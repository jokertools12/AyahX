// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalAuditJson } from '../../server/services/catalogAudit';
import { buildYoutubeVoiceMetadataSupplement, metadataMentionsName, normalizeArabicMetadataName, normalizeEnglishMetadataName, readYoutubeNameCheckpoint, type YoutubeNameMetadata, type YoutubeVoiceName } from '../../scripts/lib/d4YoutubeVoiceMetadata';
const name: YoutubeVoiceName = { slug: 'reader_one_yt', reciter_id: 'ayman_swed', name_ar: 'أيمن سويد', provider: 'youtube', V1: { passed: false, folder_classification: 'OPAQUE_FILE_OR_CHANNEL_UNVERIFIABLE' }, V2: { passed: false, status: 'unverified' }, voice_identity_status: 'unverified' };
const video = 'abcdefghijk';
const metadata: YoutubeNameMetadata = { status: 'available', checked_at: '2026-10-10T12:00:00Z', http_status: 200, title: 'سورة الفاتحة', channel_title: 'القارئ أَيْمَن سُوَيد', channel_id: null };
const link = { kind: 'chapter', recitation: name.slug, surah: 1, original_url: 'https://www.youtube.com/watch?v=' + video };
const input = 'a'.repeat(64);
function checkpoint(events: Array<Record<string, unknown>>): string {
  let previous = '0'.repeat(64);
  return [{ type: 'manifest', schema_version: 1, input_sha256: input }, ...events].map(event => {
    const body = { ...event, previous }, hash = createHash('sha256').update(canonicalAuditJson(body)).digest('hex'); previous = hash; return JSON.stringify({ ...body, hash });
  }).join('\n') + '\n';
}
const completed = () => checkpoint([{ type: 'attempt', video_id: video }, { type: 'result', video_id: video, metadata }]);
describe('actual oEmbed V1 supplement: deterministic names, no audio identity approval', () => {
  it('normalizes Arabic marks/alef/tatweel/spacing deterministically, without touching canonical Quran data', () => {
    expect(normalizeArabicMetadataName('أَيْمَن ـ سُوَيد')).toBe(normalizeArabicMetadataName('ايمنسويد'));
    expect(normalizeArabicMetadataName('على')).toBe(normalizeArabicMetadataName('علي'));
    expect(metadataMentionsName(metadata.channel_title, name)).toBe(true);
  });
  it('uses the exact full English identifier with word boundaries, without invented aliases or fuzzy spelling', () => {
    expect(normalizeEnglishMetadataName(' Ayman_SWED ')).toBe('ayman swed');
    expect(metadataMentionsName('Reciter Ayman Swed official', name)).toBe(true);
    for (const text of ['Ayman', 'Ayman Sweed', 'fakeayman swed', 'AymanSwed']) expect(metadataMentionsName(text, name)).toBe(false);
  });
  it('maps repeated videos to all chapters but counts measured videos once', () => {
    const result = buildYoutubeVoiceMetadataSupplement([name], [link, { ...link, surah: 2 }], new Map([[video, metadata]]));
    expect(result.counts).toMatchObject({ chapter_links: 2, unique_measured_videos: 1, metadata_name_matches: 1, identity_unverified: 1, identity_confirmed: 0 });
    expect(result.results[0].chapters).toHaveLength(2); expect(result.results[0].videos).toHaveLength(1);
  });
  it('never approves V1/V2/voice from a matching channel; absent audio conflict evidence remains unknown', () => {
    const original = structuredClone(name);
    const result = buildYoutubeVoiceMetadataSupplement([name], [link], new Map([[video, metadata]])).results[0];
    expect(result.V1).toMatchObject({ metadata_name_match: true, passed: false, status: 'unverified', content_fingerprint_scope: [], cross_reader_content_conflict: null });
    expect(result.V2.passed).toBe(false); expect(result.voice_identity_status).toBe('unverified');
    expect(result.license_changed).toBe(false); expect(result.offset_changed).toBe(false); expect(name).toEqual(original);
  });
  it('records unmatched names without inferring another speaker or extracting audio', () => {
    const result = buildYoutubeVoiceMetadataSupplement([name], [link], new Map([[video, { ...metadata, channel_title: 'Quran channel' }]])).results[0];
    expect(result.V1.metadata_match_state).toBe('observed_names_unmatched'); expect(result.voice_identity_status).toBe('unverified');
  });
  it('refuses changing an already human-confirmed original through this unverified-only supplement', () => {
    expect(() => buildYoutubeVoiceMetadataSupplement([{ ...name, voice_identity_status: 'confirmed' }], [link], new Map([[video, metadata]]))).toThrow('YOUTUBE_V1_SUPPLEMENT_CANNOT_CHANGE_EXISTING_IDENTITY');
  });
  it('validates the actual append-only chain and projects no URL/HTML/secret payload fields', () => {
    const content = checkpoint([{ type: 'attempt', video_id: video }, { type: 'result', video_id: video, metadata: { ...metadata, channel_url: 'https://private.example?token=DO_NOT_EXPORT', html: 'DO_NOT_EXPORT' } }]);
    const result = readYoutubeNameCheckpoint(content, input); expect(result.get(video)).toEqual(metadata); expect(JSON.stringify([...result])).not.toContain('DO_NOT_EXPORT');
  });
  it('rejects edited/truncated/other-inventory metadata rather than silently repairing it', () => {
    expect(() => readYoutubeNameCheckpoint(completed().replace('سورة الفاتحة', 'changed'), input)).toThrow('YOUTUBE_V1_CHECKPOINT_HASH_INVALID');
    expect(() => readYoutubeNameCheckpoint(completed().trimEnd(), input)).toThrow('YOUTUBE_V1_CHECKPOINT_TRUNCATED');
    expect(() => readYoutubeNameCheckpoint(completed(), 'b'.repeat(64))).toThrow('YOUTUBE_V1_CHECKPOINT_INPUT_CHANGED');
  });
  it('rejects incomplete attempts or invalid positive metadata', () => {
    expect(() => readYoutubeNameCheckpoint(checkpoint([{ type: 'attempt', video_id: video }]), input)).toThrow('YOUTUBE_V1_CHECKPOINT_INTERRUPTED');
    expect(() => readYoutubeNameCheckpoint(checkpoint([{ type: 'attempt', video_id: video }, { type: 'result', video_id: video, metadata: { ...metadata, http_status: 500 } }]), input)).toThrow('YOUTUBE_V1_METADATA_AVAILABLE_INVALID');
  });
  it('rejects missing or mismatched catalog video coverage and duplicate chapter mappings', () => {
    expect(() => buildYoutubeVoiceMetadataSupplement([name], [link], new Map())).toThrow('YOUTUBE_V1_VIDEO_INVENTORY_CHANGED');
    expect(() => buildYoutubeVoiceMetadataSupplement([name], [link, link], new Map([[video, metadata]]))).toThrow('YOUTUBE_V1_CHAPTER_DUPLICATE');
    expect(() => buildYoutubeVoiceMetadataSupplement([name], [{ ...link, original_url: 'https://evil.example/watch?v=' + video }], new Map([[video, metadata]]))).toThrow('YOUTUBE_V1_CHAPTER_REFERENCE_INVALID');
  });
});

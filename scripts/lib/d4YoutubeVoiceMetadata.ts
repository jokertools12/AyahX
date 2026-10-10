import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalAuditJson } from '../../server/services/catalogAudit';

export interface YoutubeVoiceName { slug: string; reciter_id: string; name_ar: string; provider: string; V1: Record<string, unknown>; V2: Record<string, unknown>; voice_identity_status: string }
export interface YoutubeNameMetadata { status: string; checked_at: string; http_status: number | null; title: string | null; channel_title: string | null; channel_id: string | null }
export interface YoutubeVoiceLink { kind: string; recitation: string; surah: number; original_url: string | null }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Offline catalog join only; creates no preview, request, media URL or fetch client. */
function catalogYoutubeId(raw: string): string | null {
  let url: URL; try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase())) return null;
  const id = url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.startsWith('/embed/') ? url.pathname.slice(7) : null;
  return id && /^[-_A-Za-z0-9]{11}$/u.test(id) ? id : null;
}
/** Metadata names only. Never used on canonical Quran text, translations or audio. */
export function normalizeArabicMetadataName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه').replace(/[^\p{Script=Arabic}]/gu, '');
}
export function normalizeEnglishMetadataName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
export function metadataMentionsName(text: string | null, name: YoutubeVoiceName): boolean {
  if (!text) return false;
  const arabic = normalizeArabicMetadataName(name.name_ar), english = normalizeEnglishMetadataName(name.reciter_id);
  return arabic.length >= 4 && normalizeArabicMetadataName(text).includes(arabic) || english.length >= 4 && (' ' + normalizeEnglishMetadataName(text) + ' ').includes(' ' + english + ' ');
}
/** Read-only hash-chain validation; unlike the import checkpoint opener, never creates/appends a file. */
export function readYoutubeNameCheckpoint(content: string, inputSha256: string): Map<string, YoutubeNameMetadata> {
  assert.ok(content.endsWith('\n'), 'YOUTUBE_V1_CHECKPOINT_TRUNCATED');
  const results = new Map<string, YoutubeNameMetadata>(), attempted = new Set<string>(); let previous = '0'.repeat(64);
  for (const [index, line] of content.trimEnd().split('\n').entries()) {
    const event = JSON.parse(line) as Record<string, unknown>, { hash: digest, ...body } = event;
    assert.equal(event.previous, previous, 'YOUTUBE_V1_CHECKPOINT_CHAIN_INVALID'); assert.equal(digest, hash(canonicalAuditJson(body)), 'YOUTUBE_V1_CHECKPOINT_HASH_INVALID'); previous = String(digest);
    if (index === 0) { assert.equal(event.type, 'manifest'); assert.equal(event.schema_version, 1); assert.equal(event.input_sha256, inputSha256, 'YOUTUBE_V1_CHECKPOINT_INPUT_CHANGED'); continue; }
    assert.ok(typeof event.video_id === 'string' && /^[-_A-Za-z0-9]{11}$/u.test(event.video_id), 'YOUTUBE_V1_VIDEO_INVALID');
    if (event.type === 'attempt') { assert.ok(!attempted.has(event.video_id) && !results.has(event.video_id), 'YOUTUBE_V1_CHECKPOINT_DUPLICATE'); attempted.add(event.video_id); continue; }
    assert.ok(event.type === 'result' && attempted.has(event.video_id) && !results.has(event.video_id), 'YOUTUBE_V1_CHECKPOINT_RESULT_INVALID');
    const metadata = event.metadata as YoutubeNameMetadata;
    assert.ok(metadata && typeof metadata.status === 'string' && /^[A-Za-z0-9_]+$/u.test(metadata.status) && typeof metadata.checked_at === 'string' && Number.isFinite(Date.parse(metadata.checked_at)), 'YOUTUBE_V1_METADATA_INVALID');
    assert.ok([metadata.title, metadata.channel_title, metadata.channel_id].every(value => value === null || typeof value === 'string'), 'YOUTUBE_V1_METADATA_INVALID');
    assert.ok(metadata.title === null || metadata.title.length <= 1000); assert.ok(metadata.channel_title === null || metadata.channel_title.length <= 255);
    if (metadata.status === 'available') assert.ok(metadata.http_status === 200 && metadata.title !== null && metadata.channel_title !== null, 'YOUTUBE_V1_METADATA_AVAILABLE_INVALID');
    // No provider HTML, URL, thumbnail, audio, response body or credential fields are exported.
    results.set(event.video_id, { status: metadata.status, checked_at: metadata.checked_at, http_status: metadata.http_status, title: metadata.title, channel_title: metadata.channel_title, channel_id: metadata.channel_id });
  }
  assert.equal(attempted.size, results.size, 'YOUTUBE_V1_CHECKPOINT_INTERRUPTED'); return results;
}
export function buildYoutubeVoiceMetadataSupplement(names: readonly YoutubeVoiceName[], links: readonly YoutubeVoiceLink[], metadata: ReadonlyMap<string, YoutubeNameMetadata>) {
  const seen = new Set<string>(); const mapping: Array<{ recitation: string; surah: number; video_id: string }> = [];
  for (const link of links) if (link.kind === 'chapter' && names.some(name => name.slug === link.recitation)) {
    const videoId = link.original_url && catalogYoutubeId(link.original_url); assert.ok(videoId, 'YOUTUBE_V1_CHAPTER_REFERENCE_INVALID');
    const key = link.recitation + ':' + link.surah; assert.ok(!seen.has(key), 'YOUTUBE_V1_CHAPTER_DUPLICATE'); seen.add(key);
    mapping.push({ recitation: link.recitation, surah: link.surah, video_id: videoId });
  }
  const expectedIds = new Set(mapping.map(row => row.video_id));
  assert.equal(expectedIds.size, metadata.size, 'YOUTUBE_V1_VIDEO_INVENTORY_CHANGED');
  assert.ok([...expectedIds].every(id => metadata.has(id)), 'YOUTUBE_V1_VIDEO_METADATA_MISSING');
  const results = names.map(name => {
    assert.match(name.slug, /^[a-z0-9_-]+$/u); assert.match(name.reciter_id, /^[a-z0-9_-]+$/u); assert.equal(name.provider, 'youtube'); assert.equal(name.voice_identity_status, 'unverified', 'YOUTUBE_V1_SUPPLEMENT_CANNOT_CHANGE_EXISTING_IDENTITY');
    const chapterMap = mapping.filter(row => row.recitation === name.slug).sort((a, b) => a.surah - b.surah);
    assert.ok(chapterMap.length, 'YOUTUBE_V1_RECITATION_MAPPING_MISSING');
    const videos = [...new Set(chapterMap.map(row => row.video_id))].sort().map(id => {
      const source = metadata.get(id)!;
      const titleMatch = metadataMentionsName(source.title, name), channelMatch = metadataMentionsName(source.channel_title, name);
      const otherNames = [...new Set(names.filter(other => other.reciter_id !== name.reciter_id && (metadataMentionsName(source.title, other) || metadataMentionsName(source.channel_title, other))).map(other => other.reciter_id))].sort();
      return { video_id: id, ...source, title_name_match: titleMatch, channel_name_match: channelMatch, metadata_name_match: source.status === 'available' && (titleMatch || channelMatch), other_known_reciter_names_mentioned: otherNames, evidence_scope: 'actual_oembed_metadata_not_voice_or_audio_identity' };
    });
    const matched = videos.filter(video => video.metadata_name_match).length;
    const channels = [...new Set(videos.map(video => video.channel_title).filter((title): title is string => title !== null))].sort();
    return { slug: name.slug, reciter_id: name.reciter_id, expected_name_ar: name.name_ar, expected_english_identifier: name.reciter_id, original_V1_sha256: hash(canonicalAuditJson(name.V1)), original_V1: name.V1,
      V1: { passed: false, status: 'unverified', folder_classification: 'ACTUAL_YOUTUBE_OEMBED_PROVENANCE_ONLY', metadata_name_match: matched === videos.length, metadata_match_state: matched === videos.length ? 'all_observed_names_match' : matched ? 'partial_observed_name_match' : 'observed_names_unmatched', content_fingerprint_scope: [], cross_reader_content_conflict: null, cross_reader_content_conflict_status: 'not_evaluated_no_audio_fingerprints', reasons: ['YOUTUBE_AUDIO_FINGERPRINTS_UNAVAILABLE', 'METADATA_NAMES_DO_NOT_PROVE_VOICE_IDENTITY'] },
      V2: { passed: false, status: 'unverified', original_evidence_sha256: hash(canonicalAuditJson(name.V2)), reason: 'NO_NEW_ACTUAL_AUDIO_ALIGNER_EVIDENCE' },
      voice_identity_status: 'unverified', chapter_links: chapterMap.length, unique_videos: videos.length, matched_videos: matched, title_match_videos: videos.filter(video => video.title_name_match).length, channel_match_videos: videos.filter(video => video.channel_name_match).length, channels, chapters: chapterMap, videos,
      human_confirmation_changed: false, license_changed: false, publication_changed: false, offset_changed: false, metadata_only: true,
    };
  }).sort((a, b) => a.slug.localeCompare(b.slug));
  return { schema_version: 1, actor: 'deterministic-oembed-metadata-supplement-v1', scope: 'Append-only V1 provenance supplement; original auto-verification artifact remains unchanged',
    normalization_policy: { arabic: 'NFKD, remove combining marks/tatweel, alef variants→alef, ى→ي, ة→ه, remove non-Arabic characters; full expected Arabic name substring', english: 'NFKD, remove combining marks, lowercase, punctuation/underscores→spaces; exact full reciter_id token sequence with boundaries', prohibited: ['AI matching', 'fuzzy distance', 'invented transliteration or spelling aliases', 'matching first name alone', 'audio extraction'] },
    counts: { recitations: results.length, chapter_links: mapping.length, unique_measured_videos: metadata.size, metadata_name_matches: results.filter(row => row.V1.metadata_name_match).length, identity_unverified: results.length, identity_confirmed: 0, identity_auto_verified: 0 }, results,
    network_requests: 0, database_writes: 0, audio_downloads: 0, original_artifact_mutations: 0, filesystem_deletions: 0,
  };
}

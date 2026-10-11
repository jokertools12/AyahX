// @vitest-environment node
// Mock DB/source contracts here are units only; live DB/audio acceptance is separate.
import { describe, expect, it, vi } from 'vitest';
import { CatalogRenderManifestService } from '../../server/services/catalogRenderManifest';
import { RenderManifestV2Schema, RenderManifestV2RequestSchema, toRenderManifestV1Internal } from '../../server/models/renderManifestV2';
import type { CatalogRow } from '../../server/services/catalogContracts';
import type { StorageAudioPlan } from '../../server/services/licensedSourceResolver';
import { assertTimelineValid, toRenderTimeline } from '../../shared/timing/toRenderTimeline';

const checksum = 'a'.repeat(64), url = 'https://media.example.com/source.mp3';
const request = { recitationId: 'r1', surah: 1, from: 1, to: 2, options: {}, qa: true as const };
function fixture() {
  const recitation: CatalogRow = { id: 'r1', slug: 'recording', reciter_id: 'reader', reciter_name: 'قارئ', provider: 'mp3quran', channel: 'source',
    provider_active: 1, host_allowlist: ['media.example.com'], license_text: null, canonical_text_available: 1, timing_quality: 'verified', timing_level: 'word',
    riwayah_code: 'hafs_an_asim', status: 'published', published_by: 'rule-v1', audio_mode: 'surah_slice', offset_verified: 1, offset_check_score: .99, verification_status: 'passed', verification_method: 'v1' };
  const chapter: CatalogRow = { coverage_mismatch: 0, chapter_offset_ms: 60000, audio_url: url, surah_name: 'الفاتحة', ayah_count: 2, is_enabled: 1 };
  const canonical = [1, 2].flatMap(ayah => ['كلمة', 'أخرى'].map((text, i) => ({ id: `a${ayah}`, ayah, text_uthmani: 'كلمة أخرى', words_count: 2, position: i + 1, word_text: text })));
  let timings: CatalogRow[] = [1, 2].map(ayah => ({ ayah, ayah_id: `a${ayah}`, coordinate: 'source_ms', source: 'qud', source_offset_ms: null,
    words: [[1, 0, ayah * 1000, ayah * 1000 + 200], [2, 1, ayah * 1000 + 250, ayah * 1000 + 500]], quality: 'aligned', review_status: 'ready',
    review_reasons: [], word_highlight_enabled: 1, coverage_words: 2, expected_words: 2, missing_words: [], version_hash: 'b'.repeat(64), canonical_checksum: checksum, qud_version: 'v3.2.0', source_sha256: 'c'.repeat(64) }));
  let conflicts: CatalogRow[] = [], licensed: StorageAudioPlan | null = null;
  const read = vi.fn(async (sql: string) => {
    if (sql.includes('FROM recitations r JOIN reciters')) return [recitation];
    if (sql.includes('FROM human_review_items')) return conflicts;
    if (sql.includes('FROM recitation_chapters c JOIN quran_surahs')) return [chapter];
    if (sql.includes('FROM quran_text_versions')) return [{ id: 'v1', checksum }];
    if (sql.includes('FROM quran_ayahs a JOIN quran_words')) return canonical;
    if (sql.includes('FROM ayah_timings')) return timings;
    throw new Error('UNEXPECTED_QUERY');
  });
  const checkLink = vi.fn(async (raw: string) => ({ status: 'available', httpStatus: 200, checkedAt: new Date().toISOString(), finalUrl: raw }));
  return { service: new CatalogRenderManifestService({ db: { read }, source: { checkLink }, licensedResolver: { resolveLicensedSource: async () => licensed } }),
    recitation, chapter, canonical, read, checkLink, get timings() { return timings; }, set timings(value: CatalogRow[]) { timings = value; },
    set conflicts(value: CatalogRow[]) { conflicts = value; }, set licensed(value: StorageAudioPlan | null) { licensed = value; } };
}

describe('D7 server-authoritative v2 manifest units', () => {
  it('builds only DB canonical words, clips at first timing and hashes deterministically', async () => {
    const f = fixture(), a = await f.service.build(request), b = await f.service.build(request);
    expect(a.schemaVersion).toBe('2.0.0'); expect(a.timeline).toMatchObject({ coordinate: 'render_ms', durationMs: 1650, sourceWindow: { fromMs: 60850, toMs: 62500 } });
    expect(a.timeline.ayahs[1].words[0].startMs).toBe(1150);
    expect(a.audioPlanHash).toBe(b.audioPlanHash); expect(a.timingVersionHash).toBe(b.timingVersionHash);
    expect(a.canonicalAyahRange.ayahs[0].words[0].text).toBe('كلمة'); expect(a.options.fontFamily).toBe('Amiri Quran');
    const legacy = toRenderManifestV1Internal(a, 'local-prepared.wav');
    expect(legacy.renderV2Timeline).toEqual(a.timeline); expect(legacy.renderV2CanonicalAyahs).toEqual(a.canonicalAyahRange.ayahs);
    expect(legacy.audio.audioUrl).toBe('local-prepared.wav'); expect(legacy.audio.rangeMs).toBeUndefined(); expect(legacy.timingMap.words[0].confidence).toBeUndefined();
  });
  it.each(['audioUrl', 'timingMap', 'timeline', 'audioPlan'])('rejects client %s before DB/network', async key => {
    const f = fixture(); await expect(f.service.build({ ...request, [key]: 'untrusted' })).rejects.toMatchObject({ code: 'RENDER_V2_REQUEST_INVALID' }); expect(f.read).not.toHaveBeenCalled(); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it('rejects URL-bearing or timing-bearing options and unapproved fonts', () => {
    for (const options of [{ audioUrl: url }, { backgroundUrl: url }, { startMs: 1 }, { fontFamily: 'Cairo' }, { padMs: 151 }, { fps: 45 }]) expect(RenderManifestV2RequestSchema.safeParse({ ...request, options }).success).toBe(false);
  });
  it('reports only actual complete word ranges and never trusts paper coverage', async () => {
    const f = fixture(); f.timings[1].words = [[1, 0, 2000, 2500]];
    await expect(f.service.build(request)).rejects.toMatchObject({ code: 'RANGE_NOT_AVAILABLE', details: { available_runs: [[1, 1]] } }); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it.each([
    { words: [[1, 0, 1000, 1100], [2, 0, 1150, 1500]] },
    { words: [[1, 0, 1000, 1200], [2, 1, 1190, 1500]] },
    { words: [[1, 0, 1000.5, 1200], [2, 1, 1250, 1500]] },
    { coordinate: 'clip_ms', source_offset_ms: null }, { canonical_checksum: 'd'.repeat(64) },
    { source: 'aligner', review_status: 'ready' }, { expected_words: 3 }, { missing_words: [[1, 'MISSING']] },
  ])('rejects stored corruption/unapproved timing without fetch %j', async change => {
    const f = fixture(); Object.assign(f.timings[0], change); await expect(f.service.build(request)).rejects.toMatchObject({ code: 'RANGE_NOT_AVAILABLE', details: { available_runs: [[2, 2]] } }); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it('refuses a range over 90 seconds with a stable error before source access', async () => {
    const f = fixture(); f.timings[1].words = [[1, 0, 100000, 100200], [2, 1, 100250, 100500]];
    await expect(f.service.build(request)).rejects.toMatchObject({ code: 'MAX_RENDER_DURATION_EXCEEDED', status: 422 }); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it('allows fully covered review or estimated rows only as ayah highlight', async () => {
    const f = fixture(); f.timings[0].review_status = 'needs_review'; f.timings[0].review_reasons = ['REVIEW']; f.timings[0].word_highlight_enabled = 0; f.timings[1].quality = 'estimated';
    const manifest = await f.service.build(request); expect(manifest.timeline.ayahs.every(a => a.highlightMode === 'ayah' && a.words.length === 0)).toBe(true);
    expect(manifest.warnings.map(w => w.code)).toEqual(['NEEDS_REVIEW', 'ESTIMATED_TIMING']); expect(toRenderManifestV1Internal(manifest).timingMap.words).toEqual([]);
  });
  it('preserves stored repetition mapping, backward canonical indexes and occurrence identity', async () => {
    const f = fixture(); f.timings[0].words = [[1, 0, 1000, 1100], [2, 1, 1150, 1300], [1, 2, 1350, 1500]];
    const manifest = await f.service.build(request); expect(manifest.timeline.ayahs[0].words.map(w => w.wordIndex)).toEqual([1, 2, 1]); expect(new Set(manifest.timeline.ayahs[0].words.map(w => w.occurrenceId)).size).toBe(3);
  });
  it('ignores spoken text for legal display and binds timing content rather than stored version label alone', async () => {
    const f = fixture(), first = await f.service.build(request); f.timings[0].spoken_text = 'نص مكرر'; f.timings[0].words = [[1, 0, 1000, 1190], [2, 1, 1250, 1500]];
    const second = await f.service.build(request); expect(second.canonicalAyahRange).toEqual(first.canonicalAyahRange); expect(second.timingVersionHash).not.toBe(first.timingVersionHash); expect(second.audioPlanHash).toBe(first.audioPlanHash);
  });
  it.each([{ offset_verified: 0 }, { timing_quality: 'estimated' }, { published_by: 'manual' }, { riwayah_code: 'warsh_an_nafi' }])('rejects ineligible recitation %j', async change => {
    const f = fixture(); Object.assign(f.recitation, change); await expect(f.service.build(request)).rejects.toMatchObject({ code: 'RECITATION_NOT_TECHNICALLY_ELIGIBLE' }); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it('YouTube refusal precedes technical eligibility', async () => {
    const f = fixture(); Object.assign(f.recitation, { provider: 'youtube', offset_verified: 0, timing_quality: 'unverified' });
    await expect(f.service.build(request)).rejects.toMatchObject({ code: 'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE' }); expect(f.read).toHaveBeenCalledTimes(1); expect(f.checkLink).not.toHaveBeenCalled();
  });
  it('blocks a same-audio conflict even with published status', async () => {
    const f = fixture(); f.conflicts = [{ type: 'same_audio_conflict', subject_type: 'audio_conflict', evidence: { recitation_ids: ['r1'] } }];
    await expect(f.service.build(request)).rejects.toMatchObject({ code: 'RECITATION_NOT_TECHNICALLY_ELIGIBLE', details: { reason: 'SAME_AUDIO_CONFLICT' } });
  });
  it('preserves SSRF refusal and does not fall back when source unavailable', async () => {
    const f = fixture(); f.chapter.audio_url = 'https://127.0.0.1/secret'; await expect(f.service.build(request)).rejects.toMatchObject({ code: 'AUDIO_URL_UNSAFE' }); expect(f.checkLink).not.toHaveBeenCalled();
    f.chapter.audio_url = url; f.checkLink.mockResolvedValue({ status: 'source_unavailable', httpStatus: 404, checkedAt: new Date().toISOString(), finalUrl: url });
    await expect(f.service.build(request)).rejects.toMatchObject({ code: 'AUDIO_UNAVAILABLE' }); expect(f.checkLink).toHaveBeenCalledTimes(1);
  });
  it('licensed R2 manifests store object identity, not signed credentials or provider URLs', async () => {
    const f = fixture(); Object.assign(f.recitation, { provider: 'youtube', offset_verified: 0, status: 'imported' });
    f.licensed = { kind: 'licensed_file', recitationId: 'r1', surah: 1, sourceId: 'source-1', storageObjectId: 'object-1', adapter: 'r2', bucket: 'unit-only', objectKey: `test/${checksum}.wav`, sha256: checksum, durationMs: 65000, sourceChapterOffsetMs: 60000,
      offsetEvidence: { method: 'v1', recitationId: 'r1', sourceSha256: checksum, sourceSurah: 1, sourceChapterOffsetMs: 60000, qudVersion: 'v3.2.0', protocol: 'distributed_3_surahs_interior_300ms',
        samples: [{ surah: 1, ayah: 1, chapterAyahCount: 7 }, { surah: 1, ayah: 4, chapterAyahCount: 7 }, { surah: 36, ayah: 2, chapterAyahCount: 83 }, { surah: 36, ayah: 70, chapterAyahCount: 83 }, { surah: 112, ayah: 4, chapterAyahCount: 4 }].map(s => ({ ...s, ncc: .99, lagMs: 0, durationDifferenceMs: 0 })) } };
    const manifest = await f.service.build(request); expect(manifest.audioPlan.sourceIdentity.kind).toBe('licensed_r2'); expect(manifest.audioPlan.parts[0].url).toBe(''); expect(manifest.audioPlan.fallbackReason).toBe('EXPLICIT_LICENSED_SAME_RECORDING'); expect(f.checkLink).not.toHaveBeenCalled();
    expect(JSON.stringify(manifest)).not.toContain('Signature');
  });
  it('schema rejects tampered intervals, unrecorded gaps and canonical mismatches', async () => {
    const good = await fixture().service.build(request);
    for (const edit of [(m: typeof good) => { m.timeline.ayahs[0].words[0].startMs = -1; }, (m: typeof good) => { m.timeline.gaps = []; }, (m: typeof good) => { m.timeline.ayahs[0].words[0].canonicalWordKey = '1:2:1'; }, (m: typeof good) => { m.audioPlan.parts[0].sliceFromMs++; }]) { const altered = structuredClone(good); edit(altered); expect(RenderManifestV2Schema.safeParse(altered).success).toBe(false); }
  });
});

describe('D7 integer timeline properties (synthetic unit ranges, not live acceptance)', () => {
  it('checks 5000 deterministic randomized ranges, coordinate modes, repetition and crop invariants', () => {
    let seed = 1729; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let trial = 0; trial < 5000; trial++) {
      const offset = random() % 600000, padMs = random() % 151, count = 1 + random() % 10, coordinate = trial % 2 ? 'clip_ms' as const : 'source_ms' as const;
      let start = random() % 1000;
      const rows = Array.from({ length: count }, (_, i) => { start += 500 + random() % 1000; return { ayah: i + 5, source: 'qud', coordinate, source_offset_ms: coordinate === 'clip_ms' ? offset : null,
        words: [[1, 0, start, start + 100], [2, 1, start + 120, start + 250], [1, 2, start + 270, start + 400]] as Array<[number, number, number, number]> }; });
      const result = toRenderTimeline(rows, { chapterOffsetMs: offset, sourceFormat: 'qud_release', padMs, allowAyahOnly: true });
      assertTimelineValid(result, result.durationMs); expect(result.sourceWindow.fromMs).toBe(Math.max(0, rows[0].words[0][2] + offset - padMs)); expect(result.ayahs[0].words.map(w => w[0])).toEqual([1, 2, 1]);
      expect(result.ayahs.at(-1)!.endMs).toBe(result.durationMs);
    }
  });
  it('retains legacy null-index refusal and validates bounded integer source windows', () => {
    const row = { ayah: 1, coordinate: 'source_ms' as const, source: 'qud', source_offset_ms: null, words: [[null, 0, 100, 500]] as Array<[null, number, number, number]> };
    expect(() => toRenderTimeline([row], { chapterOffsetMs: 0, sourceFormat: 'qud_release', padMs: 0 })).toThrow('TIMELINE_WORD_INVALID');
    const timeline = toRenderTimeline([row], { chapterOffsetMs: 0, sourceFormat: 'qud_release', padMs: 0, allowAyahOnly: true }); expect(timeline.ayahs[0].words).toEqual([]);
    expect(() => assertTimelineValid(timeline, 199)).toThrow(); expect(() => assertTimelineValid(timeline, 400.5)).toThrow();
  });
});

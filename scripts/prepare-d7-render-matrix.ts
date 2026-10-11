/** Select real D7 QA cases only. Local SELECTs; no rendering, fixture writes or HTTP. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { assertTimelineValid, toRenderTimeline, type SourceAyahTiming } from '../shared/timing/toRenderTimeline';
import { hasVerifiedCatalogOffset } from '../server/services/recitationAudioResolver';
import { connectedAyahRuns } from '../server/services/recitationAvailability';

const at = process.argv.indexOf('--out'); assert.ok(at >= 0 && process.argv[at + 1], 'PRIVATE_OUTPUT_REQUIRED');
const out = resolve(process.argv[at + 1]), inRepo = relative(resolve('.'), out);
assert.ok(inRepo.startsWith('..') || isAbsolute(inRepo), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
const database = process.env.AYAHX_D7_LOCAL_SCHEMA ?? 'ayahx_d2_d7_verified_20261011';
assert.match(database, /^ayahx_d2_(?:d7_restored|d7_verified|a1_verified)_\d{8}$/u, 'LOCAL_RESTORED_SCHEMA_ONLY');
const parse = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
type Timing = SourceAyahTiming & { expected_words: number; coverage_words: number; legal_words: number; missing: unknown; canonical_match: boolean; version_hash: string };
type Chapter = RowDataPacket & { recitation_id: string; surah: number; ayah_count: number; chapter_offset_ms: number | null; provider: string; slug: string; reciter_name: string; availability_state: string };
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database, charset: 'utf8mb4', multipleStatements: false });
const cases: Array<Record<string, unknown>> = [], absent: Array<Record<string, unknown>> = [], cache = new Map<string, Timing[]>();
const valid = (row: Timing): boolean => row.canonical_match && row.expected_words === row.legal_words && row.coverage_words === row.expected_words
  && Array.isArray(row.missing) && row.missing.length === 0 && row.words.length > 0
  && new Set(row.words.map(w => w[0])).size === row.expected_words && row.words.every(([index, occurrence, start, end], i, words) => index !== null && Number.isSafeInteger(index) && index >= 1 && index <= row.expected_words
    && Number.isSafeInteger(occurrence) && occurrence >= 0 && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && (!i || start >= words[i - 1][3]))
  && new Set(row.words.map(w => w[1])).size === row.words.length && (row.source !== 'aligner' || row.review_status === 'approved');
const read = async (chapter: Chapter): Promise<Timing[]> => {
  const key = `${chapter.recitation_id}:${chapter.surah}`, cached = cache.get(key); if (cached) return cached;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT t.ayah,t.coordinate,t.source,t.source_offset_ms,t.words,t.review_status,t.quality,t.word_highlight_enabled,t.version_hash,
    t.coverage_words,t.expected_words,t.missing_words,a.words_count legal_words,(t.ayah_id=a.id AND t.canonical_checksum IS NOT NULL) canonical_match
    FROM ayah_timings t LEFT JOIN quran_ayahs a ON a.surah=t.surah AND a.ayah=t.ayah
    WHERE t.recitation_id=? AND t.surah=? ORDER BY t.ayah`, [chapter.recitation_id, chapter.surah]);
  const result = rows.map(row => ({ ayah: Number(row.ayah), coordinate: row.coordinate, source: row.source, source_offset_ms: row.source_offset_ms === null ? null : Number(row.source_offset_ms),
    words: parse(row.words), review_status: row.review_status, quality: row.quality, word_highlight_enabled: Number(row.word_highlight_enabled) === 1,
    version_hash: row.version_hash, expected_words: Number(row.expected_words), coverage_words: Number(row.coverage_words), legal_words: Number(row.legal_words),
    missing: parse(row.missing_words), canonical_match: Number(row.canonical_match) === 1 } as Timing));
  cache.set(key, result); if (cache.size > 16) cache.delete(cache.keys().next().value!); return result;
};
const candidate = async (chapter: Chapter, from: number, to: number, requireComplete = false): Promise<Record<string, unknown> | null> => {
  const rows = await read(chapter), selected = rows.filter(row => row.ayah >= from && row.ayah <= to);
  if (selected.length !== to - from + 1 || selected.some((row, index) => row.ayah !== from + index || !valid(row))) return null;
  if (requireComplete && (chapter.availability_state !== 'complete' || Number(chapter.is_complete) !== 1 || rows.length !== chapter.ayah_count || rows.some(row => !valid(row)))) return null;
  const timeline = toRenderTimeline(selected, { chapterOffsetMs: Number(chapter.chapter_offset_ms ?? 0), sourceFormat: 'qud_release', padMs: 150, allowAyahOnly: true });
  assertTimelineValid(timeline, timeline.durationMs, 0); if (timeline.durationMs > 90_000) return null;
  return { recitation_id: chapter.recitation_id, recitation_slug: chapter.slug, reciter: chapter.reciter_name, provider: chapter.provider, riwayah: chapter.riwayah_code,
    surah: chapter.surah, from, to, expected_duration_ms: timeline.durationMs, source_window_ms: timeline.sourceWindow,
    expected_word_events: timeline.ayahs.reduce((count, ayah) => count + ayah.words.length, 0), ayah_only: timeline.ayahs.filter(ayah => ayah.highlightMode === 'ayah').map(ayah => ({ ayah: ayah.ayah, reason: ayah.highlightReason })),
    repetition_occurrences: selected.reduce((count, row) => count + row.words.length - new Set(row.words.map(word => word[0])).size, 0),
    source_versions_sha256: createHash('sha256').update(selected.map(row => row.version_hash).join('\n')).digest('hex'),
    request: { recitationId: chapter.recitation_id, surah: chapter.surah, from, to, options: {}, qa: true }, expected_result: 'SUCCESS', measured: false };
};
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() version'); assert.equal(version[0].version, '9.7.2');
  const [all] = await db.query<Chapter[]>(`SELECT c.recitation_id,c.surah,c.chapter_offset_ms,c.availability_state,c.is_complete,c.is_enabled,c.coverage_mismatch,
    r.slug,r.riwayah_code,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,r.audio_mode,r.timing_quality,
    p.code provider,rc.name_ar reciter_name,s.ayah_count FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id
    JOIN audio_providers p ON p.id=r.provider_id JOIN reciters rc ON rc.id=r.reciter_id JOIN quran_surahs s ON s.number=c.surah
    WHERE r.status='published' AND r.published_by='rule-v1' AND r.canonical_text_available=1 AND r.riwayah_code='hafs_an_asim'
    AND r.audio_mode='surah_slice' AND r.timing_quality='verified' AND COALESCE(c.is_enabled,1)=1 AND COALESCE(c.coverage_mismatch,1)=0
    ORDER BY p.code,r.slug,c.surah`);
  const eligible = all.filter(chapter => hasVerifiedCatalogOffset(chapter));
  const providers = ['mp3quran', 'quranicaudio', 'archive_org'];
  for (const provider of providers) {
    const slugs = [...new Set(eligible.filter(chapter => chapter.provider === provider).map(chapter => chapter.slug))]; let chosen = false;
    for (const slug of slugs) {
      const chapters = eligible.filter(chapter => chapter.slug === slug && chapter.availability_state === 'complete');
      let short: Record<string, unknown> | null = null, tail: Record<string, unknown> | null = null;
      for (const chapter of [...chapters].sort((a, b) => a.ayah_count - b.ayah_count || a.surah - b.surah)) if (chapter.ayah_count <= 20) { short = await candidate(chapter, 1, chapter.ayah_count, true); if (short) break; }
      for (const chapter of [...chapters].sort((a, b) => b.ayah_count - a.ayah_count || a.surah - b.surah)) if (chapter.ayah_count >= 50) { tail = await candidate(chapter, chapter.ayah_count - 9, chapter.ayah_count, true); if (tail) break; }
      if (short && tail) { cases.push({ id: `${provider}-short-complete`, ...short }, { id: `${provider}-long-last-ten`, ...tail }); chosen = true; break; }
    }
    if (!chosen) absent.push({ case: `${provider}-two-surahs`, status: 'SOURCE_SELECTION_UNAVAILABLE', reason: 'No same eligible recitation has a complete short chapter and complete long chapter final ten ayahs within 90 seconds.' });
  }
  let repeated = false, review = false, long = false, incomplete = false;
  for (const chapter of eligible) {
    if (repeated && review && long && incomplete) break;
    const rows = await read(chapter), legal = rows.filter(valid);
    if (!repeated && chapter.availability_state === 'complete' && Number(chapter.is_complete) === 1) {
      const row = legal.find(value => value.words.length > new Set(value.words.map(word => word[0])).size);
      if (row) { const selected = await candidate(chapter, row.ayah, row.ayah, true); if (selected) { cases.push({ id: 'real-repetition', ...selected }); repeated = true; } }
    }
    if (!review) { const row = legal.find(value => value.review_status === 'needs_review'); if (row) { const selected = await candidate(chapter, row.ayah, row.ayah); if (selected) { cases.push({ id: 'real-needs-review-full-coverage', ...selected }); review = true; } } }
    if (!long) for (const [start, end] of connectedAyahRuns(legal.map(row => row.ayah))) {
      for (let to = start; to <= Math.min(end, start + 30); to++) { const selected = await candidate(chapter, start, to); if (selected && Number(selected.expected_duration_ms) >= 60_000) { cases.push({ id: 'long-60-to-90-seconds', ...selected }); long = true; break; } }
      if (long) break;
    }
    if (!incomplete) {
      const seen = new Set(legal.map(row => row.ayah)); let missing = 0; for (let ayah = 1; ayah <= chapter.ayah_count; ayah++) if (!seen.has(ayah)) { missing = ayah; break; }
      if (missing) { cases.push({ id: 'real-incomplete-range', recitation_id: chapter.recitation_id, recitation_slug: chapter.slug, provider: chapter.provider, surah: chapter.surah,
        from: Math.max(1, missing - 1), to: Math.min(chapter.ayah_count, missing + 1), expected_result: 'RANGE_NOT_AVAILABLE', expected_available_runs: connectedAyahRuns(legal.map(row => row.ayah)), measured: false,
        request: { recitationId: chapter.recitation_id, surah: chapter.surah, from: Math.max(1, missing - 1), to: Math.min(chapter.ayah_count, missing + 1), options: {}, qa: true } }); incomplete = true; }
    }
  }
  for (const [id, found] of [['real-repetition', repeated], ['real-needs-review-full-coverage', review], ['long-60-to-90-seconds', long], ['real-incomplete-range', incomplete]] as const)
    if (!found) absent.push({ case: id, status: 'CONDITIONAL_CASE_NOT_FOUND', reason: 'No source row satisfying the unmodified eligibility, coverage, source interval and duration gates; no fabricated fixture.' });
  const [youtube] = await db.query<RowDataPacket[]>(`SELECT r.id,r.slug,c.surah FROM recitations r JOIN audio_providers p ON p.id=r.provider_id JOIN recitation_chapters c ON c.recitation_id=r.id
    WHERE p.code='youtube' AND NOT EXISTS(SELECT 1 FROM recitation_source_urls u WHERE u.recitation_id=r.id AND u.is_active=1 AND u.kind='licensed_file') ORDER BY r.slug,c.surah LIMIT 1`);
  if (youtube[0]) cases.push({ id: 'youtube-without-licensed-file', recitation_id: youtube[0].id, recitation_slug: youtube[0].slug, surah: Number(youtube[0].surah), expected_result: 'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE', measured: false,
    request: { recitationId: youtube[0].id, surah: Number(youtube[0].surah), from: 1, to: 1, options: {}, qa: true } });
  else absent.push({ case: 'youtube-without-licensed-file', status: 'CONDITIONAL_CASE_NOT_FOUND' });
  absent.push({ case: 'licensed-owned-r2-test-file', status: 'ROOT_OPERATOR_FIXTURE_REQUIRED', reason: 'Root must supply its explicitly owned/licensed R2 test source and verified source identity; this read-only script never creates it.' },
    { case: 'legacy-v1', status: 'ROOT_OPERATOR_V1_RENDER_REQUIRED', reason: 'Use an unchanged existing v1 manifest; source selection is not a render acceptance result.' });
  const result = { prepared_at: new Date().toISOString(), database, mysql_version: version[0].version, local_only: true, read_only: true, execution_performed: false,
    eligible_recitations: new Set(eligible.map(chapter => chapter.recitation_id)).size, providers_requested: providers,
    cases, unavailable_or_operator_cases: absent, matrix_sha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    notes: ['Private QA bypasses the public flag only; this script does not mutate voice/license/public flags.', 'Contains no audio URL, signed URL, credential, Quran text or full timing arrays.', 'Intervals are DB-derived predictions; root must measure real FFmpeg/video/audio output.'] };
  await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, cases: cases.length, unavailable: absent.length, eligible_recitations: result.eligible_recitations, matrix_sha256: result.matrix_sha256 }));
} finally { await db.end(); }

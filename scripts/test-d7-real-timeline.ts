/** D7 corpus properties. Local MySQL SELECT only; no mocks, audio, HTTP or writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { assertTimelineValid, toRenderTimeline, type SourceAyahTiming, type RenderTimeline } from '../shared/timing/toRenderTimeline';
import { hasVerifiedCatalogOffset } from '../server/services/recitationAudioResolver';

const option = (name: string): string | undefined => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const database = process.env.AYAHX_D7_LOCAL_SCHEMA ?? 'ayahx_d2_d7_verified_20261011';
assert.match(database, /^ayahx_d2_(?:d7_restored|d7_verified|a1_verified)_\d{8}$/u, 'LOCAL_RESTORED_SCHEMA_ONLY');
const seed = Number(option('--seed') ?? 730071);
const iterations = Number(option('--iterations') ?? 10_000);
assert.ok(Number.isSafeInteger(seed) && seed > 0 && seed <= 0xffff_ffff, 'INVALID_SEED');
assert.ok(Number.isSafeInteger(iterations) && iterations >= 10_000, 'AT_LEAST_TEN_THOUSAND_REQUIRED');
const out = resolve(option('--out') ?? 'docs/data/d7-timeline-property-proof.json');
const parse = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
type Group = { recitationId: string; surah: number; chapterOffsetMs: number; runs: Array<[number, number]> };
type Timing = SourceAyahTiming & { version_hash: string; expected_words: number; coverage_words: number; legal_words: number };
let state = seed >>> 0;
const random = (size: number): number => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % size; };
const report: Record<string, unknown> = { checked_at: new Date().toISOString(), local_only: true, read_only: true, database, seed, requested_ranges: iterations,
  audio_measurement: 'NOT_PERFORMED: algebraic source/render properties only', passed: false };
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database, charset: 'utf8mb4', multipleStatements: false });
let completed = 0, wordChecks = 0, repetitionRanges = 0, failureContext: Record<string, unknown> | undefined;
let rejectedOverlaps = 0;
const overlapEvidence: Array<Record<string,unknown>> = [];
const uniqueVersions = new Map<string, string>(), rangeHash = createHash('sha256'), visitedGroups = new Set<string>();
const cache = new Map<string, Timing[]>();
const readChapter = async (group: Group): Promise<Timing[]> => {
  const key = `${group.recitationId}:${group.surah}`, hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const [rows] = await db.query<RowDataPacket[]>(`SELECT t.ayah,t.coordinate,t.source,t.source_offset_ms,t.words,t.review_status,t.quality,t.word_highlight_enabled,
    t.coverage_words,t.expected_words,t.missing_words,t.review_reasons,t.version_hash,a.words_count legal_words
    FROM ayah_timings t JOIN quran_ayahs a ON a.id=t.ayah_id
    WHERE t.recitation_id=? AND t.surah=? ORDER BY t.ayah`, [group.recitationId, group.surah]);
  const timings = rows.map(row => {
    const words = parse(row.words); assert.ok(Array.isArray(words), 'SOURCE_WORD_ARRAY_REQUIRED');
    return { ayah: Number(row.ayah), coordinate: String(row.coordinate), source: String(row.source), source_offset_ms: row.source_offset_ms === null ? null : Number(row.source_offset_ms),
      words, review_status: String(row.review_status), quality: String(row.quality), word_highlight_enabled: Number(row.word_highlight_enabled) === 1,
      expected_words: Number(row.expected_words), coverage_words: Number(row.coverage_words), legal_words: Number(row.legal_words), version_hash: String(row.version_hash),
      missing: parse(row.missing_words), reasons: parse(row.review_reasons) } as Timing & { missing: unknown; reasons: unknown };
  });
  cache.set(key, timings); if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return timings;
};
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() version'); assert.equal(version[0].version, '9.7.2'); report.mysql_version = version[0].version;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT r.id,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,c.surah,c.chapter_offset_ms,c.available_runs FROM recitations r
    JOIN recitation_chapters c ON c.recitation_id=r.id WHERE r.riwayah_code='hafs_an_asim' AND r.canonical_text_available=1
    AND r.status='published' AND r.published_by='rule-v1' AND r.audio_mode='surah_slice' AND r.timing_quality='verified'
    AND COALESCE(c.is_enabled,1)=1 AND COALESCE(c.coverage_mismatch,1)=0 AND c.run_count>0 ORDER BY r.slug,c.surah`);
  const groups: Group[] = rows.filter(hasVerifiedCatalogOffset).map(row => ({ recitationId: String(row.id), surah: Number(row.surah), chapterOffsetMs: Number(row.chapter_offset_ms ?? 0), runs: parse(row.available_runs) as Group['runs'] }));
  assert.ok(groups.length > 0, 'REAL_READY_RANGES_REQUIRED');
  for (const group of groups) assert.ok(Array.isArray(group.runs) && group.runs.length && group.runs.every(run => Array.isArray(run) && run.length === 2 && run.every(Number.isSafeInteger) && run[0] > 0 && run[1] >= run[0]), 'RUN_METADATA_INVALID');
  report.candidate_chapters = groups.length;
  let golden: RenderTimeline | undefined, goldenSource: SourceAyahTiming[] | undefined, goldenOffset = 0;
  for (let n = 0; completed < iterations; n++) {
    assert.ok(n < iterations * 2,'EXCESSIVE_SOURCE_REFUSALS');
    const group = groups[random(groups.length)], run = group.runs[random(group.runs.length)];
    const from = run[0] + random(run[1] - run[0] + 1), to = from + random(Math.min(20, run[1] - from + 1)), padMs = random(151);
    failureContext = { iteration: n, recitation_id: group.recitationId, surah: group.surah, from, to, pad_ms: padMs };
    const chapter = await readChapter(group), source = chapter.filter(row => row.ayah >= from && row.ayah <= to) as Array<Timing & { missing: unknown; reasons: unknown }>;
    assert.equal(source.length, to - from + 1, 'SOURCE_RANGE_INCOMPLETE');
    source.forEach((row, index) => {
      assert.equal(row.ayah, from + index); assert.equal(row.review_status, 'ready'); assert.equal(row.coverage_words, row.expected_words); assert.equal(row.expected_words, row.legal_words);
      assert.deepEqual(row.missing, []); assert.deepEqual(row.reasons, []); assert.equal(row.word_highlight_enabled, true);
      assert.equal(new Set(row.words.map(word => word[0])).size, row.expected_words, 'CANONICAL_WORD_COVERAGE');
      uniqueVersions.set(`${group.recitationId}:${group.surah}:${row.ayah}`, row.version_hash);
    });
    let timeline: RenderTimeline;
    try { timeline = toRenderTimeline(source, { chapterOffsetMs: group.chapterOffsetMs, sourceFormat: 'qud_release', padMs, allowAyahOnly: true }); }
    catch(error) {
      // A real Release range may overlap across ayahs although each ayah has
      // full canonical coverage. Test refusal explicitly; never repair or pass it.
      const sourceOverlap = source.slice(1).some((row,index)=>
        Math.min(...row.words.map(word=>word[2])) < Math.max(...source[index].words.map(word=>word[3])));
      if(!(error instanceof Error && error.message==='TIMELINE_AYAH_INTERVAL_INVALID' && sourceOverlap))throw error;
      rejectedOverlaps++;
      if(overlapEvidence.length<50)overlapEvidence.push({...failureContext,reason:'SOURCE_AYAH_INTERVAL_OVERLAP',disposition:'REFUSED_NOT_REPAIRED'});
      continue;
    }
    assertTimelineValid(timeline, timeline.durationMs, 0);
    const absolute = (row: SourceAyahTiming): number => row.coordinate === 'clip_ms' ? Number(row.source_offset_ms) : row.coordinate === 'chapter_ms' || row.source === 'qud' ? group.chapterOffsetMs : 0;
    const first = Math.min(...source.flatMap(row => row.words.map(word => word[2] + absolute(row)))), last = Math.max(...source.flatMap(row => row.words.map(word => word[3] + absolute(row))));
    assert.equal(timeline.sourceWindow.fromMs, Math.max(0, first - padMs)); assert.equal(timeline.sourceWindow.toMs, last); assert.equal(timeline.durationMs, last - timeline.sourceWindow.fromMs);
    let repeated = false;
    source.forEach((row, index) => {
      const actual = timeline.ayahs[index]; assert.equal(actual.highlightMode, 'word'); assert.equal(actual.words.length, row.words.length);
      const canonical = new Set<number>();
      row.words.forEach(([word, occurrence, start, end], i) => {
        assert.deepEqual(actual.words[i], [word, occurrence, start + absolute(row) - timeline.sourceWindow.fromMs, end + absolute(row) - timeline.sourceWindow.fromMs]);
        assert.ok(word !== null && word >= 1 && word <= row.expected_words, 'CANONICAL_INDEX_INVALID');
        if (canonical.has(word!)) repeated = true; canonical.add(word!); wordChecks++;
      });
    });
    if (repeated) repetitionRanges++;
    rangeHash.update(JSON.stringify({ recitation: group.recitationId, surah: group.surah, from, to, padMs, timeline }) + '\n');
    visitedGroups.add(`${group.recitationId}:${group.surah}`); completed++;
    if (!golden) { golden = timeline; goldenSource = source; goldenOffset = group.chapterOffsetMs; }
  }
  assert.ok(golden && goldenSource);
  const rejects: string[] = [];
  const corrupt = (name: string, edit: (value: RenderTimeline) => void): void => { const value = structuredClone(golden!); edit(value); assert.throws(() => assertTimelineValid(value, golden!.durationMs, 0), undefined, name); rejects.push(name); };
  corrupt('negative_start', t => { t.ayahs[0].startMs = -1; });
  corrupt('non_integer_start', t => { t.ayahs[0].startMs += .5; });
  corrupt('zero_word_interval', t => { t.ayahs[0].words[0][3] = t.ayahs[0].words[0][2]; });
  corrupt('negative_word_interval', t => { t.ayahs[0].words[0][2] = -1; });
  corrupt('word_outside_ayah', t => { t.ayahs[0].words[0][3] = t.ayahs[0].endMs + 1; });
  corrupt('invalid_canonical_index', t => { t.ayahs[0].words[0][0] = 0; });
  corrupt('invalid_occurrence', t => { t.ayahs[0].words[0][1] = -1; });
  corrupt('inconsistent_source_window', t => { t.sourceWindow.toMs++; });
  corrupt('duration_outside_audio', t => { t.durationMs++; t.sourceWindow.toMs++; });
  corrupt('words_in_ayah_only', t => { t.ayahs[0].highlightMode = 'ayah'; });
  const malformed = structuredClone(goldenSource); malformed[0].words[0][2] = -1;
  assert.throws(() => toRenderTimeline(malformed, { chapterOffsetMs: goldenOffset, sourceFormat: 'qud_release', padMs: 150, allowAyahOnly: true })); rejects.push('negative_source_timestamp');
  assert.throws(() => toRenderTimeline(goldenSource!, { chapterOffsetMs: goldenOffset, sourceFormat: 'qud_release', padMs: 151 })); rejects.push('pad_above_policy');
  const versionsHash = createHash('sha256'); for (const [key, hash] of [...uniqueVersions].sort(([a], [b]) => a.localeCompare(b))) versionsHash.update(`${key}:${hash}\n`);
  Object.assign(report, { passed: true, completed_ranges: completed, word_checks: wordChecks, repetition_ranges: repetitionRanges, unique_source_rows: uniqueVersions.size,
    visited_chapters: visitedGroups.size, source_versions_sha256: versionsHash.digest('hex'), deterministic_ranges_sha256: rangeHash.digest('hex'), rejected_mutations: rejects,
    rejected_source_overlap_ranges:rejectedOverlaps,overlap_evidence:overlapEvidence,
    supersedes:['d7-timeline-property-initial-failure.json','d7-timeline-property-eligible-initial-failure.json'],
    policy: '10000 successful eligible real source ranges PLUS separately counted real overlapping ranges that must be refused. No source/timing repair; no failure is reported as accepted.' });
} catch (error) {
  Object.assign(report, { passed: false, completed_ranges: completed, failure: error instanceof Error ? error.message : 'UNKNOWN_FAILURE', failure_context: failureContext });
  throw error;
} finally {
  await db.end(); await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, completed_ranges: completed, output: out }));
}

/** Explicit production read-only proof, including canonical/admin invariants. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { captureInventory, ENVIRONMENTS, type Inventory } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
import type { QuranTextCorpus } from '../server/services/quranTextImport';
const option = (name: string): string => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error('REQUIRED_OPTION:' + name); return process.argv[i + 1]; };
const corpus = JSON.parse(readFileSync(option('--corpus'), 'utf8')) as QuranTextCorpus;
const session = await openRailwayMysqlSession(ENVIRONMENTS.production);
const json = async (sql: string): Promise<Array<Record<string, unknown>>> => (await session.read(sql)).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
try {
  const inventory = await captureInventory(ENVIRONMENTS.production, (sql) => session.read(sql));
  assert.equal(inventory.canonical_checksum, corpus.checksum, 'CANONICAL_CHECKSUM_STOP');
  assert.deepEqual(inventory.d1_counts, { surahs: Object.keys(corpus.surahs).length, ayahs: corpus.ayahs.length, words: corpus.wordCount }, 'D1_COUNTS_STOP');
  if (process.argv.includes('--baseline')) {
    const baseline = JSON.parse(readFileSync(option('--baseline'), 'utf8')) as Inventory;
    assert.deepEqual(inventory.critical_counts, baseline.critical_counts, 'CRITICAL_COUNTS_STOP');
    for (const table of ['users', 'user_roles']) assert.equal(inventory.checksums[table], baseline.checksums[table], 'ADMIN_CHECKSUM_STOP:' + table);
  }
  const disk = await session.storage();
  const sizes = await json("SELECT JSON_OBJECT('table',TABLE_NAME,'data_bytes',DATA_LENGTH,'index_bytes',INDEX_LENGTH) AS record FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME;");
  const report: Record<string, unknown> = { ...inventory, read_only: true, disk, table_sizes: sizes };
  if (process.argv.includes('--complete')) {
    const prepared = JSON.parse(readFileSync(option('--manifest'), 'utf8')) as { results: Array<{slug: string; rows: number; ready: number; needs_review: number}> };
    assert.equal(inventory.row_counts.ayah_timings, prepared.results.reduce((n, r) => n + r.rows, 0), 'TIMING_TOTAL_COUNT');
    const counts = await json("SELECT JSON_OBJECT('slug',r.slug,'riwayah',r.riwayah_code,'rows',COUNT(t.id),'ready',SUM(t.review_status='ready'),'needs_review',SUM(t.review_status='needs_review')) AS record FROM recitations r JOIN ayah_timings t ON t.recitation_id=r.id GROUP BY r.id,r.slug,r.riwayah_code ORDER BY r.slug;");
    for (const expected of prepared.results) { const actual = counts.find((r) => r.slug === expected.slug); assert.ok(actual, 'RECITATION_MISSING:' + expected.slug); for (const key of ['rows','ready','needs_review'] as const) assert.equal(Number(actual[key]), expected[key], 'RECITATION_COUNT_MISMATCH:' + expected.slug + ':' + key); }
    const violations = await json("SELECT JSON_OBJECT('word_accounting',SUM(expected_words IS NOT NULL AND coverage_words+JSON_LENGTH(missing_words)<>expected_words),'noncanonical_spoken_text',SUM(canonical_checksum IS NULL AND spoken_text IS NOT NULL),'highlight_invalid',SUM(word_highlight_enabled=1 AND (review_status<>'ready' OR coverage_words<>expected_words OR JSON_LENGTH(missing_words)<>0))) AS record FROM ayah_timings;");
    for (const value of Object.values(violations[0])) assert.equal(Number(value), 0, 'TIMING_VALIDATION_STOP');
    const coverage = await json("SELECT JSON_OBJECT('slug',r.slug,'chapters',COUNT(*),'complete',SUM(c.is_complete=1),'timing_complete',SUM(c.timing_complete=1),'missing_1_to_3',SUM(c.expected_words-c.coverage_words BETWEEN 1 AND 3),'covered_words',SUM(c.coverage_words),'expected_words',SUM(c.expected_words)) AS record FROM recitations r JOIN recitation_chapters c ON c.recitation_id=r.id GROUP BY r.id,r.slug ORDER BY r.slug;");
    const reasons = await json("SELECT JSON_OBJECT('slug',r.slug,'reason',j.reason,'count',COUNT(*)) AS record FROM ayah_timings t JOIN recitations r ON r.id=t.recitation_id JOIN JSON_TABLE(t.review_reasons,'$[*]' COLUMNS(reason VARCHAR(191) PATH '$')) j GROUP BY r.slug,j.reason ORDER BY r.slug,COUNT(*) DESC;");
    report.recitations = counts; report.coverage = coverage; report.reasons = reasons; report.violations = violations;
    const invariant = await json("SELECT JSON_OBJECT('coverage_errors',COUNT(*)) AS record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id LEFT JOIN (SELECT recitation_id,surah,COUNT(*) rows_count,SUM(coverage_words) covered,SUM(JSON_LENGTH(missing_words)) missing,SUM(review_status<>'ready') review FROM ayah_timings GROUP BY recitation_id,surah) t ON t.recitation_id=c.recitation_id AND t.surah=c.surah LEFT JOIN (SELECT surah,COUNT(*) words_count FROM quran_words GROUP BY surah) w ON w.surah=c.surah LEFT JOIN (SELECT surah,COUNT(*) ayah_count FROM quran_ayahs GROUP BY surah) a ON a.surah=c.surah WHERE c.coverage_words<>COALESCE(t.covered,0) OR (r.canonical_text_available=1 AND c.expected_words<>w.words_count) OR c.timing_complete<>IF(r.canonical_text_available=1 AND t.rows_count=a.ayah_count AND t.covered=w.words_count AND t.missing=0 AND t.review=0,1,0) OR c.is_complete<>(c.ayahs_complete AND COALESCE(c.timing_complete,0));");
    assert.equal(Number(invariant[0].coverage_errors), 0, 'CHAPTER_COVERAGE_STOP'); report.chapter_invariant = invariant;
  }
  report.serial = await session.close();
  writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ d1: inventory.d1_counts, canonical_checksum: inventory.canonical_checksum, tables: inventory.tables.length, timings: inventory.row_counts.ayah_timings ?? 0, disk }));
} catch (error) { await session.close(); throw error; }

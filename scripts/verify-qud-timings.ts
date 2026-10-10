import { chapterTimingVerificationQueries, reconcileChapterTimingCoverage, timingRecitationSummarySql, timingReviewReasonsSql } from '../server/services/qudTimingVerification';
/** Explicit production read-only proof, including canonical/admin invariants. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { captureInventory, ENVIRONMENTS, type Inventory } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
import type { QuranTextCorpus } from '../server/services/quranTextImport';
import { timingColumns } from '../server/services/qudTimingSql';
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
    assert.ok(!inventory.tables.some(t=>['quran_storage_health','quran_timing_audit_fixtures'].includes(t.name)), 'CANCELLED_TABLE_PRESENT');
    const timingTables=['ayah_timings','import_jobs','ayah_timing_history'];
    for(const column of inventory.columns.filter(c=>timingTables.includes(c.table)&&c.charset!==null)) assert.equal(column.collation,column.column==='spoken_text'?'utf8mb4_bin':'utf8mb4_unicode_ci','TIMING_COLLATION_STOP:'+column.table+':'+column.column);
    const additiveColumns=await json("SELECT JSON_OBJECT('column',COLUMN_NAME,'nullable',IS_NULLABLE) AS record FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recitation_chapters' AND COLUMN_NAME IN ('coverage_words','expected_words','coverage_details');");
    assert.equal(additiveColumns.length,3);for(const column of additiveColumns)assert.equal(column.nullable,'YES','TIMING_COLUMN_NOT_NULLABLE');report.additive_columns=additiveColumns;
    const counts = await json(timingRecitationSummarySql+';');
    for (const expected of prepared.results) { const actual = counts.find((r) => r.slug === expected.slug); assert.ok(actual, 'RECITATION_MISSING:' + expected.slug); for (const key of ['rows','ready','needs_review'] as const) assert.equal(Number(actual[key]), expected[key], 'RECITATION_COUNT_MISMATCH:' + expected.slug + ':' + key); }
    const violations = await json("SELECT JSON_OBJECT('word_accounting',SUM(expected_words IS NOT NULL AND coverage_words+JSON_LENGTH(missing_words)<>expected_words),'noncanonical_spoken_text',SUM(canonical_checksum IS NULL AND spoken_text IS NOT NULL),'noncanonical_legal_reference',SUM(canonical_checksum IS NULL AND (ayah_id IS NOT NULL OR expected_words IS NOT NULL)),'ready_with_reasons',SUM(review_status='ready' AND JSON_LENGTH(review_reasons)<>0),'highlight_invalid',SUM(word_highlight_enabled=1 AND (review_status<>'ready' OR coverage_words<>expected_words OR JSON_LENGTH(missing_words)<>0))) AS record FROM ayah_timings;");
    for (const value of Object.values(violations[0])) assert.equal(Number(value), 0, 'TIMING_VALIDATION_STOP');
    const coverage = await json("SELECT JSON_OBJECT('slug',r.slug,'chapters',COUNT(*),'complete',SUM(c.is_complete=1),'timing_complete',SUM(c.timing_complete=1),'missing_1_to_3',SUM(c.expected_words-c.coverage_words BETWEEN 1 AND 3),'covered_words',SUM(c.coverage_words),'expected_words',SUM(c.expected_words)) AS record FROM recitations r JOIN recitation_chapters c ON c.recitation_id=r.id GROUP BY r.id,r.slug ORDER BY r.slug;");
    const reasons = await json(timingReviewReasonsSql+';');
    report.recitations = counts; report.coverage = coverage; report.reasons = reasons; report.violations = violations;
    report.release_defect_reasons=reasons.filter(r=>/^INVALID_|^SOURCE_.*ORDER|^SOURCE_.*OVERLAP/u.test(String(r.reason)));
    const gates=await json("SELECT JSON_OBJECT('recitations',COUNT(*),'published',SUM(status='published'),'audio_basmala_unverified',SUM(surah_start_basmala_audio_status='unverified')) AS record FROM recitations;");
    assert.equal(Number(gates[0].published),0,'UNAUTHORIZED_PUBLICATION_STOP');assert.equal(Number(gates[0].audio_basmala_unverified),Number(gates[0].recitations),'BASMALA_POLICY_CHANGED');report.publication_gates=gates;
    const aggregates: Array<Array<Record<string,unknown>>> = []; for (const query of chapterTimingVerificationQueries) aggregates.push(await json(query+';'));
    const invariant = [reconcileChapterTimingCoverage(aggregates[0],aggregates[1],aggregates[2])];
    assert.equal(Number(invariant[0].coverage_errors), 0, 'CHAPTER_COVERAGE_STOP'); report.chapter_invariant = invariant;
  }
  if (process.argv.includes('--semantic-baseline')) {
    const baseline = JSON.parse(readFileSync(option('--semantic-baseline'), 'utf8')) as { uninterrupted: Record<string, string> };
    const definitions: Record<string, string[]> = {
      ayah_timings: [...timingColumns],
      import_jobs: ['id','recitation_id','qud_version','source_sha256','manifest_sha256','canonical_checksum','importer_version','status','checkpoint','total_rows','imported_rows','review_rows','error_json'],
      ayah_timing_history: ['id','timing_id','version_hash','snapshot','reason'],
      recitation_chapters: ['id','recitation_id','surah','coverage_words','expected_words','coverage_details','timing_complete','is_complete'],
      recitations: ['id','coverage_words'],
    };
    const hashes: Record<string, string> = {};
    for (const [table, keys] of Object.entries(definitions)) {
      const fields = keys.flatMap(key => ["'" + key + "'", key]).join(',');
      const rows = (await session.read("SELECT SHA2(CAST(JSON_OBJECT(" + fields + ") AS CHAR CHARACTER SET utf8mb4),256) FROM " + table + ' ORDER BY id;')).trim().split('\n').filter(Boolean);
      const hash = createHash('sha256'); for (const row of rows) hash.update(row + '\n'); hashes[table] = hash.digest('hex');
    }
    assert.deepEqual(hashes, baseline.uninterrupted, 'PRODUCTION_SEMANTIC_STATE_MISMATCH');
    report.semantic_hashes = hashes;
    report.semantic_timestamps_excluded = true;
  }
  report.serial = await session.close();
  writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ d1: inventory.d1_counts, canonical_checksum: inventory.canonical_checksum, tables: inventory.tables.length, timings: inventory.row_counts.ayah_timings ?? 0, disk }));
} catch (error) { await session.close(); throw error; }

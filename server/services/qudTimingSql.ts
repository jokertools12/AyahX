import { timingMigrationSql } from '../db/migrations/003_addQuranTimingTables';
import { sqlLiteral } from './qudCatalogSql';
import { timingHash, TIMING_IMPORTER_VERSION, type PreparedTiming } from './qudTimingPackage';

export const timingColumns = ['id','recitation_id','ayah_id','surah','ayah','source','quality','qud_version','source_sha256','canonical_checksum','coordinate','source_offset_ms','start_ms','end_ms','segments','words','spoken_text','source_rows','review_status','review_reasons','word_highlight_enabled','repetition_display_mode','coverage_words','expected_words','missing_words','version_hash','import_job_id'] as const;
const jsonColumns = new Set<string>(['segments','words','source_rows','review_reasons','missing_words']);
export function timingValues(row: PreparedTiming): Record<string, string | number | boolean | null> {
  return Object.fromEntries(timingColumns.map((name) => [name, jsonColumns.has(name) ? JSON.stringify(row[name]) : row[name]])) as Record<string, string | number | boolean | null>;
}
export interface TimingBatch { job_id: string; checkpoint: number; row_count: number; statements: string[] }
export interface TimingPlan {
  schema_version: 1; manifest_sha256: string; canonical_checksum: string; importer_version: string;
  migration: string[]; jobs: Array<{ id: string; slug: string; total_rows: number; review_rows: number; insert_sql: string; batches: TimingBatch[] }>;
  sql_sha256: string; counts: { timings: number; jobs: number }; batch_size: number;
}

export function buildTimingPlan(inputs: Array<{ slug: string; rows: PreparedTiming[] }>, manifestSha: string, canonicalChecksum: string, batchSize = 250): { plan: TimingPlan; sql: string } {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('SQL_BATCH_LIMIT_EXCEEDED');
  const allIds = new Set<string>();
  const jobs = inputs.map(({ slug, rows }) => {
    if (!rows.length) throw new Error('TIMING_IMPORT_EMPTY');
    const first = rows[0]; const reviewRows = rows.filter((r) => r.review_status === 'needs_review').length;
    for (const row of rows) {
      if (allIds.has(row.id) || row.import_job_id !== first.import_job_id || row.recitation_id !== first.recitation_id || row.source_sha256 !== first.source_sha256 || row.source !== 'qud' || row.quality !== 'aligned') throw new Error('TIMING_IMPORT_IDENTITY_MISMATCH');
      allIds.add(row.id);
    }
    const insertSql = `INSERT INTO import_jobs(id,recitation_id,qud_version,source_sha256,manifest_sha256,canonical_checksum,importer_version,total_rows,review_rows) VALUES(${[first.import_job_id,first.recitation_id,first.qud_version,first.source_sha256,manifestSha,canonicalChecksum,TIMING_IMPORTER_VERSION,rows.length,reviewRows].map(sqlLiteral).join(',')}) ON DUPLICATE KEY UPDATE id=id`;
    const batches: TimingBatch[] = [];
    for (let from = 0; from < rows.length; from += batchSize) {
      const part = rows.slice(from, from + batchSize); const checkpoint = from + part.length;
      batches.push({ job_id: first.import_job_id, checkpoint, row_count: part.length, statements: [
        'START TRANSACTION',
        `INSERT INTO ayah_timings(${timingColumns.join(',')}) VALUES\n${part.map((row) => { const values = timingValues(row); return `(${timingColumns.map((c) => sqlLiteral(values[c])).join(',')})`; }).join(',\n')} ON DUPLICATE KEY UPDATE id=id`,
        `UPDATE import_jobs SET checkpoint=${checkpoint},imported_rows=${checkpoint},status='${checkpoint === rows.length ? 'completed' : 'running'}' WHERE id=${sqlLiteral(first.import_job_id)}`,
        'COMMIT',
      ] });
    }
    return { id: first.import_job_id, slug, total_rows: rows.length, review_rows: reviewRows, insert_sql: insertSql, batches };
  });
  const migration = timingMigrationSql();
  const sql = [...migration, ...jobs.flatMap((j) => [j.insert_sql, ...j.batches.flatMap((b) => b.statements)])].map((s) => `${s};`).join('\n\n') + '\n';
  return { plan: { schema_version: 1, migration, jobs, manifest_sha256: manifestSha, canonical_checksum: canonicalChecksum, importer_version: TIMING_IMPORTER_VERSION,
    sql_sha256: timingHash(sql), batch_size: batchSize, counts: { timings: allIds.size, jobs: jobs.length } }, sql };
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
/** Compare actual stored values, not just the stored version_hash. */
export function verifyTimingRow(expected: PreparedTiming, stored: Record<string, unknown>): void {
  const want = timingValues(expected); const actual: Record<string, unknown> = {};
  for (const key of timingColumns) {
    let value = stored[key];
    if (jsonColumns.has(key)) value = typeof value === 'string' ? JSON.parse(value) : value;
    if (key === 'word_highlight_enabled') value = Boolean(value);
    actual[key] = value;
    if (jsonColumns.has(key)) want[key] = JSON.parse(String(want[key]));
  }
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(want))) throw new Error(`STORED_TIMING_MISMATCH:${expected.id}`);
}

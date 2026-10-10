import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { timingColumns, buildTimingPlan, verifyTimingRow } from './qudTimingSql';
import { timingHash, type PreparedTiming } from './qudTimingPackage';
import { sqlLiteral } from './qudCatalogSql';
import { stableId, type QuranTextCorpus } from './quranTextImport';

export interface TimingDatabase {
  read(sql: string): Promise<Array<Record<string, unknown>>>;
  execute(sql: string, rowCount: number): Promise<void>;
}
export interface PreparationManifest {
  manifest_sha256: string; canonical_checksum: string;
  results: Array<{ slug: string; rows: number; prepared_sha256: string }>;
}
export function loadPreparedTimings(directory: string, input: PreparationManifest['results'][number]): PreparedTiming[] {
  if (resolve(directory).toLowerCase().startsWith(resolve(process.cwd()).toLowerCase())) throw new Error('PRIVATE_INPUT_DIRECTORY_REQUIRED');
  if (!/^[a-z0-9_]+$/u.test(input.slug)) throw new Error('UNSAFE_SOURCE_SLUG');
  const raw = readFileSync(join(directory, `${input.slug}.timings.jsonl`), 'utf8');
  if (timingHash(raw) !== input.prepared_sha256) throw new Error('PREPARED_INPUT_PIN_MISMATCH');
  const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as PreparedTiming);
  if (rows.length !== input.rows) throw new Error('PREPARED_ROW_COUNT_MISMATCH');
  for (const row of rows) {
    const { version_hash, ...payload } = row;
    if (timingHash(JSON.stringify(payload)) !== version_hash) throw new Error('PREPARED_VALUE_HASH_MISMATCH');
  }
  return rows;
}
const metadataLiteral = (value: string): string => `${sqlLiteral(value)} COLLATE utf8mb4_unicode_ci`;
export const storedTimingSql = (id: string): string => `SELECT JSON_OBJECT(${timingColumns.flatMap((k) => [sqlLiteral(k), k]).join(',')}) AS record FROM ayah_timings WHERE recitation_id=${metadataLiteral(id)} ORDER BY surah,ayah`;
export function verifyImportedRows(expected: PreparedTiming[], actual: Array<Record<string, unknown>>, checkpoint = expected.length): string {
  if (actual.length !== checkpoint) throw new Error('CHECKPOINT_ROW_COUNT_MISMATCH');
  const wanted = new Map(expected.slice(0, checkpoint).map((r) => [r.id, r]));
  for (const row of actual) {
    const want = wanted.get(String(row.id));
    if (!want) throw new Error('CHECKPOINT_UNEXPECTED_ROW');
    verifyTimingRow(want, row); wanted.delete(want.id);
  }
  if (wanted.size) throw new Error('CHECKPOINT_MISSING_ROW');
  return timingHash(JSON.stringify(expected.slice(0, checkpoint).map((r) => r.version_hash)));
}
export function chapterCoverageSql(rows: PreparedTiming[], chapters: number[], corpus: QuranTextCorpus): string {
  const groups = new Map<number, PreparedTiming[]>();
  for (const row of rows) { const group = groups.get(row.surah) ?? []; group.push(row); groups.set(row.surah, group); }
  const cases: Record<string, string[]> = { coverage_words: [], expected_words: [], timing_complete: [], coverage_details: [] };
  for (const surah of chapters) {
    const group = groups.get(surah) ?? [];
    const legal = rows[0].canonical_checksum ? corpus.ayahs.filter((a) => a.surah === surah) : null;
    const expectedWords = legal?.reduce((n, a) => n + a.words.length, 0) ?? null;
    const coveredWords = group.reduce((n, r) => n + r.coverage_words, 0);
    const missing = group.reduce((n, r) => n + r.missing_words.length, 0);
    const complete = Boolean(legal && group.length === legal.length && group.every((r) => r.review_status === 'ready') && coveredWords === expectedWords && missing === 0);
    const reasons: Record<string, number> = {};
    for (const row of group) for (const reason of row.review_reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const values = { coverage_words: coveredWords, expected_words: expectedWords, timing_complete: complete,
      coverage_details: JSON.stringify({ ready_ayahs: group.filter((r) => r.review_status === 'ready').length,
        timing_rows: group.length, expected_ayahs: legal?.length ?? null, missing_words: missing, review_reasons: reasons }) };
    for (const key of Object.keys(cases)) cases[key].push(`WHEN ${surah} THEN ${sqlLiteral(values[key as keyof typeof values])}`);
  }
  if (!chapters.length) throw new Error('CATALOG_CHAPTERS_MISSING');
  return `UPDATE recitation_chapters SET ${Object.entries(cases).map(([key, parts]) => `${key}=CASE surah ${parts.join(' ')} ELSE ${key} END`).join(',')} WHERE recitation_id=${metadataLiteral(rows[0].recitation_id)}`;
}
export const recitationCoverageSql = (rows: PreparedTiming[]): string => `UPDATE recitations SET coverage_words=${rows.reduce((n, r) => n + r.coverage_words, 0)} WHERE id=${metadataLiteral(rows[0].recitation_id)}`;
export const completeTimingJobSql = (id: string): string => `UPDATE import_jobs SET status='completed',error_json=NULL WHERE id=${metadataLiteral(id)}`;
export async function importTimingRecitation(db: TimingDatabase, input: {
  rows: PreparedTiming[]; slug: string; manifest: PreparationManifest; corpus: QuranTextCorpus;
  maxPacket: number; onCheckpoint?: (checkpoint: number) => void | Promise<void>;
}): Promise<{ slug: string; rows: number; sha256: string; resumed_from: number; elapsed_ms: number }> {
  const started = Date.now();
  const { rows, slug, manifest, corpus } = input;
  const { plan } = buildTimingPlan([{ slug, rows }], manifest.manifest_sha256, corpus.checksum);
  const job = plan.jobs[0];
  const records = await db.read(`SELECT JSON_OBJECT('checkpoint',checkpoint,'manifest_sha256',manifest_sha256,'canonical_checksum',canonical_checksum,'total_rows',total_rows) AS record FROM import_jobs WHERE id=${metadataLiteral(job.id)}`);
  const checkpoint = records.length ? Number(records[0].checkpoint) : 0;
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint > rows.length || (records.length && (records[0].manifest_sha256 !== manifest.manifest_sha256 || records[0].canonical_checksum !== corpus.checksum || Number(records[0].total_rows) !== rows.length))) throw new Error('CHECKPOINT_IDENTITY_MISMATCH');
  const actual = await db.read(storedTimingSql(rows[0].recitation_id));
  const expectedById = new Map(rows.slice(0, checkpoint).map((row) => [row.id, row]));
  for (const stored of actual) {
    const expected = expectedById.get(String(stored.id));
    if (!expected) continue; // The count/identity guard below rejects unexpected records.
    try { verifyTimingRow(expected, stored); }
    catch (error) {
      const snapshot = JSON.stringify(stored);
      const actualHash = timingHash(snapshot);
      const historyId = stableId('timing-history', `${expected.id}:${actualHash}`);
      await db.execute(`INSERT INTO ayah_timing_history(id,timing_id,version_hash,snapshot,reason) VALUES(${[historyId, expected.id, actualHash, snapshot, 'CHECKPOINT_STORED_VALUE_MISMATCH'].map(sqlLiteral).join(',')}) ON DUPLICATE KEY UPDATE id=id;`, 1);
      await db.execute(`UPDATE import_jobs SET status='failed',error_json=${sqlLiteral(JSON.stringify({ code: 'CHECKPOINT_STORED_VALUE_MISMATCH', timing_id: expected.id }))} WHERE id=${metadataLiteral(job.id)};`, 1);
      throw error;
    }
  }
  verifyImportedRows(rows, actual, checkpoint); // Reject corruption before any write, including unchanged version_hash.
  await db.execute(`${job.insert_sql};`, 1);
  for (const batch of job.batches) {
    if (batch.checkpoint <= checkpoint) continue;
    const sql = batch.statements.map((s) => `${s};`).join('\n');
    if (Buffer.byteLength(sql) >= Math.min(input.maxPacket / 4, 4 * 1024 * 1024)) throw new Error('TIMING_PACKET_MARGIN_EXCEEDED');
    await db.execute(sql, batch.row_count);
    await input.onCheckpoint?.(batch.checkpoint);
  }
  const chapters = await db.read(`SELECT JSON_OBJECT('surah',surah) AS record FROM recitation_chapters WHERE recitation_id=${metadataLiteral(rows[0].recitation_id)} ORDER BY surah`);
  await db.execute(`${chapterCoverageSql(rows, chapters.map((r) => Number(r.surah)), corpus)};`, chapters.length);
  await db.execute(`${recitationCoverageSql(rows)};`, 1);
  const verified = await db.read(storedTimingSql(rows[0].recitation_id));
  const sha256 = verifyImportedRows(rows, verified);
  await db.execute(`${completeTimingJobSql(job.id)};`, 1);
  return { slug, rows: verified.length, sha256, resumed_from: checkpoint, elapsed_ms: Date.now() - started };
}

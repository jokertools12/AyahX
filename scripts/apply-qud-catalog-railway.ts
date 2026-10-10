import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import type { Connection } from 'mysql2/promise';
import { QURAN_CATALOG_TABLES } from '../server/db/migrations/002_addQuranCatalogTables';
import { generateCatalogSql } from '../server/services/qudCatalogSql';
import { sha, type CatalogDataset } from '../server/services/qudCatalogImport';
import { verifyCatalogRows } from '../server/services/qudCatalogVerification';
import { captureInventory, ENVIRONMENTS, type Inventory } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';

const argv = process.argv.slice(2);
const option = (name: string): string => { const i = argv.indexOf(name); if (i < 0 || !argv[i + 1]) throw new Error(`OPTION_REQUIRED:${name}`); return argv[i + 1]; };
const load = async <T>(name: string): Promise<T> => JSON.parse(await readFile(option(name), 'utf8')) as T;
const target = option('--target');
if (target !== 'production' && target !== 'staging') throw new Error('EXPLICIT_APPROVED_ENVIRONMENT_REQUIRED');
const environment = ENVIRONMENTS[target];
const apply = argv.includes('--apply');
const verifyOnly = argv.includes('--verify-only');
if (apply && verifyOnly) throw new Error('READ_ONLY_VERIFICATION_IS_SEPARATE');
if (apply && target === 'production' && !argv.includes('--confirm-production')) throw new Error('CONFIRM_PRODUCTION_REQUIRED');
const inventory = await load<Inventory>('--inventory');
const production = await load<Inventory>('--production-inventory');
if (inventory.environment_id !== ENVIRONMENTS[target] || production.environment_id !== ENVIRONMENTS.production) throw new Error('INVENTORY_ENVIRONMENT_MISMATCH');
if (target === 'staging' && inventory.server_uuid === production.server_uuid) throw new Error('STAGING_NOT_ISOLATED');
const backup = await load<{ restored_and_verified: boolean; mysql_version: string; checked_at: string; encrypted_path: string; encrypted_sha256: string; row_counts: Record<string, number> }>('--backup');
const rehearsal = await load<{ mysql_version: string; sql_sha256: string; import_twice: boolean; unverified_audio_publication_rejected: boolean; corrupted_catalog_rejected: boolean; reapply_after_rollback: boolean; unverified_surah_slice_rejected: boolean; offset_without_score_rejected: boolean }>('--rehearsal');
if (!backup.restored_and_verified || backup.mysql_version !== '9.7.2' || rehearsal.mysql_version !== '9.7.2' || !rehearsal.import_twice || !rehearsal.unverified_audio_publication_rejected || !rehearsal.corrupted_catalog_rejected || !rehearsal.reapply_after_rollback || !rehearsal.unverified_surah_slice_rejected || !rehearsal.offset_without_score_rejected) throw new Error('VERIFIED_BACKUP_AND_REHEARSAL_REQUIRED');
const data = await load<CatalogDataset>('--dataset');
const plan = generateCatalogSql(data);
if (sha(await readFile(option('--sql'), 'utf8')) !== plan.sha256) throw new Error('SQL_IS_NOT_DETERMINISTIC_PLAN');
if (rehearsal.sql_sha256 !== plan.sha256) throw new Error('REHEARSAL_MUST_VERIFY_THIS_EXACT_SQL');
if (createHash('sha256').update(await readFile(backup.encrypted_path)).digest('hex') !== backup.encrypted_sha256) throw new Error('VERIFIED_ENCRYPTED_BACKUP_CHANGED');
const archiveMetadata = await stat(backup.encrypted_path);
const backupCreatedAt = Math.min(archiveMetadata.birthtimeMs, archiveMetadata.mtimeMs, Date.parse(backup.checked_at));
if (Date.now() - backupCreatedAt >= 24 * 60 * 60 * 1000 || !Number.isFinite(backupCreatedAt) || backupCreatedAt > Date.now()) throw new Error('VERIFIED_BACKUP_MUST_BE_LESS_THAN_24H_OLD');
for (const [name, count] of Object.entries(production.critical_counts)) if (count !== null) assert.equal(backup.row_counts[name], count, `BACKUP_CRITICAL_COUNT_MISMATCH:${name}`);
for (const row of data.recitations) {
  const evidence = JSON.parse(String(row.verification_details)) as { reason?: string; attempts?: Array<{ started_epoch: number; finished_epoch: number }> };
  if (row.verification_status === 'pending' || !evidence.attempts?.length) throw new Error('ALL_SOURCE_ATTEMPTS_REQUIRED_BEFORE_RAILWAY');
  if (row.verification_status === 'source_unavailable' && evidence.reason?.startsWith('hf_')) {
    if (evidence.attempts.length < 3 || evidence.attempts.some((attempt, i, attempts) => i > 0 && attempt.started_epoch - attempts[i - 1].finished_epoch < 1800)) throw new Error('HF_THREE_SPACED_WINDOWS_REQUIRED');
  }
}
if (target === 'production' && !verifyOnly) {
  const staging = await load<{ target: string; applied: boolean; mysql_version: string; sql_sha256: string; read_only_post_verification: boolean; canonical_checksum: string; ssh_exit_verified: boolean; commit_acknowledged: boolean }>('--staging-verification');
  if (staging.target !== 'staging' || !staging.applied || !staging.ssh_exit_verified || !staging.commit_acknowledged || staging.mysql_version !== '9.7.2' || staging.sql_sha256 !== plan.sha256 || !staging.read_only_post_verification || staging.canonical_checksum !== production.canonical_checksum) throw new Error('VERIFIED_STAGING_REQUIRED_BEFORE_PRODUCTION');
}
const session = await openRailwayMysqlSession(environment, { allowWrites: apply });
const readSql = (_environment: string, sql: string): Promise<string> => session.read(sql);
try {
const before = await captureInventory(environment, (sql) => session.read(sql));
const hafsMetadataSql = "SELECT JSON_OBJECT('id',id,'code',code,'name_ar',name_ar,'name_en',name_en,'aligner_code',aligner_code,'is_active',is_active,'created_at',created_at,'updated_at',updated_at) FROM riwayat WHERE code='hafs_an_asim';";
const hafsMetadataBefore = (await readSql(environment, hafsMetadataSql)).trim();
if (!hafsMetadataBefore) throw new Error('EXISTING_HAFS_METADATA_REQUIRED');
const riwayatBefore = JSON.parse((await readSql(environment, "SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'code',code)) FROM riwayat;")).trim()) as Array<{ id: string; code: string }>;
const missingRiwayat = data.riwayat.filter((row) => !riwayatBefore.some((existing) => existing.id === row.id));
for (const row of data.riwayat) assert.ok(!riwayatBefore.some((existing) => (existing.id === row.id) !== (existing.code === row.code)), 'EXISTING_RIWAYAH_NAME_COLLISION_STOP');
assert.equal(before.server_uuid, inventory.server_uuid, 'DATABASE_IDENTITY_CHANGED');
assert.deepEqual(before.critical_counts, inventory.critical_counts, 'PRE_APPLY_CRITICAL_COUNTS_CHANGED');
assert.deepEqual(before.d1_counts, inventory.d1_counts, 'D1_COUNTS_CHANGED');
assert.equal(before.canonical_checksum, inventory.canonical_checksum, 'D1_CANONICAL_CHANGED');
const d1Tables = ['quran_surahs','quran_ayahs','quran_words','quran_text_versions','translations','translation_ayahs'];
for (const table of d1Tables) assert.equal(before.checksums[table], inventory.checksums[table], `PRE_APPLY_D1_CHECKSUM_CHANGED:${table}`);
const existing = before.tables.filter(({ name }) => (QURAN_CATALOG_TABLES as readonly string[]).includes(name));
const replay = target === 'staging' && argv.includes('--replay-verified-staging');
if (!verifyOnly && existing.length && !replay) throw new Error('D2_TABLE_COLLISION_STOP');
if (!verifyOnly && !replay) {
  assert.equal(before.row_counts.riwayat, inventory.row_counts.riwayat, 'PRE_APPLY_RIWAYAT_COUNT_CHANGED');
  assert.equal(before.checksums.riwayat, inventory.checksums.riwayat, 'PRE_APPLY_RIWAYAT_METADATA_CHANGED');
}

async function verifyRemoteRows(expectedData: CatalogDataset = data): Promise<Record<string, number>> {
  const rows: Record<string, unknown[]> = {};
  const expected = { reciters: expectedData.reciters, audio_providers: expectedData.providers, recitations: expectedData.recitations, recitation_chapters: expectedData.chapters };
  for (const [table, entries] of Object.entries(expected)) {
    const columns = Object.keys(entries[0]);
    if (table === 'recitation_chapters') columns.push('is_complete');
    const sql = `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(${columns.map((column) => `'${column}',${column}`).join(',')})),JSON_ARRAY()) FROM ${table};`;
    rows[table] = JSON.parse((await readSql(environment, sql)).trim());
  }
  rows.riwayat = JSON.parse((await readSql(environment, "SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'code',code,'name_ar',name_ar,'name_en',name_en,'aligner_code',aligner_code,'is_active',is_active)) FROM riwayat;")).trim());
  // The common verifier receives REAL remote query results; this bridge cannot
  // fabricate data or execute mutations and accepts only four fixed reads.
  const query = async (sql: string): Promise<unknown> => {
    const match = /^SELECT \* FROM (reciters|audio_providers|recitations|recitation_chapters|riwayat)$/u.exec(sql);
    if (!match) throw new Error('REMOTE_READ_BRIDGE_QUERY_NOT_ALLOWED');
    return [rows[match[1]], []];
  };
  return verifyCatalogRows({ query: query as Connection['query'] }, expectedData);
}
let corrections = 0;
if (replay) {
  const previous = await load<CatalogDataset>('--staging-previous-dataset');
  const proof = await load<{ target: string; passed: boolean; read_only: boolean; actual_catalog_values_match: boolean; expected_sql_sha256: string }>('--staging-existing-proof');
  assert.equal(proof.target, 'staging');
  assert.equal(proof.passed && proof.read_only && proof.actual_catalog_values_match, true, 'EXISTING_STAGING_RECONCILIATION_REQUIRED');
  assert.equal(sha(await readFile(option('--staging-previous-sql'), 'utf8')), proof.expected_sql_sha256, 'PREVIOUS_STAGING_SQL_CHANGED');
  for (const field of ['catalog_sha256','qud_version','riwayat','reciters','providers','chapters','unmapped_sources'] as const) assert.deepEqual(previous[field], data[field], `STAGING_REPLAY_SCOPE_CHANGED:${field}`);
  assert.equal(previous.recitations.length, data.recitations.length);
  for (let i = 0; i < data.recitations.length; i++) {
    const old = previous.recitations[i]; const next = data.recitations[i];
    const changed = old.status !== next.status;
    if (changed) { assert.equal(old.verification_status, 'failed'); assert.equal(old.status, 'imported'); assert.equal(next.status, 'needs_review'); corrections++; }
    assert.deepEqual({ ...old, status: next.status }, next, 'STAGING_REPLAY_ONLY_FAILED_STATUS_CORRECTION_ALLOWED');
  }
  await verifyRemoteRows(previous);
} else if (verifyOnly) await verifyRemoteRows();
const dryRun = { target, dry_run: !apply, verify_only: verifyOnly, sql_sha256: plan.sha256, counts: plan.counts, batch_size: plan.batchSize,
  new_tables: QURAN_CATALOG_TABLES.length - existing.length, existing_catalog_tables: existing.length, status_corrections: corrections,
  planned_inserts: Object.fromEntries(Object.entries(plan.counts).map(([table, count]) => [table, table === 'riwayat' ? missingRiwayat.length : existing.length ? 0 : count])),
  planned_existing_table_writes: 'INSERT absent inactive riwayah metadata only; no ALTER/DROP/DELETE/UPDATE to pre-D1 tables',
  before_critical_counts: before.critical_counts, backup_created_at: new Date(backupCreatedAt).toISOString(), backup_age_hours: (Date.now() - backupCreatedAt) / 3600000 };
console.log(JSON.stringify(dryRun));
if (!apply && !verifyOnly) {
  await session.close();
  await writeFile(option('--out'), JSON.stringify({ ...dryRun, ssh_exit_verified: true, mysql_connections: 1, writes: 0, checked_at: new Date().toISOString() }, null, 2) + '\n');
} else {
if (apply) {
  // The exact deterministic plan is sent in its original statement order.
  // Thread guards and acknowledgements surround it; they do not replace SQL.
  const statements = plan.statements.slice(0, -1).map((sql) => ({ sql, rowCount: sql.startsWith('INSERT') ? Math.max(1, (sql.match(/^\(/gmu) || []).length) : 0 }));
  await session.executeStatements(statements);
  assert.equal(plan.statements.at(-1), 'COMMIT;');
  await session.commit();
}
const counts = await verifyRemoteRows();
const after = await captureInventory(environment, (sql) => session.read(sql));
assert.equal((await readSql(environment, hafsMetadataSql)).trim(), hafsMetadataBefore, 'EXISTING_HAFS_METADATA_CHANGED');
assert.equal(after.row_counts.riwayat, before.row_counts.riwayat + missingRiwayat.length, 'RIWAYAT_EXTENSION_COUNT_MISMATCH');
assert.deepEqual(after.critical_counts, inventory.critical_counts, 'POST_APPLY_CRITICAL_COUNTS_CHANGED');
assert.deepEqual(after.d1_counts, inventory.d1_counts, 'POST_APPLY_D1_COUNTS_CHANGED');
assert.equal(after.canonical_checksum, inventory.canonical_checksum, 'POST_APPLY_CANONICAL_CHECKSUM_CHANGED');
for (const table of d1Tables) assert.equal(after.checksums[table], inventory.checksums[table], `D1_CHECKSUM_TABLE_CHANGED:${table}`);
const newTables = after.tables.filter(({ name }) => (QURAN_CATALOG_TABLES as readonly string[]).includes(name));
assert.equal(newTables.length, QURAN_CATALOG_TABLES.length);
assert.ok(newTables.every(({ collation, engine }) => collation === 'utf8mb4_unicode_ci' && engine === 'InnoDB'));
const newColumns = after.columns.filter((row) => row.charset && (QURAN_CATALOG_TABLES as readonly string[]).includes(row.table));
assert.ok(newColumns.every((row) => row.charset === 'utf8mb4' && row.collation === 'utf8mb4_unicode_ci'));
assert.deepEqual(after.columns.filter((row) => row.column === 'text_uthmani' && ['quran_ayahs','quran_words'].includes(row.table)), inventory.columns.filter((row) => row.column === 'text_uthmani' && ['quran_ayahs','quran_words'].includes(row.table)));
const keys = after.foreign_keys.filter((row) => (QURAN_CATALOG_TABLES as readonly string[]).includes(row.table));
assert.equal(keys.length, 3);
assert.ok(keys.every((row) => (QURAN_CATALOG_TABLES as readonly string[]).includes(row.referenced)));
await readSql(environment, 'SELECT COUNT(*) FROM reciters r LEFT JOIN users u ON u.id=r.id;');
const report = { target, mysql_version: after.mysql_version, applied: apply, read_only_post_verification: true, sql_sha256: plan.sha256, counts,
  critical_counts: after.critical_counts, d1_counts: after.d1_counts, canonical_checksum: after.canonical_checksum, d1_canonical_and_translation_table_checksums_unchanged: true,
  existing_hafs_metadata_unchanged: true, riwayat_before: before.row_counts.riwayat, riwayat_metadata_inserts: missingRiwayat.length, riwayat_after: after.row_counts.riwayat,
  d1_canonical_collations_unchanged: true, catalog_text_columns: newColumns.length, internal_foreign_keys: keys.length,
  source_unavailable: data.recitations.filter((row) => row.verification_status === 'source_unavailable').length,
  published: data.recitations.filter((row) => row.status === 'published').length, verified_at: new Date().toISOString(), existing_users_join: true,
  mysql_connections: 1, ssh_sessions: 1, corrected_failed_status_rows: corrections };
await session.close();
Object.assign(report, { ssh_exit_verified: true, commit_acknowledged: apply ? session.commitAcknowledged : false, thread_checks: session.threadChecks, transport: session.evidence });
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
}
} finally { await session.close(); }

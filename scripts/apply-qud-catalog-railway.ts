import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { Connection } from 'mysql2/promise';
import { QURAN_CATALOG_TABLES } from '../server/db/migrations/002_addQuranCatalogTables';
import { generateCatalogSql } from '../server/services/qudCatalogSql';
import { sha, type CatalogDataset } from '../server/services/qudCatalogImport';
import { verifyCatalogRows } from '../server/services/qudCatalogVerification';
import { captureInventory, ENVIRONMENTS, mysqlCommand, readSql, ssh, type Inventory } from './lib/railwayQuranOps';

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
const backup = await load<{ restored_and_verified: boolean; mysql_version: string; checked_at: string }>('--backup');
const rehearsal = await load<{ mysql_version: string; import_twice: boolean; unverified_audio_publication_rejected: boolean; corrupted_catalog_rejected: boolean; reapply_after_rollback: boolean }>('--rehearsal');
if (!backup.restored_and_verified || backup.mysql_version !== '9.7.2' || rehearsal.mysql_version !== '9.7.2' || !rehearsal.import_twice || !rehearsal.unverified_audio_publication_rejected || !rehearsal.corrupted_catalog_rejected || !rehearsal.reapply_after_rollback) throw new Error('VERIFIED_BACKUP_AND_REHEARSAL_REQUIRED');
const data = await load<CatalogDataset>('--dataset');
const plan = generateCatalogSql(data);
if (sha(await readFile(option('--sql'), 'utf8')) !== plan.sha256) throw new Error('SQL_IS_NOT_DETERMINISTIC_PLAN');
const before = await captureInventory(ENVIRONMENTS[target]);
const hafsMetadataSql = "SELECT JSON_OBJECT('id',id,'code',code,'name_ar',name_ar,'name_en',name_en,'aligner_code',aligner_code,'is_active',is_active,'created_at',created_at,'updated_at',updated_at) FROM riwayat WHERE code='hafs_an_asim';";
const hafsMetadataBefore = (await readSql(environment, hafsMetadataSql)).trim();
if (!hafsMetadataBefore) throw new Error('EXISTING_HAFS_METADATA_REQUIRED');
assert.equal(before.server_uuid, inventory.server_uuid, 'DATABASE_IDENTITY_CHANGED');
assert.deepEqual(before.critical_counts, inventory.critical_counts, 'PRE_APPLY_CRITICAL_COUNTS_CHANGED');
assert.deepEqual(before.d1_counts, inventory.d1_counts, 'D1_COUNTS_CHANGED');
assert.equal(before.canonical_checksum, inventory.canonical_checksum, 'D1_CANONICAL_CHANGED');
const existing = before.tables.filter(({ name }) => (QURAN_CATALOG_TABLES as readonly string[]).includes(name));
const replay = target === 'staging' && argv.includes('--replay-verified-staging');
if (!verifyOnly && existing.length && !replay) throw new Error('D2_TABLE_COLLISION_STOP');

async function verifyRemoteRows(): Promise<Record<string, number>> {
  const rows: Record<string, unknown[]> = {};
  const expected = { reciters: data.reciters, audio_providers: data.providers, recitations: data.recitations, recitation_chapters: data.chapters };
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
  return verifyCatalogRows({ query: query as Connection['query'] }, data);
}
if (replay || verifyOnly) await verifyRemoteRows();
console.log(JSON.stringify({ target, dry_run: !apply, verify_only: verifyOnly, sql_sha256: plan.sha256, counts: plan.counts, batch_size: plan.batchSize, new_tables: QURAN_CATALOG_TABLES.length }));
if (!apply && !verifyOnly) process.exit(0);
if (apply) {
  // One mysql process and connection; credentials expand only in the service.
  const result = await ssh(environment, mysqlCommand, `SELECT DATABASE();\n${plan.sql}`);
  if (result.split(/\r?\n/u)[0] !== 'railway') throw new Error('APPLIED_DATABASE_IDENTITY_MISMATCH');
}
const counts = await verifyRemoteRows();
const after = await captureInventory(environment);
assert.equal((await readSql(environment, hafsMetadataSql)).trim(), hafsMetadataBefore, 'EXISTING_HAFS_METADATA_CHANGED');
assert.equal(after.row_counts.riwayat, inventory.row_counts.riwayat + data.riwayat.length, 'RIWAYAT_EXTENSION_COUNT_MISMATCH');
assert.deepEqual(after.critical_counts, inventory.critical_counts, 'POST_APPLY_CRITICAL_COUNTS_CHANGED');
assert.deepEqual(after.d1_counts, inventory.d1_counts, 'POST_APPLY_D1_COUNTS_CHANGED');
assert.equal(after.canonical_checksum, inventory.canonical_checksum, 'POST_APPLY_CANONICAL_CHECKSUM_CHANGED');
const d1Tables = ['quran_surahs','quran_ayahs','quran_words','quran_text_versions','translations','translation_ayahs'];
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
  existing_hafs_metadata_unchanged: true, riwayat_before: inventory.row_counts.riwayat, riwayat_after: after.row_counts.riwayat,
  d1_canonical_collations_unchanged: true, catalog_text_columns: newColumns.length, internal_foreign_keys: keys.length,
  source_unavailable: data.recitations.filter((row) => row.verification_status === 'source_unavailable').length,
  published: data.recitations.filter((row) => row.status === 'published').length, verified_at: new Date().toISOString(), existing_users_join: true };
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));

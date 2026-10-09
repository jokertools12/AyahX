/** Read-only reconciliation after an uncertain SSH completion. Never reapply SQL. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { Connection } from 'mysql2/promise';
import { QURAN_CATALOG_TABLES } from '../server/db/migrations/002_addQuranCatalogTables';
import { sha, type CatalogDataset, type CatalogRow } from '../server/services/qudCatalogImport';
import { generateCatalogSql } from '../server/services/qudCatalogSql';
import { verifyCatalogRows } from '../server/services/qudCatalogVerification';
import { ENVIRONMENTS, identifier, readSql, type Inventory } from './lib/railwayQuranOps';

const option = (name: string): string => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`OPTION_REQUIRED:${name}`);
  return process.argv[i + 1];
};
const target = option('--target');
if (target !== 'staging' && target !== 'production') throw new Error('EXPLICIT_APPROVED_ENVIRONMENT_REQUIRED');
const present = process.argv.includes('--catalog-present');
const data = JSON.parse(await readFile(option('--dataset'), 'utf8')) as CatalogDataset;
const baseline = JSON.parse(await readFile(option('--inventory'), 'utf8')) as Inventory;
const rehearsal = JSON.parse(await readFile(option('--rehearsal'), 'utf8')) as { sql_sha256: string; schema: { text_columns: number; internal_foreign_keys: number } };
const plan = generateCatalogSql(data);
assert.equal(baseline.environment_id, ENVIRONMENTS[target]);
assert.equal(rehearsal.sql_sha256, plan.sha256, 'EXACT_REHEARSED_SQL_REQUIRED');
const expected: Record<string, CatalogRow[]> = { reciters: data.reciters, audio_providers: data.providers, recitations: data.recitations, recitation_chapters: data.chapters };
const names = QURAN_CATALOG_TABLES.map((name) => `'${name}'`).join(',');
const critical = Object.entries(baseline.critical_counts).filter(([, count]) => count !== null);
const sql = [`SELECT JSON_OBJECT('database',DATABASE(),'version',VERSION(),'uuid',@@server_uuid,
  'critical',JSON_OBJECT(${critical.map(([name]) => `'${name}',(SELECT COUNT(*) FROM ${identifier(name)})`).join(',')}),
  'd1',JSON_OBJECT('surahs',(SELECT COUNT(*) FROM quran_surahs),'ayahs',(SELECT COUNT(*) FROM quran_ayahs),'words',(SELECT COUNT(*) FROM quran_words)),
  'catalog_tables',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('name',TABLE_NAME,'collation',TABLE_COLLATION,'engine',ENGINE)),JSON_ARRAY()) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names})),
  'text_columns',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME)),JSON_ARRAY()) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND CHARACTER_SET_NAME IS NOT NULL AND (TABLE_NAME IN (${names}) OR (TABLE_NAME IN ('quran_ayahs','quran_words') AND COLUMN_NAME='text_uthmani'))),
  'fks',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('table',TABLE_NAME,'referenced',REFERENCED_TABLE_NAME,'schema',REFERENCED_TABLE_SCHEMA)),JSON_ARRAY()) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names}) AND REFERENCED_TABLE_NAME IS NOT NULL),
  'riwayat',(SELECT COUNT(*) FROM riwayat),'users_join',${present ? '(SELECT COUNT(*) FROM reciters r LEFT JOIN users u ON u.id=r.id)' : 'NULL'});`];
if (present) for (const [table, entries] of Object.entries(expected)) {
  const columns = Object.keys(entries[0]);
  if (table === 'recitation_chapters') columns.push('is_complete');
  sql.push(`SELECT JSON_ARRAYAGG(JSON_OBJECT(${columns.map((column) => `'${column}',${identifier(column)}`).join(',')})) FROM ${identifier(table)};`);
}
sql.push("SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'code',code,'name_ar',name_ar,'name_en',name_en,'aligner_code',aligner_code,'is_active',is_active)) FROM riwayat;");
sql.push("SELECT JSON_ARRAYAGG(JSON_OBJECT('surah',surah,'ayah',ayah,'text',text_uthmani)) FROM quran_ayahs;");
const d1Tables = ['quran_surahs', 'quran_ayahs', 'quran_words', 'quran_text_versions', 'translations', 'translation_ayahs'];
sql.push(`CHECKSUM TABLE ${d1Tables.join(',')};`);
// All statements are SELECT/CHECKSUM. The fixed helper rejects DML/DDL.
const lines = (await readSql(ENVIRONMENTS[target], sql.join('\n'))).trim().split(/\r?\n/u);
interface Facts {
  database: string; version: string; uuid: string; critical: Record<string, number>; d1: Inventory['d1_counts']; riwayat: number; users_join: number | null;
  catalog_tables: Array<{ name: string; collation: string; engine: string }>;
  text_columns: Array<{ table: string; column: string; charset: string; collation: string }>;
  fks: Array<{ table: string; referenced: string; schema: string }>;
}
const facts = JSON.parse(lines.shift()!) as Facts;
assert.equal(facts.database, 'railway');
assert.equal(facts.version, '9.7.2');
assert.equal(facts.uuid, baseline.server_uuid);
assert.deepEqual(facts.critical, Object.fromEntries(critical));
assert.deepEqual(facts.d1, baseline.d1_counts);
const rows: Record<string, CatalogRow[]> = {};
if (present) for (const table of Object.keys(expected)) rows[table] = JSON.parse(lines.shift()!);
rows.riwayat = JSON.parse(lines.shift()!);
let counts: Record<string, number> | null = null;
const metadataColumns = facts.text_columns.filter(({ table }) => (QURAN_CATALOG_TABLES as readonly string[]).includes(table));
if (present) {
  const query = async (statement: string): Promise<unknown> => {
    const match = /^SELECT \* FROM (reciters|audio_providers|recitations|recitation_chapters|riwayat)$/u.exec(statement);
    if (!match) throw new Error('READ_BRIDGE_QUERY_NOT_ALLOWED');
    return [rows[match[1]], []];
  };
  counts = await verifyCatalogRows({ query: query as Connection['query'] }, data);
  assert.equal(facts.catalog_tables.length, QURAN_CATALOG_TABLES.length);
  assert.ok(facts.catalog_tables.every((row) => row.collation === 'utf8mb4_unicode_ci' && row.engine === 'InnoDB'));
  assert.equal(metadataColumns.length, rehearsal.schema.text_columns);
  assert.ok(metadataColumns.every((row) => row.charset === 'utf8mb4' && row.collation === 'utf8mb4_unicode_ci'));
  assert.equal(facts.fks.length, rehearsal.schema.internal_foreign_keys);
  assert.ok(facts.fks.every((row) => row.schema === 'railway' && Object.hasOwn(expected, row.referenced)));
  assert.equal(facts.riwayat, baseline.row_counts.riwayat + data.riwayat.length);
  assert.equal(facts.users_join, data.reciters.length);
} else {
  assert.equal(facts.catalog_tables.length, 0, 'UNEXPECTED_D2_TABLE_PRESENT');
  assert.equal(facts.riwayat, baseline.row_counts.riwayat);
}
const ayahs = JSON.parse(lines.shift()!) as Array<{ surah: number; ayah: number; text: string }>;
ayahs.sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
const checksum = sha(ayahs.map((row) => `${row.surah}:${row.ayah}\t${row.text}`).join('\n'));
assert.equal(checksum, baseline.canonical_checksum);
const legalColumns = facts.text_columns.filter(({ table }) => ['quran_ayahs', 'quran_words'].includes(table));
assert.equal(legalColumns.length, baseline.columns.filter(({ table, column }) => ['quran_ayahs', 'quran_words'].includes(table) && column === 'text_uthmani').length);
assert.ok(legalColumns.every((row) => row.charset === 'utf8mb4' && row.collation === 'utf8mb4_bin'));
assert.equal(lines.length, d1Tables.length);
for (const line of lines) {
  const [name, checksum] = line.split('\t');
  assert.equal(checksum, baseline.checksums[name.split('.').pop()!]);
}
const report = { target, checked_at: new Date().toISOString(), read_only: true, mysql_connections: 1, server_uuid: facts.uuid,
  expected_sql_sha256: plan.sha256, catalog_expected_present: present, actual_catalog_values_match: present ? true : null, counts,
  critical_counts: facts.critical, d1_counts: facts.d1, canonical_checksum: checksum, d1_table_checksums_unchanged: true,
  d1_canonical_collations_unchanged: true, catalog_tables: facts.catalog_tables.length, catalog_text_columns: metadataColumns.length,
  internal_foreign_keys: facts.fks.length, riwayat: facts.riwayat, published: present ? rows.recitations.filter((row) => row.status === 'published').length : null,
  writes_in_this_command: 0, application_command_success_claimed: false, passed: true };
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));

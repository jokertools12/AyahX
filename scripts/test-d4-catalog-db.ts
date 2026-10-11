/** Real MySQL 9.7.2, isolated local clone. No application credentials. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { catalogServiceColumns, catalogServiceIndexes, CATALOG_SERVICE_TABLES, upRecitationCatalogServices, downRecitationCatalogServices } from '../server/db/migrations/004_addRecitationCatalogServices';
const option = (key: string): string => { const i = process.argv.indexOf(key); if (i < 0 || !process.argv[i + 1]) throw new Error('REQUIRED_OPTION:' + key); return process.argv[i + 1]; };
const database = option('--local-db');
assert.match(database, /^ayahx_d4_[a-z0-9_]+$/u, 'LOCAL_REHEARSAL_REQUIRED');
const source = 'ayahx_d2_d3_cli_20261010';
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', charset: 'utf8mb4', multipleStatements: true });
const report: Record<string, unknown> = { checked_at: new Date().toISOString(), local_only: true };
const tables = ['quran_surahs','quran_ayahs','quran_words','reciters','audio_providers','recitations','recitation_chapters','ayah_timings','import_jobs','ayah_timing_history','system_settings','audit_logs','users','user_roles'];
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() version'); assert.equal(version[0].version, '9.7.2'); report.mysql = version[0].version;
  const [existing] = await db.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  if (!existing.length) {
    await db.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    for (const table of tables) {
      await db.query(`CREATE TABLE ${database}.${table} LIKE ${source}.${table}`);
      const [columns] = await db.query<RowDataPacket[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND EXTRA NOT LIKE ? ORDER BY ORDINAL_POSITION', [source,table,'%GENERATED%']);
      const names = columns.map(c => '`' + String(c.COLUMN_NAME) + '`').join(',');
      await db.query(`INSERT INTO ${database}.${table}(${names}) SELECT ${names} FROM ${source}.${table}`);
    }
  }
  await db.query(`USE ${database}`);
  // CHECKSUM TABLE includes newly added columns: it cannot prove old cells
  // unchanged across additive DDL. Hash only the original column projection.
  const originalColumns: Record<string, string[]> = {};
  for (const table of Object.keys(catalogServiceColumns)) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[source,table]);
    originalColumns[table] = rows.map(r => String(r.COLUMN_NAME));
  }
  const checksum = async (): Promise<Record<string, unknown>> => {
    const output: Record<string, unknown> = {};
    for (const table of tables) {
      const columns = originalColumns[table];
      if (!columns) { output[table] = (await db.query<RowDataPacket[]>('CHECKSUM TABLE ' + table))[0][0].Checksum; continue; }
      const fields = columns.flatMap(c => ["'" + c + "'", '`' + c + '`']).join(',');
      const [rows] = await db.query<RowDataPacket[]>(`SELECT SHA2(CAST(JSON_OBJECT(${fields}) AS CHAR CHARACTER SET utf8mb4),256) row_hash FROM ${table} ORDER BY id`);
      const hash = createHash('sha256'); for (const row of rows) hash.update(String(row.row_hash)+'\n'); output[table] = { rows: rows.length, sha256: hash.digest('hex') };
    }
    return output;
  };
  const before = await checksum();
  const schema = async (): Promise<RowDataPacket[]> => (await db.query<RowDataPacket[]>('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,COLLATION_NAME,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION'))[0];
  await upRecitationCatalogServices(db); const first = await schema();
  await upRecitationCatalogServices(db); assert.deepEqual(await schema(), first, 'MIGRATION_REPLAY_SCHEMA');
  assert.deepEqual(await checksum(), before, 'EXISTING_VALUES_CHANGED');
  for (const [table, columns] of Object.entries(catalogServiceColumns)) for (const name of Object.keys(columns)) {
    const found = first.find(c => c.TABLE_NAME === table && c.COLUMN_NAME === name); assert.ok(found, 'COLUMN_MISSING'); assert.equal(found.IS_NULLABLE, 'YES', 'COLUMN_MUST_BE_NULLABLE');
    if (String(found.COLUMN_TYPE).match(/char|text|enum/u)) assert.equal(found.COLLATION_NAME, name === 'terms_url' ? 'utf8mb4_bin' : 'utf8mb4_unicode_ci');
  }
  const [fk] = await db.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'); assert.equal(fk.length,0,'NO_NEW_FOREIGN_KEYS');
  const [indexes] = await db.query<RowDataPacket[]>('SELECT DISTINCT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()');
  for (const i of catalogServiceIndexes) assert.ok(indexes.some(x => x.TABLE_NAME === i.table && x.INDEX_NAME === i.name));
  await assert.rejects(downRecitationCatalogServices(db, 'production' as 'local-rehearsal'), /DESTRUCTIVE_REHEARSAL_ONLY/u);
  await downRecitationCatalogServices(db, 'local-rehearsal'); await downRecitationCatalogServices(db, 'local-rehearsal');
  const afterDown = await schema();
  assert.ok(!afterDown.some(c => (CATALOG_SERVICE_TABLES as readonly string[]).includes(String(c.TABLE_NAME))));
  for (const [table, columns] of Object.entries(catalogServiceColumns)) assert.ok(!afterDown.some(c => c.TABLE_NAME === table && Object.keys(columns).includes(String(c.COLUMN_NAME))));
  assert.deepEqual(await checksum(), before, 'DOWN_CHANGED_EXISTING_VALUES');
  await upRecitationCatalogServices(db); assert.deepEqual(await schema(), first, 'REAPPLY_SCHEMA');
  assert.deepEqual(await checksum(), before, 'REAPPLY_CHANGED_EXISTING_VALUES');
  const [defaults] = await db.query<RowDataPacket[]>("SELECT COUNT(*) n,SUM(COALESCE(is_public,1)<>0) public_count,SUM(voice_identity_status<>'unverified') human_changed FROM recitations");
  assert.equal(Number(defaults[0].public_count),0); assert.equal(Number(defaults[0].human_changed),0);
  const [counts] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ayah_timings'); assert.equal(Number(counts[0].n),422463);
  report.passed = true; report.migration_twice = true; report.down_twice = true; report.reapply = true; report.explicit_collation_nullable = true;
  report.existing_values_unchanged = true; report.no_foreign_keys = true; report.indexes = catalogServiceIndexes; report.default_gates = defaults[0]; report.timing_rows = Number(counts[0].n);
} catch (error) { report.passed = false; report.failure = error instanceof Error ? error.message : 'UNKNOWN_FAILURE'; throw error; }
finally { await db.end(); writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify(report));

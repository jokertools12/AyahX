/** Root-only disposable MySQL restore: real up/replay/down/reapply, no Railway. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { renderV2Columns, renderV2MigrationSql, activateRenderV2AccessSql, upRenderV2, activateRenderV2Access, downRenderV2 } from '../server/db/migrations/007_addRenderManifestV2';
const schema = process.env.AYAHX_D7_LOCAL_SCHEMA ?? 'ayahx_d2_d7_restored_20261011';
assert.match(schema, /^ayahx_d2_d7_restored_\d{8}$/u);
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database: schema, multipleStatements: true, timezone: 'Z' });
const critical = ['users','profiles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','user_roles','notifications'];
const originalColumns = new Map<string,string[]>();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function protectedSnapshot() {
  const result: Record<string,{count:number;sha256:string}> = {};
  for (const table of critical) {
    const columns = originalColumns.get(table)!;
    const [rows] = await db.query<RowDataPacket[]>(`SELECT ${columns.map(column=>'`'+column+'`').join(',')} FROM \`${table}\` ORDER BY ${table==='system_settings'?'key_name':'id'}`);
    result[table] = { count: rows.length, sha256: digest(rows) };
  }
  return result;
}
async function catalog() {
  const result: Record<string,{count:number;checksum:string}> = {};
  for (const table of ['quran_surahs','quran_ayahs','quran_words','ayah_timings']) {
    const [counts] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
    const [sums] = await db.query<RowDataPacket[]>(`CHECKSUM TABLE ${table}`);
    result[table] = { count: Number(counts[0].count), checksum: String(sums[0].Checksum) };
  }
  return result;
}
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() version'); assert.equal(version[0].version,'9.7.2');
  for (const table of critical) {
    const [columns] = await db.query<RowDataPacket[]>('SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table]);
    originalColumns.set(table,columns.map(row=>String(row.name)).filter(name=>!(name in renderV2Columns)));
  }
  const before = await protectedSnapshot(), canonicalBefore = await catalog();
  const [grantsBefore] = await db.query<RowDataPacket[]>("SELECT COUNT(*) count FROM admin_permissions WHERE permission_key='render.test'");
  assert.equal(Number(grantsBefore[0].count),0,'FRESH_RESTORED_SCHEMA_REQUIRED');
  await upRenderV2(db); await upRenderV2(db);
  assert.deepEqual(await protectedSnapshot(),before);
  const [unactivated] = await db.query<RowDataPacket[]>("SELECT COUNT(*) count FROM admin_permissions WHERE permission_key='render.test'");
  assert.equal(Number(unactivated[0].count),0,'DDL_MUST_NOT_ACTIVATE_PERMISSION');
  await activateRenderV2Access(db); await activateRenderV2Access(db);
  const [grants] = await db.query<RowDataPacket[]>("SELECT role_slug FROM admin_permissions WHERE permission_key='render.test' ORDER BY role_slug");
  assert.deepEqual(grants.map(row=>row.role_slug),['admin','super_admin']);
  const [columns] = await db.query<RowDataPacket[]>('SELECT COLUMN_NAME name,IS_NULLABLE nullable,COLLATION_NAME collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=\'render_jobs\'');
  for(const name of Object.keys(renderV2Columns))assert.equal(columns.find(row=>row.name===name)?.nullable,'YES');
  await assert.rejects(downRenderV2(db,'production' as 'local-rehearsal'),/DESTRUCTIVE_REHEARSAL_ONLY/u);
  await downRenderV2(db,'local-rehearsal'); await downRenderV2(db,'local-rehearsal');
  assert.deepEqual(await protectedSnapshot(),before);
  const [downColumns] = await db.query<RowDataPacket[]>("SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='render_jobs'");
  assert.equal(downColumns.some(row=>row.name in renderV2Columns),false);
  await upRenderV2(db); await activateRenderV2Access(db);
  assert.deepEqual(await protectedSnapshot(),before); assert.deepEqual(await catalog(),canonicalBefore);
  const proof = { checked_at:new Date().toISOString(),mysql_version:'9.7.2',database:schema,
    sql_sha256:createHash('sha256').update(renderV2MigrationSql().map(sql=>sql+';').join('\n')+'\n').digest('hex'),
    activation_sha256:createHash('sha256').update(activateRenderV2AccessSql().map(sql=>sql+';').join('\n')+'\n').digest('hex'),
    up_twice_identical:true,activation_twice_identical:true,ddl_does_not_activate_permission:true,
    down_twice_removed_columns:true,down_restored_protected_data:true,production_down_rejected:true,reapplied:true,
    protected:before,catalog:canonicalBefore,columns:columns.filter(row=>row.name in renderV2Columns),production_writes:0 };
  await writeFile('docs/data/d7-migration-local-proof.json',JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({ passed:true,up_twice:true,down_twice:true,activation_twice:true,sql_sha256:proof.sql_sha256,production_writes:0 }));
} finally { await db.end(); }

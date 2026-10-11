/** Root-only additive T1. Explicit production target, defaults to dry-run. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {catalogServiceMigrationSql,catalogServiceColumns,CATALOG_SERVICE_TABLES} from '../server/db/migrations/004_addRecitationCatalogServices';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {captureInventory,ENVIRONMENTS,type Inventory} from './lib/railwayQuranOps';
const option=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
assert.equal(option('--target'),'production');const apply=process.argv.includes('--apply');if(apply)assert.ok(process.argv.includes('--confirm-production'));
const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as Inventory;
const backup=JSON.parse(readFileSync(option('--backup'),'utf8')) as {restored_and_verified:boolean;mysql_version:string;checked_at:string;encrypted_path:string;encrypted_sha256:string;row_counts:Record<string,number>};
const rehearsal=JSON.parse(readFileSync('docs/data/d4-t1-local-migration.json','utf8'));
assert.ok(rehearsal.passed&&rehearsal.migration_twice&&rehearsal.down_twice&&rehearsal.reapply);
assert.ok(backup.restored_and_verified&&backup.mysql_version==='9.7.2'&&Date.now()-Date.parse(backup.checked_at)<24*3600000,'FRESH_VERIFIED_BACKUP_REQUIRED');
assert.equal(createHash('sha256').update(readFileSync(backup.encrypted_path)).digest('hex'),backup.encrypted_sha256);
const statements=catalogServiceMigrationSql().map(sql=>({sql:sql+';',rowCount:0}));const sql=statements.map(r=>r.sql).join('\n')+'\n';const sha=createHash('sha256').update(sql).digest('hex');
if(apply){const expected=JSON.parse(readFileSync(option('--dry-run'),'utf8'));assert.ok(expected.passed&&!expected.applied);assert.equal(expected.sql_sha256,sha,'SQL_PLAN_CHANGED');}
const remote=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});const report:Record<string,unknown>={target:'production',applied:apply,sql_sha256:sha,sql_bytes:Buffer.byteLength(sql),started_at:new Date().toISOString()};
try{
  const before=await captureInventory(ENVIRONMENTS.production,s=>remote.read(s));assert.equal(before.server_uuid,baseline.server_uuid);assert.deepEqual(before.d1_counts,baseline.d1_counts);assert.equal(before.canonical_checksum,baseline.canonical_checksum);
  for(const table of ['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'])assert.equal(before.checksums[table],baseline.checksums[table],'PROTECTED_CHECKSUM_STOP:'+table);
  for(const [table,count] of Object.entries(before.row_counts))assert.equal(count,backup.row_counts[table],'BACKUP_COUNT_CHANGED:'+table);
  report.before_tables=before.tables.length;report.disk_before=await remote.storage();report.critical_before=before.critical_counts;
  if(apply){await remote.executeStatements(statements,async batch=>{const disk=await remote.storage();assert.ok(disk.available_bytes/disk.total_bytes>=.2,'D4_SPACE_GUARD');assert.ok(Buffer.byteLength(statements[batch.ordinal-1].sql)<256*1024,'D4_PACKET_MARGIN');});await remote.commit();}
  const after=apply?await captureInventory(ENVIRONMENTS.production,s=>remote.read(s)):before;
  assert.deepEqual(after.critical_counts,before.critical_counts);assert.equal(after.canonical_checksum,before.canonical_checksum);assert.deepEqual(after.d1_counts,before.d1_counts);
  for(const table of ['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'])assert.equal(after.checksums[table],before.checksums[table],'POST_PROTECTED_CHECKSUM_STOP:'+table);
  if(apply){for(const table of CATALOG_SERVICE_TABLES){assert.ok(after.tables.some(t=>t.name===table&&t.collation==='utf8mb4_unicode_ci'));assert.equal(after.row_counts[table],0);}for(const [table,fields] of Object.entries(catalogServiceColumns))for(const key of Object.keys(fields))assert.ok(after.columns.some(c=>c.table===table&&c.column===key));}
  report.after_tables=after.tables.length;report.protected_checksums_unchanged=true;report.d1=after.d1_counts;report.canonical_checksum=after.canonical_checksum;report.timings=after.row_counts.ayah_timings;report.disk_after=await remote.storage();report.passed=true;
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw new Error(String(report.failure));}
finally{report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({applied:apply,passed:report.passed,sql_sha256:sha,tables:report.after_tables}));

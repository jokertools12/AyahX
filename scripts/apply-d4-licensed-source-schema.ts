/** Root-only explicit production schema plan. Defaults to read-only dry-run. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {humanReviewMigrationSql,licensedSourceColumns,licensedSourceTables} from '../server/db/migrations/005_addHumanReviewsAndLicensedSources';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {captureInventory,ENVIRONMENTS,identifier,type Inventory} from './lib/railwayQuranOps';
const option=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
assert.equal(option('--target'),'production');const apply=process.argv.includes('--apply');if(apply)assert.ok(process.argv.includes('--confirm-production'));
const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as Inventory;
const backup=JSON.parse(readFileSync(option('--backup'),'utf8')) as {restored_and_verified:boolean;mysql_version:string;checked_at:string;encrypted_path:string;encrypted_sha256:string;row_counts:Record<string,number>};
const rehearsal=JSON.parse(readFileSync(option('--rehearsal'),'utf8'));
assert.ok(rehearsal.passed&&rehearsal.migration_twice&&rehearsal.down_twice&&rehearsal.reapply&&rehearsal.original_columns_unchanged&&rehearsal.protected_unchanged,'REAL_005_REHEARSAL_REQUIRED');
assert.ok(backup.restored_and_verified&&backup.mysql_version==='9.7.2'&&Date.now()-Date.parse(backup.checked_at)<24*3600000&&Date.parse(backup.checked_at)<=Date.now(),'FRESH_VERIFIED_BACKUP_REQUIRED');
assert.equal(createHash('sha256').update(readFileSync(backup.encrypted_path)).digest('hex'),backup.encrypted_sha256,'ENCRYPTED_BACKUP_SHA_MISMATCH');
const statements=humanReviewMigrationSql().map(sql=>({sql:sql+';',rowCount:0})),sql=statements.map(r=>r.sql).join('\n')+'\n',sha=createHash('sha256').update(sql).digest('hex');
assert.equal(rehearsal.sql_sha256,sha,'REHEARSAL_SQL_CHANGED');
if(apply){const expected=JSON.parse(readFileSync(option('--dry-run'),'utf8'));assert.ok(expected.passed&&!expected.applied);assert.equal(expected.sql_sha256,sha,'DRY_RUN_SQL_CHANGED');}
const remote=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
const report:Record<string,unknown>={target:'production',applied:apply,sql_sha256:sha,sql_bytes:Buffer.byteLength(sql),started_at:new Date().toISOString()};
try{
  const before=await captureInventory(ENVIRONMENTS.production,s=>remote.read(s));assert.equal(before.server_uuid,baseline.server_uuid);assert.deepEqual(before.d1_counts,baseline.d1_counts);assert.equal(before.canonical_checksum,baseline.canonical_checksum);
  for(const table of ['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'])assert.equal(before.checksums[table],baseline.checksums[table],'PROTECTED_BASELINE_STOP:'+table);
  for(const [table,count]of Object.entries(before.row_counts))assert.equal(count,backup.row_counts[table],'FRESH_BACKUP_COUNT_CHANGED:'+table);
  const originalColumns=Object.fromEntries(Object.keys(licensedSourceColumns).map(table=>[table,before.columns.filter(c=>c.table===table).map(c=>c.column)]));
  const projection=async(table:string)=>{const fields=originalColumns[table];assert.ok(fields.length,'ORIGINAL_PROJECTION_COLUMNS_MISSING');const record=fields.flatMap(field=>["'"+field+"'",identifier(field)]).join(',');const result=await remote.read(`SELECT JSON_OBJECT(${record}) record FROM ${identifier(table)} ORDER BY id;`);const values=result.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return createHash('sha256').update(canonicalAuditJson(values)).digest('hex');};
  const beforeProjection:Record<string,string>={};for(const table of Object.keys(originalColumns))beforeProjection[table]=await projection(table);
  report.original_column_projection_sha256=beforeProjection;report.before_tables=before.tables.length;report.disk_before=await remote.storage();report.critical_before=before.critical_counts;
  if(apply){await remote.executeStatements(statements,async batch=>{const disk=await remote.storage();assert.ok(disk.available_bytes/disk.total_bytes>=.2,'D4_SPACE_GUARD');assert.ok(Buffer.byteLength(statements[batch.ordinal-1].sql)<256*1024,'D4_PACKET_MARGIN');});await remote.commit();}
  const after=apply?await captureInventory(ENVIRONMENTS.production,s=>remote.read(s)):before;
  assert.deepEqual(after.critical_counts,before.critical_counts);assert.deepEqual(after.d1_counts,before.d1_counts);assert.equal(after.canonical_checksum,before.canonical_checksum);
  for(const [table,count]of Object.entries(before.row_counts)){assert.equal(after.row_counts[table],count,'ORIGINAL_COUNT_CHANGED:'+table);if(!(table in originalColumns))assert.equal(after.checksums[table],before.checksums[table],'ORIGINAL_CHECKSUM_CHANGED:'+table);}
  for(const table of Object.keys(originalColumns))assert.equal(await projection(table),beforeProjection[table],'ORIGINAL_PROJECTION_CHANGED:'+table);
  assert.deepEqual(after.foreign_keys,before.foreign_keys,'FOREIGN_KEYS_CHANGED');
  if(apply){
    for(const table of licensedSourceTables){assert.ok(after.tables.some(t=>t.name===table&&t.collation==='utf8mb4_unicode_ci'));assert.equal(after.row_counts[table],before.row_counts[table]??0);}
    const raw=await remote.read("SELECT JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'nullable',IS_NULLABLE,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME) record FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;");const cols=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    for(const [table,fields]of Object.entries(licensedSourceColumns))for(const [name,definition]of Object.entries(fields)){const c=cols.find(c=>c.table===table&&c.column===name);assert.ok(c,'ADDED_COLUMN_MISSING');assert.equal(c.nullable,'YES');if(definition.includes('CHARACTER SET')){assert.equal(c.charset,'utf8mb4');assert.equal(c.collation,definition.includes('utf8mb4_bin')?'utf8mb4_bin':'utf8mb4_unicode_ci');}}
    assert.equal(cols.find(c=>c.table==='recitation_source_urls'&&c.column==='url')?.nullable,'YES');report.collation_and_nullability_verified=true;
  }
  Object.assign(report,{after_tables:after.tables.length,original_columns_unchanged:true,protected_checksums_unchanged:true,d1:after.d1_counts,canonical_checksum:after.canonical_checksum,timings:after.row_counts.ayah_timings,disk_after:await remote.storage(),passed:true});
}catch(error){report.passed=false;report.failure=error&&typeof error==='object'&&'code'in error?String(error.code):'D4_005_PRODUCTION_SCHEMA_FAILED';throw new Error(String(report.failure));}
finally{report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({applied:apply,passed:report.passed,sql_sha256:sha,tables:report.after_tables}));

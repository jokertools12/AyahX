/** Root only. Read-only default; explicit fresh backup and rehearsal for DDL. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {adminReviewWorkspaceMigrationSql,adminReviewColumns,draftNullableColumns} from '../server/db/migrations/008_addAdminReviewWorkspace';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {captureInventory,ENVIRONMENTS,identifier,type Inventory} from './lib/railwayQuranOps';
import {assertAdminWorkspaceDryRun,closeAdminWorkspaceReport} from './lib/adminWorkspaceMigrationProof';

const args=process.argv.slice(2),apply=args.includes('--apply');
const option=(name:string)=>{const i=args.indexOf(name);assert.ok(i>=0&&args[i+1]&&!args[i+1].startsWith('--'),'OPTION_REQUIRED:'+name);return resolve(args[i+1]);};
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const sql=adminReviewWorkspaceMigrationSql(),sqlSha=sha(sql.join('\n'));
if(apply)assert.ok(args.includes('--confirm-production'),'PRODUCTION_ACK_REQUIRED');
const rehearsal=await json(option('--rehearsal'));
assert.equal(rehearsal.local_only,true);assert.equal(rehearsal.production_writes,0);
assert.equal(rehearsal.results.length,9);assert.ok(rehearsal.results.every((r:{passed:boolean})=>r.passed));
assert.equal(rehearsal.results[0].detail.sql_sha256,sqlSha,'REHEARSAL_SQL_MISMATCH');
const baseline=await json(option('--baseline')) as Inventory;
assert.equal(baseline.environment_id,ENVIRONMENTS.production,'PRODUCTION_BASELINE_REQUIRED');
const backup=await json(option('--backup'));
assert.equal(backup.restored_and_verified,true,'RESTORED_BACKUP_REQUIRED');assert.equal(backup.mysql_version,'9.7.2');
const backupAge=Date.now()-Date.parse(backup.checked_at);
assert.ok(Number.isFinite(backupAge)&&backupAge>=0&&backupAge<3600000,'FRESH_BACKUP_REQUIRED');
const archiveHash=createHash('sha256');for await(const bytes of createReadStream(backup.encrypted_path))archiveHash.update(bytes);
assert.equal(archiveHash.digest('hex'),backup.encrypted_sha256,'BACKUP_ARCHIVE_SHA_MISMATCH');
assert.deepEqual(backup.row_counts,baseline.row_counts,'BACKUP_INVENTORY_MISMATCH');
assert.deepEqual(backup.checksums,baseline.checksums,'BACKUP_CHECKSUM_INVENTORY_MISMATCH');
const dryRun=apply?await json(option('--dry-run')):null;
if(apply){assertAdminWorkspaceDryRun(dryRun,sqlSha);assert.notEqual(option('--report'),option('--dry-run'));}
const report:Record<string,unknown>={started_at:new Date().toISOString(),applied:apply,passed:false,sql_sha256:sqlSha,rehearsal_passed:true,backup_restored_tables:backup.restored_tables};
const protectedTables=['users','profiles','user_roles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','notifications','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
const planned={new_tables:['admin_preferences','admin_media_tasks'],review_columns:Object.keys(adminReviewColumns),recitation_columns:['timing_reference_recitation_id'],nullable_existing_columns:Object.keys(draftNullableColumns),inserted_rows:0,updated_rows:0};
if(apply)assert.deepEqual(dryRun.planned,planned,'DRY_RUN_PLAN_CHANGED');
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
try{
 const before=await captureInventory(ENVIRONMENTS.production,s=>session.read(s));
 assert.equal(before.server_uuid,baseline.server_uuid,'MYSQL_SERVER_IDENTITY_CHANGED');
 assert.deepEqual(before.d1_counts,baseline.d1_counts);assert.equal(before.row_counts.ayah_timings,422463);assert.equal(before.canonical_checksum,baseline.canonical_checksum);
 for(const table of protectedTables){assert.ok(Number.isSafeInteger(baseline.row_counts[table])&&Number.isSafeInteger(before.row_counts[table]),'PROTECTED_TABLE_MISSING:'+table);assert.ok(before.checksums[table]!=null&&baseline.checksums[table]!=null,'PROTECTED_CHECKSUM_UNAVAILABLE:'+table);assert.equal(before.row_counts[table],baseline.row_counts[table],'PRE_COUNT_CHANGED:'+table);assert.equal(before.checksums[table],baseline.checksums[table],'PRE_CHECKSUM_CHANGED:'+table);}
 for(const table of planned.new_tables)assert.ok(!before.tables.some(t=>t.name===table),'UNEXPECTED_EXISTING_008_TABLE:'+table);
 const projections:Record<string,string>={};
 for(const table of ['human_review_items','recitations']){
  const columns=before.columns.filter(c=>c.table===table).map(c=>identifier(c.column));assert.ok(columns.length);
  projections[table]=sha(await session.read('SELECT '+columns.join(',')+' FROM '+identifier(table)+' ORDER BY id;'));
 }
 Object.assign(report,{planned,d1:before.d1_counts,d3:before.row_counts.ayah_timings,canonical_checksum:before.canonical_checksum,critical_before:before.critical_counts,original_projections:projections,disk_before:await session.storage()});
 if(apply){
  assert.deepEqual(dryRun.critical_before,before.critical_counts,'DRY_RUN_CRITICAL_CHANGED');assert.deepEqual(dryRun.original_projections,projections,'DRY_RUN_CATALOG_CHANGED');
  await session.executeStatements(sql.map(statement=>({sql:statement+';',rowCount:0})));await session.commit();
  const after=await captureInventory(ENVIRONMENTS.production,s=>session.read(s));
  assert.deepEqual(after.d1_counts,before.d1_counts);assert.equal(after.canonical_checksum,before.canonical_checksum);
  for(const table of protectedTables){assert.equal(after.row_counts[table],before.row_counts[table],'POST_COUNT_CHANGED:'+table);assert.equal(after.checksums[table],before.checksums[table],'POST_CHECKSUM_CHANGED:'+table);}
  for(const table of ['human_review_items','recitations']){
   const columns=before.columns.filter(c=>c.table===table).map(c=>identifier(c.column));assert.equal(sha(await session.read('SELECT '+columns.join(',')+' FROM '+identifier(table)+' ORDER BY id;')),projections[table],'ORIGINAL_COLUMNS_CHANGED:'+table);
  }
  for(const table of planned.new_tables){assert.equal(after.row_counts[table],0);assert.equal(after.tables.find(t=>t.name===table)?.collation,'utf8mb4_unicode_ci');}
  const nullable=await session.read("SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='human_review_items' AND COLUMN_NAME IN ('supersedes_id','target_subject_type','target_subject_id')) OR (TABLE_NAME='recitations' AND COLUMN_NAME IN ('timing_reference_recitation_id','basmala_mode','basmala_reason','source_url','qud_version','catalog_sha256'))) ORDER BY TABLE_NAME,COLUMN_NAME;");
  const rows=nullable.trim().split(/\r?\n/u).map(line=>line.split('\t'));assert.equal(rows.length,9);
  for(const row of rows){assert.equal(row[2],'YES');assert.equal(row[3],row[1]==='target_subject_id'?'utf8mb4_bin':'utf8mb4_unicode_ci');}
  Object.assign(report,{critical_after:after.critical_counts,disk_after:await session.storage(),original_columns_unchanged:true,protected_checksums_unchanged:true,new_columns_nullable_collation_verified:true});
 }
 report.checks_passed=true;
}catch(error){report.failure=error instanceof Error&&/^[A-Z0-9_:. -]{1,120}$/u.test(error.message)?error.message:'ADMIN_WORKSPACE_MIGRATION_FAILED';throw error;}
finally{
 try{await closeAdminWorkspaceReport(report,()=>session.close());}finally{report.finished_at=new Date().toISOString();await writeFile(option('--report'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});}
}
console.log(JSON.stringify({applied:apply,passed:report.passed,sql_sha256:sqlSha,planned,d1:report.d1,d3:report.d3}));

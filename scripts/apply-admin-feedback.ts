/** Production-safe application proof for the additive Batch 5b feedback table.
 * Read-only by default; the write path requires a fresh encrypted restore proof. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {adminFeedbackMigrationSql} from '../server/db/migrations/009_addAdminFeedback';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {captureInventory,ENVIRONMENTS,type Inventory} from './lib/railwayQuranOps';
import {assertAdminWorkspaceDryRun,closeAdminWorkspaceReport,executeAdminWorkspaceMigration} from './lib/adminWorkspaceMigrationProof';
import {readFreshQaBackup} from './lib/temporaryAdminQaBackup';

const args=process.argv.slice(2),apply=args.includes('--apply');
const option=(name:string)=>{const i=args.indexOf(name);assert.ok(i>=0&&args[i+1]&&!args[i+1].startsWith('--'),'OPTION_REQUIRED:'+name);return resolve(args[i+1]);};
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const outside=(path:string)=>{const value=relative(process.cwd(),path);assert.ok(value.startsWith('..')||isAbsolute(value),'PRIVATE_REPORT_REQUIRED');return path;};
if(apply)assert.ok(args.includes('--confirm-production'),'PRODUCTION_ACK_REQUIRED');
const sql=adminFeedbackMigrationSql(),sqlSha=createHash('sha256').update(sql.join('\n')).digest('hex');
const rehearsal=await json(option('--rehearsal'));
assert.equal(rehearsal.local_only,true,'LOCAL_REHEARSAL_REQUIRED');assert.equal(rehearsal.migration,'009','LOCAL_MIGRATION_REQUIRED');assert.equal(rehearsal.up_twice,true);assert.equal(rehearsal.down_twice,true);assert.equal(rehearsal.reapply,true);assert.equal(rehearsal.foreign_keys,0);assert.equal(rehearsal.status,'passed');
const baseline=await json(option('--baseline')) as Inventory;
assert.equal(baseline.environment_id,ENVIRONMENTS.production,'PRODUCTION_BASELINE_REQUIRED');
const backup=await readFreshQaBackup(option('--backup'));
assert.deepEqual(backup.row_counts,baseline.row_counts,'BACKUP_INVENTORY_MISMATCH');assert.deepEqual(backup.checksums,baseline.checksums,'BACKUP_CHECKSUM_INVENTORY_MISMATCH');
const planned={new_tables:['admin_feedback'],inserted_rows:0,updated_rows:0};
const dryRun=apply?await json(option('--dry-run')):null;
if(apply){assertAdminWorkspaceDryRun(dryRun,sqlSha);assert.deepEqual(dryRun.planned,planned,'DRY_RUN_PLAN_CHANGED');assert.notEqual(option('--report'),option('--dry-run'));}
const protectedTables=['users','profiles','user_roles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','notifications','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
const report:Record<string,unknown>={started_at:new Date().toISOString(),applied:apply,passed:false,sql_sha256:sqlSha,rehearsal_passed:true,backup_restored_tables:backup.restored_tables};
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
try{
 const before=await captureInventory(ENVIRONMENTS.production,s=>session.read(s));
 assert.equal(before.server_uuid,baseline.server_uuid,'MYSQL_SERVER_IDENTITY_CHANGED');assert.deepEqual(before.d1_counts,baseline.d1_counts);assert.equal(before.row_counts.ayah_timings,422463);assert.equal(before.canonical_checksum,baseline.canonical_checksum);
 for(const table of protectedTables){assert.equal(before.row_counts[table],baseline.row_counts[table],'PRE_COUNT_CHANGED:'+table);assert.equal(before.checksums[table],baseline.checksums[table],'PRE_CHECKSUM_CHANGED:'+table);}
 assert.ok(!before.tables.some(table=>table.name==='admin_feedback'),'UNEXPECTED_EXISTING_009_TABLE');
 Object.assign(report,{planned,d1:before.d1_counts,d3:before.row_counts.ayah_timings,canonical_checksum:before.canonical_checksum,critical_before:before.critical_counts,disk_before:await session.storage()});
 if(apply){
  assert.deepEqual(dryRun.critical_before,before.critical_counts,'DRY_RUN_CRITICAL_CHANGED');
  await executeAdminWorkspaceMigration(session,sql,backup);
  const after=await captureInventory(ENVIRONMENTS.production,s=>session.read(s));
  assert.deepEqual(after.d1_counts,before.d1_counts);assert.equal(after.canonical_checksum,before.canonical_checksum);
  for(const table of protectedTables){assert.equal(after.row_counts[table],before.row_counts[table],'POST_COUNT_CHANGED:'+table);assert.equal(after.checksums[table],before.checksums[table],'POST_CHECKSUM_CHANGED:'+table);}
  const feedback=after.tables.find(table=>table.name==='admin_feedback');assert.equal(feedback?.collation,'utf8mb4_unicode_ci');assert.equal(after.row_counts.admin_feedback,0);
  const raw=await session.read("SELECT COLUMN_NAME,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback' ORDER BY ORDINAL_POSITION;");
  const columns=raw.trim().split(/\r?\n/u).filter(Boolean).map(line=>line.split('\t'));assert.equal(columns.length,17);for(const column of columns.filter(row=>row[2]==='utf8mb4'))assert.equal(column[3],'utf8mb4_unicode_ci');
  for(const name of ['actor_id','message'])assert.equal(columns.find(row=>row[0]===name)?.[1],'YES');assert.equal(columns.find(row=>row[0]==='status')?.[1],'NO');
  const foreignKeys=await session.read("SELECT COUNT(*) n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback' AND REFERENCED_TABLE_NAME IS NOT NULL;");assert.equal(Number(foreignKeys.trim()),0,'FEEDBACK_FOREIGN_KEY_FORBIDDEN');
  Object.assign(report,{critical_after:after.critical_counts,disk_after:await session.storage(),protected_checksums_unchanged:true,feedback_metadata_verified:true});
 }
 report.checks_passed=true;
}catch(error){report.failure=error instanceof Error&&/^[A-Z0-9_:. -]{1,120}$/u.test(error.message)?error.message:'ADMIN_FEEDBACK_MIGRATION_FAILED';throw error;}
finally{try{await closeAdminWorkspaceReport(report,()=>session.close());}finally{report.finished_at=new Date().toISOString();await writeFile(outside(option('--report')),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});}}
console.log(JSON.stringify({applied:apply,passed:report.passed,sql_sha256:sqlSha,planned,d1:report.d1,d3:report.d3}));

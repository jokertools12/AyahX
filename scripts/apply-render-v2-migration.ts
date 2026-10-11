/** Root only. Default read-only dry-run; verified encrypted restore gates every DDL. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile,writeFile } from 'node:fs/promises';
import { renderV2Columns,renderV2MigrationSql } from '../server/db/migrations/007_addRenderManifestV2';
import { captureInventory,ENVIRONMENTS,identifier } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1],'REQUIRED_OPTION');return process.argv[i+1];};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const readJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const apply=process.argv.includes('--apply');
const failureCode=(error:unknown)=>{const line=error instanceof Error?error.message.split('\n')[0]:'';return /^[A-Z0-9_:]+$/u.test(line)?line:'007_OPERATOR_FAILED';};
async function main(){
 assert.ok(!apply||process.argv.includes('--confirm-production'),'PRODUCTION_ACK_REQUIRED');
 const backup=await readJson(option('--backup')),rehearsal=await readJson(option('--rehearsal'));
 const sql=renderV2MigrationSql(),sqlSha=hash(sql.map(row=>row+';').join('\n')+'\n');
 assert.ok(rehearsal.mysql_version==='9.7.2'&&rehearsal.up_twice_identical&&rehearsal.down_twice_removed_columns&&rehearsal.down_restored_protected_data&&rehearsal.production_down_rejected&&rehearsal.reapplied&&rehearsal.production_writes===0,'REAL_007_REHEARSAL_REQUIRED');
 assert.equal(sqlSha,rehearsal.sql_sha256,'REHEARSAL_SQL_CHANGED');
 const age=Date.now()-Date.parse(backup.checked_at);
 assert.ok(backup.restored_and_verified&&backup.mysql_version==='9.7.2'&&age>=0&&age<86400000,'FRESH_VERIFIED_BACKUP_REQUIRED');
 const encryptedHash=createHash('sha256');for await(const chunk of createReadStream(backup.encrypted_path))encryptedHash.update(chunk);
 assert.equal(encryptedHash.digest('hex'),backup.encrypted_sha256,'ENCRYPTED_BACKUP_SHA_MISMATCH');
 const dry=apply?await readJson(option('--dry-run')):null;
 if(apply){assert.ok(dry.passed&&dry.applied===false&&dry.target==='production','READ_ONLY_DRY_RUN_REQUIRED');assert.equal(dry.sql_sha256,sqlSha,'DRY_RUN_SQL_CHANGED');assert.equal(dry.encrypted_backup_sha256,backup.encrypted_sha256,'DRY_RUN_BACKUP_CHANGED');}
 const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
 const report:Record<string,unknown>={target:'production',applied:apply,passed:false,started_at:new Date().toISOString(),sql_sha256:sqlSha,encrypted_backup_sha256:backup.encrypted_sha256};
 const protectedTables=['users','profiles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','user_roles','notifications','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
 try{
  const before=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));
  assert.equal(before.canonical_checksum,'eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4','D1_CANONICAL_PROTECTED_STOP');
  for(const name of protectedTables){assert.equal(before.row_counts[name],backup.row_counts[name],'PROTECTED_BACKUP_COUNT_CHANGED');assert.equal(before.checksums[name],backup.checksums[name],'PROTECTED_BACKUP_CHECKSUM_CHANGED');}
  const grantsBefore=await session.read("SELECT role_slug,id FROM admin_permissions WHERE permission_key='render.test' ORDER BY role_slug,id;");
  assert.equal(grantsBefore.trim(),'','EARLY_PERMISSION_ACTIVATION_FORBIDDEN');
  const flagBefore=await session.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='quran_catalog_v2';");
  assert.ok(['','false\t0','0\t0'].includes(flagBefore.trim()),'CATALOG_FLAG_MUST_REMAIN_OFF');
  const oldColumns=before.columns.filter(row=>row.table==='render_jobs'&&!(row.column in renderV2Columns)).map(row=>row.column);
  const projectionSql="SELECT SHA2(CAST(JSON_OBJECT("+oldColumns.flatMap(name=>["'"+name+"'",identifier(name)]).join(',')+") AS CHAR CHARACTER SET utf8mb4),256) FROM render_jobs ORDER BY id;";
  const originalHash=hash(await session.read(projectionSql));
  const planned={nullable_columns:Object.keys(renderV2Columns).filter(name=>!before.columns.some(row=>row.table==='render_jobs'&&row.column===name)),permission_catalog_rows:before.row_counts.permissions===backup.row_counts.permissions?1:0,role_grants:0};
  const diskBefore=await session.storage();assert.ok(diskBefore.available_bytes/diskBefore.total_bytes>=.2,'007_SPACE_GUARD');
  Object.assign(report,{planned,critical_before:before.critical_counts,d1:before.d1_counts,d3:before.row_counts.ayah_timings,canonical_checksum:before.canonical_checksum,protected_checksums_before:Object.fromEntries(protectedTables.map(name=>[name,before.checksums[name]])),original_render_job_columns_sha256:originalHash,disk_before:diskBefore});
  if(apply){
   assert.deepEqual(planned,dry.planned,'DRY_RUN_PLAN_CHANGED');assert.deepEqual(before.critical_counts,dry.critical_before,'DRY_RUN_CRITICAL_COUNTS_CHANGED');assert.equal(originalHash,dry.original_render_job_columns_sha256,'DRY_RUN_RENDER_JOBS_CHANGED');
   await session.executeStatements(sql.map(value=>({sql:value+';',rowCount:0})));await session.commit();
   const after=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));
   for(const name of protectedTables){assert.equal(after.row_counts[name],before.row_counts[name],'PROTECTED_COUNT_CHANGED');if(name!=='render_jobs')assert.equal(after.checksums[name],before.checksums[name],'PROTECTED_CHECKSUM_CHANGED');}
   assert.equal(hash(await session.read(projectionSql)),originalHash,'ORIGINAL_RENDER_JOBS_CHANGED');
   assert.equal(after.canonical_checksum,before.canonical_checksum,'D1_CANONICAL_PROTECTED_STOP');
   assert.equal(after.row_counts.permissions,before.row_counts.permissions+planned.permission_catalog_rows,'PERMISSION_CATALOG_COUNT_MISMATCH');
   assert.equal(await session.read("SELECT role_slug,id FROM admin_permissions WHERE permission_key='render.test' ORDER BY role_slug,id;"),grantsBefore,'EARLY_PERMISSION_ACTIVATION_FORBIDDEN');
   assert.equal(await session.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='quran_catalog_v2';"),flagBefore,'CATALOG_FLAG_CHANGED');
   const columns=JSON.parse((await session.read("SELECT JSON_ARRAYAGG(JSON_OBJECT('name',COLUMN_NAME,'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'collation',COLLATION_NAME)) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='render_jobs';")).trim()) as Array<{name:string;type:string;nullable:string;collation:string|null}>;
   for(const [name,definition]of Object.entries(renderV2Columns)){const found=columns.find(row=>row.name===name);assert.equal(found?.nullable,'YES','007_NULLABILITY_MISMATCH');if(definition.includes('COLLATE'))assert.equal(found?.collation,'utf8mb4_unicode_ci','007_COLLATION_MISMATCH');}
   assert.deepEqual(after.foreign_keys,before.foreign_keys,'FOREIGN_KEYS_CHANGED');assert.deepEqual(after.triggers,before.triggers,'TRIGGERS_CHANGED');
   Object.assign(report,{critical_after:after.critical_counts,columns:columns.filter(row=>row.name in renderV2Columns),disk_after:await session.storage(),permission_activated:false});
  }
  report.passed=true;
 }catch(error){report.failure=failureCode(error);throw error;}finally{report.serial=await session.close();report.finished_at=new Date().toISOString();await writeFile(option('--report'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.passed,applied:apply,sql_sha256:sqlSha,planned:report.planned}));
}
void main().catch(error=>{console.error(failureCode(error));process.exitCode=1;});

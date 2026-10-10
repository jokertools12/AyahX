/** K1 reviewed CHECK replacement. Root only; defaults to read-only dry-run. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {publicationConstraintSql,PUBLICATION_CONSTRAINTS} from '../server/services/catalogTechnicalPublication';
import {captureInventory,ENVIRONMENTS,type Inventory} from './lib/railwayQuranOps';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
assert.equal(option('--target'),'production');const apply=process.argv.includes('--apply');if(apply)assert.ok(process.argv.includes('--confirm-production'));
const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as Inventory;
const backup=JSON.parse(readFileSync(option('--backup'),'utf8'));
const rehearsal=JSON.parse(readFileSync('docs/data/d4-k1-local-rehearsal.json','utf8')),scratch=JSON.parse(readFileSync('docs/data/d4-k1-scratch.json','utf8'));
assert.ok(rehearsal.passed&&rehearsal.apply_twice&&rehearsal.local_rollback&&rehearsal.reapply&&rehearsal.data_checksums_unchanged&&scratch.passed&&scratch.missing_conditions_rejected>=19);
assert.ok(backup.restored_and_verified&&backup.mysql_version==='9.7.2'&&Date.now()-Date.parse(backup.checked_at)<86400000,'FRESH_VERIFIED_BACKUP_REQUIRED');
assert.equal(createHash('sha256').update(readFileSync(backup.encrypted_path)).digest('hex'),backup.encrypted_sha256);
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});const report:Record<string,unknown>={started_at:new Date().toISOString(),target:'production',applied:apply};
try{
  const before=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));assert.equal(before.server_uuid,baseline.server_uuid);assert.equal(before.canonical_checksum,baseline.canonical_checksum);assert.deepEqual(before.d1_counts,baseline.d1_counts);
  for(const table of ['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'])assert.equal(before.checksums[table],baseline.checksums[table],'PROTECTED_CHECKSUM_STOP:'+table);
  for(const [table,count] of Object.entries(before.row_counts))assert.equal(count,backup.row_counts[table],'FRESH_BACKUP_COUNT_CHANGED:'+table);
  const checks=async()=> (await session.read("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='recitations' AND CONSTRAINT_TYPE='CHECK';")).trim().split('\n').filter(Boolean);
  const statements=publicationConstraintSql(await checks()),sql=statements.join('\n')+'\n',sha=createHash('sha256').update(sql).digest('hex');
  if(statements.length)assert.equal(sha,rehearsal.sql_sha256,'REHEARSED_SQL_CHANGED');
  if(apply){const dry=JSON.parse(readFileSync(option('--dry-run'),'utf8'));assert.ok(dry.passed&&!dry.applied);assert.equal(sha,dry.sql_sha256,'DRY_PLAN_CHANGED');}
  Object.assign(report,{sql_sha256:sha,sql_bytes:Buffer.byteLength(sql),statements:statements.length,disk_before:await session.storage()});
  if(apply&&statements.length){await session.executeStatements(statements.map(sql=>({sql,rowCount:0})),async()=>{const disk=await session.storage();assert.ok(disk.available_bytes/disk.total_bytes>=.2,'D4_SPACE_GUARD');});await session.commit();}
  const after=apply?await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql)):before;
  assert.deepEqual(after.row_counts,before.row_counts);assert.deepEqual(after.checksums,before.checksums,'DDL_CHANGED_CELLS');assert.deepEqual(after.critical_counts,before.critical_counts);
  if(apply){const names=await checks();assert.ok(Object.keys(PUBLICATION_CONSTRAINTS).every(n=>names.includes(n)));assert.ok(!names.includes('chk_catalog_offset')&&!names.includes('chk_catalog_publish'));}
  Object.assign(report,{passed:true,protected_unchanged:true,d1:after.d1_counts,d3:after.row_counts.ayah_timings,canonical_checksum:after.canonical_checksum,disk_after:await session.storage()});
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'K1_PRODUCTION_FAILED';throw new Error(String(report.failure));}
finally{report.serial=await session.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,applied:apply,sql_sha256:report.sql_sha256}));

/** Root-only reviewed SQL, one SSH/MySQL session. Defaults to read-only dry-run. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {captureInventory,ENVIRONMENTS,type Inventory} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
assert.equal(option('--target'),'production');const apply=process.argv.includes('--apply');if(apply)assert.ok(process.argv.includes('--confirm-production'));
const plan=JSON.parse(readFileSync(option('--plan'),'utf8')) as {passed:boolean;sql_sha256:string;audit_tail?:string};assert.ok(plan.passed);
const file=resolve(option('--sql'));const outside=relative(process.cwd(),file);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');
const sql=readFileSync(file,'utf8');const sha=createHash('sha256').update(sql).digest('hex');assert.equal(sha,plan.sql_sha256,'SQL_PLAN_CHANGED');
// Planner output uses one statement per physical line. Embedded data uses JSON escaping.
const statements=sql.split(/\r?\n/u).filter(s=>s.trim()&&!s.trim().startsWith('--'));
for(const s of statements){assert.ok(s.endsWith(';'),'ONE_COMPLETE_STATEMENT_PER_LINE_REQUIRED');assert.ok(/^(?:SET |START TRANSACTION;|COMMIT;|CREATE TEMPORARY TABLE ayahx_d4_|INSERT INTO ayahx_d4_|INSERT INTO audit_logs\(|INSERT INTO recitation_audition_samples\(|UPDATE (?:recitations|audio_providers|recitation_chapters|recitation_source_urls) SET |SELECT RELEASE_LOCK\()/u.test(s),'D4_STATEMENT_NOT_APPROVED');assert.ok(Buffer.byteLength(s)<=256*1024,'ROW_PACKET_MARGIN');}
const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as Inventory;
if(apply){const dry=JSON.parse(readFileSync(option('--dry-run'),'utf8'));assert.ok(dry.passed&&!dry.applied);assert.equal(dry.sql_sha256,sha);}
const remote=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
const report:Record<string,unknown>={started_at:new Date().toISOString(),target:'production',applied:apply,sql_sha256:sha,sql_bytes:Buffer.byteLength(sql),statements:statements.length};
const protectedTables=['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'];
try{
  const before=await captureInventory(ENVIRONMENTS.production,s=>remote.read(s));assert.equal(before.server_uuid,baseline.server_uuid);assert.equal(before.canonical_checksum,baseline.canonical_checksum);assert.deepEqual(before.d1_counts,baseline.d1_counts);
  for(const table of protectedTables)assert.equal(before.checksums[table],baseline.checksums[table],'PROTECTED_CHECKSUM_STOP:'+table);
  report.disk_before=await remote.storage();
  if(apply){
    const batches:Array<{sql:string;rowCount:number}>=[];let lines:string[]=[];let rows=0;let bytes=0;
    const flush=()=>{if(lines.length)batches.push({sql:lines.join('\n'),rowCount:rows});lines=[];rows=0;bytes=0;};
    for(const statement of statements){const n=/^(?:UPDATE |INSERT INTO (?:audit_logs|recitation_audition_samples)\()/u.test(statement)?1:0;const size=Buffer.byteLength(statement)+1;if(rows+n>200||bytes+size>256*1024)flush();lines.push(statement);rows+=n;bytes+=size;}flush();
    const packet=Number((await remote.read('SELECT @@max_allowed_packet;')).trim());
    await remote.executeStatements(batches,async batch=>{const disk=await remote.storage();assert.ok(disk.available_bytes/disk.total_bytes>=.2,'D4_SPACE_GUARD');assert.ok(Buffer.byteLength(batches[batch.ordinal-1].sql)<packet/4,'D4_PACKET_GUARD');});await remote.commit();
  }
  const after=apply?await captureInventory(ENVIRONMENTS.production,s=>remote.read(s)):before;
  for(const table of protectedTables)assert.equal(after.checksums[table],before.checksums[table],'POST_PROTECTED_CHECKSUM_STOP:'+table);
  assert.deepEqual(after.critical_counts,before.critical_counts);assert.equal(after.canonical_checksum,before.canonical_checksum);assert.deepEqual(after.d1_counts,before.d1_counts);
  if(apply&&plan.audit_tail){const tail=(await remote.read('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL;')).trim().split('\n').filter(Boolean);assert.deepEqual(tail,[plan.audit_tail],'AUDIT_TAIL_STOP');}
  report.protected_checksums_unchanged=true;report.d1=after.d1_counts;report.canonical_checksum=after.canonical_checksum;report.timings=after.row_counts.ayah_timings;report.disk_after=await remote.storage();report.passed=true;
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw new Error('D4_PLAN_FAILED:'+String(report.failure));}
finally{report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,applied:apply,sql_sha256:sha}));

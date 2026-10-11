/** Root-only local apply / read-only production plan with deterministic audit evidence. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {planCatalogT7Evidence} from '../server/services/catalogT7EvidencePlanner';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {jsonReviewValue} from '../server/services/humanReviewService';
import {D4AuditSqlPlan,d4Literal,sha256} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const path=resolve(option('--sql-output')),outside=relative(process.cwd(),path);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');
const bytes=readFileSync(option('--t7')),artifact=JSON.parse(bytes.toString('utf8')),artifactSha=sha256(bytes);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null,remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const rowsSql="SELECT JSON_OBJECT('id',id,'slug',slug,'status',status,'offset_verified',offset_verified,'offset_check_score',offset_check_score,'verification_status',verification_status,'verification_method',verification_method,'verification_details',verification_details,'audio_mode',audio_mode,'timing_quality',timing_quality,'timing_level',timing_level,'canonical_text_available',canonical_text_available,'voice_identity_status',voice_identity_status,'voice_confirmed_by',voice_confirmed_by,'voice_confirmed_at',voice_confirmed_at,'is_public',is_public) record FROM recitations ORDER BY slug";
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply,t7_artifact_sha256:artifactSha};
try{
  const rows=await read(rowsSql),prepared=planCatalogT7Evidence(rows,artifact,artifactSha),tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');const plan=new D4AuditSqlPlan(String(tails[0]?.hash??'0'.repeat(64)));
  for(const item of prepared){const keys=Object.keys(item.patch);if(!keys.length)continue;const old=rows.find(r=>r.id===item.id)!;plan.statements.push(`UPDATE recitations SET ${keys.map(k=>k+'='+d4Literal(k==='verification_details'?canonicalAuditJson(item.patch[k]):item.patch[k] as string|number|null)).join(',')} WHERE id=${d4Literal(item.id)};`);plan.append('recitation.t7_evidence','recitation',item.id,Object.fromEntries(keys.map(k=>[k,k==='verification_details'?jsonReviewValue(old[k])??null:old[k]??null])),{...item.patch,v1_raw_metrics_revalidated:item.v1_passed,artifact_sha256:artifactSha,human_state_unchanged:true});}
  const finished=plan.finish();writeFileSync(path,finished.sql);if(apply)await local!.query(finished.sql);
  if(apply){const after=await read(rowsSql);for(const old of rows){const current=after.find(r=>r.id===old.id)!;for(const key of ['voice_identity_status','voice_confirmed_by','voice_confirmed_at','is_public'])assert.equal(current[key],old[key],'HUMAN_PUBLIC_STATE_CHANGED');}assert.ok(planCatalogT7Evidence(after,artifact,artifactSha).every(r=>Object.keys(r.patch).length===0),'T7_REPLAY_NOT_IDEMPOTENT');}
  const {sql:_private,...proof}=finished;void _private;Object.assign(report,proof,{recitations:prepared.length,changes:plan.mutations.length,results:prepared.map(r=>({slug:r.slug,v1_passed:r.v1_passed,result_status:r.result_status})),passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error&&/^T7_[A-Z_]+$/u.test(error.message)?error.message:'T7_EVIDENCE_PREPARATION_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,recitations:report.recitations,changes:report.changes,artifact_sha256:artifactSha}));

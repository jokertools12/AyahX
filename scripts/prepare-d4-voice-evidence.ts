/** Root executes local rehearsal; production is read-only deterministic SQL preparation. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {planCatalogVoiceEvidence,type VoiceEvidenceRow} from '../server/services/catalogVoiceEvidencePlanner';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {jsonReviewValue} from '../server/services/humanReviewService';
import {D4AuditSqlPlan,d4Literal,sha256} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const sqlPath=resolve(option('--sql-output')),outside=relative(process.cwd(),sqlPath);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');
const bytes=readFileSync(option('--voice-auto')),artifact=JSON.parse(bytes.toString('utf8')),artifactSha=sha256(bytes);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null,remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const rowsSql="SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'reciter_id',r.reciter_id,'source_reciter_id',e.source_reciter_id,'voice_identity_status',r.voice_identity_status,'voice_auto_evidence',r.voice_auto_evidence,'voice_auto_verified_at',r.voice_auto_verified_at,'voice_confirmed_by',r.voice_confirmed_by,'voice_confirmed_at',r.voice_confirmed_at,'voice_notes',r.voice_notes,'is_public',r.is_public,'status',r.status) record FROM recitations r JOIN reciters e ON e.id=r.reciter_id ORDER BY r.slug";
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply,voice_artifact_sha256:artifactSha};
try{
  const rows=await read(rowsSql) as VoiceEvidenceRow[],prepared=planCatalogVoiceEvidence(rows,artifact,artifactSha),tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');const plan=new D4AuditSqlPlan(String(tails[0]?.hash??'0'.repeat(64)));
  for(const item of prepared){const keys=Object.keys(item.patch);if(!keys.length)continue;const old=rows.find(r=>r.id===item.id)!;plan.statements.push(`UPDATE recitations SET ${keys.map(k=>k+'='+d4Literal(k==='voice_auto_evidence'?canonicalAuditJson(item.patch[k]):item.patch[k] as string|null)).join(',')} WHERE id=${d4Literal(item.id)};`);plan.append('recitation.voice_auto_evidence','recitation',item.id,Object.fromEntries(keys.map(k=>[k,k==='voice_auto_evidence'?jsonReviewValue(old[k])??null:old[k]??null])),{...item.patch,advisory_only:true,human_state_preserved:item.human_state_preserved,artifact_sha256:artifactSha});}
  const finished=plan.finish();writeFileSync(sqlPath,finished.sql);if(apply)await local!.query(finished.sql);
  if(apply){const after=await read(rowsSql) as VoiceEvidenceRow[];assert.equal(after.length,rows.length);for(const old of rows){const current=after.find(r=>r.id===old.id)!;assert.ok(current);for(const key of ['voice_confirmed_by','voice_confirmed_at','voice_notes','is_public','status'])assert.equal(current[key],old[key],'HUMAN_PUBLIC_STATE_CHANGED');const expected=prepared.find(r=>r.id===old.id)!;assert.equal(current.voice_identity_status,expected.patch.voice_identity_status??old.voice_identity_status,'VOICE_STATE_READBACK_FAILED');}assert.ok(planCatalogVoiceEvidence(after,artifact,artifactSha).every(r=>Object.keys(r.patch).length===0),'VOICE_EVIDENCE_REPLAY_NOT_IDEMPOTENT');}
  const {sql:_private,...proof}=finished;void _private;Object.assign(report,proof,{recitations:prepared.length,changes:plan.mutations.length,human_states_preserved:prepared.filter(r=>r.human_state_preserved).length,automatic_status_changes:prepared.filter(r=>'voice_identity_status'in r.patch).map(r=>({slug:r.slug,status:r.patch.voice_identity_status})),advisory_status_counts:prepared.reduce((a,r)=>(a[r.advisory_status]=(a[r.advisory_status]??0)+1,a),{} as Record<string,number>),actual_aligner_readiness:artifact.actual_aligner_readiness??null,passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error&&/^VOICE_[A-Z_]+$/u.test(error.message)?error.message:'VOICE_EVIDENCE_PREPARATION_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,recitations:report.recitations,changes:report.changes,artifact_sha256:artifactSha,automatic_status_changes:report.automatic_status_changes}));

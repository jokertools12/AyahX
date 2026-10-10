/** Technical status plan only; root applies reviewed deterministic SQL separately. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {catalogPublicationFacts,technicalPublicationDecision,technicalPublicationMutation} from '../server/services/catalogTechnicalPublication';
import {D4AuditSqlPlan,d4Literal} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply));
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply};
try{
  const tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1);const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));
  const rowsSql="SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'reciter_id',r.reciter_id,'reader',x.name_ar,'riwayah_code',r.riwayah_code,'provider',p.code,'channel',r.channel,'status',r.status,'published_by',r.published_by,'published_at',r.published_at,'canonical_text_available',r.canonical_text_available,'audio_mode',r.audio_mode,'offset_verified',r.offset_verified,'offset_check_score',r.offset_check_score,'verification_status',r.verification_status,'verification_method',r.verification_method,'verification_details',r.verification_details,'timing_level',r.timing_level,'timing_quality',r.timing_quality,'voice_identity_status',r.voice_identity_status,'is_public',r.is_public,'license_status',p.license_status) record FROM recitations r JOIN reciters x ON x.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug";
  const rows=await read(rowsSql);
  const chapters=await read("SELECT JSON_OBJECT('recitation_id',recitation_id,'availability_state',availability_state,'coverage_mismatch',coverage_mismatch,'audio_status',audio_status,'checked_epoch_ms',UNIX_TIMESTAMP(last_verified_at)*1000) record FROM recitation_chapters");
  const conflicts=await read("SELECT JSON_OBJECT('type',type,'subject_type',subject_type,'subject_id',subject_id,'status',status,'evidence',evidence) record FROM human_review_items WHERE type='same_audio_conflict'");
  const nowMs=Date.now();report.link_health_as_of_ms=nowMs;
  let changes=0;const decisions=[];const changedIds=new Set<string>();for(const row of rows){const group=chapters.filter(c=>c.recitation_id===row.id);
    const facts=catalogPublicationFacts(row,group,conflicts,nowMs);
    const decision=technicalPublicationDecision(row,facts),mutation=technicalPublicationMutation(row,decision.eligible);decisions.push({id:row.id,slug:row.slug,reciter_id:row.reciter_id,reader:row.reader,riwayah:row.riwayah_code,provider:row.provider,channel:row.channel,...facts,...decision,publication_change_planned:mutation!==null});
    if(!mutation)continue;
    plan.statements.push(`UPDATE recitations SET status='published',published_by='rule-v1',published_at=UTC_TIMESTAMP(3) WHERE id=${d4Literal(row.id)};`);
    plan.append('recitation.technical_publication','recitation',row.id,{status:row.status,published_by:row.published_by??null,published_at:row.published_at??null},{...mutation,facts,rule:'rule-v1',public_visibility_unchanged:true});changes++;changedIds.add(String(row.id));
  }
  const finished=plan.finish(),path=resolve(option('--sql-output'));const outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside));writeFileSync(path,finished.sql);if(apply)await local!.query(finished.sql);
  if(apply){const after=await read(rowsSql);assert.equal(after.length,rows.length);for(const old of rows){const row=after.find(r=>r.id===old.id);assert.ok(row);for(const key of ['is_public','voice_identity_status','license_status'])assert.equal(row[key],old[key],'PUBLIC_OR_HUMAN_FIELDS_CHANGED');if(changedIds.has(String(old.id))){assert.equal(row.status,'published');assert.equal(row.published_by,'rule-v1');assert.ok(row.published_at);}else for(const key of ['status','published_by','published_at'])assert.equal(row[key],old[key],'EXISTING_PUBLICATION_CHANGED');}}
  const {sql:_privateSql,...evidence}=finished;void _privateSql;Object.assign(report,evidence,{changes,decisions,eligible:decisions.filter(d=>d.eligible).length,eligible_readers:new Set(decisions.filter(d=>d.eligible).map(d=>d.reciter_id)).size,passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN';throw new Error('D4_PUBLICATION_PLAN_FAILED');}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,eligible:report.eligible}));

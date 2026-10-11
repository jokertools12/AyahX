/** Root executes: local apply allowed, production is strictly read-only preparation. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {planHumanReviews,type ReviewPreparation} from '../server/services/humanReviewPlanner';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {jsonReviewValue} from '../server/services/humanReviewService';
import {D4AuditSqlPlan,d4Literal,sha256} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string,required=true)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1]){if(required)throw new Error('REQUIRED_OPTION:'+key);return null;}return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target!));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply};
try{
  const evidencePath=option('--evidence',false);const extra=evidencePath?JSON.parse(readFileSync(evidencePath,'utf8')):{};
  const recitations=await read("SELECT JSON_OBJECT('id',id,'slug',slug,'channel',channel,'style',style,'voice_identity_status',voice_identity_status,'voice_auto_evidence',voice_auto_evidence,'surah_start_basmala_audio_status',surah_start_basmala_audio_status,'basmala_mode',basmala_mode,'basmala_reason',basmala_reason,'verification_method',verification_method,'verification_status',verification_status,'verification_details',verification_details,'needs_label_review',needs_label_review,'display_label_ar',display_label_ar) record FROM recitations ORDER BY slug");
  const voiceFile=option('--voice-auto',false);
  if(voiceFile){const bytes=readFileSync(voiceFile),voice=JSON.parse(bytes.toString('utf8'));assert.equal(voice.actor,'auto-verifier-v1');assert.ok(voice.results&&typeof voice.results==='object');assert.deepEqual(Object.keys(voice.results).sort(),recitations.map(r=>r.slug).sort(),'VOICE_EVIDENCE_COVERAGE_MISMATCH');extra.voice_evidence=Object.fromEntries(Object.entries(voice.results).map(([slug,record])=>[slug,{artifact:'docs/data/voice-auto-verification.json',artifact_sha256:sha256(bytes),result:record}]));report.voice_artifact_sha256=sha256(bytes);}
  const youtubeV1Path=option('--youtube-v1',false);
  if(youtubeV1Path){assert.ok(voiceFile,'ORIGINAL_VOICE_ARTIFACT_REQUIRED');const bytes=readFileSync(youtubeV1Path),supplement=JSON.parse(bytes.toString('utf8'));assert.equal(supplement.actor,'deterministic-oembed-metadata-supplement-v1');assert.equal(supplement.input_sha256.original_voice_auto_verification,report.voice_artifact_sha256);assert.ok(Array.isArray(supplement.results));assert.deepEqual(supplement.results.map(r=>r.slug).sort(),recitations.filter(r=>r.channel==='youtube').map(r=>r.slug).sort(),'YOUTUBE_V1_COVERAGE_MISMATCH');for(const record of supplement.results){assert.equal(record.voice_identity_status,'unverified');assert.equal(record.V1.passed,false);assert.equal(record.V2.passed,false);extra.voice_evidence[record.slug].youtube_oembed_supplement={artifact:'docs/data/d4-youtube-v1-evidence.json',artifact_sha256:sha256(bytes),result:record};}report.youtube_v1_supplement_sha256=sha256(bytes);}
  const providers=await read("SELECT JSON_OBJECT('id',id,'code',code,'name',name,'license_status',license_status,'terms_url',terms_url) record FROM audio_providers ORDER BY code");
  const auditions=await read("SELECT JSON_OBJECT('recitation_id',recitation_id,'sample_key',sample_key,'surah',surah,'start_ms',start_ms,'duration_ms',duration_ms,'selection_details',selection_details) record FROM recitation_audition_samples ORDER BY recitation_id,sample_key");
  const near=JSON.parse(readFileSync(option('--near-complete')!,'utf8'));
  const planned=planHumanReviews({...extra,recitations,providers,auditions,near_complete:near.chapters} as ReviewPreparation);
  const stored=await read("SELECT JSON_OBJECT('id',id,'type',type,'subject_type',subject_type,'subject_id',subject_id,'evidence',evidence,'priority',priority,'status',status) record FROM human_review_items");
  const tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');
  const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));let changes=0,preservedDecisions=0;
  for(const item of planned){const old=stored.find(s=>s.type===item.type&&s.subject_type===item.subject_type&&s.subject_id===item.subject_id);
    if(old&&old.status!=='pending'){preservedDecisions++;continue;}
    if(old&&Number(old.priority)===item.priority&&canonicalAuditJson(jsonReviewValue(old.evidence))===canonicalAuditJson(item.evidence))continue;
    const id=old?.id??item.id;
    if(old)plan.statements.push(`UPDATE human_review_items SET evidence=${d4Literal(JSON.stringify(item.evidence))},priority=${item.priority} WHERE id=${d4Literal(String(id))} AND status='pending';`);
    else plan.statements.push(`INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(${[id,item.type,item.subject_type,item.subject_id,JSON.stringify(item.evidence),item.priority,'pending'].map(d4Literal).join(',')});`);
    plan.append('review.enqueue','human_review_item',String(id),old?{evidence:jsonReviewValue(old.evidence),priority:old.priority}:null,{type:item.type,subject_type:item.subject_type,subject_id:item.subject_id,evidence:item.evidence,priority:item.priority,status:'pending'});changes++;
  }
  const finished=plan.finish(),path=resolve(option('--sql-output')!),outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(path,finished.sql);
  if(apply)await local!.query(finished.sql);
  if(apply){const after=await read("SELECT JSON_OBJECT('type',type,'subject_type',subject_type,'subject_id',subject_id,'status',status,'priority',priority,'evidence',evidence) record FROM human_review_items");for(const item of planned){const row=after.find(r=>r.type===item.type&&r.subject_type===item.subject_type&&r.subject_id===item.subject_id);assert.ok(row,'REVIEW_READBACK_MISSING');if(row.status==='pending'){assert.equal(Number(row.priority),item.priority);assert.equal(canonicalAuditJson(jsonReviewValue(row.evidence)),canonicalAuditJson(item.evidence));}}}
  const {sql:_privateSql,...proof}=finished;void _privateSql;Object.assign(report,proof,{planned_items:planned.length,changes,preserved_decisions:preservedDecisions,by_type:planned.reduce((a,r)=>(a[r.type]=(a[r.type]??0)+1,a),{} as Record<string,number>),passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error&&typeof error==='object'&&'code'in error?String(error.code):'HUMAN_REVIEW_PREPARATION_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report')!,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,items:report.planned_items,by_type:report.by_type}));

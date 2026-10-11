/** Metadata-only supplement. Local SQL reads; no decisions, remote calls or media. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {validateReviewEvidence,type ReviewInput} from '../server/services/humanReviewService';
import {sha256} from './lib/d4AuditSqlPlan';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const database=option('--local-db');assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const out=resolve(option('--out')),outside=relative(process.cwd(),out);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_METADATA_REQUIRED');
const t7Bytes=readFileSync(option('--t7')),t7=JSON.parse(t7Bytes.toString('utf8')),durationBytes=readFileSync('docs/data/d4-duration-audit.json'),duration=JSON.parse(durationBytes.toString('utf8')),voice=JSON.parse(readFileSync('docs/data/voice-auto-verification.json','utf8'));
assert.ok(t7.results&&typeof t7.results==='object');
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4'});
try{
  const [rows]=await db.query<RowDataPacket[]>('SELECT id,slug,channel FROM recitations ORDER BY slug');
  const control=JSON.parse(readFileSync('docs/data/d4-r2-control-plane.json','utf8'));
  const acceptanceBytes=readFileSync('docs/data/d4-r2-real-acceptance.json'),acceptance=JSON.parse(acceptanceBytes.toString('utf8'));
  const logBytes=readFileSync('docs/data/d4-r2-log-secret-scan.json'),logs=JSON.parse(logBytes.toString('utf8'));
  const variables=JSON.parse(readFileSync('docs/data/d4-r2-variables.json','utf8'));
  assert.equal(acceptance.status,'PASSED_STORAGE_ACCEPTANCE_1_TO_7');assert.equal(acceptance.actual_r2,true);assert.equal(acceptance.test_objects_deleted,true);assert.equal(logs.secret_scan_passed,true);assert.equal(variables.passed,true);
  const storage_reviews=[{type:'storage_activation',subject_type:'storage_adapter',subject_id:'r2',technical_acceptance_completed:true,actual_r2_acceptance:true,acceptance_artifact:'docs/data/d4-r2-real-acceptance.json',acceptance_sha256:sha256(acceptanceBytes),log_scan_artifact:'docs/data/d4-r2-log-secret-scan.json',log_scan_sha256:sha256(logBytes),control_plane:control,blockers:[],required_action:'Monitor USD5 monthly R2 budget; the configured USD5 account-spend alert is monitoring, not a provider hard cap. Check invoice reporting after delay. No human rights or voice approvals were granted by technical storage acceptance.'},
    {type:'storage_credentials',subject_type:'storage_adapter',subject_id:'r2_read_only',credential_values_stored:true,credential_values_in_review:false,variables_artifact:'docs/data/d4-r2-variables.json',ttl_days:30,token_count:4,worker_writer_credentials:false,required_action:'Renew the approved single-bucket RW/RO credentials before their November9/10 expiry, retaining separate worker read-only scopes. Store replacement values only in Railway server variables and repeat scope tests. Existing credentials were created with explicit user approval; this pending operational review does not claim a new human decision.'},
    ...rows.filter(r=>r.channel==='youtube').map(r=>({type:'storage_rights',subject_type:'recitation',subject_id:r.id,slug:r.slug,rights_status:'unknown',required_action:'Provide owner permission, applicable CC terms or own-content evidence separately for each uploaded chapter. Official IFrame/oEmbed availability does not grant audio reuse rights.'}))];
  const measurements=duration.measurements??duration.results;assert.ok(Array.isArray(measurements),'DURATION_MEASUREMENTS_MISSING');
  const additional_reviews:ReviewInput[]=measurements.filter(r=>r.warning_over_5_percent===true).map(r=>{const recitation=rows.find(row=>row.slug===r.recitation);assert.ok(recitation,'DURATION_RECITATION_MISSING');return {type:'data_conflict',subject_type:'recitation_chapter',subject_id:recitation.id+':'+r.surah,priority:80,evidence:{reason:'DURATION_LAST_TIMED_WORD_DISCREPANCY',advisory_only:true,measurement:r,artifact:'docs/data/d4-duration-audit.json',artifact_sha256:sha256(durationBytes),required_action:'Review full source duration versus last stored timed-word endpoint; distinguish silence/basmala/outro/incomplete words/recording identity. Do not adjust timing or offset from this warning alone.'}};});
  const supplement={offset_evidence:Object.fromEntries(Object.entries(t7.results).map(([slug,result])=>[slug,{artifact:'docs/data/d4-t7-execution-results.json',artifact_sha256:sha256(t7Bytes),fixed_selection_sha256:t7.bindings.selection_sha256,measurement_complete:t7.real_measurements_complete,result,human_v2_acceptance_required:true}])),same_audio_conflicts:voice.same_audio_conflicts??[],storage_reviews,additional_reviews};
  for(const evidence of Object.values(supplement.offset_evidence))validateReviewEvidence(evidence);
  for(const evidence of storage_reviews)validateReviewEvidence(evidence);
  for(const review of additional_reviews)validateReviewEvidence(review.evidence);
  writeFileSync(out,JSON.stringify(supplement,null,2)+'\n');
  console.log(JSON.stringify({offset_reviews:Object.keys(supplement.offset_evidence).length,storage_reviews:storage_reviews.length,duration_warnings:additional_reviews.length,same_audio_conflicts:supplement.same_audio_conflicts.length,human_decisions:0}));
}finally{await db.end();}

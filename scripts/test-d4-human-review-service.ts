/** Root-only real local MySQL test. Disposable fixtures, never production. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {HumanReviewService,type ReviewInput} from '../server/services/humanReviewService';
import {LaunchReadinessService} from '../server/services/launchReadinessService';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {type CatalogActor} from '../server/services/catalogAudit';
const option=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
const database=option('--local-db');assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',connectionLimit:4});
const db=catalogDatabaseFromPool(pool),service=new HumanReviewService(db),rId=randomUUID(),pId=randomUUID();let reviewId:string|null=null,providerReviewId:string|null=null;
const report:Record<string,unknown>={started_at:new Date().toISOString(),target:'local',database,production_writes:0};
try{
  const [version]=await pool.query<RowDataPacket[]>('SELECT VERSION() version');assert.equal(version[0].version,'9.7.2');
  const [people]=await pool.query<RowDataPacket[]>('SELECT id FROM users ORDER BY id LIMIT 1');assert.ok(people.length,'LOCAL_ACTOR_FIXTURE_MISSING');
  const permissions=new Set(['reviews.enqueue','reviews.decide','reviews.read','recitations.voice.review','providers.license.review']);
  const actor:CatalogActor={id:String(people[0].id),kind:'human',permissions},system:CatalogActor={id:'auto-verifier-v1',kind:'system',permissions};
  const clone=async(table:'recitations'|'audio_providers',patch:Record<string,unknown>)=>{
    const [fields]=await pool.query<RowDataPacket[]>("SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",[table]);
    const names=fields.map(f=>String(f.name));assert.ok(names.every(n=>/^[a-z_]+$/u.test(n)));
    const values:unknown[]=[];const projection=names.map(name=>{if(name in patch){values.push(patch[name]);return '?';}return '`'+name+'`';});
    await pool.query(`INSERT INTO ${table}(${names.map(n=>'`'+n+'`').join(',')}) SELECT ${projection.join(',')} FROM ${table} ORDER BY id LIMIT 1`,values);
  };
  await clone('audio_providers',{id:pId,code:'k6_fixture_'+pId.slice(0,8),license_status:'unreviewed'});
  await clone('recitations',{id:rId,slug:'k6_fixture_'+rId,provider_id:pId,status:'needs_review',voice_identity_status:'unverified',voice_confirmed_by:null,voice_confirmed_at:null,is_public:0});
  const input:ReviewInput={type:'voice_confirmation',subject_type:'recitation',subject_id:rId,evidence:{test_fixture:true,V1:{passed:false}},priority:100};
  const first=await service.enqueue(system,input);reviewId=first.id;assert.equal(first.changed,true);assert.equal((await service.enqueue(system,input)).changed,false);
  await assert.rejects(service.decide(system,reviewId,{status:'approved',notes:'must reject system'}),{code:'CATALOG_PERMISSION_DENIED'});
  const outcomes=await Promise.allSettled([service.decide(actor,reviewId,{status:'approved',notes:'LOCAL TEST listening fixture only'}),service.decide(actor,reviewId,{status:'rejected',notes:'LOCAL TEST conflicting decision'})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);const failure=outcomes.find(o=>o.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'REVIEW_ALREADY_DECIDED');
  const [reviews]=await pool.query<RowDataPacket[]>('SELECT * FROM human_review_items WHERE id=?',[reviewId]);const decided=reviews[0];assert.equal(decided.decided_by,actor.id);
  const [histories]=await pool.query<RowDataPacket[]>('SELECT status,reviewer_id FROM recitation_voice_reviews WHERE recitation_id=?',[rId]);assert.equal(histories.length,1);assert.equal(histories[0].status,decided.status==='approved'?'confirmed':'mismatch');
  assert.equal((await service.decide(actor,reviewId,{status:decided.status,notes:decided.notes})).changed,false);
  assert.equal((await service.enqueue(system,{...input,evidence:{changed:true}})).changed,false);
  const license=await service.enqueue(system,{type:'provider_license',subject_type:'audio_provider',subject_id:pId,evidence:{test_fixture:true},priority:90});providerReviewId=license.id;
  await assert.rejects(service.decide(system,license.id,{status:'approved',notes:'must reject',decision:{license_status:'permitted',rights_evidence_ref:'local:test'}}),{code:'CATALOG_PERMISSION_DENIED'});
  await assert.rejects(service.decide(actor,license.id,{status:'approved',notes:'missing rights',decision:{license_status:'permitted'}}),{code:'LICENSE_EVIDENCE_REQUIRED'});
  const [licenseRows]=await pool.query<RowDataPacket[]>('SELECT license_status FROM audio_providers WHERE id=?',[pId]);assert.equal(licenseRows[0].license_status,'unreviewed');
  const [tail]=await pool.query<RowDataPacket[]>('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert.equal(tail.length,1);
  const readiness=await new LaunchReadinessService(db).get(actor);assert.equal(readiness.flag_enabled,false);
  Object.assign(report,{passed:true,enqueue_idempotent:true,system_confirmed_denied:true,system_permitted_denied:true,concurrent_decisions:{accepted:1,conflict_rejected:1,voice_history_rows:histories.length},decision_replay_idempotent:true,human_decision_preserved:true,missing_license_evidence_rolled_back:true,audit_chain_unique_tail:true,launch_readiness_flag_closed:true});
}catch(error){report.passed=false;report.failure=error&&typeof error==='object'&&'code'in error?String(error.code):'K6_LOCAL_SERVICE_ACCEPTANCE_FAILED';throw new Error(String(report.failure));}
finally{
  // Only disposable local fixture rows; no account, canonical or D3 data touched.
  await pool.query('DELETE FROM recitation_voice_reviews WHERE recitation_id=?',[rId]);
  for(const id of [reviewId,providerReviewId])if(id)await pool.query('DELETE FROM human_review_items WHERE id=?',[id]);
  await pool.query('DELETE FROM recitations WHERE id=?',[rId]);await pool.query('DELETE FROM audio_providers WHERE id=?',[pId]);
  await pool.end();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,target:'local',concurrent_decisions:report.concurrent_decisions}));

/** Root local audition rehearsal / production read-only deterministic preparation. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {planRecitationAuditions,type AuditionChapter,type AuditionLinkEvidence} from '../server/services/recitationAuditionPlanner';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {D4AuditSqlPlan,d4Literal,sha256} from './lib/d4AuditSqlPlan';
import {createLinkCheckpoint,type CatalogLinkCheckpoint,type CatalogLinkTarget} from '../server/services/catalogLinkChecker';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target');const apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply};
try{
  const checkpoint=JSON.parse(readFileSync(option('--checkpoint'),'utf8')) as CatalogLinkCheckpoint;assert.ok(!checkpoint.stopped,'CROSS_RECITER_AUDIO_FILE_COLLISION');
  const currentTargets=await read("SELECT JSON_OBJECT('id',c.id,'recitationId',r.id,'reciterId',r.reciter_id,'recitationSlug',r.slug,'surah',c.surah,'url',c.audio_url,'allowedHosts',p.host_allowlist) record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id");
  createLinkCheckpoint(currentTargets.map(r=>({...r,kind:'chapter',key:'chapter:'+String(r.id)})) as CatalogLinkTarget[],checkpoint);
  const recitations=await read("SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'allowed_hosts',p.host_allowlist) record FROM recitations r JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug");
  const chapters=await read("SELECT JSON_OBJECT('id',id,'recitation_id',recitation_id,'surah',surah,'audio_url',audio_url,'chapter_offset_ms',chapter_offset_ms) record FROM recitation_chapters ORDER BY recitation_id,surah");
  assert.equal(Object.keys(checkpoint.results).length,chapters.length,'LINK_CHECKPOINT_INCOMPLETE');
  const stored=await read("SELECT JSON_OBJECT('id',id,'recitation_id',recitation_id,'sample_key',sample_key,'surah',surah,'start_ms',start_ms,'duration_ms',duration_ms,'selection_details',selection_details) record FROM recitation_audition_samples");
  const tails=await read('SELECT JSON_OBJECT(\'hash\',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');
  const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));const all:Record<string,unknown>[]=[];let changes=0;
  for(const recitation of recitations){
    const group=chapters.filter(c=>c.recitation_id===recitation.id);const checks:Record<string,AuditionLinkEvidence>={};
    for(const chapter of group){const check=checkpoint.results['chapter:'+chapter.id];assert.ok(check,'LINK_CHECKPOINT_ROW_MISSING');checks[chapter.audio_url]=check.check;}
    const slots=planRecitationAuditions({recitation_id:recitation.id,chapters:group as AuditionChapter[],allowed_hosts:recitation.allowed_hosts,link_checks:checks});
    for(const slot of slots){
      const old=stored.find(s=>s.recitation_id===slot.recitation_id&&s.sample_key===slot.sample_key);
      const id=old?.id??sha256(slot.recitation_id+':'+slot.sample_key).slice(0,36);const patch={surah:slot.surah,start_ms:slot.start_ms,duration_ms:slot.duration_ms,selection_details:slot.selection_details};
      all.push({recitation:recitation.slug,...slot});
      if(old&&canonicalAuditJson(Object.fromEntries(Object.keys(patch).map(k=>[k,old[k]])))===canonicalAuditJson(patch))continue;
      const values=[id,slot.recitation_id,slot.sample_key,slot.surah,slot.start_ms,slot.duration_ms,JSON.stringify(slot.selection_details)];
      plan.statements.push(`INSERT INTO recitation_audition_samples(id,recitation_id,sample_key,surah,start_ms,duration_ms,selection_details) VALUES(${values.map(d4Literal).join(',')}) ON DUPLICATE KEY UPDATE surah=VALUES(surah),start_ms=VALUES(start_ms),duration_ms=VALUES(duration_ms),selection_details=VALUES(selection_details);`);
      plan.append('recitation.audition_sample','recitation_audition_samples',String(id),old?Object.fromEntries(Object.keys(patch).map(k=>[k,old[k]])):null,patch);changes++;
    }
  }
  assert.equal(all.length,recitations.length*3);const finished=plan.finish();const path=resolve(option('--sql-output'));const outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(path,finished.sql);
  if(apply)await local!.query(finished.sql);
  const {sql:_privateSql,...evidence}=finished;void _privateSql;Object.assign(report,evidence,{changes,slots:all.length,available:all.filter(s=>(s.selection_details as {status:string}).status==='available').length,samples:all,passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error&&typeof error==='object'&&'code' in error?String(error.code):'D4_AUDITION_PLAN_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,slots:report.slots,available:report.available}));

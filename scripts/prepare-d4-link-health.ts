/** Root local rehearsal / production read-only plan. No network request or provider substitution. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {createLinkCheckpoint,catalogLinkReport,catalogLinkSqlPlan,type CatalogLinkCheckpoint,type CatalogLinkTarget} from '../server/services/catalogLinkChecker';
import {D4AuditSqlPlan,sha256} from './lib/d4AuditSqlPlan';
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
  const rows=await read("SELECT JSON_OBJECT('id',c.id,'recitationId',r.id,'reciterId',r.reciter_id,'recitationSlug',r.slug,'surah',c.surah,'url',c.audio_url,'allowedHosts',p.host_allowlist) record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY c.id");
  const stored=await read("SELECT JSON_OBJECT('id',id,'audio_status',audio_status,'checked_epoch_ms',UNIX_TIMESTAMP(last_verified_at)*1000) record FROM recitation_chapters ORDER BY id");
  const storedById=new Map(stored.map(r=>[r.id,r]));
  const alternates=await read('SELECT JSON_OBJECT(\'n\',COUNT(*)) record FROM recitation_source_urls');assert.equal(Number(alternates[0].n),0,'ALTERNATE_INVENTORY_CHANGED');
  const targets=rows.map(r=>({...r,kind:'chapter',key:'chapter:'+String(r.id)})) as CatalogLinkTarget[];
  const checkpoint=createLinkCheckpoint(targets,JSON.parse(readFileSync(option('--checkpoint'),'utf8')) as CatalogLinkCheckpoint);
  assert.ok(!checkpoint.stopped,'CROSS_RECITER_AUDIO_FILE_COLLISION');
  const plain=catalogLinkSqlPlan(targets,checkpoint);const summary=catalogLinkReport(targets,checkpoint);
  const tails=await read('SELECT JSON_OBJECT(\'hash\',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');
  const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));let changes=0;
  let mutations:Record<string,unknown>[]=[];let observations:Record<string,unknown>[]=[];
  const flush=()=>{if(!mutations.length)return;plan.append('catalog.links.checked','catalog_link_batch',sha256(JSON.stringify(mutations)).slice(0,36),null,{mutations,resolved_observations:observations,evidence_scope:'link_only_not_voice_identity'});mutations=[];observations=[];};
  for(const item of plain.statements){const match=/WHERE id='([^']+)'/u.exec(item.sql);assert.ok(match);const old=rows.find(r=>r.id===match[1]);assert.ok(old);const key='chapter:'+old.id;const check=checkpoint.results[key].check;
    const status=check.status==='available'?'available':'source_unavailable';const storedRow=storedById.get(old.id);assert.ok(storedRow);
    const epoch=Math.floor(Date.parse(check.checkedAt)/1000)*1000;
    if(storedRow.audio_status===status&&Number(storedRow.checked_epoch_ms)===epoch)continue;
    plan.statements.push(item.sql);changes++;
    mutations.push({target_key:key,recitation_id:old.recitationId,old_status:storedRow.audio_status,old_checked_epoch_ms:storedRow.checked_epoch_ms,new_status:status,checked_at:check.checkedAt,link_check_status:check.status,http_status:check.httpStatus,...(check.retryAt?{retry_at:check.retryAt,retry_host:check.retryHost??new URL(String(old.url)).hostname}:{})});
    if(check.status==='available'&&check.finalUrl)observations.push({targetKey:key,originalSha256:sha256(String(old.url)),finalUrl:check.finalUrl,checkedAt:check.checkedAt});
    if(mutations.length>=20)flush();
  }flush();
  const finished=plan.finish();const path=resolve(option('--sql-output'));const outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(path,finished.sql);
  if(apply)await local!.query(finished.sql);
  const {sql:_privateSql,...evidence}=finished;void _privateSql;
  Object.assign(report,evidence,{changes,links:summary.total,counts:summary.counts,checkpoint_sha256:sha256(readFileSync(option('--checkpoint'))),passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error&&typeof error==='object'&&'code' in error?String(error.code):'D4_LINK_PLAN_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,counts:report.counts}));

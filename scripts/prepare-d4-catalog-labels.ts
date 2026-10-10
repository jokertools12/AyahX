/** Root runs local apply or production read-only deterministic plan. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {planCatalogLabels,type LabelCatalogRow} from '../server/services/catalogLabelPlanner';
import {D4AuditSqlPlan,d4Literal} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply),'PRODUCTION_PLAN_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null,remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const report:Record<string,unknown>={target,applied:apply,started_at:new Date().toISOString()};
try{
  const rows=await read("SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'name_ar',e.name_ar,'name_en',e.name_en,'style',r.style,'provider_name',p.name,'recording_year',r.recording_year,'display_label_ar',r.display_label_ar,'display_label_en',r.display_label_en,'needs_label_review',r.needs_label_review,'human_edited',EXISTS(SELECT 1 FROM audit_logs a WHERE a.user_id IS NOT NULL AND a.entity_type IN ('recitation','recitations') AND a.entity_id=r.id AND a.action IN ('recitation.presentation','recitation.label_review'))) record FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug");
  const labels=planCatalogLabels(rows.map(r=>({...r,human_edited:r.human_edited===true||r.human_edited===1})) as LabelCatalogRow[]);
  const tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));
  for(const label of labels){const keys=Object.keys(label.patch);if(!keys.length)continue;const row=rows.find(r=>r.id===label.id)!;plan.statements.push(`UPDATE recitations SET ${keys.map(k=>k+'='+d4Literal(label.patch[k] as string|boolean|null)).join(',')} WHERE id=${d4Literal(label.id)};`);plan.append('recitation.catalog_label','recitation',label.id,Object.fromEntries(keys.map(k=>[k,row[k]])),{...label.patch,reasons:label.reasons,source:'QUD catalog + stored provider metadata'});}
  const finished=plan.finish(),path=resolve(option('--sql-output')),outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(path,finished.sql);if(apply)await local!.query(finished.sql);
  if(apply){const after=await read("SELECT JSON_OBJECT('id',id,'display_label_ar',display_label_ar,'display_label_en',display_label_en,'needs_label_review',needs_label_review) record FROM recitations");for(const label of labels){const row=after.find(r=>r.id===label.id);assert.ok(row);for(const [key,value]of Object.entries(label.patch))assert.equal(typeof value==='boolean'?Boolean(row[key]):row[key],value,'LABEL_READBACK_FAILED');}}
  const {sql:_private,...proof}=finished;void _private;Object.assign(report,proof,{recitations:labels.length,changes:plan.mutations.length,human_labels_preserved:labels.filter(r=>r.human_label_preserved).length,label_conflicts:labels.filter(r=>r.reasons.length).map(r=>({slug:r.slug,reasons:r.reasons})),passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error&&typeof error==='object'&&'code'in error?String(error.code):'CATALOG_LABEL_PREPARATION_FAILED';throw new Error(String(report.failure));}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,recitations:report.recitations,changes:report.changes}));

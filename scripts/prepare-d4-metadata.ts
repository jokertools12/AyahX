/** Root-owned metadata rehearsal/production dry-run; never production apply. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {catalogOffsetPatch,type AcceptedOffsetProof} from '../server/services/catalogOffsetMetadata';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {sqlLiteral as rawSqlLiteral} from '../server/services/qudCatalogSql';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target');const apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const decisions=JSON.parse(readFileSync('docs/data/d3-offset-v2-accepted.json','utf8')) as AcceptedOffsetProof;
assert.equal(createHash('sha256').update(readFileSync('docs/data/d3-audio-failure-diagnosis-v2.json')).digest('hex'),decisions.raw_report_sha256,'OFFSET_RAW_EVIDENCE_CHANGED');
assert.equal(createHash('sha256').update(readFileSync('docs/data/d3-audio-independent-review.json')).digest('hex'),decisions.independent_review_sha256,'OFFSET_REVIEW_EVIDENCE_CHANGED');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');const report:Record<string,unknown>={checked_at:new Date().toISOString(),target,applied:apply};
const sqlLiteral=(value:string|number|boolean|null)=>rawSqlLiteral(value)+(typeof value==='string'?' COLLATE utf8mb4_unicode_ci':'');
try{
  const tails=await read('SELECT JSON_OBJECT(\'hash\',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');let previous=tails[0]?.hash??'0'.repeat(64);const seed=previous;
  const columns=await read("SELECT JSON_OBJECT('n',COUNT(*)) record FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recitations' AND COLUMN_NAME='verification_method'");
  const rows=await read(`SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'canonical_text_available',r.canonical_text_available,'offset_verified',r.offset_verified,'offset_check_score',r.offset_check_score,'verification_status',r.verification_status,'verification_details',r.verification_details,'verification_method',${Number(columns[0].n)?'r.verification_method':'NULL'},'audio_mode',r.audio_mode,'timing_level',r.timing_level,'timing_quality',r.timing_quality,'ready',(SELECT COUNT(*) FROM ayah_timings a FORCE INDEX(idx_timing_ready_range) WHERE a.recitation_id=r.id AND a.review_status='ready')) record FROM recitations r ORDER BY r.slug`);
  const statements:string[]=[];const mutations:Record<string,unknown>[]=[];
  const mutation=(table:string,id:string,action:string,old:Record<string,unknown>,patch:Record<string,unknown>)=>{
    const normalized=Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,typeof v==='boolean'?Number(v):v]));
    const diff=Object.fromEntries(Object.entries(normalized).filter(([key,value])=>canonicalAuditJson(old[key]??null)!==canonicalAuditJson(value)));if(!Object.keys(diff).length)return;
    const oldValues=Object.fromEntries(Object.keys(diff).map(k=>[k,old[k]??null]));const rawId=sha(canonicalAuditJson({action,table,id,oldValues,newValues:diff,previous})).slice(0,32);const auditId=[rawId.slice(0,8),rawId.slice(8,12),rawId.slice(12,16),rawId.slice(16,20),rawId.slice(20)].join('-');
    const payload={id:auditId,actor:null,role:null,action,entityType:table,entityId:id,oldValues,newValues:diff,prev:previous};const hash=sha(canonicalAuditJson(payload));
    statements.push(`UPDATE ${table} SET ${Object.entries(diff).map(([k,v])=>`${k}=${sqlLiteral(typeof v==='object'&&v!==null?JSON.stringify(v):v as string|number|boolean|null)}`).join(',')} WHERE id=${sqlLiteral(id)};`);
    statements.push(`INSERT INTO audit_logs(id,user_id,role_slug,action,entity_type,entity_id,old_values,new_values,hash,prev_hash) VALUES(${[auditId,null,null,action,table,id,JSON.stringify(oldValues),JSON.stringify(diff),hash,previous].map(v=>sqlLiteral(v)).join(',')});`);
    mutations.push({table,id,action,fields:Object.keys(diff),audit_id:auditId,audit_hash:hash});previous=hash;
  };
  for(const row of rows)mutation('recitations',String(row.id),'recitation.offset_timing_metadata',row,catalogOffsetPatch(row,Number(row.ready),decisions));
  const providers=await read("SELECT JSON_OBJECT('id',id,'host_allowlist',host_allowlist) record FROM audio_providers WHERE code='mp3quran'");assert.equal(providers.length,1);const p=providers[0];assert.ok(Array.isArray(p.host_allowlist));
  if(!p.host_allowlist.includes('cdn.mp3quran.net'))mutation('audio_providers',p.id,'provider.allowlist_redirect',p,{host_allowlist:[...p.host_allowlist,'cdn.mp3quran.net'].sort()});
  // A native CHECK guard halts if another writer changed the chain since dry-run.
  const guard=`CREATE TEMPORARY TABLE ayahx_d4_metadata_guard(ok BOOLEAN NOT NULL CHECK(ok=1));\nSET @ayahx_d4_lock=GET_LOCK('ayahx_audit_chain',10);\nINSERT INTO ayahx_d4_metadata_guard VALUES(IF(@ayahx_d4_lock=1,1,0));\nSTART TRANSACTION;\nINSERT INTO ayahx_d4_metadata_guard SELECT IF(COUNT(*)=${seed==='0'.repeat(64)?0:1} AND COALESCE(MAX(a.hash),REPEAT('0',64))=${sqlLiteral(seed)},1,0) FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL;`;
  const sql=`${guard}\n${statements.join('\n')}\nCOMMIT;\nSELECT RELEASE_LOCK('ayahx_audit_chain');\n`;
  const output=resolve(option('--sql-output'));const outside=relative(process.cwd(),output);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(output,sql);
  if(apply){assert.equal(Number(columns[0].n),1,'MIGRATION004_REQUIRED');await local!.query(sql);}
  report.sql_sha256=sha(sql);report.sql_bytes=Buffer.byteLength(sql);report.mutations=mutations;report.audit_seed=seed;report.audit_tail=previous;report.offset_v2_accepted=Object.keys(decisions.accepted);report.passed=true;
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';const code=error&&typeof error==='object'&&'code' in error?String(error.code):'D4_METADATA_FAILED';throw new Error(code);}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,applied:apply,mutations:(report.mutations as unknown[]).length,sql_sha256:report.sql_sha256}));

/** Root-only explicit provider host audit and local rehearsal. Production prepares SQL only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {createLinkCheckpoint,catalogLinkReport,type CatalogLinkTarget,type CatalogLinkCheckpoint} from '../server/services/catalogLinkChecker';
import {migrateApprovedHostCheckpoint} from '../server/services/catalogLinkCheckpointMigration';
import {D4AuditSqlPlan,d4Literal,sha256} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(k:string)=>{const i=process.argv.indexOf(k);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply));
const privatePath=(key:string)=>{const path=resolve(option(key)),outside=relative(process.cwd(),path);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_ARTIFACT_REQUIRED');return path;};
const sqlOutput=privatePath('--sql-output'),checkpointOutput=privatePath('--new-checkpoint');assert.notEqual(sqlOutput,checkpointOutput,'ARTIFACT_PATH_COLLISION');
if(target==='local')assert.match(option('--local-db'),/^ayahx_d4_[a-z0-9_]+$/u,'LOCAL_REHEARSAL_REQUIRED');
const proofBytes=readFileSync(option('--host-evidence')),proof=JSON.parse(proofBytes.toString('utf8'));assert.ok(proof.passed&&proof.finished_at);
const initial=JSON.parse(readFileSync(option('--initial-report'),'utf8')),old=JSON.parse(readFileSync(option('--old-checkpoint'),'utf8')) as CatalogLinkCheckpoint;
assert.equal(proof.old_inventory_sha256,initial.input_sha256);assert.equal(old.inputSha256,initial.input_sha256);
assert.deepEqual(proof.checks.map((c:{target_key:string})=>c.target_key).sort(),initial.failed_urls.filter((r:{status:string})=>r.status==='AUDIO_HOST_NOT_ALLOWED').map((r:{target_key:string})=>r.target_key).sort());
const approved=['*.us.archive.org',...proof.new_hosts.filter((h:string)=>/^[a-z0-9-]+\.ca\.archive\.org$/u.test(h))];assert.ok(proof.new_hosts.some((h:string)=>h.endsWith('.us.archive.org')));
const db=target==='local'?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:option('--local-db'),charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>db?(await db.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const report:Record<string,unknown>={target,applied:apply,host_evidence_sha256:sha256(proofBytes),added_hosts:approved};
try{
  const providers=await read("SELECT JSON_OBJECT('id',id,'code',code,'host_allowlist',host_allowlist) record FROM audio_providers");
  const rows=await read("SELECT JSON_OBJECT('id',c.id,'recitationId',r.id,'reciterId',r.reciter_id,'recitationSlug',r.slug,'surah',c.surah,'url',c.audio_url,'allowedHosts',p.host_allowlist,'provider_id',p.id) record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY c.id");
  const targets=rows.map(r=>{const {provider_id:_provider,...t}=r;void _provider;return {...t,kind:'chapter',key:'chapter:'+String(r.id)};}) as CatalogLinkTarget[];
  createLinkCheckpoint(targets,old);
  const tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1);const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));
  const providerIds=new Set(rows.filter(r=>new URL(r.url).hostname==='archive.org'||new URL(r.url).hostname.endsWith('.us.archive.org')).map(r=>r.provider_id));
  const hostMap=new Map<string,string[]>();
  for(const provider of providers){const before=provider.host_allowlist as string[];const hosts=providerIds.has(provider.id)?[...new Set([...before,...approved])].sort():before;hostMap.set(provider.id,hosts);
    if(JSON.stringify([...before].sort())===JSON.stringify([...hosts].sort()))continue;
    plan.statements.push(`UPDATE audio_providers SET host_allowlist=${d4Literal(JSON.stringify(hosts))} WHERE id=${d4Literal(provider.id)};`);
    plan.append('provider.host_allowlist_audited','audio_provider',provider.id,{host_allowlist:before},{host_allowlist:hosts,evidence:'docs/data/d4-archive-host-evidence-phase2.json',evidence_sha256:sha256(proofBytes),basis:'pinned catalog/official Archive HTTPS redirect, public pinned DNS, authorized TLS certificate on every hop'});
  }
  const after=targets.map(t=>({...t,allowedHosts:hostMap.get(rows.find(r=>r.id===t.id)!.provider_id)!}));
  const checkpoint=migrateApprovedHostCheckpoint(targets,after,old,{evidenceSha256:sha256(proofBytes),approvedHosts:approved});
  for(const c of proof.checks){assert.equal(sha256(c.original_url),initial.last_checks.find((r:{target_key:string})=>r.target_key===c.target_key).original_url_sha256);checkpoint.results[c.target_key].check=c.checked;}
  createLinkCheckpoint(after,checkpoint);writeFileSync(checkpointOutput,JSON.stringify(checkpoint,null,2)+'\n');
  const summary=catalogLinkReport(after,checkpoint);writeFileSync(option('--link-report'),JSON.stringify(summary,null,2)+'\n');
  const finished=plan.finish();writeFileSync(sqlOutput,finished.sql);if(apply)await db!.query(finished.sql);
  const {sql:_sql,...evidence}=finished;void _sql;Object.assign(report,evidence,{provider_changes:plan.mutations.length,before_inventory_sha256:old.inputSha256,after_inventory_sha256:checkpoint.inputSha256,reused_results:Object.keys(old.results).length-proof.checks.length,replaced_host_checks:proof.checks.length,counts:summary.counts,passed:true});
}finally{if(db)await db.end();if(remote)report.serial=await remote.close();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,provider_changes:report.provider_changes,counts:report.counts}));

/** Technical status plan only; root applies reviewed deterministic SQL separately. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {catalogPublicationFacts} from '../server/services/catalogTechnicalPublication';
import {planScopedTechnicalPublication} from '../server/services/catalogLicensedPublicationPlanner';
import {CatalogLicensedChapterReadiness,createLicensedPublicationDetails,LICENSED_CHAPTER_FIELDS,LICENSED_TIMING_FIELDS,LICENSED_TIMING_BINDING_EXPRESSION,type LicensedChapterProof} from '../server/services/catalogLicensedReadiness';
import {CatalogLicensedSourceResolver,LICENSED_SOURCE_FIELDS,LICENSED_SOURCE_BINDING_EXPRESSION} from '../server/services/licensedSourceResolver';
import {catalogStorageFromEnvironment} from '../server/services/catalogStorageRuntime';
import {CatalogAudioSource} from '../server/services/catalogAudioSource';
import {readCatalogSettings} from '../server/services/recitationCatalogService';
import type {CatalogDatabase} from '../server/services/catalogContracts';
import type {AudioObjectStorage} from '../server/services/catalogStorageContracts';
import {D4AuditSqlPlan,d4Literal} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply');assert.ok(['local','production'].includes(target));assert.ok(!(target==='production'&&apply));
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const local=database?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true}):null;
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production):null;
const read=async(sql:string)=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const projectedRead=async(sql:string,params:unknown[]=[])=>{
  const fields=sql.includes('u.id source_id')?LICENSED_SOURCE_FIELDS:sql.includes('JOIN quran_surahs')?LICENSED_CHAPTER_FIELDS:sql.includes('FROM ayah_timings')?LICENSED_TIMING_FIELDS:sql.includes('FROM system_settings')?['key_name','value_text','is_secret']:['id'];
  let i=0;const bound=sql.replace(/\?/gu,()=>{const v=params[i++];assert.ok(v===null||['string','number','boolean'].includes(typeof v));return d4Literal(v as string|number|boolean|null);});assert.equal(i,params.length);
  return read(`SELECT JSON_OBJECT(${fields.flatMap(f=>["'"+f+"'",'_licensed_row.'+f]).join(',')}) record FROM (${bound}) _licensed_row`);
};
const readonlyDb:CatalogDatabase={read:projectedRead,execute:async()=>{throw new Error('PUBLICATION_VERIFIER_READ_ONLY');},transaction:async()=>{throw new Error('PUBLICATION_VERIFIER_READ_ONLY');}};
const source=new CatalogAudioSource();
const report:Record<string,unknown>={started_at:new Date().toISOString(),target,applied:apply};
try{
  const tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1);const plan=new D4AuditSqlPlan(tails[0]?.hash??'0'.repeat(64));
  const rowsSql="SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'reciter_id',r.reciter_id,'reader',x.name_ar,'riwayah_code',r.riwayah_code,'provider',p.code,'channel',r.channel,'status',r.status,'published_by',r.published_by,'published_at',r.published_at,'canonical_text_available',r.canonical_text_available,'audio_mode',r.audio_mode,'offset_verified',r.offset_verified,'offset_check_score',r.offset_check_score,'verification_status',r.verification_status,'verification_method',r.verification_method,'verification_details',r.verification_details,'timing_level',r.timing_level,'timing_quality',r.timing_quality,'voice_identity_status',r.voice_identity_status,'is_public',r.is_public,'license_status',p.license_status,'licensed_publication_details',r.licensed_publication_details) record FROM recitations r JOIN reciters x ON x.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug";
  const rows=await read(rowsSql);
  const chapters=await read("SELECT JSON_OBJECT('recitation_id',recitation_id,'surah',surah,'availability_state',availability_state,'coverage_mismatch',coverage_mismatch,'audio_status',audio_status,'checked_epoch_ms',UNIX_TIMESTAMP(last_verified_at)*1000) record FROM recitation_chapters");
  const licensedCandidates=await read("SELECT JSON_OBJECT('recitation_id',recitation_id,'surah',surah,'storage_object_id',storage_object_id) record FROM recitation_source_urls WHERE kind='licensed_file' AND is_active=1 AND verification_status='verified'");
  const configuration=await readCatalogSettings(readonlyDb);
  const conflicts=await read("SELECT JSON_OBJECT('type',type,'subject_type',subject_type,'subject_id',subject_id,'status',status,'evidence',evidence) record FROM human_review_items WHERE type='same_audio_conflict'");
  const nowMs=Date.now();report.link_health_as_of_ms=nowMs;
  let changes=0;const decisions=[];const newlyPublishedIds=new Set<string>();for(const row of rows){const group=chapters.filter(c=>c.recitation_id===row.id);
    const facts=catalogPublicationFacts(row,group,conflicts,nowMs);
    const proofChapters:LicensedChapterProof[]=[];
    const candidates=licensedCandidates.filter(c=>c.recitation_id===row.id&&group.some(g=>g.surah===c.surah&&g.availability_state==='complete'&&Number(g.coverage_mismatch)===0));
    if(candidates.length){
      const needsR2=candidates.some(c=>!!c.storage_object_id),storage=needsR2&&configuration.storageAdapter==='r2'?catalogStorageFromEnvironment('r2','read_only',[]):null;
      try{const gate=new CatalogLicensedChapterReadiness(readonlyDb,new CatalogLicensedSourceResolver(readonlyDb,storage,source));for(const candidate of candidates){const proof=await gate.assess(String(row.id),Number(candidate.surah));if(proof)proofChapters.push(proof);}}
      finally{await (storage as (AudioObjectStorage&{close?:()=>void|Promise<void>})|null)?.close?.();}
    }
    const checkedAt=Date.now(),details=createLicensedPublicationDetails(String(row.id),proofChapters,checkedAt),scoped=planScopedTechnicalPublication(row,{...facts,licensedOffsetVerifiedCompleteChapters:proofChapters.length},details,checkedAt),{decision,patch}=scoped;
    decisions.push({id:row.id,slug:row.slug,reciter_id:row.reciter_id,reader:row.reader,riwayah:row.riwayah_code,provider:row.provider,channel:row.channel,...facts,licensedOffsetVerifiedCompleteChapters:proofChapters.length,...decision,publication_change_planned:patch.status==='published',metadata_change_planned:Object.keys(patch).length>0});
    if(!Object.keys(patch).length)continue;
    const protectedColumns=['status','published_by','published_at','is_public','voice_identity_status','offset_verified','offset_check_score','verification_status','verification_method','canonical_text_available','riwayah_code','timing_level'];
    const unchanged=protectedColumns.map(k=>`r.${k}<=>${d4Literal(row[k]??null)}`).join(' AND ');
    const globalEvidence=row.verification_details===null?'NULL':`CAST(${d4Literal(JSON.stringify(row.verification_details))} AS JSON)`;
    plan.statements.push(`INSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=1,1,0) FROM recitations r WHERE r.id=${d4Literal(row.id)} AND ${unchanged} AND r.verification_details<=>${globalEvidence};`);
    if(details&&patch.licensed_publication_details){
      const anchor=details.chapters[0];
      const sourceDigestSql=`SELECT ${LICENSED_SOURCE_BINDING_EXPRESSION} source_sha256 FROM recitation_source_urls u LEFT JOIN storage_objects o ON o.id=u.storage_object_id JOIN human_review_items h ON h.id=u.rights_ref WHERE u.id=${d4Literal(anchor.source_id)} AND u.recitation_id=${d4Literal(row.id)}`;
      const [sourceDigest]=await read(`SELECT JSON_OBJECT('source_sha256',b.source_sha256) record FROM (${sourceDigestSql}) b`);assert.ok(anchor.source_binding_sha256);assert.equal(sourceDigest?.source_sha256,anchor.source_binding_sha256,'LICENSED_SOURCE_CHANGED_DURING_VERIFICATION');
      plan.statements.push(`INSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=1 AND MAX(source_sha256)=${d4Literal(anchor.source_binding_sha256)},1,0) FROM (${sourceDigestSql}) source_bound;`);
      if(anchor.method==='v2')plan.statements.push(`INSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=1,1,0) FROM human_review_items WHERE id=${d4Literal(anchor.v2_human_review_id)} AND type='offset_exception' AND status='approved' AND decided_by IS NOT NULL AND subject_type='recitation' AND subject_id=${d4Literal(row.id)};`);
      plan.statements.push(`INSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=1,1,0) FROM recitation_source_urls u LEFT JOIN storage_objects o ON o.id=u.storage_object_id JOIN human_review_items h ON h.id=u.rights_ref AND h.status='approved' AND h.decided_by IS NOT NULL AND h.subject_type='recitation' AND h.subject_id=u.recitation_id AND h.type IN ('storage_rights','youtube_rights') JOIN recitation_chapters c ON c.recitation_id=u.recitation_id AND c.surah=u.surah JOIN quran_surahs s ON s.number=c.surah WHERE u.id=${d4Literal(anchor.source_id)} AND u.recitation_id=${d4Literal(row.id)} AND u.surah=${anchor.surah} AND u.kind='licensed_file' AND u.is_active=1 AND u.verification_status='verified' AND u.sha256=${d4Literal(anchor.source_sha256)} AND u.rights_ref=${d4Literal(anchor.rights_ref)} AND c.availability_state='complete' AND c.coverage_mismatch=0 AND s.ayah_count=${anchor.expected_ayahs} AND (u.storage_object_id IS NULL OR (o.upload_status='verified' AND o.sha256=u.sha256 AND o.recitation_id=u.recitation_id AND o.surah=u.surah AND o.rights_ref=u.rights_ref)) AND UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000<${details.expires_at_epoch_ms};`);
      const timingDigestSql=`SELECT ${LICENSED_TIMING_BINDING_EXPRESSION} timing_sha256 FROM ayah_timings WHERE recitation_id=${d4Literal(row.id)} AND surah=${anchor.surah} LIMIT 1`;
      const [digest]=await read(`SELECT JSON_OBJECT('timing_sha256',t.timing_sha256) record FROM (${timingDigestSql}) t`);assert.ok(anchor.timing_binding_sha256);assert.equal(digest?.timing_sha256,anchor.timing_binding_sha256,'LICENSED_TIMINGS_CHANGED_DURING_VERIFICATION');
      plan.statements.push(`INSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=1 AND MAX(timing_sha256)=${d4Literal(anchor.timing_binding_sha256)},1,0) FROM (${timingDigestSql}) timing_bound;`);
    }
    const oldValues=Object.fromEntries(Object.keys(patch).map(k=>[k,row[k]??null]));
    const set=Object.entries(patch).map(([k,v])=>k+'='+(k==='published_at'?'UTC_TIMESTAMP(3)':d4Literal(v&&typeof v==='object'?JSON.stringify(v):v as string|number|boolean|null))).join(',');
    plan.statements.push(`UPDATE recitations SET ${set} WHERE id=${d4Literal(row.id)};`);
    plan.append('recitation.technical_publication','recitation',row.id,oldValues,{...patch,facts:scoped.facts,rule:'rule-v1',public_visibility_unchanged:true,global_catalog_offset_unchanged:true});changes++;if(patch.status==='published')newlyPublishedIds.add(String(row.id));
  }
  const finished=plan.finish(),path=resolve(option('--sql-output'));const outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside));writeFileSync(path,finished.sql);if(apply)await local!.query(finished.sql);
  if(apply){const after=await read(rowsSql);assert.equal(after.length,rows.length);for(const old of rows){const row=after.find(r=>r.id===old.id);assert.ok(row);for(const key of ['is_public','voice_identity_status','license_status','offset_verified','offset_check_score','verification_status','verification_method'])assert.equal(row[key],old[key],'PUBLIC_OR_GLOBAL_OFFSET_FIELDS_CHANGED');assert.deepEqual(row.verification_details,old.verification_details);if(newlyPublishedIds.has(String(old.id))){assert.equal(row.status,'published');assert.equal(row.published_by,'rule-v1');assert.ok(row.published_at);}else for(const key of ['status','published_by','published_at'])assert.equal(row[key],old[key],'EXISTING_PUBLICATION_CHANGED');}}
  const {sql:_privateSql,...evidence}=finished;void _privateSql;Object.assign(report,evidence,{changes,decisions,eligible:decisions.filter(d=>d.eligible).length,eligible_readers:new Set(decisions.filter(d=>d.eligible).map(d=>d.reciter_id)).size,passed:true});
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN';throw new Error('D4_PUBLICATION_PLAN_FAILED');}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,eligible:report.eligible}));

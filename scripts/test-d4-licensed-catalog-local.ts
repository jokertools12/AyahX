/** Root-run MySQL integration. SQL is real; audio transports are explicitly offline test doubles. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import mysql,{type Pool,type RowDataPacket} from 'mysql2/promise';
import {identifier} from './lib/railwayQuranOps';
import {acceptedLicensedClauses,digest,assertExpectedCheckClauses,licensedPublicationConstraintSql,type LicensedRehearsal} from './lib/d4PublicationAcceptance';
import {assertLicensedAcceptanceDatabases,assertLocalCloneDdl} from './lib/d4LicensedAcceptanceGuard';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {CatalogAudioSource,type AudioLinkCheck} from '../server/services/catalogAudioSource';
import {CatalogLicensedSourceResolver} from '../server/services/licensedSourceResolver';
import {CatalogLicensedChapterReadiness,createLicensedPublicationDetails,type LicensedChapterGate} from '../server/services/catalogLicensedReadiness';
import {RecitationAudioResolver} from '../server/services/recitationAudioResolver';
import {RecitationCatalogService,readCatalogSettings} from '../server/services/recitationCatalogService';
import {LaunchReadinessService} from '../server/services/launchReadinessService';
import {CatalogError,type CatalogDatabase,type CatalogRow} from '../server/services/catalogContracts';
import type {AudioObjectStorage} from '../server/services/catalogStorageContracts';
import type {LicensedOffsetEvidence} from '../server/services/licensedAudioVerification';
import {toRenderTimeline,type SourceAyahTiming} from '../shared/timing/toRenderTimeline';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1],'REQUIRED_OPTION:'+key);return process.argv[i+1];};
const database=option('--database'),template=option('--template');assertLicensedAcceptanceDatabases(database,template);
const expectedClauses=acceptedLicensedClauses(JSON.parse(readFileSync(option('--licensed-rehearsal'),'utf8')) as LicensedRehearsal);
const report:Record<string,unknown>={scope:'local_mysql_real_sql_offline_audio_transports',database,template,production_written:false,cloud_access:false,network_audio_requests:0,actual_r2_acceptance:false,synthetic_human_approvals:true,started_at:new Date().toISOString(),checks:[]};
const connection=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:template,charset:'utf8mb4'});
let pool:Pool|undefined,locked=false;
const checks=report.checks as string[];
const transport={hostedChecks:0,hostedHashes:0,objectHeads:0,presigns:0,providerAttempts:0};
const fixtureBytes=Buffer.from('OFFLINE_SYNTHETIC_AUDIO_TRANSPORT_FIXTURE_NOT_AN_AUDIO_FILE'),blobSha=digest(fixtureBytes);
const hostedUrl='https://licensed-fixture.example/chapter.mp3',bucket='local-offline-fixture';
class OfflineAudioSource extends CatalogAudioSource{
  constructor(){super(async()=>{transport.providerAttempts++;throw new Error('LIVE_DNS_PROHIBITED');});}
  override async checkLink(url:string,hosts:string[]):Promise<AudioLinkCheck>{
    if(url!==hostedUrl||!hosts.includes('licensed-fixture.example')){transport.providerAttempts++;throw new Error('PROVIDER_OR_NETWORK_AUDIO_PROHIBITED');}
    transport.hostedChecks++;return {status:'available',httpStatus:200,checkedAt:new Date().toISOString()};
  }
  override async verifyLicensedBlob(url:string,hosts:string[],sha:string):Promise<void>{assert.equal(url,hostedUrl);assert.ok(hosts.includes('licensed-fixture.example'));assert.equal(sha,digest(fixtureBytes));transport.hostedHashes++;}
}
const offlineStorage:AudioObjectStorage={adapter:'r2',bucket,
  async head(key){assert.ok(key.endsWith('/'+blobSha+'.mp3'));transport.objectHeads++;return {sizeBytes:fixtureBytes.length,contentType:'audio/mpeg',etag:null};},
  async presignGet(key,seconds){assert.equal(seconds,900);transport.presigns++;return {url:'https://capability-fixture.example/'+encodeURIComponent(key)+'?offline=1',expiresAt:new Date(Date.now()+900000).toISOString(),requiredHeaders:{}};},
  async read(){throw new Error('AUDIO_READ_PROHIBITED');},async presignPut(){throw new Error('UPLOAD_PROHIBITED');},async beginMultipart(){throw new Error('UPLOAD_PROHIBITED');},async presignPart(){throw new Error('UPLOAD_PROHIBITED');},async listParts(){throw new Error('UPLOAD_PROHIBITED');},async completeMultipart(){throw new Error('UPLOAD_PROHIBITED');},async abortMultipart(){throw new Error('UPLOAD_PROHIBITED');},async listObjects(){throw new Error('CLOUD_LIST_PROHIBITED');},async deleteObject(){throw new Error('CLOUD_DELETE_PROHIBITED');}};
const protectedTables=['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','recitations','recitation_chapters','human_review_items','storage_objects','recitation_source_urls'];
const templateFingerprint=async()=>{
  const results:Record<string,unknown>={};for(const table of protectedTables){const [count]=await connection.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${identifier(table)}`);const [checksum]=await connection.query<RowDataPacket[]>(`CHECKSUM TABLE ${identifier(table)}`);results[table]={count:Number(count[0].n),checksum:checksum[0].Checksum};}return results;
};
const errorCode=async(work:()=>Promise<unknown>,expected:string)=>{await assert.rejects(work,error=>error instanceof CatalogError&&error.code===expected,expected);checks.push(expected);};
try{
  const [version]=await connection.query<RowDataPacket[]>('SELECT VERSION() version,@@hostname hostname');assert.equal(version[0].version,'9.7.2');report.mysql_version=version[0].version;
  const [lock]=await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',['ayahx_d4_licensed_acceptance']);assert.equal(Number(lock[0].acquired),1,'LOCAL_REHEARSAL_ALREADY_RUNNING');locked=true;
  const [existing]=await connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);assert.equal(existing.length,0,'SCRATCH_ALREADY_EXISTS_REFUSE_OVERWRITE');
  const before=await templateFingerprint();report.template_before=before;
  const [tables]=await connection.query<RowDataPacket[]>("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",[template]);
  await connection.query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);report.scratch_created=true;
  pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',connectionLimit:1});
  await pool.query('SET FOREIGN_KEY_CHECKS=0');const ddlHashes:Record<string,string>={};
  try{for(const table of tables){const [ddl]=await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE ${identifier(String(table.name))}`);const text=String(ddl[0]['Create Table']);assertLocalCloneDdl(text,template);ddlHashes[String(table.name)]=digest(text);await pool.query(text);}}
  finally{await pool.query('SET FOREIGN_KEY_CHECKS=1');}
  report.template_ddl_sha256=ddlHashes;
  for(const table of ['riwayat','quran_text_versions','quran_surahs','quran_ayahs','quran_words'])await pool.query(`INSERT INTO ${identifier(table)} SELECT * FROM ${identifier(template)}.${identifier(table)}`);
  for(const table of ['quran_surahs','quran_ayahs','quran_words']){const sums:RowDataPacket[]=(await pool.query<RowDataPacket[]>(`CHECKSUM TABLE ${identifier(table)}`))[0];assert.equal(sums[0].Checksum,(before[table] as {checksum:unknown}).checksum,'CANONICAL_COPY_CHANGED');}
  const [columns]=await pool.query<RowDataPacket[]>("SELECT TABLE_NAME t,COLUMN_NAME c,EXTRA extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?",[database]);
  assert.ok(columns.some(c=>c.t==='recitations'&&c.c==='licensed_publication_details'),'CURRENT_MIGRATION005_REQUIRED');
  const insert=async(table:string,row:CatalogRow)=>{
    const writable=new Set(columns.filter(c=>c.t===table&&!String(c.extra).includes('GENERATED')).map(c=>String(c.c)));
    assert.ok(Object.keys(row).every(k=>columns.some(c=>c.t===table&&c.c===k)),'UNKNOWN_FIXTURE_COLUMN');const keys=Object.keys(row).filter(k=>writable.has(k));
    await pool!.query(`INSERT INTO ${identifier(table)}(${keys.map(identifier).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,keys.map(k=>{const v=row[k];return v&&typeof v==='object'&&!(v instanceof Date)&&!Buffer.isBuffer(v)?JSON.stringify(v):v;}));
  };
  const [baseRows]=await connection.query<RowDataPacket[]>('SELECT * FROM recitations ORDER BY slug LIMIT 1');const base=baseRows[0];assert.ok(base);
  const [readerRows]=await connection.query<RowDataPacket[]>('SELECT * FROM reciters WHERE id=?',[base.reciter_id]);await insert('reciters',readerRows[0]);
  const [providerRows]=await connection.query<RowDataPacket[]>('SELECT * FROM audio_providers WHERE code=\'youtube\' LIMIT 1');assert.ok(providerRows[0]);const provider:CatalogRow={...providerRows[0],license_status:'permitted',license_text:'SYNTHETIC LOCAL ACCEPTANCE RIGHTS ONLY'};await insert('audio_providers',provider);
  const [timingSource]=await connection.query<RowDataPacket[]>("SELECT a.recitation_id FROM ayah_timings a JOIN quran_surahs s ON s.number=a.surah WHERE a.surah=1 GROUP BY a.recitation_id HAVING COUNT(*)=MAX(s.ayah_count) AND SUM(a.review_status='ready' AND a.coverage_words=a.expected_words AND JSON_LENGTH(a.review_reasons)=0 AND JSON_LENGTH(a.missing_words)=0)=COUNT(*) ORDER BY a.recitation_id LIMIT 1");assert.ok(timingSource[0],'COMPLETE_REAL_RELEASE_CHAPTER_REQUIRED');
  const [timingRows]=await connection.query<RowDataPacket[]>('SELECT * FROM ayah_timings WHERE recitation_id=? AND surah=1 ORDER BY ayah',[timingSource[0].recitation_id]);
  const [chapterRows]=await connection.query<RowDataPacket[]>('SELECT * FROM recitation_chapters WHERE recitation_id=? AND surah=1',[timingSource[0].recitation_id]);assert.ok(chapterRows[0]);
  const timings=timingRows.map(a=>({ayah:Number(a.ayah),coordinate:a.coordinate,source:a.source,source_offset_ms:a.source_offset_ms,words:typeof a.words==='string'?JSON.parse(a.words):a.words})) as SourceAyahTiming[];
  const measuredOffset=1000,duration=Math.ceil(toRenderTimeline(timings,{chapterOffsetMs:measuredOffset,sourceFormat:'qud_release',padMs:0}).sourceWindow.toMs)+1000;
  const [surahs]=await pool.query<RowDataPacket[]>('SELECT number,ayah_count FROM quran_surahs ORDER BY number');
  const db=catalogDatabaseFromPool(pool),source=new OfflineAudioSource(),licensed=new CatalogLicensedSourceResolver(db,offlineStorage,source),gate=new CatalogLicensedChapterReadiness(db,licensed);
  const resolver=new RecitationAudioResolver(db,source,()=>readCatalogSettings(db),{resolver:licensed,storage:offlineStorage});
  const service=new RecitationCatalogService(db,()=>readCatalogSettings(db),resolver,gate);
  // Root's current LaunchReadiness accepts the gate; an older implementation fails the live-rights tests below.
  const Readiness=LaunchReadinessService as new(db:CatalogDatabase,gate:LicensedChapterGate)=>LaunchReadinessService;
  const readiness=new Readiness(db,gate),actor={id:'synthetic-local-human',kind:'human' as const,permissions:new Set(['reviews.read'])};
  const fixtures:Array<{id:string;slug:string;rights:string;sourceId:string;objectId:string;adapter:string}>=[];
  for(const adapter of ['url_reference','r2']){
    const id=randomUUID(),slug='local_licensed_'+adapter,rights=randomUUID(),sourceId=randomUUID(),objectId=randomUUID();fixtures.push({id,slug,rights,sourceId,objectId,adapter});
    await insert('recitations',{...base,id,slug,provider_id:provider.id,channel:'youtube',status:'needs_review',is_public:1,voice_identity_status:'confirmed',offset_verified:0,offset_check_score:.4,verification_status:'failed',verification_method:'v1',verification_details:{synthetic_local_only:true},licensed_publication_details:null,audio_mode:'surah_slice',timing_level:'word',timing_quality:'verified',canonical_text_available:1,published_by:null,published_at:null});
    for(const s of surahs)await insert('recitation_chapters',{...chapterRows[0],id:randomUUID(),recitation_id:id,surah:s.number,expected_ayahs:s.ayah_count,available_ayahs:s.ayah_count,ready_ayahs:s.ayah_count,available_runs:[[1,Number(s.ayah_count)]],run_count:1,max_run_ayahs:s.ayah_count,missing_verses:[],coverage_mismatch:0,ayahs_complete:1,timing_complete:1,availability_state:'complete',audio_status:'available',last_verified_at:new Date(),chapter_offset_ms:987654321});
    for(const a of timingRows)await insert('ayah_timings',{...a,id:randomUUID(),recitation_id:id});
    await insert('human_review_items',{id:rights,type:'youtube_rights',subject_type:'recitation',subject_id:id,status:'approved',decided_by:actor.id,decided_at:new Date(),decision:{synthetic_local_only:true,rights:'admin_owned'},evidence:{synthetic_local_only:true}});
    const evidence:LicensedOffsetEvidence={method:'v1',sourceSha256:blobSha,recitationId:id,qudVersion:String(base.qud_version),sourceSurah:1,sourceChapterOffsetMs:measuredOffset,protocol:'distributed_3_surahs_interior_300ms',samples:[{surah:1,ayah:1,chapterAyahCount:7,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:1,ayah:4,chapterAyahCount:7,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:2,ayah:2,chapterAyahCount:286,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:2,ayah:100,chapterAyahCount:286,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:3,ayah:199,chapterAyahCount:200,ncc:.98,durationDifferenceMs:0,lagMs:0}]};
    if(adapter==='r2')await insert('storage_objects',{id:objectId,adapter,bucket,object_key:`licensed/${slug}/001/${blobSha}.mp3`,size_bytes:fixtureBytes.length,sha256:blobSha,duration_ms:duration,upload_status:'verified',verified_at:new Date(),recitation_id:id,surah:1,rights_ref:rights});
    await insert('recitation_source_urls',{id:sourceId,recitation_id:id,surah:1,kind:'licensed_file',url:adapter==='url_reference'?hostedUrl:null,storage_object_id:adapter==='r2'?objectId:null,sha256:blobSha,duration_ms:duration,rights_ref:rights,verification_status:'verified',verification_details:{...evidence,...(adapter==='url_reference'?{hosted_source:{allowed_hosts:['licensed-fixture.example'],url_sha256:digest(hostedUrl)}}:{})},is_active:1,approved_by:actor.id});
  }
  const [checkRows]=await pool.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME name,CHECK_CLAUSE clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN ('chk_recitations_offset_gate_v1','chk_recitations_publish_gate_v1','chk_catalog_offset','chk_catalog_publish')",[database]);
  const actual=Object.fromEntries(checkRows.map(r=>[String(r.name),String(r.clause)]));for(const sql of licensedPublicationConstraintSql(actual,expectedClauses))await pool.query(sql);
  const [canonicalChecks]=await pool.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME name,CHECK_CLAUSE clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN ('chk_recitations_offset_gate_v1','chk_recitations_publish_gate_v1')",[database]);report.applied_checks=Object.fromEntries(canonicalChecks.map(r=>[String(r.name),String(r.clause)]));assertExpectedCheckClauses(report.applied_checks as Record<string,string>,expectedClauses);
  for(const f of fixtures){const proof=await gate.assess(f.id,1);assert.ok(proof&&proof.source_binding_sha256&&proof.timing_binding_sha256);const snapshot=createLicensedPublicationDetails(f.id,[proof],Date.now());await pool.query("UPDATE recitations SET status='published',published_by='rule-v1',published_at=UTC_TIMESTAMP(3),licensed_publication_details=? WHERE id=?",[JSON.stringify(snapshot),f.id]);await assert.rejects(pool.query('UPDATE recitations SET licensed_publication_details=NULL WHERE id=?',[f.id]),e=>String((e as {code?:unknown}).code)==='ER_CHECK_CONSTRAINT_VIOLATED');assert.equal(await gate.isChapterReady(f.id,2),false);}
  checks.push('SCOPED_CHECK_ACCEPTS_WITH_GLOBAL_OFFSET_FALSE','SCOPED_CHECK_REJECTS_NULL_PROOF','ONE_LICENSED_CHAPTER_DOES_NOT_GRANT_OTHER_CHAPTERS');
  for(const [key,value] of Object.entries({quran_catalog_v2:'false',availability_mode:'complete_only',voice_gate_policy:'require_confirmed',storage_adapter:'r2'}))await pool.query('INSERT INTO system_settings(key_name,value_text,is_secret) VALUES(?,?,0)',[key,value]);
  const transportBefore={...transport};await errorCode(()=>service.listReciters(),'QURAN_CATALOG_DISABLED');await errorCode(()=>service.resolveAudioPlan({recitationId:fixtures[0].id,surah:1,from:2,to:2}),'QURAN_CATALOG_DISABLED');assert.deepEqual(transport,transportBefore);const closed=await readiness.get(actor);assert.equal(closed.public_potential_recitations,2);assert.equal(closed.flag_enabled,false);assert.ok((closed.recitations as CatalogRow[]).every(r=>r.currently_visible===false));
  await pool.query("UPDATE system_settings SET value_text='true' WHERE key_name='quran_catalog_v2'");
  for(const f of fixtures){const selected=await service.listSurahsForRecitation(f.slug);assert.deepEqual(selected.map(s=>Number(s.surah)),[1]);await errorCode(()=>service.getAvailability(f.slug,2),'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE');await errorCode(()=>resolver.resolveAudioPlan({recitationId:f.id,surah:2,from:1,to:1}),'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE');const plan=await service.resolveAudioPlan({recitationId:f.id,surah:1,from:2,to:2,padMs:0});const expected=toRenderTimeline(timings.filter(t=>t.ayah===2),{chapterOffsetMs:measuredOffset,sourceFormat:'qud_release',padMs:0});assert.deepEqual({fromMs:plan.parts[0].sliceFromMs,toMs:plan.parts[0].sliceToMs},expected.sourceWindow);assert.equal(plan.provider,'licensed_file');}
  checks.push('SOLE_TIMELINE_USES_MEASURED_LICENSED_OFFSET_NOT_CATALOG_OFFSET','PUBLIC_CHAPTER_SELECTION_ONLY_VERIFIED_CHAPTER','SHORT_PRESIGNED_GET_900_SECONDS');
  const healthy=await readiness.get(actor);assert.equal(healthy.public_potential_recitations,2);
  const hosted=fixtures[0],r2=fixtures[1];await pool.query("UPDATE human_review_items SET status='pending' WHERE id=?",[hosted.rights]);assert.equal(await gate.isChapterReady(hosted.id,1),false);assert.equal((await readiness.get(actor)).public_potential_recitations,1);assert.deepEqual(await service.listSurahsForRecitation(hosted.slug),[]);await pool.query("UPDATE human_review_items SET status='approved' WHERE id=?",[hosted.rights]);
  await pool.query('UPDATE storage_objects SET recitation_id=? WHERE id=?',[hosted.id,r2.objectId]);assert.equal(await gate.isChapterReady(r2.id,1),false);assert.equal((await readiness.get(actor)).public_potential_recitations,1);await pool.query('UPDATE storage_objects SET recitation_id=? WHERE id=?',[r2.id,r2.objectId]);
  await pool.query('UPDATE recitation_source_urls SET sha256=? WHERE id=?',['b'.repeat(64),hosted.sourceId]);assert.equal(await gate.isChapterReady(hosted.id,1),false);await pool.query('UPDATE recitation_source_urls SET sha256=? WHERE id=?',[blobSha,hosted.sourceId]);
  await pool.query('UPDATE recitation_source_urls SET duration_ms=1 WHERE id=?',[hosted.sourceId]);assert.equal(await gate.isChapterReady(hosted.id,1),false);await errorCode(()=>resolver.resolveAudioPlan({recitationId:hosted.id,surah:1,from:2,to:2}),'LICENSED_TIMING_COORDINATES_INVALID');await pool.query('UPDATE recitation_source_urls SET duration_ms=? WHERE id=?',[duration,hosted.sourceId]);
  checks.push('LIVE_HUMAN_RIGHTS_RECHECK_IN_LAUNCH_READINESS','R2_RECITATION_BINDING_FAIL_CLOSED','SOURCE_SHA_MISMATCH_FAIL_CLOSED','TOO_SHORT_LICENSED_FILE_FAIL_CLOSED');
  const [finalRows]=await pool.query<RowDataPacket[]>('SELECT id,offset_verified,verification_status,verification_method,voice_identity_status,is_public,status FROM recitations ORDER BY slug');assert.ok(finalRows.every(r=>Number(r.offset_verified)===0&&r.verification_status==='failed'&&r.verification_method==='v1'&&r.voice_identity_status==='confirmed'&&Number(r.is_public)===1&&r.status==='published'));
  const [audit]=await pool.query<RowDataPacket[]>("SELECT action,old_values,new_values FROM audit_logs WHERE action='recitation.licensed_source_used'");assert.equal(audit.length,2);assert.ok(audit.every(a=>!JSON.stringify(a).includes('https://')&&!JSON.stringify(a).includes('capability-fixture')));assert.equal(transport.providerAttempts,0);
  assert.deepEqual(await templateFingerprint(),before,'READ_ONLY_TEMPLATE_CHANGED');checks.push('GLOBAL_OFFSET_AND_HUMAN_STATE_UNCHANGED','AUDIT_HAS_NO_AUDIO_CAPABILITIES','TEMPLATE_PROTECTED_DATA_UNCHANGED');
  report.source_sha256=Object.fromEntries(['catalogRuntime','launchReadinessService','recitationCatalogService','recitationAudioResolver','catalogLicensedReadiness','licensedSourceResolver'].map(name=>[name,digest(readFileSync(`server/services/${name}.ts`))]));report.fixture_rows=finalRows;report.complete_chapters_adversarial_cache=surahs.length;report.licensed_chapters_per_recitation=1;report.transport_simulated_calls=transport;report.template_after=await templateFingerprint();report.launch_readiness=await readiness.get(actor);report.passed=true;
}catch(error){report.passed=false;report.failure=error instanceof CatalogError?error.code:error instanceof Error?error.message:'UNKNOWN_LOCAL_ACCEPTANCE_FAILURE';throw new Error('LOCAL_LICENSED_CATALOG_ACCEPTANCE_FAILED:'+String(report.failure));}
finally{await pool?.end();if(locked)await connection.query("SELECT RELEASE_LOCK('ayahx_d4_licensed_acceptance')");await connection.end();report.connections_closed=true;report.scratch_retained_for_evidence=true;report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,checks:checks.length,database,network_audio_requests:0,actual_r2_acceptance:false}));

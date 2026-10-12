/** ROOT RUNS ONLY. Real disposable MySQL 9.7.2 + Redis + HTTP; never Railway.
 * Does not print credentials or original rows. Audit history remains immutable.
 * Imported catalog/reviews/users are snapshotted and must remain identical.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,unlink,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Server} from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import mysql,{type Pool,type RowDataPacket} from 'mysql2/promise';
import Redis from 'ioredis';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import type {CatalogRow} from '../server/services/catalogContracts';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import {createAdminRuntime} from '../server/admin/adminRuntime';
import {AdminOwnerWorkspace} from '../server/admin/adminOwnerWorkspace';
import {CatalogAudioSource} from '../server/services/catalogAudioSource';
import {RecitationCatalogService,readCatalogSettings} from '../server/services/recitationCatalogService';
import {RecitationAudioResolver} from '../server/services/recitationAudioResolver';
import {getFfmpegBinary} from '../server/services/ffmpegBinary';
import {upAdminReviewWorkspace,downAdminReviewWorkspace,adminReviewWorkspaceMigrationSql} from '../server/db/migrations/008_addAdminReviewWorkspace';

type Result={name:string;passed:true;detail?:CatalogRow};
const local=(host:string)=>['127.0.0.1','localhost','[::1]'].includes(host);
const digest=(rows:unknown)=>createHash('sha256').update(canonicalAuditJson(rows)).digest('hex');
/** Environment is checked even when imported by the CI harness. */
export async function runAdminOwnerLocalAcceptance(pool:Pool,redis:Redis,env:NodeJS.ProcessEnv):Promise<Result[]>{
  const db=catalogDatabaseFromPool(pool),results:Result[]=[];
  const [version]=await db.read('SELECT VERSION() version,DATABASE() db');
  assert.match(String(version.version),/^9\.7\.2/u,'REAL_MYSQL_9_7_2_REQUIRED');
  assert.match(String(version.db),/^ayahx_.*(?:verified|rehearsal|restored|local|test|migration_final)/iu,'DISPOSABLE_LOCAL_SCHEMA_REQUIRED');
  assert.ok(local(new URL(env.REDIS_URL??'').hostname),'LOCAL_REDIS_REQUIRED');
  assert.equal(await redis.ping(),'PONG');
  const pass=(name:string,detail?:CatalogRow)=>results.push({name,passed:true,detail});
  // CHECKSUM TABLE is computed by MySQL, including the full 422k-row timing table.
  const protectedTables=['users','profiles','user_roles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','notifications','plans','videos','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
  async function snapshot(){const values:CatalogRow={};for(const table of protectedTables){
    if(['plans','videos'].includes(table)){const[present]=await db.read('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);if(Number(present.n)===0){values[table]={available:false,reason:'TABLE_NOT_PRESENT'};continue;}}
    const[count]=await db.read('SELECT COUNT(*) n FROM '+table),[checksum]=await db.read('CHECKSUM TABLE '+table);assert.notEqual(checksum.Checksum,null,'MYSQL_CHECKSUM_UNAVAILABLE:'+table);values[table]={available:true,count:Number(count.n),checksum:String(checksum.Checksum)};
  }return values;}
  const reviewsBefore=await db.read('SELECT id,type,subject_type,subject_id,evidence,priority,status,decided_by,decided_at,notes,decision,created_at,updated_at FROM human_review_items ORDER BY id');
  const originalReviewIds=reviewsBefore.map(row=>row.id),before=await snapshot();
  const ddl=await pool.getConnection();
  try{
    await upAdminReviewWorkspace(ddl);const first=await snapshot();assert.deepEqual(first,before);
    await upAdminReviewWorkspace(ddl);assert.deepEqual(await snapshot(),before);
    await downAdminReviewWorkspace(ddl,'local-rehearsal');assert.deepEqual(await snapshot(),before);
    await downAdminReviewWorkspace(ddl,'local-rehearsal');assert.deepEqual(await snapshot(),before);
    await upAdminReviewWorkspace(ddl);assert.deepEqual(await snapshot(),before);
  }finally{ddl.release();}
  assert.equal(digest(await db.read('SELECT id,type,subject_type,subject_id,evidence,priority,status,decided_by,decided_at,notes,decision,created_at,updated_at FROM human_review_items ORDER BY id')),digest(reviewsBefore));
  pass('migration008_up_twice_down_twice_reapply_preserves_protected_rows',{original_reviews:reviewsBefore.length,unavailable_tables:protectedTables.filter(table=>(before[table] as CatalogRow).available===false),sql_sha256:createHash('sha256').update(adminReviewWorkspaceMigrationSql().join('\n')).digest('hex')});

  const prefix='a2b-local-'+randomUUID().slice(0,8),ids={user:randomUUID(),provider:randomUUID(),reader:randomUUID(),recitation:randomUUID(),voice:randomUUID(),license:randomUUID(),safe:randomUUID(),render:randomUUID(),draft:randomUUID(),linked:randomUUID()},password=randomBytes(24).toString('base64url');
  const created:Array<{table:string;id:string}>=[],fixtureReviewIds:string[]=[ids.voice,ids.license,ids.safe];
  const file=resolve(process.cwd(),'uploads',prefix+'.mp4');let server:Server|undefined;
  const sourceAudio=new CatalogAudioSource(),settings=()=>readCatalogSettings(db);
  const catalog=new RecitationCatalogService(db,settings,new RecitationAudioResolver(db,sourceAudio,settings));
  const runtime=createAdminRuntime({db,source:sourceAudio,catalog,env,origins:['http://localhost']});
  const owner=new AdminOwnerWorkspace(db);
  async function clone(table:string,source:string,id:string,overrides:CatalogRow){
    assert.ok(['audio_providers','reciters','recitations'].includes(table));
    const [columns]=await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM '+table),names=columns.filter(column=>!/GENERATED/iu.test(String(column.Extra))).map(column=>String(column.Field));
    for(const name of names)assert.match(name,/^[a-z_][a-z0-9_]*$/u);
    await db.execute('INSERT INTO '+table+'('+names.join(',')+') SELECT '+names.map(name=>name==='id'||Object.hasOwn(overrides,name)?'?':name).join(',')+' FROM '+table+' WHERE id=?',[...names.flatMap(name=>name==='id'?[id]:Object.hasOwn(overrides,name)?[overrides[name]]:[]),source]);created.push({table,id});
  }
  let cookie='',base='';
  async function request(path:string,method='GET',body?:unknown,authenticated=true,headers:Record<string,string>={}){
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json',origin:'http://localhost',...(authenticated?{cookie}:{}),...headers},body:method==='GET'?undefined:JSON.stringify(body??{})});
    const content=response.headers.get('content-type')??'',payload=content.includes('application/json')?await response.json() as CatalogRow:null;
    if(!payload)await response.arrayBuffer();return{status:response.status,body:payload,data:payload?.data as CatalogRow,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  async function clearRates(){let cursor='0';do{const[next,keys]=await redis.scan(cursor,'MATCH','ayahx:admin-rate:*','COUNT',100);cursor=next;if(keys.length)await redis.del(...keys);}while(cursor!=='0');}
  async function mutate(path:string,method:string,body:unknown){await clearRates();const response=await request(path,method,body);assert.equal(response.status,200,`${path}:${response.body?.code}`);const requestId=response.headers.get('x-request-id');assert.ok(requestId);const [audit]=await db.read('SELECT COUNT(*) n FROM audit_logs WHERE request_id=? AND user_id=?',[requestId,ids.user]);assert.ok(Number(audit.n)>=1,'MUTATION_MUST_BE_AUDITED');return response.data;}
  try{
    await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[ids.user,prefix+'@example.test',await bcrypt.hash(password,10)]);
    await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),ids.user,'LOCAL A2b acceptance only']);
    await db.execute("INSERT INTO user_roles(id,user_id,role) VALUES(?,?,'super_admin')",[randomUUID(),ids.user]);
    const [source]=await db.read('SELECT id,provider_id,reciter_id,riwayah_code FROM recitations WHERE qud_version IS NOT NULL ORDER BY slug LIMIT 1');assert.ok(source,'IMPORTED_CATALOG_REQUIRED');
    await clone('audio_providers',String(source.provider_id),ids.provider,{code:prefix,name:'LOCAL only provider',license_status:'unreviewed'});
    await clone('reciters',String(source.reciter_id),ids.reader,{slug:prefix,name_ar:'قارئ محلي للاختبار',source_reciter_id:null});
    await clone('recitations',String(source.id),ids.recitation,{slug:prefix,provider_id:ids.provider,reciter_id:ids.reader,voice_identity_status:'unverified',voice_confirmed_by:null,voice_confirmed_at:null,is_public:0});
    for(const [id,type,subjectType,subjectId]of [[ids.voice,'voice_confirmation','recitation',ids.recitation],[ids.license,'provider_license','audio_provider',ids.provider],[ids.safe,'data_conflict','recitation',ids.recitation]])await db.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status,notes) VALUES(?,?,?,?,?,100,'pending','')",[id,type,subjectType,subjectId,JSON.stringify({local_fixture_only:true,prefix})]);
    const app=express();app.use(express.json());app.use('/api/admin',runtime.router);
    server=await new Promise<Server>(accept=>{const listener=app.listen(0,'127.0.0.1',()=>accept(listener));});const address=server.address();assert.ok(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}/api/admin`;
    await clearRates();const login=await request('/auth/login','POST',{email:prefix+'@example.test',password},false);assert.equal(login.status,200,`LOGIN:${login.body?.code}`);assert.ok(login.cookie);cookie=login.cookie;
    assert.equal((await request('/workspace',undefined,undefined,false)).status,401);
    const reviewed=await mutate('/reviews/'+ids.voice+'/decision','POST',{status:'approved',notes:'LOCAL_FIXTURE_ONLY_NOT_HUMAN_APPROVAL'});assert.equal(reviewed.changed,true);
    const [approved]=await db.read('SELECT voice_identity_status FROM recitations WHERE id=?',[ids.recitation]);assert.equal(approved.voice_identity_status,'confirmed');
    const [originalDecision]=await db.read('SELECT * FROM human_review_items WHERE id=?',[ids.voice]);
    const reopened=await mutate('/reviews/'+ids.voice+'/undo','POST',{notes:'LOCAL_FIXTURE_ONLY review again'});fixtureReviewIds.push(String(reopened.id));
    assert.equal(digest((await db.read('SELECT * FROM human_review_items WHERE id=?',[ids.voice]))[0]),digest(originalDecision),'ORIGINAL_DECISION_IMMUTABLE');
    const [pending]=await db.read('SELECT voice_identity_status,is_public FROM recitations WHERE id=?',[ids.recitation]);assert.equal(pending.voice_identity_status,'unverified');assert.equal(Number(pending.is_public),0);
    await mutate('/reviews/'+reopened.id+'/decision','POST',{status:'rejected',notes:'LOCAL_FIXTURE_ONLY identity not accepted'});
    const [rejected]=await db.read('SELECT voice_identity_status FROM recitations WHERE id=?',[ids.recitation]);assert.equal(rejected.voice_identity_status,'mismatch');
    pass('review_decide_undo_redecide_targets_same_subject_and_keeps_history');
    const deniedBulk=await request('/reviews/bulk','POST',{ids:[ids.license],status:'approved',notes:'local',confirmation:'1'});assert.equal(deniedBulk.status,409);
    await mutate('/reviews/bulk-preview','POST',{ids:[ids.safe],status:'deferred'});
    await mutate('/reviews/bulk','POST',{ids:[ids.safe],status:'deferred',notes:'LOCAL_FIXTURE_ONLY data review',confirmation:'1'});
    const noConfirm=await request('/reviews/'+ids.license+'/decision','POST',{status:'approved',notes:'local',decision:{license_status:'permitted',rights_evidence_ref:'local-only'}});assert.equal(noConfirm.status,422);
    await mutate('/reviews/'+ids.license+'/decision','POST',{status:'approved',notes:'LOCAL_FIXTURE_ONLY_NOT_LEGAL_APPROVAL',confirmation:prefix,decision:{license_status:'permitted',rights_evidence_ref:'local-fixture-only'}});
    pass('safe_bulk_excludes_voice_license_and_typed_license_confirmation');
    for(const route of ['/flags/quran_catalog_v2','/settings/quran_catalog_v2']){
      const response=await request(route,'PATCH',{value:true,confirmation:'quran_catalog_v2'});assert.equal(response.status,409);assert.ok(['PUBLIC_FLOW_V2_NOT_READY','ADMIN_SETTING_READ_ONLY'].includes(String(response.body?.code)));
    }
    const launch=await request('/launch-readiness');assert.equal(launch.status,200);assert.equal(launch.data.public_flow_v2_ready,false);assert.equal(launch.data.can_open,false);pass('every_existing_settings_route_rejects_public_opening');
    await mutate('/preferences','PATCH',{density:'compact',font_scale:1.1});assert.deepEqual(await owner.preferences(ids.user),{density:'compact',font_scale:1.1});pass('preferences_real_per_user_persistence');
    const draft={intent_id:ids.draft,reciter:{id:ids.reader,name_ar:'قارئ',name_en:'Local'},recitation:{slug:prefix+'-draft',riwayah_code:String(source.riwayah_code),style:'murattal',display_label_ar:'مسودة محلية'},source:{kind:'licensed_file',provider_id:ids.provider}};
    const createdDraft=await mutate('/reciter-wizard','POST',draft);assert.equal(createdDraft.status,'draft');created.push({table:'recitations',id:ids.draft});fixtureReviewIds.push(...createdDraft.review_ids as string[]);
    const replay=await request('/reciter-wizard','POST',draft);assert.equal(replay.status,200);assert.equal(replay.data.replay,true);
    const [storedDraft]=await db.read('SELECT status,is_public,basmala_mode,basmala_reason,source_url,qud_version,catalog_sha256,offset_verified,timing_reference_recitation_id FROM recitations WHERE id=?',[ids.draft]);assert.equal(storedDraft.basmala_mode,null);assert.equal(storedDraft.qud_version,null);assert.equal(Number(storedDraft.offset_verified),0);
    const bad=await request('/reciter-wizard/validate','POST',{...draft,source:{kind:'url_pattern',provider_id:ids.provider,url_pattern:'https://127.0.0.1/{surah:03d}.mp3'}});assert.equal(bad.status,422);
    const wrongRef=await request('/reciter-wizard/validate','POST',{...draft,source:{kind:'qud',provider_id:ids.provider,qud_slug:(await db.read('SELECT slug FROM recitations WHERE id=?',[source.id]))[0].slug}});assert.equal(wrongRef.status,422);
    const linkedInput={...draft,intent_id:ids.linked,recitation:{...draft.recitation,slug:prefix+'-linked'},source:{kind:'qud',provider_id:source.provider_id,qud_slug:(await db.read('SELECT slug FROM recitations WHERE id=?',[source.id]))[0].slug}};
    const linked=await mutate('/reciter-wizard','POST',linkedInput);created.push({table:'recitations',id:ids.linked});fixtureReviewIds.push(...linked.review_ids as string[]);
    const [linkedRow]=await db.read('SELECT status,offset_verified,timing_reference_recitation_id FROM recitations WHERE id=?',[ids.linked]);assert.equal(linkedRow.timing_reference_recitation_id,source.id);assert.equal(linkedRow.status,'draft');assert.equal(Number(linkedRow.offset_verified),0);
    pass('draft_wizard_null_unknowns_replay_ssrf_and_scoped_reference_without_eligibility');
    // Owned fixture: one second generated test video, never Quran/source audio.
    await mkdir(resolve(process.cwd(),'uploads'),{recursive:true});
    await new Promise<void>((accept,reject)=>{const child=spawn(getFfmpegBinary(),['-nostdin','-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=10:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',file],{stdio:['ignore','ignore','pipe'],windowsHide:true});let errorBytes=0;child.stderr.on('data',(bytes:Buffer)=>{errorBytes+=bytes.length;});child.once('error',()=>reject(new Error('LOCAL_FFMPEG_UNAVAILABLE')));child.once('close',code=>code===0&&!errorBytes?accept():reject(new Error('LOCAL_MEDIA_FIXTURE_FAILED')));});
    await db.execute("INSERT INTO render_jobs(id,user_id,engine,status,progress,stage,manifest,max_retries,output_path,expires_at) VALUES(?,?,'skia_canvas','succeeded',100,'local owned fixture',?,0,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))",[ids.render,ids.user,JSON.stringify({schemaVersion:'2.0.0',local_fixture_only:true}),file]);
    const mediaPath='/render-lab/jobs/'+ids.render+'/media';assert.equal((await request(mediaPath,'GET',undefined,false)).status,401);assert.equal((await request(mediaPath)).status,200);
    const partial=await request(mediaPath,'GET',undefined,true,{range:'bytes=0-31'});assert.equal(partial.status,206);assert.match(partial.headers.get('content-range')??'',/^bytes 0-31\//u);
    await db.execute('UPDATE render_jobs SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?',[ids.render]);assert.equal((await request(mediaPath)).status,410);
    await mutate('/render-lab/jobs/'+ids.render,'DELETE',{});pass('owned_media_auth_range_expiry_and_delete_audited');
    const originals=await db.read(`SELECT id,type,subject_type,subject_id,evidence,priority,status,decided_by,decided_at,notes,decision,created_at,updated_at FROM human_review_items WHERE id IN (${originalReviewIds.map(()=>'?').join(',')}) ORDER BY id`,originalReviewIds);
    assert.equal(digest(originals),digest(reviewsBefore));pass('all_original_human_reviews_preserved',{count:originals.length});
  }finally{
    await runtime.close();if(server)await new Promise<void>((accept,reject)=>server!.close(error=>error?reject(error):accept()));
    // Delete only this invocation's local fixtures. Audits are intentionally retained.
    await db.execute('DELETE FROM render_jobs WHERE id=? AND user_id=?',[ids.render,ids.user]);
    await db.execute('DELETE FROM recitation_voice_reviews WHERE recitation_id=?',[ids.recitation]);
    if(fixtureReviewIds.length)await db.execute(`DELETE FROM human_review_items WHERE id IN (${fixtureReviewIds.map(()=>'?').join(',')})`,fixtureReviewIds);
    for(const item of [...created].reverse())await db.execute('DELETE FROM '+item.table+' WHERE id=?',[item.id]);
    await db.execute('DELETE FROM admin_preferences WHERE user_id=?',[ids.user]);await db.execute('DELETE FROM admin_sessions WHERE user_id=?',[ids.user]);await db.execute('DELETE FROM admin_user_extensions WHERE user_id=?',[ids.user]);await db.execute('DELETE FROM user_roles WHERE user_id=?',[ids.user]);await db.execute('DELETE FROM profiles WHERE user_id=?',[ids.user]);await db.execute('DELETE FROM users WHERE id=?',[ids.user]);
    await unlink(file).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
  }
  assert.deepEqual(await snapshot(),before);pass('protected_d1_d3_admin_rows_identical_after_fixture_cleanup');return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.ok(process.argv.includes('--allow-local-fixture-writes'),'LOCAL_FIXTURE_WRITE_ACK_REQUIRED');
  const mysqlUrl=process.env.A2B_MYSQL_URL;assert.ok(mysqlUrl,'A2B_MYSQL_URL_REQUIRED');assert.ok(local(new URL(mysqlUrl).hostname),'LOCAL_MYSQL_REQUIRED');
  const redisUrl=process.env.A2B_REDIS_URL??'redis://127.0.0.1:6380/14';assert.ok(local(new URL(redisUrl).hostname),'LOCAL_REDIS_REQUIRED');
  const pool=mysql.createPool({uri:mysqlUrl,connectionLimit:3,multipleStatements:true,timezone:'Z'}),redis=new Redis(redisUrl);
  try{
    const results=await runAdminOwnerLocalAcceptance(pool,redis,{...process.env,NODE_ENV:'test',REDIS_URL:redisUrl,JWT_SECRET:randomBytes(48).toString('hex')});
    const report=JSON.stringify({checked_at:new Date().toISOString(),local_only:true,production_writes:0,results},null,2)+'\n';
    const outputIndex=process.argv.indexOf('--out');
    if(outputIndex>=0){assert.ok(process.argv[outputIndex+1]&&!process.argv[outputIndex+1].startsWith('--'),'OUTPUT_PATH_REQUIRED');const output=resolve(process.argv[outputIndex+1]);await mkdir(dirname(output),{recursive:true});await writeFile(output,report,{encoding:'utf8',mode:0o600,flag:'wx'});}
    console.log(report);
  }finally{await redis.quit();await pool.end();}
}

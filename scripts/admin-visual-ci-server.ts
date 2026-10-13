/** Disposable CI only. Real MySQL/Redis and production routers; no dump or API mocks. */
import express from 'express';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {pinAdminVisualCiEnvironment} from '../tooling/e2e/helpers/adminVisualCiEnvironment.mjs';
import {CatalogAudioSource} from '../server/services/catalogAudioSource';
import {RecitationCatalogService,readCatalogSettings} from '../server/services/recitationCatalogService';
import {RecitationAudioResolver} from '../server/services/recitationAudioResolver';
import {youtubeReference} from '../server/services/catalogYoutubeMetadata';
import {buildQuranTextCorpus,checksumText,importQuranText,type ScriptWord,type SourceSurah} from '../server/services/quranTextImport';
import {QudReleaseAdapter,buildCatalogDataset} from '../server/services/qudCatalogImport';
import {generateCatalogSql} from '../server/services/qudCatalogSql';
import {upQuranTextTables} from '../server/db/migrations/001_addQuranTextTables';
import {upQuranCatalogTables} from '../server/db/migrations/002_addQuranCatalogTables';
import {upQuranTimingTables} from '../server/db/migrations/003_addQuranTimingTables';
import {upRecitationCatalogServices} from '../server/db/migrations/004_addRecitationCatalogServices';
import {upHumanReviewsAndLicensedSources} from '../server/db/migrations/005_addHumanReviewsAndLicensedSources';
import {upAdminFoundation} from '../server/db/migrations/006_addAdminFoundation';
import {upRenderV2,activateRenderV2Access} from '../server/db/migrations/007_addRenderManifestV2';
import {readTimingPackage,prepareTimingRows,timingHash} from '../server/services/qudTimingPackage';
import {importTimingRecitation} from '../server/services/qudTimingImport';
import {appendCatalogAudit} from '../server/services/catalogAudit';
import {getFfmpegBinary,getFfprobeBinary} from '../server/services/ffmpegBinary';
import {runRenderV2Process} from '../server/services/renderV2Process';

const env:NodeJS.ProcessEnv=pinAdminVisualCiEnvironment(process.env);
const directory=resolve(process.env.AYAHX_ADMIN_CI_PRIVATE_DIR??'');
const location=relative(process.cwd(),directory);
if(!process.env.AYAHX_ADMIN_CI_PRIVATE_DIR||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_DIRECTORY_OUTSIDE_GIT_REQUIRED');
await mkdir(directory,{recursive:true,mode:0o700});
const schema='ayahx_ci_admin_visual';
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',password:'',multipleStatements:true,charset:'utf8mb4',timezone:'Z'});
const redis=new Redis('redis://127.0.0.1:6380/15',{maxRetriesPerRequest:1,retryStrategy:null});
let redisFailed=false;redis.on('error',()=>{redisFailed=true;console.error('EPHEMERAL_REDIS_UNAVAILABLE');});
const [versions]=await db.query<RowDataPacket[]>('SELECT VERSION() version');
if(!/^9\.7\.2(?:$|-)/u.test(String(versions[0].version)))throw new Error('MYSQL_9_7_2_REQUIRED');
if(!/^redis_version:7\.2\./mu.test(await redis.info('server')))throw new Error('REDIS_7_2_REQUIRED');
await db.query(`CREATE DATABASE IF NOT EXISTS ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await db.changeUser({database:schema});
const [tables]=await db.query<RowDataPacket[]>('SHOW TABLES');
if(tables.length)throw new Error('EMPTY_EPHEMERAL_SCHEMA_REQUIRED');
await db.query(await readFile('database/schema.sql','utf8'));
// Retained schema is absent from schema.sql. Reconstruct ONLY its public schema
// metadata, never production rows. Exact metadata and primary keys are checked.
interface Column{table:string;column:string;type:string;nullable:string;default:string|null}
interface Index{table:string;index:string;column:string;non_unique:number}
const metadata=JSON.parse(await readFile('docs/data/a1-existing-schema-metadata.json','utf8')) as {schema:{columns:Column[];indexes:Index[]}};
const ident=(value:string)=>{if(!/^[a-zA-Z0-9_]+$/u.test(value))throw new Error('METADATA_IDENTIFIER_INVALID');return '`'+value+'`';};
for(const table of ['admin_roles','admin_permissions','admin_sessions','admin_user_extensions']){
 const columns=metadata.schema.columns.filter(c=>c.table===table);
 if(!columns.length)throw new Error('LEGACY_SCHEMA_METADATA_REQUIRED');
 const fields=columns.map(c=>{
  if(!/^(?:varchar\(\d+\)|text|timestamp|int|tinyint\(1\))$/u.test(c.type))throw new Error('METADATA_TYPE_UNSUPPORTED');
  const fallback=c.default===null?'':c.default==='CURRENT_TIMESTAMP'?' DEFAULT CURRENT_TIMESTAMP':" DEFAULT '"+c.default.replaceAll("'","''")+"'";
  return ident(c.column)+' '+c.type+(/varchar|text/u.test(c.type)?' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci':'')+(c.nullable==='YES'?' NULL':' NOT NULL')+fallback;
 });
 const indexes=new Map<string,Index[]>();for(const i of metadata.schema.indexes.filter(i=>i.table===table))indexes.set(i.index,[...(indexes.get(i.index)??[]),i]);
 for(const[name,parts]of indexes)fields.push((name==='PRIMARY'?'PRIMARY KEY':(parts[0].non_unique?'INDEX ':'UNIQUE KEY ')+ident(name))+'('+parts.map(p=>ident(p.column)).join(',')+')');
 await db.query('CREATE TABLE '+ident(table)+' ('+fields.join(',')+') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}
await db.query(`CREATE TABLE audit_logs (id VARCHAR(36) NOT NULL PRIMARY KEY,user_id VARCHAR(36) NULL,role_slug VARCHAR(50) NULL,action VARCHAR(191) NOT NULL,entity_type VARCHAR(64) NOT NULL,entity_id VARCHAR(128) NOT NULL,old_values JSON NULL,new_values JSON NULL,hash CHAR(64) NOT NULL,prev_hash CHAR(64) NOT NULL,ip_address VARCHAR(45) NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_ci_audit_hash(hash)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
await db.query(`CREATE TABLE render_engine_capacity (engine VARCHAR(32) NOT NULL PRIMARY KEY,replicas INT NOT NULL DEFAULT 0,slots_per_replica INT NOT NULL DEFAULT 0,waiting_jobs INT NOT NULL DEFAULT 0,active_jobs INT NOT NULL DEFAULT 0,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
for(const up of [upQuranTextTables,upQuranCatalogTables,upQuranTimingTables,upRecitationCatalogServices,upHumanReviewsAndLicensedSources,upAdminFoundation,upRenderV2])await up(db);
// Dynamic filename permits the independent backend slice to land first. Missing
// migration008 fails visibly; the visual job can never silently skip it.
const migration008='../server/db/migrations/008_addAdminReviewWorkspace.ts';
const {upAdminReviewWorkspace}=await import(migration008);await upAdminReviewWorkspace(db);await activateRenderV2Access(db);
const release='https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/v3.2.0/';
async function asset(name:string,sha:string){if(!/^[a-zA-Z0-9_.-]+$/u.test(name)||!/^[a-f0-9]{64}$/u.test(sha))throw new Error('PUBLIC_RELEASE_PIN_INVALID');const response=await fetch(release+name,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('PUBLIC_RELEASE_FETCH_FAILED_'+response.status);const raw=await response.text();if(checksumText(raw)!==sha)throw new Error('PUBLIC_RELEASE_PIN_MISMATCH');return raw;}
const script=await asset('digital_khatt_v2_script.json','19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86');
const surahs=await asset('surah_info.json','e8e1f39b9fe73a121b61f9b4ec8eee4880e0f4333acf9f34671ac15ff581e77b');
const corpus=buildQuranTextCorpus(JSON.parse(script) as Record<string,ScriptWord>,JSON.parse(surahs) as Record<string,SourceSurah>,'v3.2.0');
if(corpus.checksum!=='eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4')throw new Error('CANONICAL_PIN_MISMATCH');
await importQuranText(db,corpus,false);
const source=JSON.parse(await readFile('docs/data/d2-catalog-source.json','utf8'));
const catalog=await asset('catalog.json',source.sha256);
const annotation=JSON.parse(await readFile('docs/data/d1-config-audit.json','utf8'));
const followup=JSON.parse(await readFile('docs/data/d1-followup-audit.json','utf8'));
const adapter=new QudReleaseAdapter(catalog,source.sha256);
const dataset=await buildCatalogDataset(adapter,{version:'v3.2.0',catalogSha:source.sha256,sourceUrl:source.url,legalCounts:Object.fromEntries(Object.entries(corpus.surahs).map(([key,value])=>[key,value.num_verses])),annotations:annotation.configs,openings:followup.opening_audits,reviews:followup.reviews_by_config,offsets:{}});
// Seed actual pinned catalogue metadata, but no invented offset/audio approval.
for(const statement of generateCatalogSql(dataset).statements)await db.query(statement);
// A small real Release package makes canonical/timing inspection nonempty.
// Its publication/offset/human gates remain unchanged and all reviews pending.
const timingSlug='ahmed_saud_mp3quran';
const timingManifestSha='bde8378c423c5e6b30fbc73c42663cce299f2ca4e8bd9f2f4b258ed9467645cf';
const timingManifestText=await asset('manifest.json',timingManifestSha);
const timingManifest=JSON.parse(timingManifestText) as {release_version:string;recitations:Record<string,{sha256:string;zip_url:string;bytes:number;tiers:string[]}>};
const timingPin=timingManifest.recitations[timingSlug];
if(timingManifest.release_version!=='v3.2.0'||timingPin?.sha256!=='2cc895c18521ab21bd86605acb6da612487da10c405f1503fc92c6cb37b661ed'||timingPin.zip_url!==release+timingSlug+'.zip')throw new Error('CI_TIMING_RELEASE_IDENTITY_MISMATCH');
const packageResponse=await fetch(timingPin.zip_url,{signal:AbortSignal.timeout(120000)});
if(!packageResponse.ok)throw new Error('CI_TIMING_RELEASE_FETCH_FAILED_'+packageResponse.status);
const timingBytes=Buffer.from(await packageResponse.arrayBuffer());
if(timingBytes.length!==timingPin.bytes||timingHash(timingBytes)!==timingPin.sha256)throw new Error('CI_TIMING_RELEASE_PIN_MISMATCH');
const timingSource=adapter.recitations.find(row=>row.slug===timingSlug);
if(!timingSource)throw new Error('CI_TIMING_RELEASE_CATALOG_MISSING');
const timingPackage=readTimingPackage(timingBytes,timingPin.sha256,timingSlug,timingPin.tiers);
const preparedTimings=prepareTimingRows({rows:timingPackage.rows,slug:timingSlug,sourceSha:timingPin.sha256,version:timingManifest.release_version,corpus,canonicalAvailable:timingSource.riwayah==='hafs_an_asim',chapters:Object.keys(timingSource.audio.chapter_urls).map(Number)});
const timingLines=preparedTimings.map(row=>JSON.stringify(row)).join('\n')+'\n';
const [packet]=await db.query<RowDataPacket[]>('SELECT @@max_allowed_packet max_packet');
const timingResult=await importTimingRecitation({
 read:async sql=>{const[rows]=await db.query<RowDataPacket[]>(sql);return rows.map(row=>typeof row.record==='string'?JSON.parse(row.record):row.record);},
 execute:async sql=>{await db.query(sql);},
},{rows:preparedTimings,slug:timingSlug,manifest:{manifest_sha256:timingManifestSha,canonical_checksum:corpus.checksum,results:[{slug:timingSlug,rows:preparedTimings.length,prepared_sha256:timingHash(timingLines)}]},corpus,maxPacket:Number(packet[0].max_packet)});
const firstReadyTiming=preparedTimings.find(row=>row.review_status==='ready'&&row.words.length>0);
if(!firstReadyTiming)throw new Error('CI_REAL_CANONICAL_TIMING_ROW_REQUIRED');
const selectedRecording=dataset.recitations.find(row=>row.id===firstReadyTiming.recitation_id);
if(!selectedRecording)throw new Error('CI_TIMING_CATALOG_IDENTITY_MISMATCH');
const [timingGates]=await db.execute<RowDataPacket[]>('SELECT status,offset_verified,voice_identity_status FROM recitations WHERE id=?',[selectedRecording.id]);
if(timingGates.length!==1||timingGates[0].status==='published'||Number(timingGates[0].offset_verified)!==0||timingGates[0].voice_identity_status==='confirmed')throw new Error('CI_TIMING_APPROVAL_MUST_NOT_BE_INVENTED');
const userId=randomUUID(),password=randomBytes(32).toString('base64url'),email='ci-admin-visual@example.test';
await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[userId,email,await bcrypt.hash(password,10)]);
await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),userId,'CI visual fixture']);
await db.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)',[randomUUID(),userId,'super_admin']);
// Each browser shard authenticates independently: no shared sessions, profiles
// or Redis actor read buckets. Both accounts exist only in this disposable DB.
const secondShardId=randomUUID(),secondShardPassword=randomBytes(32).toString('base64url'),secondShardEmail='ci-admin-visual-shard-2@example.test';
await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[secondShardId,secondShardEmail,await bcrypt.hash(secondShardPassword,10)]);
await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),secondShardId,'CI_VISUAL_ONLY second browser shard']);
await db.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)',[randomUUID(),secondShardId,'super_admin']);
const secondaryUserId=randomUUID();
await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[secondaryUserId,'ci-admin-visual-target@example.test',await bcrypt.hash(randomBytes(32).toString('base64url'),10)]);
await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),secondaryUserId,'CI_VISUAL_ONLY secondary role target']);
await db.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)',[randomUUID(),secondaryUserId,'user']);
const reviewId=randomUUID(),storageId=randomUUID(),recitationId=String(selectedRecording.id),reciterId=String(selectedRecording.reciter_id);
const youtubeRecitation=dataset.recitations.find(row=>row.channel==='youtube');
if(!youtubeRecitation)throw new Error('PINNED_YOUTUBE_METADATA_REQUIRED');
const youtubeRecitationId=String(youtubeRecitation.id);
await db.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,'voice_confirmation','recitation',?,?,10,'pending')",[reviewId,recitationId,JSON.stringify({fixture:'CI_VISUAL_ONLY',source:source.url,source_sha256:source.sha256,approved:false})]);
for(const provider of dataset.providers)await db.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,'provider_license','audio_provider',?,?,20,'pending')",[randomUUID(),provider.id,JSON.stringify({fixture:'CI_VISUAL_ONLY',source:source.url,approved:false})]);
await db.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,'label_review','recitation',?,?,30,'pending')",[randomUUID(),recitationId,JSON.stringify({fixture:'CI_VISUAL_ONLY',approved:false})]);
await db.execute('UPDATE recitations SET needs_label_review=1 WHERE id=?',[recitationId]);
const safeReviewId=randomUUID();
await db.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,'data_conflict','recitation',?,?,10000,'pending')",[safeReviewId,recitationId,JSON.stringify({fixture:'CI_VISUAL_ONLY',informational:true,approved:false,source:source.url})]);
await db.execute("INSERT INTO storage_objects(id,adapter,upload_status,recitation_id,surah,notes) VALUES(?,'url_reference','pending',?,103,'CI_VISUAL_ONLY: no audio uploaded or approved')",[storageId,youtubeRecitationId]);
// Real public Release video IDs only; no YouTube download, extraction or API.
for(const row of dataset.recitations.filter(item=>item.channel==='youtube')){
 const releaseRow=adapter.recitations.find(item=>item.slug===row.slug);
 if(!releaseRow)throw new Error('PINNED_RECITATION_MAPPING_MISSING');
 for(const[surah,raw]of Object.entries(releaseRow.audio.chapter_urls)){
  const reference=youtubeReference(raw);if(!reference)throw new Error('PINNED_YOUTUBE_ID_UNSUPPORTED');
  await db.execute("INSERT INTO recitation_youtube_sources(id,recitation_id,surah,video_id,playlist_id,rights_status) VALUES(?,?,?,?,?,'unknown')",[randomUUID(),row.id,Number(surah),reference.videoId,reference.playlistId]);
 }
}
const [reviewStates]=await db.query<RowDataPacket[]>("SELECT COUNT(*) decided FROM human_review_items WHERE status<>'pending'");
if(Number(reviewStates[0].decided)!==0)throw new Error('CI_HUMAN_REVIEWS_MUST_STAY_PENDING');
await db.end();
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',password:'',database:schema,connectionLimit:4,timezone:'Z'});
const applicationDb=catalogDatabaseFromPool(pool);
// Generated black/silent media is ONLY a marked visual fixture, never D7/M8
// quality evidence. Keep it in ignored local uploads, under the real media
// router's path boundary, with real ffprobe duration/size and authenticated GET.
const renderJobId=randomUUID(),secondRenderJobId=randomUUID();
type CiVisualMedia={fixtureTag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK';jobId:string;localPath:string;sha256:string;actual_quran_render:false;human_acceptance:false};
const shardActors:Array<{id:string;email:string;password:string;renderJobId:string;visualMedia?:CiVisualMedia}>=[{id:userId,email,password,renderJobId},{id:secondShardId,email:secondShardEmail,password:secondShardPassword,renderJobId:secondRenderJobId}];
const syntheticManifest={schemaVersion:'2.0.0',fixture:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',actual_quran_render:false,acceptance_evidence:false};
const visualMediaEvidence:Array<{synthetic_black:true;no_audio:true;duration_seconds:number;bytes:number;sha256:string;probe_source:'REAL_FFPROBE_LOCAL_ENCODED_ARTIFACT';fixture_tag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK';actual_quran_render:false;human_acceptance:false}>=[];
for(const actor of shardActors){
 const clipDirectory=join(process.cwd(),'uploads',actor.id,'admin-visual-ci');await mkdir(clipDirectory,{recursive:true,mode:0o700});
 const clipPath=join(clipDirectory,actor.renderJobId+'.mp4');
 await runRenderV2Process(getFfmpegBinary(),['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=24:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',clipPath]);
 const mediaProbe=await runRenderV2Process(getFfprobeBinary(),['-v','error','-show_format','-show_streams','-of','json',clipPath]);
 const media=JSON.parse(mediaProbe.stdout.toString('utf8')) as {format:{duration:string;size:string};streams:Array<{codec_type:string}>};
 if(!media.streams.some(stream=>stream.codec_type==='video')||media.streams.some(stream=>stream.codec_type==='audio')||!Number.isFinite(Number(media.format.duration))||Number(media.format.duration)<=0)throw new Error('CI_SYNTHETIC_BLACK_MEDIA_PROBE_INVALID');
 const mediaSha256=createHash('sha256').update(await readFile(clipPath)).digest('hex');
 actor.visualMedia={fixtureTag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',jobId:actor.renderJobId,localPath:resolve(clipPath),sha256:mediaSha256,actual_quran_render:false,human_acceptance:false};
 visualMediaEvidence.push({synthetic_black:true,no_audio:true,duration_seconds:Number(media.format.duration),bytes:Number(media.format.size),sha256:mediaSha256,probe_source:'REAL_FFPROBE_LOCAL_ENCODED_ARTIFACT',fixture_tag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',actual_quran_render:false,human_acceptance:false});
 await applicationDb.transaction(async tx=>{
  await tx.execute("INSERT INTO render_jobs(id,user_id,engine,enqueue_state,status,progress,stage,manifest,max_retries,output_path,output_filename,output_size_bytes,duration_seconds,audio_bytes_fetched,qa_report_json,completed_at,expires_at) VALUES(?,?,'skia_canvas','enqueued','succeeded',100,?,?,0,?,'ci-synthetic-black.mp4',?,?,0,?,CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 24 HOUR))",[actor.renderJobId,actor.id,'CI: فيديو أسود مصنوع للاختبار البصري فقط؛ ليس تلاوة أو قبول ريندر',JSON.stringify(syntheticManifest),clipPath,Number(media.format.size),Number(media.format.duration),JSON.stringify(syntheticManifest)]);
  await appendCatalogAudit(tx,{id:'ci_visual_fixture_preparer',kind:'system',permissions:new Set(),requestId:'ci-visual-seed'},'admin.ci_visual_fixture.prepared','render_job',actor.renderJobId,null,{fixture_tag:'CI_VISUAL_ONLY',synthetic_black_video:true,actual_quran_render:false,human_acceptance:false,timing_source:timingPin.zip_url,timing_source_sha256:timingPin.sha256,timing_rows:timingResult.rows,canonical_checksum:corpus.checksum,all_human_reviews:'pending'});
 });
}
await applicationDb.transaction(async tx=>{
 await appendCatalogAudit(tx,{id:'ci_visual_fixture_preparer',kind:'system',permissions:new Set(),requestId:'ci-visual-seed-reciter'},'admin.ci_visual_fixture.prepared','reciter',reciterId,null,{fixture_tag:'CI_VISUAL_ONLY',source_recording:timingSlug,all_human_reviews:'pending',approval_invented:false});
});
await writeFile(join(directory,'fixture.json'),JSON.stringify({id:userId,email,password,shardActors,secondaryUserId,fixtureRoleSlug:'analyst',safeReviewId,reciterId,recitationId,reviewId,storageId,youtubeRecitationId,renderJobId,timingsRecitationId:recitationId,timingsSurah:firstReadyTiming.surah,timingsAyah:firstReadyTiming.ayah}),{mode:0o600,flag:'wx'});
await writeFile(join(directory,'seed-evidence.json'),JSON.stringify({mysql:String(versions[0].version),redis:'7.2',canonical_checksum:corpus.checksum,surahs:Object.keys(corpus.surahs).length,ayahs:corpus.ayahs.length,words:corpus.wordCount,recitations:dataset.recitations.length,reciters:dataset.reciters.length,fixture_tag:'CI_VISUAL_ONLY',browser_shards:shardActors.length,independent_actor_sessions:true,timings:{slug:timingSlug,source_sha256:timingPin.sha256,manifest_sha256:timingManifestSha,script_sha256:timingPackage.scriptSha,rows:timingResult.rows,stored_fingerprint:timingResult.sha256,ready:preparedTimings.filter(row=>row.review_status==='ready').length,needs_review:preparedTimings.filter(row=>row.review_status==='needs_review').length,covered_words:preparedTimings.reduce((n,row)=>n+row.coverage_words,0),published:false,offset_approval_invented:false},visual_media:visualMediaEvidence,all_review_fixtures:'pending',migration008:true}),{mode:0o600});
if(process.argv.includes('--seed-only')){if(redisFailed)throw new Error('EPHEMERAL_REDIS_UNAVAILABLE');await pool.end();await redis.quit();console.log('EPHEMERAL_ADMIN_CI_SEED_VERIFIED');process.exit(0);}
// adminRuntime -> renderQueueBroker -> server/config reads process.env at import
// time. Static import would load the checkout .env before our loopback pins.
const {createAdminRuntime}=await import('../server/admin/adminRuntime');
const sourceAudio=new CatalogAudioSource(),settings=()=>readCatalogSettings(applicationDb);
const catalogService=new RecitationCatalogService(applicationDb,settings,new RecitationAudioResolver(applicationDb,sourceAudio,settings));
const runtime=createAdminRuntime({db:applicationDb,source:sourceAudio,env,origins:['http://127.0.0.1:3005'],catalog:catalogService});
const app=express();app.disable('x-powered-by');app.use('/api/admin',runtime.router);
app.get('/api/health/ready',async(_req,res)=>{await pool.query('SELECT 1');if(redisFailed||await redis.ping()!=='PONG')throw new Error('REDIS_UNAVAILABLE');res.json({status:'ready',ci:true,mysql:String(versions[0].version),redis:'7.2'});});
app.use(express.static('dist'));app.get('/{*path}',(_req,res)=>res.sendFile(join(process.cwd(),'dist','index.html')));
const server=app.listen(3005,'127.0.0.1',()=>console.log('EPHEMERAL_ADMIN_CI_READY'));
const close=()=>{server.close(()=>{void runtime.close().then(()=>pool.end()).then(()=>redis.quit()).then(()=>process.exit(0));});};process.on('SIGINT',close);process.on('SIGTERM',close);

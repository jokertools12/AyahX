/** Root runs this CLI. Production only reads and prepares a separately approved SQL file. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {canonicalAuditJson} from '../server/services/catalogAudit';
import type {CatalogRow} from '../server/services/catalogContracts';
import {checkYoutubeOembed} from '../server/services/catalogYoutubeMetadata';
import {openYoutubeCheckpoint,prepareYoutubeMetadataSql,recordYoutubeAttempt,recordYoutubeMetadata,sanitizeYoutubeMetadata,youtubeChapters} from './lib/d4YoutubeMetadataPlan';
import {sha256} from './lib/d4AuditSqlPlan';
import {openRailwayMysqlSession,type RailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string,required=true)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1]){if(required)throw new Error('REQUIRED_OPTION:'+key);return null;}return process.argv[i+1];};
const target=option('--target'),apply=process.argv.includes('--apply'),network=process.argv.includes('--check-network');assert.ok(['local','production'].includes(target!));assert.ok(!(target==='production'&&apply),'PRODUCTION_PREPARATION_READ_ONLY');
const database=target==='local'?option('--local-db'):null;if(database)assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const privatePath=(key:string)=>{const path=resolve(option(key)!),outside=relative(process.cwd(),path);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_ARTIFACT_REQUIRED');return path;};
const checkpointPath=privatePath('--checkpoint'),sqlPath=privatePath('--sql-output');
assert.notEqual(checkpointPath,sqlPath,'CHECKPOINT_SQL_PATH_COLLISION');
const limit=Number(option('--limit',false)??Number.MAX_SAFE_INTEGER);assert.ok(Number.isSafeInteger(limit)&&limit>=1,'INVALID_METADATA_LIMIT');
let local:mysql.Connection|null=null,remote:RailwayMysqlSession|null=null;
const report:CatalogRow={started_at:new Date().toISOString(),target,applied:apply,network_enabled:network,minimum_request_interval_ms:1000,retry_policy:'one attempt per unique video, no retries; honor global Retry-After',serial:[]};
async function open(){assert.ok(!local&&!remote);if(database)local=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true});else remote=await openRailwayMysqlSession(ENVIRONMENTS.production);}
async function close(){if(local){await local.end();local=null;}if(remote){(report.serial as unknown[]).push(await remote.close());remote=null;}}
const read=async(sql:string):Promise<CatalogRow[]>=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const chapterSql="SELECT JSON_OBJECT('recitation_id',r.id,'slug',r.slug,'surah',c.surah,'url',c.audio_url) record FROM recitations r JOIN recitation_chapters c ON c.recitation_id=r.id WHERE r.channel='youtube' ORDER BY r.slug,c.surah";
const pause=async(ms:number)=>{if(ms>0)await new Promise(resolve=>setTimeout(resolve,ms));};
try{
  await open();const chapters=youtubeChapters(await read(chapterSql));await close();assert.ok(chapters.length>0,'YOUTUBE_CATALOG_EMPTY');
  const inputSha=sha256(canonicalAuditJson(chapters)),checkpoint=openYoutubeCheckpoint(checkpointPath,inputSha),videos=[...new Set(chapters.map(r=>r.video_id))].sort();
  Object.assign(report,{input_sha256:inputSha,recitations:new Set(chapters.map(r=>r.recitation_id)).size,chapter_links:chapters.length,unique_videos:videos.length,checkpoint_reused_results:checkpoint.results.size});
  let requests=0,lastRequest=0;
  for(const video of videos){if(checkpoint.results.has(video))continue;
    if(checkpoint.attempted.has(video)){recordYoutubeMetadata(checkpointPath,checkpoint,video,sanitizeYoutubeMetadata({status:'YOUTUBE_OEMBED_INTERRUPTED',checked_at:new Date().toISOString()}),Date.now());continue;}
    if(!network||requests>=limit)continue;
    // No database connection is held while waiting for an external service.
    while(Date.now()<Math.max(lastRequest+1000,checkpoint.blocked_until_ms)){const wait=Math.min(10000,Math.max(lastRequest+1000,checkpoint.blocked_until_ms)-Date.now());if(wait>1000)console.log(JSON.stringify({status:'YOUTUBE_RATE_WAIT',remaining_ms:Math.max(0,checkpoint.blocked_until_ms-Date.now())}));await pause(wait);}
    recordYoutubeAttempt(checkpointPath,checkpoint,video);lastRequest=Date.now();requests++;
    // The service's header deadline ends before reading the body. This outer deadline covers both.
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);let result:CatalogRow;
    try{result=await checkYoutubeOembed({videoId:video,playlistId:null},(input,init)=>fetch(input,{...init,signal:controller.signal}));}
    catch(error){if(error instanceof TypeError||error instanceof DOMException)result={status:'YOUTUBE_OEMBED_BODY_UNAVAILABLE',checked_at:new Date().toISOString()};else throw error;}
    finally{clearTimeout(timeout);}
    const metadata=sanitizeYoutubeMetadata(result);recordYoutubeMetadata(checkpointPath,checkpoint,video,metadata,Date.now());
    if(requests%25===0||metadata.http_status===429)console.log(JSON.stringify({status:'YOUTUBE_METADATA_PROGRESS',requests,completed:checkpoint.results.size,total:videos.length,http_status:metadata.http_status}));
  }
  const complete=videos.every(v=>checkpoint.results.has(v));Object.assign(report,{checkpoint_sha256:sha256(readFileSync(checkpointPath)),requests_this_run:requests,completed_videos:checkpoint.results.size,complete,status_counts:[...checkpoint.results.values()].reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{} as Record<string,number>),recitation_results:[...new Set(chapters.map(c=>c.slug))].map(slug=>{const set=new Set(chapters.filter(c=>c.slug===slug).map(c=>c.video_id));return {slug,chapter_links:chapters.filter(c=>c.slug===slug).length,unique_videos:set.size,statuses:[...set].reduce((a,v)=>{const status=checkpoint.results.get(v)?.status??'NOT_CHECKED';a[status]=(a[status]??0)+1;return a;},{} as Record<string,number>)};})});
  if(!complete){assert.ok(!apply,'INCOMPLETE_METADATA_APPLY_REFUSED');report.passed=true;report.plan_prepared=false;}
  else{
    await open();assert.equal(sha256(canonicalAuditJson(youtubeChapters(await read(chapterSql)))),inputSha,'YOUTUBE_CATALOG_CHANGED_DURING_SCAN');
    const ytSql="SELECT JSON_OBJECT('id',s.id,'recitation_id',s.recitation_id,'surah',s.surah,'video_id',s.video_id,'playlist_id',s.playlist_id,'channel_id',s.channel_id,'channel_title',s.channel_title,'oembed_status',s.oembed_status,'rights_status',s.rights_status,'rights_evidence_url',s.rights_evidence_url,'rights_evidence_note',s.rights_evidence_note) record FROM recitation_youtube_sources s JOIN recitations r ON r.id=s.recitation_id WHERE r.channel='youtube'";
    const sourcesSql="SELECT JSON_OBJECT('id',s.id,'recitation_id',s.recitation_id,'surah',s.surah,'url',s.url,'kind',s.kind,'channel_title',s.channel_title,'last_status',s.last_status) record FROM recitation_source_urls s JOIN recitations r ON r.id=s.recitation_id WHERE r.channel='youtube' AND s.kind='provider_original'";
    const youtubeRows=await read(ytSql),sourceRows=await read(sourcesSql),tails=await read("SELECT JSON_OBJECT('hash',a.hash) record FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL");assert.ok(tails.length<=1,'AUDIT_CHAIN_CORRUPT');
    const prepared=prepareYoutubeMetadataSql(chapters,checkpoint.results,youtubeRows,sourceRows,String(tails[0]?.hash??'0'.repeat(64))),finished=prepared.plan.finish();writeFileSync(sqlPath,finished.sql);
    if(apply){await local!.query(finished.sql);const after=await read(ytSql),sources=await read(sourcesSql),replay=prepareYoutubeMetadataSql(chapters,checkpoint.results,after,sources,finished.audit_tail);assert.equal(replay.plan.mutations.length,0,'YOUTUBE_METADATA_REPLAY_NOT_IDEMPOTENT');
      for(const old of youtubeRows){const row=after.find(r=>r.id===old.id);assert.ok(row);for(const key of ['rights_status','rights_evidence_url','rights_evidence_note'])assert.equal(row[key],old[key],'HUMAN_RIGHTS_CHANGED');}}
    const {sql:_private,...proof}=finished;void _private;Object.assign(report,proof,{youtube_changed:prepared.youtube_changed,source_changed:prepared.source_changed,human_rights_preserved:prepared.human_rights_preserved,plan_prepared:true,passed:true});
  }
}catch(error){if(local)await local.rollback();report.passed=false;report.failure=error instanceof Error&&/^YOUTUBE_[A-Z_]+$/u.test(error.message)?error.message:'YOUTUBE_METADATA_PREPARATION_FAILED';throw new Error(String(report.failure));}
finally{await close();report.finished_at=new Date().toISOString();writeFileSync(option('--report')!,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,complete:report.complete,recitations:report.recitations,chapter_links:report.chapter_links,unique_videos:report.unique_videos,completed:report.completed_videos,requests:report.requests_this_run,youtube_changed:report.youtube_changed,source_changed:report.source_changed}));

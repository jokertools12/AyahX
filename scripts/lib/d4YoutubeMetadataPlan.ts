import {createHash} from 'node:crypto';
import {appendFileSync,closeSync,existsSync,fsyncSync,openSync,readFileSync} from 'node:fs';
import {canonicalAuditJson} from '../../server/services/catalogAudit';
import type {CatalogRow} from '../../server/services/catalogContracts';
import {youtubeReference} from '../../server/services/catalogYoutubeMetadata';
import {validateReviewEvidence} from '../../server/services/humanReviewService';
import {D4AuditSqlPlan,d4Literal,sha256} from './d4AuditSqlPlan';

export interface YoutubeChapter {recitation_id:string;slug:string;surah:number;url:string;video_id:string;playlist_id:string|null}
export interface YoutubeMetadata {status:string;checked_at:string;http_status:number|null;title:string|null;channel_title:string|null;channel_id:string|null;channel_url:string|null;retry_after:string|null}
export interface YoutubeCheckpoint {input_sha256:string;previous:string;results:Map<string,YoutubeMetadata>;attempted:Set<string>;blocked_until_ms:number}
export function youtubeChapters(rows:CatalogRow[]):YoutubeChapter[]{
  return rows.map(row=>{const ref=youtubeReference(String(row.url));if(!ref)throw new Error('YOUTUBE_CATALOG_REFERENCE_INVALID');validateReviewEvidence({url:row.url});
    const surah=Number(row.surah);if(!Number.isSafeInteger(surah)||surah<1||surah>114)throw new Error('YOUTUBE_CHAPTER_INVALID');
    return {recitation_id:String(row.recitation_id),slug:String(row.slug),surah,url:String(row.url),video_id:ref.videoId,playlist_id:ref.playlistId};
  }).sort((a,b)=>a.slug.localeCompare(b.slug)||a.surah-b.surah);
}
export function sanitizeYoutubeMetadata(row:CatalogRow):YoutubeMetadata{
  if(typeof row.status!=='string'||row.status.length>64||typeof row.checked_at!=='string'||!Number.isFinite(Date.parse(row.checked_at)))throw new Error('YOUTUBE_METADATA_INVALID');
  let channel_url:string|null=null,channel_id:string|null=null;
  if(typeof row.channel_url==='string'){let url:URL;try{url=new URL(row.channel_url);}catch{throw new Error('YOUTUBE_CHANNEL_URL_INVALID');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['youtube.com','www.youtube.com'].includes(url.hostname)||url.port)throw new Error('YOUTUBE_CHANNEL_URL_INVALID');
    if(!/^\/(?:channel\/[A-Za-z0-9_-]+|user\/[A-Za-z0-9_-]+|@[A-Za-z0-9_.%-]+)\/?$/u.test(url.pathname))throw new Error('YOUTUBE_CHANNEL_URL_INVALID');
    channel_url=url.href;channel_id=url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]+)\/?$/u)?.[1]??null;
  }
  const result:YoutubeMetadata={status:row.status,checked_at:new Date(row.checked_at).toISOString(),http_status:typeof row.http_status==='number'?row.http_status:null,title:typeof row.title==='string'?row.title.slice(0,1000):null,channel_title:typeof row.channel_title==='string'?row.channel_title.slice(0,255):null,channel_url,channel_id,retry_after:typeof row.retry_after==='string'?row.retry_after.slice(0,128):null};
  validateReviewEvidence({...result});return result;
}
export function retryAfterDeadline(metadata:YoutubeMetadata,nowMs:number):number{
  if(metadata.http_status!==429)return 0;
  if(metadata.retry_after===null)return nowMs+60_000;
  if(/^\d+$/u.test(metadata.retry_after))return nowMs+Number(metadata.retry_after)*1000;
  const parsed=Date.parse(metadata.retry_after);return Number.isFinite(parsed)?Math.max(nowMs,parsed):nowMs+60_000;
}
function appendCheckpoint(path:string,state:YoutubeCheckpoint,payload:CatalogRow):void{
  const body={...payload,previous:state.previous},hash=sha256(canonicalAuditJson(body));
  const fd=openSync(path,'a');try{appendFileSync(fd,JSON.stringify({...body,hash})+'\n','utf8');fsyncSync(fd);}finally{closeSync(fd);}state.previous=hash;
}
/** Append-only, hash-bound metadata evidence. A damaged tail stops rather than being repaired. */
export function openYoutubeCheckpoint(path:string,inputSha:string):YoutubeCheckpoint{
  const state:YoutubeCheckpoint={input_sha256:inputSha,previous:'0'.repeat(64),results:new Map(),attempted:new Set(),blocked_until_ms:0};
  if(!existsSync(path)){appendCheckpoint(path,state,{type:'manifest',schema_version:1,input_sha256:inputSha});return state;}
  const content=readFileSync(path,'utf8');if(!content.endsWith('\n'))throw new Error('YOUTUBE_CHECKPOINT_TRUNCATED');
  const lines=content.trimEnd().split('\n');for(let i=0;i<lines.length;i++){const parsed=JSON.parse(lines[i]) as CatalogRow,{hash,...body}=parsed;
    if(parsed.previous!==state.previous||hash!==sha256(canonicalAuditJson(body)))throw new Error('YOUTUBE_CHECKPOINT_HASH_INVALID');state.previous=String(hash);
    if(i===0){if(parsed.type!=='manifest'||parsed.schema_version!==1||parsed.input_sha256!==inputSha)throw new Error('YOUTUBE_CHECKPOINT_INPUT_CHANGED');}
    else{if(typeof parsed.video_id!=='string'||!/^[-_A-Za-z0-9]{11}$/u.test(parsed.video_id)||state.results.has(parsed.video_id))throw new Error('YOUTUBE_CHECKPOINT_RESULT_INVALID');
      if(parsed.type==='attempt'){if(state.attempted.has(parsed.video_id))throw new Error('YOUTUBE_CHECKPOINT_DUPLICATE_VIDEO');state.attempted.add(parsed.video_id);continue;}
      if(parsed.type!=='result'||!state.attempted.has(parsed.video_id))throw new Error('YOUTUBE_CHECKPOINT_RESULT_INVALID');
      const metadata=sanitizeYoutubeMetadata(parsed.metadata as CatalogRow);state.results.set(parsed.video_id,metadata);const blocked=Number(parsed.blocked_until_ms);if(!Number.isFinite(blocked)||blocked<0)throw new Error('YOUTUBE_CHECKPOINT_RETRY_INVALID');state.blocked_until_ms=Math.max(state.blocked_until_ms,blocked);}
  }return state;
}
export function recordYoutubeAttempt(path:string,state:YoutubeCheckpoint,video:string):void{
  if(!/^[-_A-Za-z0-9]{11}$/u.test(video)||state.attempted.has(video))throw new Error('YOUTUBE_CHECKPOINT_DUPLICATE_VIDEO');appendCheckpoint(path,state,{type:'attempt',video_id:video,attempted_at:new Date().toISOString()});state.attempted.add(video);
}
export function recordYoutubeMetadata(path:string,state:YoutubeCheckpoint,video:string,metadata:YoutubeMetadata,nowMs:number):void{
  if(!/^[-_A-Za-z0-9]{11}$/u.test(video)||state.results.has(video)||!state.attempted.has(video))throw new Error('YOUTUBE_CHECKPOINT_DUPLICATE_VIDEO');
  const blocked=retryAfterDeadline(metadata,nowMs);appendCheckpoint(path,state,{type:'result',video_id:video,metadata:{...metadata},blocked_until_ms:blocked});state.results.set(video,metadata);state.blocked_until_ms=Math.max(state.blocked_until_ms,blocked);
}
function deterministicId(namespace:string,value:string):string{const raw=createHash('sha256').update(namespace+':'+value).digest('hex').slice(0,32);return [raw.slice(0,8),raw.slice(8,12),raw.slice(12,16),raw.slice(16,20),raw.slice(20)].join('-');}
const matches=(old:CatalogRow,desired:CatalogRow)=>Object.entries(desired).every(([key,value])=>key==='last_checked_at'||(old[key]??null)===value);
export function prepareYoutubeMetadataSql(chapters:YoutubeChapter[],results:ReadonlyMap<string,YoutubeMetadata>,youtubeRows:CatalogRow[],sourceRows:CatalogRow[],auditSeed:string):{plan:D4AuditSqlPlan;human_rights_preserved:number;youtube_changed:number;source_changed:number}{
  const plan=new D4AuditSqlPlan(auditSeed);let preserved=0,youtubeChanged=0,sourceChanged=0;
  for(const chapter of chapters){const metadata=results.get(chapter.video_id);if(!metadata)throw new Error('YOUTUBE_METADATA_INCOMPLETE');
    const tuple=`${chapter.recitation_id}:${chapter.surah}:${chapter.video_id}`,checked=metadata.checked_at.replace('T',' ').replace('Z','');
    const old=youtubeRows.find(r=>r.recitation_id===chapter.recitation_id&&Number(r.surah)===chapter.surah&&r.video_id===chapter.video_id);
    const desired:CatalogRow={recitation_id:chapter.recitation_id,surah:chapter.surah,video_id:chapter.video_id,playlist_id:chapter.playlist_id,channel_id:metadata.channel_id,channel_title:metadata.channel_title,oembed_status:metadata.status,last_checked_at:checked};
    if(old?.rights_status&&old.rights_status!=='unknown')preserved++;
    if(!old||!matches(old,desired)){const id=String(old?.id??deterministicId('youtube',tuple));if(old)plan.statements.push(`UPDATE recitation_youtube_sources SET ${Object.entries(desired).map(([k,v])=>k+'='+d4Literal(v as string|number|null)).join(',')} WHERE id=${d4Literal(id)};`);
      else plan.statements.push(`INSERT INTO recitation_youtube_sources(id,${Object.keys(desired).join(',')},rights_status) VALUES(${[id,...Object.values(desired),'unknown'].map(v=>d4Literal(v as string|number|null)).join(',')});`);
      plan.append('recitation.youtube_metadata','recitation_youtube_source',id,old?Object.fromEntries(Object.keys(desired).map(k=>[k,old[k]??null])):null,{...desired,metadata_only:true,audio_status:'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE'});youtubeChanged++;}
    const original=sourceRows.find(r=>r.recitation_id===chapter.recitation_id&&Number(r.surah)===chapter.surah&&r.kind==='provider_original'&&r.url===chapter.url);
    const source:CatalogRow={channel_title:metadata.channel_title,last_status:metadata.status==='available'?'youtube_metadata_ok':'youtube_metadata_unavailable',last_checked_at:checked.slice(0,19)};
    if(!original||!matches(original,source)){const id=String(original?.id??deterministicId('youtube-reference',tuple));if(original)plan.statements.push(`UPDATE recitation_source_urls SET ${Object.entries(source).map(([k,v])=>k+'='+d4Literal(v as string|null)).join(',')} WHERE id=${d4Literal(id)};`);
      else plan.statements.push(`INSERT INTO recitation_source_urls(id,recitation_id,surah,url,kind,is_active,priority,${Object.keys(source).join(',')}) VALUES(${[id,chapter.recitation_id,chapter.surah,chapter.url,'provider_original',false,0,...Object.values(source)].map(v=>d4Literal(v as string|number|boolean|null)).join(',')});`);
      plan.append('recitation.youtube_reference_metadata','recitation_source_url',id,original?Object.fromEntries(Object.keys(source).map(k=>[k,original[k]??null])):null,{...source,recitation_id:chapter.recitation_id,surah:chapter.surah,kind:'provider_original',metadata_only:true});sourceChanged++;}
  }return {plan,human_rights_preserved:preserved,youtube_changed:youtubeChanged,source_changed:sourceChanged};
}

import { CatalogError,type CatalogRow } from './catalogContracts';
export interface YoutubeReference {videoId:string;playlistId:string|null}
/** Metadata and official embeds only. This module never requests audio/video media. */
export function youtubeReference(raw:string):YoutubeReference|null{
  let url:URL;try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))return null;
  const host=url.hostname.toLowerCase();if(!['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(host))return null;
  const video=host==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.startsWith('/embed/')?url.pathname.slice(7):null;
  const playlist=url.searchParams.get('list');
  if(!video||!/^[-_A-Za-z0-9]{11}$/u.test(video)||playlist&&!/^[-_A-Za-z0-9]{10,128}$/u.test(playlist))return null;
  return {videoId:video,playlistId:playlist};
}
export function youtubeIframePreview(raw:string,startMs:number,durationMs:number|null):CatalogRow{
  const ref=youtubeReference(raw);if(!ref)throw new CatalogError('YOUTUBE_REFERENCE_INVALID',422);
  if(!Number.isSafeInteger(startMs)||startMs<0||durationMs!==null&&(!Number.isSafeInteger(durationMs)||durationMs<=0))throw new CatalogError('AUDITION_DATA_INVALID',503);
  // IFrame API uses integer seconds. These are listening limits, never word timing.
  const params=new URLSearchParams({enablejsapi:'1',start:String(Math.floor(startMs/1000))});
  if(durationMs!==null)params.set('end',String(Math.ceil((startMs+durationMs)/1000)));
  if(ref.playlistId)params.set('list',ref.playlistId);
  return {status:'youtube_iframe',source:'official_youtube_iframe',iframe_url:`https://www.youtube.com/embed/${ref.videoId}?${params}`,video_id:ref.videoId,playlist_id:ref.playlistId,start_ms:startMs,duration_ms:durationMs,render_status:'needs_licensed_file'};
}
export async function checkYoutubeOembed(ref:YoutubeReference,fetcher:typeof fetch=fetch):Promise<CatalogRow>{
  const endpoint=new URL('https://www.youtube.com/oembed');endpoint.searchParams.set('url','https://www.youtube.com/watch?v='+ref.videoId);endpoint.searchParams.set('format','json');
  const checked_at=new Date().toISOString();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try{
  let response:Response;
  try{response=await fetcher(endpoint,{redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});}catch(error){if(error instanceof TypeError||error instanceof DOMException)return {status:'YOUTUBE_OEMBED_UNAVAILABLE',checked_at};throw error;}
  if(!response.ok){await response.body?.cancel();return {status:'YOUTUBE_OEMBED_HTTP_'+response.status,http_status:response.status,checked_at,retry_after:response.status===429?response.headers.get('retry-after'):null};}
  const reader=response.body?.getReader();if(!reader)return {status:'YOUTUBE_OEMBED_EMPTY',checked_at};
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();return {status:'YOUTUBE_OEMBED_TOO_LARGE',checked_at};}chunks.push(value);}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return {status:'YOUTUBE_OEMBED_INVALID',checked_at};}
  if(!body||typeof body!=='object')return {status:'YOUTUBE_OEMBED_INVALID',checked_at};
  const data=body as CatalogRow;
  if(data.provider_name!=='YouTube'||typeof data.title!=='string'||typeof data.author_name!=='string')return {status:'YOUTUBE_OEMBED_INVALID',checked_at};
  // Never persist/embed provider-supplied HTML or remote thumbnail assets.
  return {status:'available',http_status:response.status,checked_at,title:data.title.slice(0,1000),channel_title:data.author_name.slice(0,255),channel_url:typeof data.author_url==='string'?data.author_url:null,rights_status:'unknown',audio_status:'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE'};
  }finally{clearTimeout(timeout);}
}

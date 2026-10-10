import { assertCatalogAudioUrl } from './catalogAudioSource';
import { CatalogError,type CatalogRow } from './catalogContracts';
import { youtubeIframePreview } from './catalogYoutubeMetadata';
/** Original chapter preview. No timing or offset verification is used here. */
export function auditionPreview(row:CatalogRow,hosts:string[]):CatalogRow{
  const details=typeof row.selection_details==='string'?JSON.parse(row.selection_details):row.selection_details;
  if(details&&typeof details==='object'&&'unavailable_reason' in details&&details.unavailable_reason)return {sample_key:row.sample_key,surah:row.surah,status:'unavailable',reason:details.unavailable_reason};
  if(details&&typeof details==='object'&&'playback_kind' in details&&details.playback_kind==='youtube_iframe'){
    if(!('original_url' in details)||details.original_url!==row.audio_url||!('chapter_offset_ms' in details)||details.chapter_offset_ms!==Number(row.chapter_offset_ms)||Number(row.start_ms)!==Number(row.chapter_offset_ms))return {sample_key:row.sample_key,surah:row.surah,status:'unavailable',reason:'AUDITION_SOURCE_CHANGED'};
    return {sample_key:row.sample_key,surah:row.surah,...youtubeIframePreview(String(row.audio_url),Number(row.start_ms),row.duration_ms===null?null:Number(row.duration_ms))};
  }
  if(!details||typeof details!=='object'||!('original_url' in details)||details.original_url!==row.audio_url||Number(row.chapter_offset_ms??0)!==0)return {sample_key:row.sample_key,surah:row.surah,status:'unavailable',reason:'AUDITION_SOURCE_CHANGED'};
  const start=Number(row.start_ms),duration=row.duration_ms===null?null:Number(row.duration_ms);
  if(!Number.isSafeInteger(start)||start<0||(duration!==null&&(!Number.isSafeInteger(duration)||duration<=0))||(duration===null&&start!==0))throw new CatalogError('AUDITION_DATA_INVALID',503);
  const url=assertCatalogAudioUrl(String(row.audio_url),hosts).href;
  // Media Fragments require seconds; persisted/service time fields remain ms.
  const fragment=duration===null?'':`#t=${start/1000},${(start+duration)/1000}`;
  return {sample_key:row.sample_key,surah:row.surah,status:'original_source',url,preview_url:url+fragment,start_ms:start,duration_ms:duration,whole_chapter:duration===null,source:'original_chapter_audio',selection_details:details??null};
}

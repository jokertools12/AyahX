/** Sole coordinate conversion for the new data pipeline; legacy runtime is unchanged. */
export interface SourceAyahTiming {
  ayah:number; coordinate:'source_ms'|'chapter_ms'|'clip_ms'; source:string;
  source_offset_ms:number|null; words:Array<[number|null,number,number,number]>;
}
export interface TimelinePlan { chapterOffsetMs:number; sourceFormat:'qud_release'|'absolute_source'; padMs:number }
export interface RenderTimeline {
  coordinate:'render_ms'; durationMs:number; sourceWindow:{fromMs:number;toMs:number};
  ayahs:Array<{ayah:number;startMs:number;endMs:number;words:Array<[number,number,number,number]>}>;
}
/** QUD Release tier times are chapter-relative; HF offsets are already absolute.
 * D3 retained its original `source_ms` label. Explicit sourceFormat resolves that
 * documented ambiguity without changing a single stored D3 value.
 */
export function toRenderTimeline(timings:readonly SourceAyahTiming[],plan:TimelinePlan):RenderTimeline{
  if(!['qud_release','absolute_source'].includes(plan.sourceFormat)||!Number.isSafeInteger(plan.chapterOffsetMs)||plan.chapterOffsetMs<0||!Number.isSafeInteger(plan.padMs)||plan.padMs<0||plan.padMs>150)throw new Error('TIMELINE_PLAN_INVALID');
  const source=timings.map(row=>{
    if(!['source_ms','chapter_ms','clip_ms'].includes(row.coordinate))throw new Error('TIMELINE_COORDINATE_UNSUPPORTED');
    if(!Number.isSafeInteger(row.ayah)||row.ayah<1)throw new Error('TIMELINE_AYAH_INVALID');
    let offset=0;
    if(row.coordinate==='clip_ms'){
      if(!Number.isSafeInteger(row.source_offset_ms)||Number(row.source_offset_ms)<0)throw new Error('TIMELINE_SOURCE_OFFSET_REQUIRED');offset=Number(row.source_offset_ms);
    }else if(row.coordinate==='chapter_ms'||(row.source==='qud'&&plan.sourceFormat==='qud_release'))offset=plan.chapterOffsetMs;
    else if(row.coordinate!=='source_ms')throw new Error('TIMELINE_COORDINATE_UNSUPPORTED');
    const words=row.words.map(([index,occurrence,from,to])=>{
      if(index===null||!Number.isSafeInteger(index)||index<1||!Number.isSafeInteger(occurrence)||occurrence<0||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from)throw new Error('TIMELINE_WORD_INVALID');
      if(!Number.isSafeInteger(from+offset)||!Number.isSafeInteger(to+offset))throw new Error('TIMELINE_WORD_INVALID');
      return [index,occurrence,from+offset,to+offset] as [number,number,number,number];
    });
    if(!words.length)throw new Error('TIMELINE_WORDS_REQUIRED');
    return {ayah:row.ayah,words};
  });
  if(!source.length)throw new Error('TIMELINE_AYAHS_REQUIRED');
  const first=Math.min(...source.flatMap(a=>a.words.map(w=>w[2])));const last=Math.max(...source.flatMap(a=>a.words.map(w=>w[3])));
  const fromMs=Math.max(0,first-plan.padMs);const durationMs=last-fromMs;
  const ayahs=source.map(row=>{const words=row.words.map(([i,o,a,b])=>[i,o,a-fromMs,b-fromMs] as [number,number,number,number]);return {ayah:row.ayah,startMs:Math.min(...words.map(w=>w[2])),endMs:Math.max(...words.map(w=>w[3])),words};});
  return {coordinate:'render_ms',durationMs,sourceWindow:{fromMs,toMs:last},ayahs};
}

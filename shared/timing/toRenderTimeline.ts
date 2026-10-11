/** Sole coordinate conversion for the new data pipeline; legacy runtime is unchanged. */
export interface SourceAyahTiming {
  ayah:number; coordinate:'source_ms'|'chapter_ms'|'clip_ms'; source:string;
  source_offset_ms:number|null; words:Array<[number|null,number,number,number]>;
  start_ms?:number|null; end_ms?:number|null;
  review_status?:string; quality?:string; word_highlight_enabled?:boolean;
}
export interface TimelinePlan { chapterOffsetMs:number; sourceFormat:'qud_release'|'absolute_source'; padMs:number; allowAyahOnly?:boolean }
export interface RenderTimeline {
  coordinate:'render_ms'; durationMs:number; sourceWindow:{fromMs:number;toMs:number};
  ayahs:Array<{ayah:number;startMs:number;endMs:number;words:Array<[number,number,number,number]>;highlightMode?:'word'|'ayah';highlightReason?:string}>;
  gaps?:Array<{startMs:number;endMs:number;type:'inter_ayah';evidence:'source_timestamps'}>;
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
    const ayahOnly=plan.allowAyahOnly===true&&(row.review_status==='needs_review'||row.review_status==='rejected'||row.quality==='estimated'||row.word_highlight_enabled===false||row.words.some(w=>w[0]===null));
    const words=row.words.map(([index,occurrence,from,to])=>{
      if((index===null?!ayahOnly:!Number.isSafeInteger(index)||index<1)||!Number.isSafeInteger(occurrence)||occurrence<0||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from)throw new Error('TIMELINE_WORD_INVALID');
      if(!Number.isSafeInteger(from+offset)||!Number.isSafeInteger(to+offset))throw new Error('TIMELINE_WORD_INVALID');
      return [index,occurrence,from+offset,to+offset] as [number|null,number,number,number];
    });
    if(!words.length)throw new Error('TIMELINE_WORDS_REQUIRED');
    return {ayah:row.ayah,words,ayahOnly,reason:row.quality==='estimated'?'ESTIMATED_TIMING':row.review_status==='needs_review'?'NEEDS_REVIEW':row.words.some(w=>w[0]===null)?'WORD_DIFF_UNMAPPED':'WORD_HIGHLIGHT_DISABLED'};
  });
  if(!source.length)throw new Error('TIMELINE_AYAHS_REQUIRED');
  const first=Math.min(...source.flatMap(a=>a.words.map(w=>w[2])));const last=Math.max(...source.flatMap(a=>a.words.map(w=>w[3])));
  const fromMs=Math.max(0,first-plan.padMs);const durationMs=last-fromMs;
  const ayahs=source.map(row=>{const words=row.words.map(([i,o,a,b])=>[i,o,a-fromMs,b-fromMs] as [number,number,number,number]);const base={ayah:row.ayah,startMs:Math.min(...words.map(w=>w[2])),endMs:Math.max(...words.map(w=>w[3])),words:row.ayahOnly?[]:words};return plan.allowAyahOnly?{...base,highlightMode:row.ayahOnly?'ayah' as const:'word' as const,...(row.ayahOnly?{highlightReason:row.reason}:{})}:base;});
  const timeline:RenderTimeline={coordinate:'render_ms',durationMs,sourceWindow:{fromMs,toMs:last},ayahs};
  if(plan.allowAyahOnly){timeline.gaps=ayahs.slice(1).flatMap((a,i)=>a.startMs>ayahs[i].endMs?[{startMs:ayahs[i].endMs,endMs:a.startMs,type:'inter_ayah' as const,evidence:'source_timestamps' as const}]:[]);assertTimelineValid(timeline,durationMs);}
  return timeline;
}

/** No repairing, rounding or guessed offsets. The caller supplies measured audio duration. */
export function assertTimelineValid(timeline:RenderTimeline,actualAudioDurationMs:number,marginMs=200):void{
  const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  if(timeline.coordinate!=='render_ms'||!integer(actualAudioDurationMs)||actualAudioDurationMs===0||!integer(marginMs)||marginMs>200||!integer(timeline.durationMs)||timeline.durationMs===0||!timeline.ayahs.length)throw new Error('TIMELINE_INVALID');
  if(!integer(timeline.sourceWindow.fromMs)||!integer(timeline.sourceWindow.toMs)||timeline.sourceWindow.toMs-timeline.sourceWindow.fromMs!==timeline.durationMs)throw new Error('TIMELINE_SOURCE_WINDOW_INVALID');
  let previousAyah=0,previousEnd=0;
  for(const row of timeline.ayahs){
    if(!Number.isSafeInteger(row.ayah)||row.ayah!==previousAyah+1&&previousAyah!==0||!integer(row.startMs)||!integer(row.endMs)||row.endMs<=row.startMs||row.startMs<previousEnd||row.endMs>actualAudioDurationMs+marginMs)throw new Error('TIMELINE_AYAH_INTERVAL_INVALID');
    if(previousAyah&&row.startMs>previousEnd&&!timeline.gaps?.some(g=>g.startMs===previousEnd&&g.endMs===row.startMs&&g.type==='inter_ayah'&&g.evidence==='source_timestamps'))throw new Error('TIMELINE_UNJUSTIFIED_AYAH_GAP');
    let wordEnd=row.startMs;const occurrences=new Set<number>();
    for(const [index,occurrence,from,to]of row.words){
      if(!Number.isSafeInteger(index)||index<1||!integer(occurrence)||occurrences.has(occurrence)||!integer(from)||!integer(to)||to<=from||from<wordEnd||from<row.startMs||to>row.endMs)throw new Error('TIMELINE_WORD_INTERVAL_INVALID');
      occurrences.add(occurrence);wordEnd=to;
    }
    if(row.highlightMode==='ayah'&&row.words.length||row.highlightMode!=='ayah'&&!row.words.length)throw new Error('TIMELINE_HIGHLIGHT_INVALID');
    previousAyah=row.ayah;previousEnd=row.endMs;
  }
  if(timeline.durationMs>actualAudioDurationMs+marginMs||previousEnd>timeline.durationMs)throw new Error('TIMELINE_AUDIO_DURATION_EXCEEDED');
  for(const gap of timeline.gaps??[])if(!integer(gap.startMs)||!integer(gap.endMs)||gap.endMs<=gap.startMs||gap.endMs>timeline.durationMs||!timeline.ayahs.some((a,i)=>i>0&&a.startMs===gap.endMs&&timeline.ayahs[i-1].endMs===gap.startMs))throw new Error('TIMELINE_GAP_INVALID');
}

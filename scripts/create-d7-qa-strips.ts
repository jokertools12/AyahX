/** Actual Skia PNGs only. Label/resize for a compact evidence strip; no fabricated frames. */
import { createCanvas,loadImage } from '@napi-rs/canvas';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { registerRenderV2Fonts } from '../server/services/renderV2Fonts';
import { runRenderV2Process } from '../server/services/renderV2Process';
import { getFfmpegBinary } from '../server/services/ffmpegBinary';
registerRenderV2Fonts();
const directory=process.env.LOCALAPPDATA+'/AyahX/d7-packet-index-qa';
const cases=['mp3quran-short-complete','mp3quran-long-last-ten','quranicaudio-short-complete','quranicaudio-long-last-ten','archive_org-short-complete','archive_org-long-last-ten','real-repetition','real-needs-review-full-coverage'];
await mkdir('docs/data/render-qa',{recursive:true});
for(const id of cases){
 const report=JSON.parse(await readFile(path.join(directory,id+'.report.json'),'utf8'));
 const frames=report.qa.golden_frames.filter((row:{png?:string})=>row.png);
 const selected=frames.length===1?[frames[0]]:id==='real-repetition'?frames.slice(0,3):[frames[0],frames[Math.floor(frames.length/2)],frames[frames.length-1]];
 const canvas=createCanvas(selected.length*270,512),context=canvas.getContext('2d');context.fillStyle='#121212';context.fillRect(0,0,selected.length*270,512);
 for(const [index,frame]of selected.entries()){
  const decoded=await runRenderV2Process(getFfmpegBinary(),['-nostdin','-v','error','-threads','1','-i',path.join(directory,id+'.mp4'),'-vf',`select=eq(n\\,${frame.frame_index})`,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{outputLimitBytes:2*1024*1024});
  const image=await loadImage(decoded.stdout);context.drawImage(image,index*270,32,270,480);context.fillStyle='#fff';context.font='13px "Amiri"';context.fillText(`${frame.time_ms.toFixed(1)}ms | ${frame.actual_word_keys.join(',')||'ayah only'}`,index*270+6,21);
 }
 await writeFile('docs/data/render-qa/local-'+id+'.png',canvas.toBuffer('image/png'));
}
console.log(JSON.stringify({strips:cases.length,source:'actual_encoded_mp4_decoded_by_ffmpeg_at_golden_frame_indices'}));

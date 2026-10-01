import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { applyAudioEffects } from '../server/services/deterministicVideoRenderer';
const output=path.resolve('qa-output/audio-options'); fs.mkdirSync(output,{recursive:true});
const source=path.join(output,'source.wav');
const generate=spawnSync(ffmpeg!,['-y','-f','lavfi','-i','sine=frequency=1200:duration=3','-af',"volume='if(lt(t,1.5),0.3,1)':eval=frame",'-c:a','pcm_s16le',source],{encoding:'utf8'});
if(generate.status!==0)throw Error(generate.stderr);
const defaults={reverbEnabled:false,reverbLevel:.5,echoEnabled:false,echoDelay:.3,echoFeedback:.4,normalizeEnabled:false,eqEnabled:false,volume:1,speedAdjust:1,pitchShift:0,copyrightProtectionEnabled:false};
const cases:Record<string,any>={original:{},halfVolume:{volume:.5},doubleVolume:{volume:2},normalize:{normalizeEnabled:true},clarityEQ:{eqEnabled:true},lightReverb:{reverbEnabled:true,reverbLevel:.2},strongReverb:{reverbEnabled:true,reverbLevel:.8},shortEcho:{echoEnabled:true,echoDelay:.1,echoFeedback:.2},longEcho:{echoEnabled:true,echoDelay:.7,echoFeedback:.6}};
const results:any[]=[];
for(const [name,patch] of Object.entries(cases)){
 const dir=path.join(output,name);fs.mkdirSync(dir,{recursive:true});
 const processed=await applyAudioEffects(source,dir,{audio:{durationSeconds:3},audioEffects:{...defaults,...patch}} as any);
 const decoded=spawnSync(ffmpeg!,['-v','error','-i',processed,'-t','3','-ac','1','-ar','44100','-f','f32le','-'],{maxBuffer:5e6});
 if(decoded.status!==0)throw Error(String(decoded.stderr));
 let power=0,peak=0;for(let i=0;i<decoded.stdout.length;i+=4){const v=decoded.stdout.readFloatLE(i);power+=v*v;peak=Math.max(peak,Math.abs(v));}
 const probe=spawnSync(ffprobe.path,['-v','error','-show_format','-of','json',processed],{encoding:'utf8'});
 const duration=Number(JSON.parse(probe.stdout).format.duration);
 results.push({name,rms:Math.sqrt(power/(decoded.stdout.length/4)),peak,duration,digest:crypto.createHash('sha256').update(decoded.stdout).digest('hex')});
}
const original=results[0];
if(Math.abs(results[1].rms/original.rms-.5)>.03||Math.abs(results[2].rms/original.rms-2)>.05)throw Error('Volume gain was not respected');
if(new Set(results.map(r=>r.digest)).size!==results.length)throw Error('Audio setting produced unchanged samples');
if(results.some(r=>!Number.isFinite(r.rms)||r.peak>1||r.duration<3))throw Error('Invalid or clipped audio');
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({count:results.length,results},null,2));

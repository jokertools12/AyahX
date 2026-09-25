// Isolated, loopback-only route integration check. No database, login or app boot.
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import router from '../server/routes/videoTranscode';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass an existing WebM fixture path.');
const input = await fs.readFile(inputPath);
const outputDir = path.resolve('qa-output/ui-transcode');
await fs.mkdir(outputDir, {recursive:true});
const app = express();
app.use(express.raw({type:'video/*',limit:'100mb'}));
app.use('/api/videos',router);
const server = app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing loopback address');
const evidence = [];
try {
  for (const [fps,audioBitrate] of [[30,'192k'],[60,'320k']] as const) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/videos/process-mp4?fps=${fps}&audioBitrate=${audioBitrate}&filename=qa.mp4`,{
      method:'POST',headers:{'Content-Type':'video/webm'},body:input,
    });
    if (!response.ok) throw new Error(`Transcode failed: ${response.status} ${await response.text()}`);
    const outputPath = path.join(outputDir,`actual-route-${fps}-${audioBitrate}.mp4`);
    await fs.writeFile(outputPath,Buffer.from(await response.arrayBuffer()));
    const probe = JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',outputPath],{encoding:'utf8'}));
    const video = probe.streams.find((s:{codec_type:string})=>s.codec_type==='video');
    const audio = probe.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
    if (video?.codec_name!=='h264' || video.avg_frame_rate!==`${fps}/1` || audio?.codec_name!=='aac' || Number(probe.format.duration)<=0) throw new Error(`Unexpected media metadata: ${JSON.stringify(probe)}`);
    evidence.push({outputPath,fps,audioBitrate,video:{codec:video.codec_name,width:video.width,height:video.height,frameRate:video.avg_frame_rate},audio:{codec:audio.codec_name,sampleRate:audio.sample_rate,bitRate:audio.bit_rate},duration:probe.format.duration,bytes:probe.format.size});
  }
  await fs.writeFile(path.join(outputDir,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
} finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

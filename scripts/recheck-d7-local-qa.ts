/** Recheck real encoded local outputs after review strengthened QA; no provider/SQL writes. */
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countRenderV2BlackFrames } from '../server/services/renderV2Qa';
import { runRenderV2Process } from '../server/services/renderV2Process';
import { getFfmpegBinary } from '../server/services/ffmpegBinary';
const matrix=JSON.parse(await readFile('docs/data/d7-local-render-matrix-proof.json','utf8'));
const results=[];
for(const row of matrix.results.filter((row:{expected:string})=>row.expected==='SUCCESS')){
 const file=path.join(process.env.LOCALAPPDATA!,'AyahX/d7-packet-index-qa',row.id+'.mp4');
 const black=await countRenderV2BlackFrames(file);
 const pcm=await runRenderV2Process(getFfmpegBinary(),['-nostdin','-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','16000','-f','s16le','pipe:1'],{outputLimitBytes:4_000_000});
 const decodedDurationMs=pcm.stdout.length/2/16,difference=Math.abs(decodedDurationMs-row.expected_duration_ms);
 assert.equal(black.black,0);assert.ok(difference<=1000/30+.001,'AUDIO_DURATION_OUTSIDE_ONE_FRAME');
 results.push({id:row.id,black_frames:black.black,decoded_frames:black.frames,decoded_audio_duration_ms:decodedDurationMs,expected_duration_ms:row.expected_duration_ms,difference_ms:difference,passed:true});
}
await writeFile('docs/data/d7-local-qa-review-recheck.json',JSON.stringify({passed:true,source:'actual_encoded_mp4_full_resolution_scan_and_full_audio_decode',results,checked_at:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify({passed:true,videos:results.length}));

/** Root-only evidence for an actual human-task render; loopback DB, owned fixture. */
import assert from 'node:assert/strict';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,dirname,relative,isAbsolute,resolve} from 'node:path';
import mysql from 'mysql2/promise';
import {getFfmpegBinary,getFfprobeBinary} from '../server/services/ffmpegBinary';
const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);assert.ok(i>=0&&args[i+1]);return resolve(args[i+1]);};
const manifest=JSON.parse(await readFile(option('--manifest'),'utf8')),report=JSON.parse(await readFile(option('--human-report'),'utf8'));
assert.equal(manifest.mode,'local-mutations');assert.equal(manifest.fixtureTag,'BATCH5_HUMAN_QA');assert.match(manifest.schema,/^ayahx_d2_batch5_.*restored.*$/u);
const task=report.tasks.find((row:{id:string})=>row.id==='M8');assert.equal(task?.passed,true);assert.equal(task.evidence.realVideoPlayed,true);assert.match(task.evidence.jobId,/^[a-f0-9-]{36}$/u);
const output=option('--out'),location=relative(process.cwd(),output);assert.ok(location.startsWith('..')||isAbsolute(location),'PRIVATE_OUTPUT_REQUIRED');
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:manifest.schema});
try{
 const [versions]=await db.query<mysql.RowDataPacket[]>('SELECT VERSION() version');assert.equal(versions[0].version,'9.7.2');
 const [rows]=await db.execute<mysql.RowDataPacket[]>('SELECT user_id,status,output_path,output_size_bytes,metadata,qa_report_json,manifest,expires_at FROM render_jobs WHERE id=?',[task.evidence.jobId]);const row=rows[0];assert.equal(row.user_id,manifest.owned.userId);assert.equal(row.status,'succeeded');
 const file=await realpath(String(row.output_path)),root=await realpath(join(process.cwd(),'uploads','renders',manifest.owned.userId)),inside=relative(root,file);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside),'OWNED_RENDER_OUTPUT_REQUIRED');
 async function command(binary:string,argv:string[]){return new Promise<string>((accept,reject)=>{const child=spawn(binary,argv,{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks:Buffer[]=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.resume();child.once('error',()=>reject(new Error('LOCAL_MEDIA_BINARY_UNAVAILABLE')));child.once('close',code=>code===0?accept(Buffer.concat(chunks).toString('utf8')):reject(new Error('LOCAL_MEDIA_INSPECTION_FAILED')));});}
 const probe=JSON.parse(await command(getFfprobeBinary(),['-v','error','-show_streams','-show_format','-of','json',file]));
 const frame=join(dirname(output),'actual-skia-human-frame.png');await command(getFfmpegBinary(),['-nostdin','-v','error','-ss','2','-i',file,'-frames:v','1','-y',frame]);
 const renderManifest=typeof row.manifest==='string'?JSON.parse(row.manifest):row.manifest;
 const evidence={checked_at:new Date().toISOString(),local_only:true,synthetic_video:false,job_id:task.evidence.jobId,engine:'skia_canvas',schema_version:renderManifest.schemaVersion,real_ui_video_playback:true,size_bytes:row.output_size_bytes,duration_seconds:Number(probe.format.duration),streams:probe.streams.map((s:{codec_type:string;codec_name:string;width?:number;height?:number;sample_rate?:string;duration?:string})=>({kind:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,sample_rate:s.sample_rate,duration:s.duration})),quality:typeof row.qa_report_json==="string"?JSON.parse(row.qa_report_json):row.qa_report_json,frame_path:frame,expires_at:row.expires_at};
 // The full DB metadata stays private; terminal prints only bounded media facts.
 await writeFile(output,JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({local_only:true,real_ui_video_playback:true,engine:'skia_canvas',schema_version:renderManifest.schemaVersion,size_bytes:row.output_size_bytes,duration_seconds:evidence.duration_seconds,frame_path:frame}));
}finally{await db.end();}

/** Root-only inspection/removal of a specific NEW D7 lab job, never historical artifacts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createCanvas,loadImage } from '@napi-rs/canvas';
import { pool } from '../server/db';
import { RenderManifestV2Schema } from '../server/models/renderManifestV2';
import { streamStoredRender,deleteStoredRender,isObjectStoragePath,objectKeyFromPath } from '../server/services/objectStorage';
import { registerRenderV2Fonts } from '../server/services/renderV2Fonts';
import { getFfmpegBinary } from '../server/services/ffmpegBinary';
import { runRenderV2Process } from '../server/services/renderV2Process';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { AdminAccessService } from '../server/admin/adminAccessService';
import { appendCatalogAudit } from '../server/services/catalogAudit';
async function main(){
 assert.ok(process.argv.includes('--root-operated'),'ROOT_OPERATOR_REQUIRED');
 const [mode,id]=process.argv.slice(2);assert.ok(['inspect','cleanup'].includes(mode));assert.match(id,/^[a-f0-9-]{36}$/u);
 const db=catalogDatabaseFromPool(pool);
 const [job]=await db.read('SELECT id,user_id,status,manifest,qa_report_json,output_path,output_filename,created_at FROM render_jobs WHERE id=?',[id]);
 assert.ok(job&&String(job.created_at)>='2026-10-11 21:00:00'&&job.status==='succeeded','NEW_FINISHED_LAB_JOB_REQUIRED');
 const manifest=RenderManifestV2Schema.parse(typeof job.manifest==='string'?JSON.parse(job.manifest):job.manifest);
 const filename=`quran_reel_${manifest.canonicalAyahRange.surahNumber}_${manifest.canonicalAyahRange.startAyah}-${manifest.canonicalAyahRange.endAyah}_${id.slice(0,8)}.mp4`;
 assert.equal(job.output_filename,filename);
 const root=path.resolve(process.cwd(),process.env.RENDER_STORAGE_DIR||'uploads/renders');
 const local=path.join(root,String(job.user_id),filename);
 const storage=job.output_path===null?null:String(job.output_path);
 if(storage)assert.ok(isObjectStoragePath(storage)?objectKeyFromPath(storage)===`renders/${job.user_id}/${id}.mp4`:path.resolve(storage)===local,'EXACT_JOB_ARTIFACT_REQUIRED');
 if(mode==='cleanup'){
  const actor=await new AdminAccessService(db).actorForUser(String(job.user_id),{requestId:randomUUID()});
  assert.ok(['super_admin','admin'].includes(actor.roleSlug??'')&&actor.permissions.has('render.test'));
  if(storage&&isObjectStoragePath(storage))await deleteStoredRender(storage);
  for(const file of [local,local+'.qa.json'])if(fs.existsSync(file))await fs.promises.unlink(file);
  // Only this newly-created job's exact sidecar directory is eligible.
  if(fs.existsSync(local+'.qa'))await fs.promises.rm(local+'.qa',{recursive:true,force:true});
  await db.transaction(async tx=>{await tx.execute('UPDATE render_jobs SET output_path=NULL,expires_at=NOW() WHERE id=?',[id]);await appendCatalogAudit(tx,actor,'render_lab.artifact_deleted','render_job',id,{artifact_available:storage!==null},{artifact_available:false});});
  console.log(JSON.stringify({id,artifact_removed:true,qa_retained_in_database:true}));return;
 }
 assert.ok(storage,'ARTIFACT_ALREADY_REMOVED');
 const qa=typeof job.qa_report_json==='string'?JSON.parse(job.qa_report_json):job.qa_report_json;
 assert.ok(qa?.passed,'PASSING_QA_REQUIRED');
 const scratch=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ayahx-d7-artifact-'));
 try{
  const file=path.join(scratch,'video.mp4');
  if(isObjectStoragePath(storage)){const result=await streamStoredRender(storage);await pipeline(result.body as Readable,fs.createWriteStream(file));}else await fs.promises.copyFile(storage,file);
  const golden=qa.golden_frames.filter((frame:{png?:string})=>frame.png);
  const selected=golden.length===1?golden:manifest.canonicalAyahRange.surahNumber===81?golden.slice(0,3):[golden[0],golden[Math.floor(golden.length/2)],golden[golden.length-1]];
  registerRenderV2Fonts();const canvas=createCanvas(selected.length*270,512),context=canvas.getContext('2d');context.fillStyle='#121212';context.fillRect(0,0,canvas.width,canvas.height);
  for(const [index,frame]of selected.entries()){
   const decoded=await runRenderV2Process(getFfmpegBinary(),['-nostdin','-v','error','-threads','1','-i',file,'-vf',`select=eq(n\\,${frame.frame_index})`,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{outputLimitBytes:3_000_000});
   context.drawImage(await loadImage(decoded.stdout),index*270,32,270,480);context.fillStyle='#fff';context.font='13px "Amiri"';context.fillText(`${frame.time_ms.toFixed(1)}ms | ${frame.actual_word_keys.join(',')||'ayah only'}`,index*270+6,21);
  }
  console.log(JSON.stringify({id,qa,source:'actual_queue_output_decoded_by_ffmpeg',png_base64:canvas.toBuffer('image/png').toString('base64')}));
 }finally{await fs.promises.rm(scratch,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(JSON.stringify({error:'D7_ARTIFACT_OPERATOR_FAILED',assertion:error instanceof assert.AssertionError?error.message.split('\n')[0]:null}));process.exitCode=1;}).finally(()=>pool.end());

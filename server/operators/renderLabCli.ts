/** Private SSH operator. No public route, migration, user grant, or token creation. */
import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { CatalogError } from '../services/catalogContracts';
import { CatalogAudioSource } from '../services/catalogAudioSource';
import { catalogDatabaseFromPool } from '../services/catalogMysqlDatabase';
import { createRenderLabService } from '../admin/adminRuntime';
import { AdminAccessService } from '../admin/adminAccessService';
import { closeRenderQueue } from '../services/renderQueueBroker';
import { createOwnedRenderLabFixture } from '../services/renderLabOwnedFixture';
import { RenderLabService } from '../services/renderLabService';
import { enqueueRenderJob } from '../services/renderQueueBroker';
import { catalogStorageFromEnvironment } from '../services/catalogStorageRuntime';
import { RenderManifestV2Schema } from '../models/renderManifestV2';
async function main(): Promise<void> {
  if(!process.argv.includes('--root-operated'))throw new Error('ROOT_OPERATOR_OPT_IN_REQUIRED');
  const db=catalogDatabaseFromPool(pool);
  try{
    const [owner]=await db.read("SELECT user_id FROM user_roles WHERE role='super_admin' ORDER BY user_id LIMIT 1");
    if(!owner)throw new CatalogError('ADMIN_FORBIDDEN',403);
    const actor=await new AdminAccessService(db).actorForUser(String(owner.user_id),{requestId:randomUUID()});
    const lab=createRenderLabService(db,new CatalogAudioSource());
    const mode=process.argv[2],raw=process.argv[3];
    if(mode==='cleanup-owned-source'){
      if(!/^[a-f0-9-]{36}$/u.test(raw))throw new CatalogError('OWNED_FIXTURE_CLEANUP_SCOPE_INVALID',422);
      const [row]=await db.read("SELECT manifest,status FROM render_jobs WHERE id=?",[raw]);
      if(!row||!['succeeded','failed','cancelled'].includes(String(row.status)))throw new CatalogError('OWNED_FIXTURE_NOT_FINISHED',409);
      const manifest=RenderManifestV2Schema.parse(typeof row.manifest==='string'?JSON.parse(row.manifest):row.manifest);
      const source=manifest.audioPlan.sourceIdentity;
      if(manifest.recitation.slug!=='owned-noise-qa-fixture'||!manifest.warnings.some(warning=>warning.code==='OWNED_NOISE_QA_NOT_QURAN_TIMING')||source.kind!=='licensed_r2'||!/^test\/d7-[a-f0-9-]{36}\/licensed\/owned-noise-qa\/001\/[a-f0-9]{64}\.mp3$/u.test(source.objectKey))throw new CatalogError('OWNED_FIXTURE_CLEANUP_SCOPE_INVALID',422);
      const writer=catalogStorageFromEnvironment('r2','read_write',[]);
      try{await writer.deleteObject(source.objectKey);if(await writer.head(source.objectKey))throw new CatalogError('OWNED_FIXTURE_CLEANUP_FAILED',502);console.log(JSON.stringify({job:raw,owned_fixture_source_removed:true}));}finally{await writer.close?.();}
      return;
    }
    if(mode==='owned-fixture'){
      const fixture=await createOwnedRenderLabFixture(db);
      const request={recitationId:fixture.manifest.recitation.id,surah:1,from:1,to:1,options:{},qa:true};
      try{
        const ownedLab=new RenderLabService(db,{build:async value=>{if(JSON.stringify(value)!==JSON.stringify({...request,options:fixture.manifest.options}))throw new CatalogError('OWNED_FIXTURE_REQUEST_INVALID',422);return fixture.manifest;}},id=>enqueueRenderJob(id,'skia_canvas',0,{attempts:1}));
        console.log(JSON.stringify({...await ownedLab.create(actor,request),fixture:'OWNED_NOISE_QA_NOT_QURAN_TIMING'}));
      }catch(error){await fixture.cleanup();throw error;}
      return;
    }
    if(mode==='status'){console.log(JSON.stringify(await lab.get(actor,raw)));return;}
    if(!['dry-run','create'].includes(mode))throw new Error('RENDER_LAB_CLI_MODE_INVALID');
    const request=JSON.parse(raw);
    if(mode==='create')console.log(JSON.stringify(await lab.create(actor,request)));
    else{const manifest=await lab.preview(actor,request);console.log(JSON.stringify({dry_run:true,schemaVersion:manifest.schemaVersion,durationMs:manifest.timeline.durationMs,audioPlanHash:manifest.audioPlanHash,timingVersionHash:manifest.timingVersionHash,warnings:manifest.warnings,production_writes:0}));}
  }finally{await closeRenderQueue();await pool.end();}
}
void main().catch(error=>{const code=error instanceof CatalogError?error.code:error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:'RENDER_LAB_CLI_FAILED';console.error(JSON.stringify({error:code}));process.exitCode=1;});

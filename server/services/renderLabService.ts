import {randomUUID} from 'node:crypto';
import type {CatalogDatabase,CatalogRow} from './catalogContracts';
import {CatalogError} from './catalogContracts';
import {appendCatalogAudit,type CatalogActor} from './catalogAudit';
import {RenderManifestV2RequestSchema,type RenderManifestV2} from '../models/renderManifestV2';
import {redactAdminAudit} from '../admin/adminAuditService';
export interface RenderLabBuilder{build(request:unknown):Promise<RenderManifestV2>}
export function requireRenderTester(actor:CatalogActor):void{
  if(actor.kind!=='human'||!actor.permissions.has('render.test')||!['super_admin','admin'].includes(actor.roleSlug??''))throw new CatalogError('CATALOG_PERMISSION_DENIED',403);
}
const parsedJson=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value;
/** Private QA admission. Never called from a public route and never changes the catalog flag. */
export class RenderLabService{
  constructor(private readonly db:CatalogDatabase,private readonly builder:RenderLabBuilder,private readonly enqueue:(id:string)=>Promise<unknown>){}
  async preview(actor:CatalogActor,raw:unknown):Promise<RenderManifestV2>{requireRenderTester(actor);const request=RenderManifestV2RequestSchema.parse(raw);return this.builder.build(request);}
  async create(actor:CatalogActor,raw:unknown):Promise<CatalogRow>{
    const manifest=await this.preview(actor,raw);
    if(manifest.timeline.durationMs>90000)throw new CatalogError('RENDER_LAB_DURATION_EXCEEDED',422);
    const id=randomUUID();
    await this.db.transaction(async tx=>{
      // catalogDatabaseFromPool holds its shared admission/audit lock THROUGH COMMIT.
      // A durable queued/running v2 row therefore fences all API replicas, not just one user.
      const active=await tx.read("SELECT id FROM render_jobs WHERE status IN ('queued','running') AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.schemaVersion'))='2.0.0' LIMIT 1 FOR UPDATE");
      if(active.length)throw new CatalogError('RENDER_LAB_BUSY',409);
      const userActive=await tx.read("SELECT id FROM render_jobs WHERE user_id=? AND status IN ('queued','running') LIMIT 1 FOR UPDATE",[actor.id]);
      if(userActive.length)throw new CatalogError('ACTIVE_RENDER_EXISTS',409);
      await tx.execute("INSERT INTO render_jobs(id,user_id,idempotency_key,engine,active_user_id,enqueue_state,status,progress,stage,manifest,max_retries,recitation_id,audio_plan_hash,timing_version_hash,audio_mode_used,fallback_used,audio_provider_code) VALUES(?,?,NULL,'skia_canvas',?,'pending','queued',0,'اختبار الريندر الخاص',?,0,?,?,?,?,?,?)",[id,actor.id,actor.id,JSON.stringify(manifest),manifest.recitation.id,manifest.audioPlanHash,manifest.timingVersionHash,manifest.audioPlan.mode,manifest.audioPlan.fallbackUsed,manifest.audioPlan.provider]);
      await appendCatalogAudit(tx,actor,'render_lab.job_created','render_job',id,null,{schema_version:'2.0.0',recitation_id:manifest.recitation.id,surah:manifest.canonicalAyahRange.surahNumber,from:manifest.canonicalAyahRange.startAyah,to:manifest.canonicalAyahRange.endAyah,duration_ms:manifest.timeline.durationMs,audio_plan_hash:manifest.audioPlanHash,timing_version_hash:manifest.timingVersionHash,qa:true});
    });
    // The durable pending row is also recovered by the existing render-control handoff.
    // Enqueue failures propagate; they are never disguised as successful rendering.
    await this.enqueue(id);
    return {id,status:'queued',schemaVersion:'2.0.0',durationMs:manifest.timeline.durationMs,audioPlanHash:manifest.audioPlanHash,timingVersionHash:manifest.timingVersionHash};
  }
  async get(actor:CatalogActor,id:string):Promise<CatalogRow>{
    requireRenderTester(actor);if(!/^[a-f0-9-]{36}$/u.test(id))throw new CatalogError('RENDER_LAB_JOB_NOT_FOUND',404);
    const [row]=await this.db.read("SELECT id,status,progress,stage,error_code,recitation_id,audio_plan_hash,timing_version_hash,audio_mode_used,fallback_used,audio_bytes_fetched,audio_provider_code,qa_report_json,duration_seconds,output_size_bytes,created_at,completed_at,(output_path IS NOT NULL) artifact_available FROM render_jobs WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.schemaVersion'))='2.0.0'",[id]);
    if(!row)throw new CatalogError('RENDER_LAB_JOB_NOT_FOUND',404);
    return {...row,qa_report_json:redactAdminAudit(parsedJson(row.qa_report_json)),artifact:row.status==='succeeded'&&Number(row.artifact_available)===1?{downloadPath:`/api/render-jobs/${id}/download`,requiresUserAuthentication:true}:null};
  }
}

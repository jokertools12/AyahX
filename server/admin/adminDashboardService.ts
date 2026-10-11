import Redis from 'ioredis';
import type { CatalogDatabase, CatalogRow } from '../services/catalogContracts';
import { CatalogError, publicCatalogSql } from '../services/catalogContracts';
import { readCatalogSettings } from '../services/recitationCatalogService';
import { catalogStorageFromEnvironment } from '../services/catalogStorageRuntime';
import { assessQuranStorage, type StorageMeasurement } from '../services/quranStorageHealth';
import { AdminAuditService } from './adminAuditService';
type Check=Record<string,unknown>;
export class AdminDashboardService {
 private cached?:{until:number;value:Check};
 constructor(private readonly db:CatalogDatabase,private readonly env:NodeJS.ProcessEnv=process.env,private readonly now:()=>number=Date.now){}
 private async probe(work:()=>Promise<Check>):Promise<Check>{const start=this.now();try{return{...await work(),latencyMs:this.now()-start};}catch(error){return{status:'unavailable',code:error instanceof CatalogError?error.code:'PROBE_FAILED',latencyMs:this.now()-start};}}
 private async health():Promise<Check>{
  if(this.cached&&this.cached.until>this.now())return this.cached.value;
  const mysql=await this.probe(async()=>{await this.db.read('SELECT 1 ok');return{status:'ok'};});
  const redis=await this.probe(async()=>{if(!this.env.REDIS_URL)return{status:'unavailable',code:'REDIS_NOT_CONFIGURED'};const client=new Redis(this.env.REDIS_URL,{maxRetriesPerRequest:1,connectTimeout:5000,retryStrategy:()=>null});client.on('error',()=>{});try{return{status:await client.ping()==='PONG'?'ok':'unavailable'};}finally{client.disconnect();}});
  const r2=await this.probe(async()=>{const storage=catalogStorageFromEnvironment('r2','read_only',[],this.env);try{await storage.listObjects('__ayahx_health__/');return{status:'ok',access:'read_only'};}finally{await (storage as typeof storage&{close?:()=>Promise<void>}).close?.();}});
  const storage=await this.probe(async()=>{const [row]=await this.db.read("SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) allocated_bytes,COALESCE(SUM(CASE WHEN TABLE_NAME IN ('ayah_timings','import_jobs','ayah_timing_history') THEN 0 ELSE DATA_LENGTH+INDEX_LENGTH END),0) base_bytes,COALESCE(SUM(CASE WHEN TABLE_NAME IN ('ayah_timings','import_jobs','ayah_timing_history') THEN DATA_LENGTH+INDEX_LENGTH ELSE 0 END),0) timing_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");return assessQuranStorage(row as unknown as StorageMeasurement,this.env.STORAGE_VOLUME_BYTES,this.now());});
  const workers=await this.probe(async()=>{const rows=await this.db.read('SELECT engine,replicas,slots_per_replica,waiting_jobs,active_jobs,updated_at FROM render_engine_capacity');return{status:rows.length?'observed':'unavailable',source:'render_engine_capacity',limitation:'Capacity observations are not a worker heartbeat.',engines:rows};});
  const value={mysql,redis,r2,storage,workers,observedAt:new Date(this.now()).toISOString()};this.cached={until:this.now()+30000,value};return value;
 }
 async get():Promise<CatalogRow>{
  const [counts]=await this.db.read('SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM saved_videos) savedVideos,(SELECT COUNT(*) FROM reciters) reciters,(SELECT COUNT(*) FROM recitations) recitations,(SELECT COUNT(*) FROM ayah_timings) timingRows');
  const recitationStates=await this.db.read('SELECT status,COUNT(*) count FROM recitations GROUP BY status');
  const renderStates=await this.db.read('SELECT status,COUNT(*) count FROM render_jobs GROUP BY status');
  const reviews=await this.db.read("SELECT type,COUNT(*) count FROM human_review_items WHERE status='pending' GROUP BY type ORDER BY type");
  const settings=await readCatalogSettings(this.db);
  const [eligible]=await this.db.read(`SELECT COUNT(*) count FROM recitations r JOIN audio_providers p ON p.id=r.provider_id WHERE ${publicCatalogSql(settings.voiceGatePolicy)} AND EXISTS(SELECT 1 FROM recitation_chapters c WHERE c.recitation_id=r.id AND COALESCE(c.is_enabled,1)=1 AND c.availability_state='complete')`);
  const [objects]=await this.db.read("SELECT COUNT(*) objects,COALESCE(SUM(size_bytes),0) bytes FROM storage_objects WHERE upload_status NOT IN ('deleted','rejected')");
  const activity=await new AdminAuditService(this.db).list({page:1,limit:10});
  return{stats:{...counts,eligibleRecitations:Number(eligible?.count||0),recitationStates,renderStates,pendingReviews:reviews,storedAudio:{objects:Number(objects?.objects||0),bytes:Number(objects?.bytes||0)}},health:await this.health(),activity:activity.data,alerts:[{code:'R2_TOKEN_RENEWAL',deadline:'2026-11-09',message:'جدّد رموز R2 قبل 9 نوفمبر؛ راجع حالة الرموز الفعلية في Cloudflare.'}],catalogEnabled:settings.enabled};
 }
}

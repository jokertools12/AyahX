import {CatalogError,isPubliclyVisible,type CatalogDatabase,type CatalogRow,type PublicRecitation} from './catalogContracts';
import {requireCatalogPermission,type CatalogActor} from './catalogAudit';
export type ReadinessVoicePolicy='allow_auto_verified'|'require_confirmed';
export interface LaunchRecitation extends PublicRecitation {id:string;slug:string;reciter_id:string;complete_chapters:number;coverage_mismatches:number;healthy_complete_chapters:number;needs_label_review?:boolean|number|null}
export interface LaunchSnapshot {enabled:boolean;voice_policy:ReadinessVoicePolicy;availability_mode:'complete_only'|'ayah_ranges';pending_by_type:Record<string,number>;recitations:LaunchRecitation[]}
/** The sole visibility function remains catalogContracts.isPubliclyVisible. */
const visible=isPubliclyVisible as (row:PublicRecitation,enabled:boolean,policy:ReadinessVoicePolicy)=>boolean;
export function summarizeLaunchReadiness(snapshot:LaunchSnapshot):CatalogRow{
  const potential=snapshot.recitations.filter(r=>visible(r,true,snapshot.voice_policy)&&r.healthy_complete_chapters>0&&r.coverage_mismatches===0);
  const recitations=snapshot.recitations.map(r=>{
    const blockers:string[]=[];
    if(r.status!=='published')blockers.push('TECHNICAL_NOT_PUBLISHED');
    if(r.is_public!==true&&r.is_public!==1)blockers.push('ADMIN_PUBLIC_DISABLED');
    if(r.voice_identity_status!=='confirmed'&&!(snapshot.voice_policy==='allow_auto_verified'&&r.voice_identity_status==='auto_verified'))blockers.push('VOICE_GATE_NOT_MET');
    if(r.license_status!=='permitted')blockers.push('PROVIDER_LICENSE_NOT_PERMITTED');
    if(!r.complete_chapters)blockers.push('NO_COMPLETE_CHAPTER');
    if(!r.healthy_complete_chapters)blockers.push('NO_HEALTHY_COMPLETE_CHAPTER');
    if(r.coverage_mismatches)blockers.push('COVERAGE_MISMATCH');
    return {id:r.id,slug:r.slug,reciter_id:r.reciter_id,visible_if_flag_open:potential.some(p=>p.id===r.id),currently_visible:snapshot.enabled&&potential.some(p=>p.id===r.id),blockers};
  });
  return {flag_enabled:snapshot.enabled,voice_gate_policy:snapshot.voice_policy,availability_mode:snapshot.availability_mode,pending_by_type:snapshot.pending_by_type,pending_total:Object.values(snapshot.pending_by_type).reduce((a,b)=>a+b,0),public_potential_recitations:potential.length,public_potential_readers:new Set(potential.map(r=>r.reciter_id)).size,recitations,launch_blockers:[...(!snapshot.enabled?['CATALOG_FLAG_DISABLED']:[]),...new Set(recitations.flatMap(r=>r.blockers))]};
}
export class LaunchReadinessService {
  constructor(private readonly db:CatalogDatabase){}
  async get(actor:CatalogActor):Promise<CatalogRow>{
    requireCatalogPermission(actor,'reviews.read');
    const settings=await this.db.read("SELECT key_name,value_text FROM system_settings WHERE key_name IN ('quran_catalog_v2','voice_gate_policy','availability_mode')");
    const values=Object.fromEntries(settings.map(r=>[String(r.key_name),String(r.value_text)]));const policy=values.voice_gate_policy??'allow_auto_verified',mode=values.availability_mode??'complete_only';
    if(!['allow_auto_verified','require_confirmed'].includes(policy)||!['complete_only','ayah_ranges'].includes(mode))throw new CatalogError('CATALOG_SETTING_INVALID',503);
    const pending=await this.db.read("SELECT type,COUNT(*) count FROM human_review_items WHERE status='pending' GROUP BY type");
    const rows=await this.db.read("SELECT r.id,r.slug,r.reciter_id,r.status,r.is_public,r.voice_identity_status,r.needs_label_review,p.license_status,COALESCE(SUM(c.availability_state='complete'),0) complete_chapters,COALESCE(SUM(c.coverage_mismatch=1),0) coverage_mismatches,COALESCE(SUM(c.availability_state='complete' AND c.audio_status='available'),0) healthy_complete_chapters FROM recitations r JOIN audio_providers p ON p.id=r.provider_id LEFT JOIN recitation_chapters c ON c.recitation_id=r.id GROUP BY r.id,r.slug,r.reciter_id,r.status,r.is_public,r.voice_identity_status,r.needs_label_review,p.license_status ORDER BY r.slug");
    return summarizeLaunchReadiness({enabled:values.quran_catalog_v2==='true'||values.quran_catalog_v2==='1',voice_policy:policy as ReadinessVoicePolicy,availability_mode:mode as 'complete_only'|'ayah_ranges',pending_by_type:Object.fromEntries(pending.map(r=>[String(r.type),Number(r.count)])),recitations:rows.map(r=>({...r,complete_chapters:Number(r.complete_chapters),healthy_complete_chapters:Number(r.healthy_complete_chapters),coverage_mismatches:Number(r.coverage_mismatches)})) as unknown as LaunchRecitation[]});
  }
}

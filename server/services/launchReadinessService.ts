import {isPubliclyVisible,type CatalogDatabase,type CatalogRow,type PublicRecitation} from './catalogContracts';
import {requireCatalogPermission,type CatalogActor} from './catalogAudit';
import {readCatalogSettings} from './recitationCatalogService';
import {requiresScopedLicensedSource} from './recitationCatalogService';
import type {LicensedChapterGate} from './catalogLicensedReadiness';
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
  constructor(private readonly db:CatalogDatabase,private readonly licensed?:LicensedChapterGate){}
  async get(actor:CatalogActor):Promise<CatalogRow>{
    requireCatalogPermission(actor,'reviews.read');
    const settings=await readCatalogSettings(this.db),policy=settings.voiceGatePolicy??'allow_auto_verified',mode=settings.availabilityMode;
    const pending=await this.db.read("SELECT type,COUNT(*) count FROM human_review_items WHERE status='pending' GROUP BY type");
    const rows=await this.db.read("SELECT r.id,r.slug,r.reciter_id,r.status,r.is_public,r.voice_identity_status,r.needs_label_review,r.channel,r.licensed_publication_details,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,p.code provider,p.license_status,COALESCE(SUM(c.availability_state='complete'),0) complete_chapters,COALESCE(SUM(c.coverage_mismatch=1),0) coverage_mismatches,COALESCE(SUM(c.availability_state='complete' AND c.audio_status='available' AND c.coverage_mismatch=0 AND c.last_verified_at>UTC_TIMESTAMP()-INTERVAL 1 DAY),0) healthy_complete_chapters FROM recitations r JOIN audio_providers p ON p.id=r.provider_id LEFT JOIN recitation_chapters c ON c.recitation_id=r.id GROUP BY r.id,r.slug,r.reciter_id,r.status,r.is_public,r.voice_identity_status,r.needs_label_review,r.channel,r.licensed_publication_details,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,p.code,p.license_status ORDER BY r.slug");
    for(const row of rows)if(requiresScopedLicensedSource(row)){
      const candidates=await this.db.read("SELECT DISTINCT c.surah FROM recitation_chapters c JOIN recitation_source_urls u ON u.recitation_id=c.recitation_id AND u.surah=c.surah WHERE c.recitation_id=? AND c.availability_state='complete' AND c.coverage_mismatch=0 AND u.kind='licensed_file' AND u.is_active=1 AND u.verification_status='verified'",[row.id]);
      let healthy=0;for(const chapter of candidates)if(this.licensed&&await this.licensed.isChapterReady(String(row.id),Number(chapter.surah),true))healthy++;
      row.healthy_complete_chapters=healthy;
    }
    return summarizeLaunchReadiness({enabled:settings.enabled,voice_policy:policy,availability_mode:mode,pending_by_type:Object.fromEntries(pending.map(r=>[String(r.type),Number(r.count)])),recitations:rows.map(r=>({...r,complete_chapters:Number(r.complete_chapters),healthy_complete_chapters:Number(r.healthy_complete_chapters),coverage_mismatches:Number(r.coverage_mismatches)})) as unknown as LaunchRecitation[]});
  }
}

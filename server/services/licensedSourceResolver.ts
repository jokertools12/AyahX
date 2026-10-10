import {createHash} from 'node:crypto';
import {CatalogError,type CatalogDatabase,type CatalogRow} from './catalogContracts';
import {CatalogAudioSource,assertCatalogAudioUrl} from './catalogAudioSource';
import type {AudioObjectStorage} from './catalogStorageContracts';
import {assertLicensedOffsetEvidence,type LicensedOffsetEvidence} from './licensedAudioVerification';
interface LicensedPlanBase {kind:'licensed_file';recitationId:string;surah:number;sourceId:string;sha256:string;durationMs:number;sourceChapterOffsetMs:number;offsetEvidence:LicensedOffsetEvidence;rightsRef?:string}
export interface StorageAudioPlan extends LicensedPlanBase {storageObjectId:string;adapter:'r2';bucket:string;objectKey:string}
export interface HostedAudioPlan extends LicensedPlanBase {storageObjectId:null;adapter:'url_reference';url:string;allowedHosts:string[]}
export type LicensedAudioPlan=StorageAudioPlan|HostedAudioPlan;
export interface LicensedSourceResolver {resolveLicensedSource(recitationId:string,surah:number):Promise<LicensedAudioPlan|null>}
export const LICENSED_SOURCE_FIELDS=['source_id','recitation_id','surah','url','rights_ref','source_sha256','source_duration_ms','verification_status','verification_details','storage_id','adapter','bucket','object_key','sha256','size_bytes','duration_ms','upload_status','verified_at','object_recitation_id','object_surah','object_rights_ref'] as const;
export const LICENSED_SOURCE_SELECT="SELECT u.id source_id,u.recitation_id,u.surah,u.url,u.rights_ref,u.sha256 source_sha256,u.duration_ms source_duration_ms,u.verification_status,u.verification_details,o.id storage_id,o.adapter,o.bucket,o.object_key,o.sha256,o.size_bytes,o.duration_ms,o.upload_status,o.verified_at,o.recitation_id object_recitation_id,o.surah object_surah,o.rights_ref object_rights_ref FROM recitation_source_urls u LEFT JOIN storage_objects o ON o.id=u.storage_object_id JOIN human_review_items h ON h.id=u.rights_ref AND h.status='approved' AND h.decided_by IS NOT NULL AND h.subject_type='recitation' AND h.subject_id=u.recitation_id AND h.type IN ('storage_rights','youtube_rights') WHERE u.recitation_id=? AND u.surah=? AND u.kind='licensed_file' AND u.is_active=1 ORDER BY u.priority,u.id";
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Each resolution rechecks rights and current source. No snapshot is an audio capability. */
export class CatalogLicensedSourceResolver implements LicensedSourceResolver {
  constructor(private readonly db:CatalogDatabase,private readonly storage:AudioObjectStorage|null,private readonly hosted:Pick<CatalogAudioSource,'checkLink'|'verifyLicensedBlob'>=new CatalogAudioSource()){}
  async resolveLicensedSource(recitationId:string,surah:number):Promise<LicensedAudioPlan|null>{
    if(!recitationId||!Number.isSafeInteger(surah)||surah<1||surah>114)throw new CatalogError('STORAGE_INPUT_INVALID',422);
    const rows=await this.db.read(LICENSED_SOURCE_SELECT,[recitationId,surah]);
    for(const row of rows){
      if(row.recitation_id!==recitationId||Number(row.surah)!==surah||row.verification_status!=='verified'||!row.rights_ref||!/^[a-f0-9]{64}$/u.test(String(row.source_sha256)))continue;
      let evidence:LicensedOffsetEvidence;
      try{evidence=(typeof row.verification_details==='string'?JSON.parse(row.verification_details):row.verification_details) as LicensedOffsetEvidence;assertLicensedOffsetEvidence(evidence,recitationId,String(row.source_sha256),surah);}
      catch(error){if(error instanceof CatalogError||error instanceof SyntaxError)continue;throw error;}
      if(evidence.method==='v2'){const [review]=await this.db.read("SELECT id FROM human_review_items WHERE id=? AND type='offset_exception' AND status='approved' AND decided_by IS NOT NULL AND subject_type='recitation' AND subject_id=?",[evidence.v2Acceptance!.humanReviewId,recitationId]);if(!review)continue;}
      const base={kind:'licensed_file' as const,recitationId,surah,sourceId:String(row.source_id),sha256:String(row.source_sha256),sourceChapterOffsetMs:evidence.sourceChapterOffsetMs,offsetEvidence:evidence,rightsRef:String(row.rights_ref)};
      if(row.storage_id){
        if(!this.storage||this.storage.adapter!=='r2')continue;
        if(row.object_recitation_id!==recitationId||Number(row.object_surah)!==surah||row.upload_status!=='verified'||!row.verified_at||row.rights_ref!==row.object_rights_ref||row.source_sha256!==row.sha256||!Number.isFinite(Number(row.duration_ms))||Number(row.duration_ms)<=0||row.adapter!==this.storage.adapter||row.bucket!==this.storage.bucket||!String(row.object_key).includes('/'+row.sha256+'.'))continue;
        const head=await this.storage.head(String(row.object_key));if(!head||head.sizeBytes!==Number(row.size_bytes))throw new CatalogError('LICENSED_OBJECT_MISSING_OR_CHANGED',409);
        return {...base,storageObjectId:String(row.storage_id),adapter:'r2',bucket:String(row.bucket),objectKey:String(row.object_key),durationMs:Number(row.duration_ms)};
      }
      if(typeof row.url!=='string'||!Number.isFinite(Number(row.source_duration_ms))||Number(row.source_duration_ms)<=0)continue;
      const detail=evidence as unknown as CatalogRow,scope=detail.hosted_source as CatalogRow|undefined;
      if(!scope||scope.url_sha256!==sha(row.url)||!Array.isArray(scope.allowed_hosts)||!scope.allowed_hosts.length||scope.allowed_hosts.some(h=>typeof h!=='string'||!/^[a-z0-9.-]+$/iu.test(h)))continue;
      const hosts=scope.allowed_hosts as string[];assertCatalogAudioUrl(row.url,hosts);
      const check=await this.hosted.checkLink(row.url,hosts);if(check.status!=='available')throw new CatalogError('LICENSED_AUDIO_UNAVAILABLE',502);
      await this.hosted.verifyLicensedBlob(row.url,hosts,String(row.source_sha256));
      return {...base,storageObjectId:null,adapter:'url_reference',url:row.url,allowedHosts:hosts,durationMs:Number(row.source_duration_ms)};
    }
    return null;
  }
}
import { toRenderTimeline,type SourceAyahTiming } from '../../shared/timing/toRenderTimeline';
import { CatalogError,parseRuns,publicCatalogSql,type CatalogDatabase,type CatalogRow,type AudioPlanInput,type CatalogAudioPlan,type CatalogSettings } from './catalogContracts';
import { isRangeAvailable } from './recitationAvailability';
import { CatalogAudioSource } from './catalogAudioSource';
import { appendCatalogAudit } from './catalogAudit';
import type {LicensedSourceResolver} from './licensedSourceResolver';
import type {AudioObjectStorage} from './catalogStorageContracts';
import {assertLicensedOffsetEvidence} from './licensedAudioVerification';
import {CatalogLicensedChapterReadiness} from './catalogLicensedReadiness';
const json=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value;
export function hasVerifiedCatalogOffset(row:CatalogRow):boolean{
  if(Number(row.offset_verified)!==1||row.verification_status!=='passed'||!Number.isFinite(Number(row.offset_check_score))||Number(row.offset_check_score)>1)return false;
  if(row.verification_method==='v1')return Number(row.offset_check_score)>=.95;
  if(row.verification_method!=='v2'||Number(row.offset_check_score)<.9)return false;
  const detail=json(row.verification_details) as CatalogRow|null;const proof=detail?.v2_acceptance as CatalogRow|undefined;
  return !!proof&&proof.cause==='codec_processing_only'&&proof.decision==='accepted_for_data_pipeline_verification'&&
    ['minimum_VAD_agreement','maximum_absolute_lag_ms','maximum_duration_difference_ms','sample_count'].every(k=>typeof proof[k]==='number'&&Number.isFinite(proof[k])&&Number(proof[k])>=0)&&Number(proof.minimum_VAD_agreement)>=.9&&Number(proof.minimum_VAD_agreement)<=1&&Number(proof.maximum_absolute_lag_ms)<=30&&Number(proof.maximum_duration_difference_ms)<=30&&
    Number.isSafeInteger(proof.sample_count)&&Number(proof.sample_count)>=5&&Array.isArray(proof.review_blockers)&&proof.review_blockers.length===0;
}
/** No public route calls this directly; CatalogService enforces human/public gates. */
export class RecitationAudioResolver {
  constructor(private readonly db:CatalogDatabase,private readonly source:CatalogAudioSource,private readonly settings:()=>Promise<CatalogSettings>,private readonly licensed?:{resolver:LicensedSourceResolver;storage:AudioObjectStorage}){}
  async resolveAudioPlan(input:AudioPlanInput):Promise<CatalogAudioPlan>{
    const {recitationId,surah,from,to}=input;const pad=input.padMs??150;
    if(!recitationId||![surah,from,to,pad].every(Number.isSafeInteger)||surah<1||from<1||to<from||pad<0||pad>150)throw new CatalogError('RANGE_NOT_AVAILABLE',422,{available_runs:[]});
    const [r]=await this.db.read('SELECT r.id,r.reciter_id,r.slug,r.audio_mode,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,r.timing_level,r.timing_quality,r.riwayah_code,p.code provider,p.host_allowlist,p.license_text,p.attribution_text FROM recitations r JOIN audio_providers p ON p.id=r.provider_id WHERE r.id=?',[recitationId]);
    if(!r)throw new CatalogError('RECITATION_NOT_PUBLIC',404);
    const licensed=await this.licensed?.resolver.resolveLicensedSource(recitationId,surah)??null;
    if(r.provider==='youtube'&&!licensed)throw new CatalogError('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE',409);
    if(r.riwayah_code!=='hafs_an_asim'||(!licensed&&(r.audio_mode!=='surah_slice'||!hasVerifiedCatalogOffset(r))))throw new CatalogError('TIMINGS_INCOMPLETE',409,{reason:'OFFSET_OR_CANONICAL_REFERENCE_UNVERIFIED'});
    if(licensed){if(licensed.recitationId!==recitationId||licensed.surah!==surah||licensed.sourceChapterOffsetMs!==licensed.offsetEvidence.sourceChapterOffsetMs||!Number.isFinite(licensed.durationMs)||licensed.durationMs<=0)throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED',409);assertLicensedOffsetEvidence(licensed.offsetEvidence,recitationId,licensed.sha256,surah);}
    const [chapter]=await this.db.read('SELECT audio_url,chapter_offset_ms,availability_state,available_runs,coverage_mismatch FROM recitation_chapters WHERE recitation_id=? AND surah=?',[r.id,surah]);
    const settings=await this.settings();const runs=chapter?parseRuns(chapter.available_runs):[];
    if(!chapter||Number(chapter.coverage_mismatch)!==0||(!isRangeAvailable(runs,from,to))||(settings.availabilityMode==='complete_only'&&chapter.availability_state!=='complete'))throw new CatalogError('RANGE_NOT_AVAILABLE',422,{available_runs:settings.availabilityMode==='complete_only'&&chapter?.availability_state!=='complete'?[]:runs});
    const rows=await this.db.read('SELECT ayah,coordinate,source,source_offset_ms,words,review_status,review_reasons,coverage_words,expected_words,missing_words FROM ayah_timings WHERE recitation_id=? AND surah=? AND ayah BETWEEN ? AND ? ORDER BY ayah',[r.id,surah,from,to]);
    if(rows.length!==to-from+1||rows.some((a,i)=>Number(a.ayah)!==from+i||a.review_status!=='ready'||Number(a.coverage_words)!==Number(a.expected_words)||!Array.isArray(json(a.review_reasons))||(json(a.review_reasons) as unknown[]).length!==0||!Array.isArray(json(a.missing_words))||(json(a.missing_words) as unknown[]).length!==0))throw new CatalogError('TIMINGS_INCOMPLETE',409);
    const timing=rows.map(a=>({ayah:Number(a.ayah),coordinate:String(a.coordinate),source:String(a.source),source_offset_ms:a.source_offset_ms===null?null:Number(a.source_offset_ms),words:json(a.words)}) as SourceAyahTiming);
    const timeline=toRenderTimeline(timing,{chapterOffsetMs:licensed?licensed.sourceChapterOffsetMs:chapter.chapter_offset_ms===null?0:Number(chapter.chapter_offset_ms),sourceFormat:'qud_release',padMs:pad});
    if(licensed){
      if(timeline.sourceWindow.toMs>licensed.durationMs+30)throw new CatalogError('LICENSED_TIMING_COORDINATES_INVALID',409);
      const url=licensed.adapter==='r2'?(await this.licensed!.storage.presignGet(licensed.objectKey,900)).url:licensed.url;
      return {recitationId,mode:'surah_slice',coordinate:'source_ms',provider:'licensed_file',license:'admin_owned_or_licensed',attribution:r.attribution_text===null?null:String(r.attribution_text),parts:[{url,sliceFromMs:timeline.sourceWindow.fromMs,sliceToMs:timeline.sourceWindow.toMs}],fallbackUsed:true,fallbackReason:'EXPLICIT_LICENSED_SAME_RECORDING',alternateSourceId:licensed.sourceId};
    }
    const hosts=json(r.host_allowlist);if(!Array.isArray(hosts)||hosts.some(h=>typeof h!=='string'))throw new CatalogError('AUDIO_PROVIDER_INVALID',503);
    const primary=String(chapter.audio_url);const health=await this.source.checkLink(primary,hosts);
    const base={recitationId,mode:'surah_slice' as const,coordinate:'source_ms' as const,provider:String(r.provider),license:r.license_text===null?null:String(r.license_text),attribution:r.attribution_text===null?null:String(r.attribution_text)};
    const part=(url:string)=>[{url,sliceFromMs:timeline.sourceWindow.fromMs,sliceToMs:timeline.sourceWindow.toMs}];
    if(health.status==='available')return {...base,parts:part(health.finalUrl??primary),fallbackUsed:false};
    const alternates=await this.db.read("SELECT id,recitation_id,surah,url,recording_sha256,identity_evidence,approved_by FROM recitation_source_urls WHERE recitation_id=? AND (surah=? OR surah IS NULL) AND kind='alternate_same_recording' AND is_active=1 ORDER BY priority,id",[r.id,surah]);
    const failures:CatalogRow[]=[{source:'primary',status:health.status}];
    for(const alternate of alternates){
      const proof=json(alternate.identity_evidence) as CatalogRow|null;
      if(alternate.recitation_id!==r.id||!alternate.approved_by||proof?.primaryUrl!==primary||proof?.primarySha256!==alternate.recording_sha256||proof?.alternateSha256!==alternate.recording_sha256||proof?.method!=='decoded_audio_sha256'){failures.push({source_id:alternate.id,status:'ALTERNATE_RECORDING_UNVERIFIED'});continue;}
      const checked=await this.source.checkLink(String(alternate.url),hosts);if(checked.status!=='available'){failures.push({source_id:alternate.id,status:checked.status});continue;}
      try{await this.source.verifyRecordingFingerprint(checked.finalUrl??String(alternate.url),hosts,String(alternate.recording_sha256));}
      catch(error){if(error instanceof CatalogError){failures.push({source_id:alternate.id,status:error.code});continue;}throw error;}
      const reason='PRIMARY_AUDIO_UNAVAILABLE:'+health.status;
      await this.db.transaction(tx=>appendCatalogAudit(tx,{id:'audio-resolver',kind:'system',permissions:new Set()},'recitation.alternate_used','recitation',String(r.id),{primary_status:health.status},{source_id:alternate.id,surah,from,to,reason}));
      return {...base,parts:part(checked.finalUrl??String(alternate.url)),fallbackUsed:true,fallbackReason:reason,alternateSourceId:String(alternate.id)};
    }
    const candidates=settings.enabled?await this.db.read(`SELECT r.id,r.channel,p.code provider,r.licensed_publication_details,r.offset_verified,r.offset_check_score,r.verification_status,r.verification_method,r.verification_details,r.slug,r.display_label_ar,r.display_label_en,c.availability_state,c.available_runs FROM recitations r JOIN audio_providers p ON p.id=r.provider_id JOIN recitation_chapters c ON c.recitation_id=r.id WHERE r.reciter_id=? AND r.id<>? AND ${publicCatalogSql(settings.voiceGatePolicy)} AND c.surah=? AND c.run_count>0 ORDER BY COALESCE(r.sort_order,2147483647),r.slug`,[r.reciter_id,r.id,surah]):[];
    const suggestions:CatalogRow[]=[];
    for(const c of candidates){if(!(settings.availabilityMode==='ayah_ranges'||c.availability_state==='complete')||!isRangeAvailable(parseRuns(c.available_runs),from,to))continue;
      if(c.channel==='youtube'||c.provider==='youtube'||c.licensed_publication_details!==null&&c.licensed_publication_details!==undefined&&!hasVerifiedCatalogOffset(c)){
        if(!this.licensed||!await new CatalogLicensedChapterReadiness(this.db,this.licensed.resolver).isChapterReady(String(c.id),surah,settings.availabilityMode==='complete_only'))continue;
      }
      suggestions.push({slug:c.slug,display_label_ar:c.display_label_ar,display_label_en:c.display_label_en});
    }
    throw new CatalogError('AUDIO_UNAVAILABLE',502,{recitation_id:recitationId,suggested_recitations:suggestions,failures});
  }
}

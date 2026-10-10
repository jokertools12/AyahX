import {type CatalogRow} from './catalogContracts';
import {hasVerifiedCatalogOffset} from './recitationAudioResolver';
export interface PublicationFacts {completeChapters:number;healthyCompleteChapters:number;coverageMismatches:number;links:number;healthyLinks:number;youtube:boolean;sameAudioConflict:boolean;licensedOffsetVerifiedCompleteChapters?:number}
const zero=(value:unknown)=>value===0||value===false||value==='0';
/** K8 requires healthy and complete in the same chapter, not two disjoint counts. */
export function catalogPublicationFacts(row:CatalogRow,chapters:readonly CatalogRow[],conflicts:readonly CatalogRow[],nowMs:number):PublicationFacts{
  if(!Number.isFinite(nowMs)||nowMs<0)throw new Error('PUBLICATION_FACTS_INVALID');
  const healthy=(c:CatalogRow)=>c.audio_status==='available'&&Number(c.checked_epoch_ms)>nowMs-24*3600000&&Number(c.checked_epoch_ms)<=nowMs;
  const complete=(c:CatalogRow)=>c.availability_state==='complete'&&zero(c.coverage_mismatch);
  const sameAudioConflict=conflicts.some(c=>{
    if(c.type!=='same_audio_conflict')return false;
    if(['recitation','recitations'].includes(String(c.subject_type))&&c.subject_id===row.id)return true;
    const evidence=typeof c.evidence==='string'?JSON.parse(c.evidence):c.evidence;
    if(!evidence||typeof evidence!=='object')return false;
    const proof=evidence as CatalogRow;
    // Review status alone does not establish a disproved content fingerprint.
    return Array.isArray(proof.recitations)&&proof.recitations.some(id=>id===row.id||id===row.slug);
  });
  return {completeChapters:chapters.filter(complete).length,healthyCompleteChapters:chapters.filter(c=>complete(c)&&healthy(c)).length,coverageMismatches:chapters.filter(c=>!zero(c.coverage_mismatch)).length,links:chapters.length,healthyLinks:chapters.filter(healthy).length,youtube:row.channel==='youtube'||row.provider==='youtube',sameAudioConflict};
}
/** Technical status only. Human voice/license/public visibility are never changed here. */
export function technicalPublicationDecision(row:CatalogRow,facts:PublicationFacts):{eligible:boolean;reasons:string[]}{
  for(const value of [facts.completeChapters,facts.healthyCompleteChapters,facts.coverageMismatches,facts.links,facts.healthyLinks,facts.licensedOffsetVerifiedCompleteChapters??0])if(!Number.isSafeInteger(value)||value<0)throw new Error('PUBLICATION_FACTS_INVALID');
  if(facts.healthyLinks>facts.links||facts.completeChapters>facts.links||facts.healthyCompleteChapters>Math.min(facts.completeChapters,facts.healthyLinks)||facts.coverageMismatches>facts.links||typeof facts.youtube!=='boolean'||typeof facts.sameAudioConflict!=='boolean')throw new Error('PUBLICATION_FACTS_INVALID');
  const reasons:string[]=[];
  if(row.riwayah_code!=='hafs_an_asim'||Number(row.canonical_text_available)!==1)reasons.push('HAFS_CANONICAL_REQUIRED');
  if(!hasVerifiedCatalogOffset(row))reasons.push('OFFSET_NOT_VERIFIED');
  if(row.audio_mode!=='surah_slice')reasons.push('SURAH_SLICE_REQUIRED');
  if(row.timing_quality!=='verified'||!['word','letter'].includes(String(row.timing_level)))reasons.push('WORD_TIMING_NOT_VERIFIED');
  if(facts.completeChapters<1)reasons.push('NO_COMPLETE_CHAPTER');
  if(facts.coverageMismatches>0)reasons.push('COVERAGE_MISMATCH');
  if(facts.healthyCompleteChapters<1)reasons.push('NO_HEALTHY_COMPLETE_CHAPTER');
  if(facts.youtube)reasons.push('YOUTUBE_SOURCE_PROHIBITED');
  if(facts.sameAudioConflict)reasons.push('SAME_AUDIO_CONFLICT');
  if(['hidden','deprecated'].includes(String(row.status)))reasons.push('ADMIN_STATUS_PROTECTED');
  return {eligible:reasons.length===0,reasons};
}
/** Preserve every existing human stamp and public field; only rule-v1 may add a new technical publication. */
export function technicalPublicationMutation(row:CatalogRow,eligible:boolean):{status:'published';published_by:'rule-v1';publication_clock:'UTC_TIMESTAMP(3)'}|null{
  if(!eligible||row.status==='published'||['hidden','deprecated'].includes(String(row.status)))return null;
  if(row.published_by&&row.published_by!=='rule-v1'||row.published_at&&!row.published_by)return null;
  return {status:'published',published_by:'rule-v1',publication_clock:'UTC_TIMESTAMP(3)'};
}
// MySQL requires a boolean top-level operator. Each nullable predicate compares IFNULL to 1,
// so missing evidence is FALSE rather than UNKNOWN (which CHECK would otherwise accept).
const every=(conditions:readonly string[]):string=>conditions.map(c=>`IFNULL((${c}),0)=1`).join(' AND ');
const v2=every(["verification_method='v2'","offset_check_score>=0.90",
  "JSON_UNQUOTE(JSON_EXTRACT(verification_details,'$.v2_acceptance.cause'))='codec_processing_only'",
  "JSON_UNQUOTE(JSON_EXTRACT(verification_details,'$.v2_acceptance.decision'))='accepted_for_data_pipeline_verification'",
  "JSON_TYPE(JSON_EXTRACT(verification_details,'$.v2_acceptance.sample_count'))='INTEGER'",
  "JSON_EXTRACT(verification_details,'$.v2_acceptance.sample_count')>=5",
  "JSON_EXTRACT(verification_details,'$.v2_acceptance.minimum_VAD_agreement') BETWEEN 0.90 AND 1",
  "JSON_EXTRACT(verification_details,'$.v2_acceptance.maximum_absolute_lag_ms') BETWEEN 0 AND 30",
  "JSON_EXTRACT(verification_details,'$.v2_acceptance.maximum_duration_difference_ms') BETWEEN 0 AND 30",
  "JSON_TYPE(JSON_EXTRACT(verification_details,'$.v2_acceptance.review_blockers'))='ARRAY'",
  "JSON_LENGTH(JSON_EXTRACT(verification_details,'$.v2_acceptance.review_blockers'))=0"]);
export const D4_OFFSET_CHECK=`IFNULL(offset_verified,0)=0 OR (${every(["verification_status='passed'","offset_check_score BETWEEN 0 AND 1",`(verification_method='v1' AND offset_check_score>=0.95) OR (${v2})`])})`;
export const D4_PUBLISH_CHECK=`status<>'published' OR (${every(["riwayah_code='hafs_an_asim'","canonical_text_available=1","audio_mode='surah_slice'","offset_verified=1","verification_status='passed'","timing_quality='verified'","timing_level IN ('word','letter')","verification_method IN ('v1','v2')"])})`;
export const PUBLICATION_CONSTRAINTS={chk_recitations_offset_gate_v1:D4_OFFSET_CHECK,chk_recitations_publish_gate_v1:D4_PUBLISH_CHECK} as const;
export function publicationConstraintSql(existing:readonly string[]):string[]{
  const added=Object.entries(PUBLICATION_CONSTRAINTS).filter(([name])=>!existing.includes(name)).map(([name,expr])=>`ADD CONSTRAINT ${name} CHECK (${expr})`);
  const removed=['chk_catalog_offset','chk_catalog_publish'].filter(n=>existing.includes(n)).map(n=>`DROP CHECK ${n}`);
  return added.length||removed.length?[`ALTER TABLE recitations ${[...removed,...added].join(', ')};`]:[];
}
/** Separate reviewed K1 operation, never part of additive migration004. */
export const D4_PUBLICATION_CONSTRAINT_SQL=publicationConstraintSql(['chk_catalog_offset','chk_catalog_publish'])[0];

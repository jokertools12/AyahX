import {type CatalogRow} from './catalogContracts';
import {hasVerifiedCatalogOffset} from './recitationAudioResolver';
export interface PublicationFacts {completeChapters:number;coverageMismatches:number;links:number;healthyLinks:number;youtube:boolean}
/** Technical status only. Human voice/license/public visibility are never changed here. */
export function technicalPublicationDecision(row:CatalogRow,facts:PublicationFacts):{eligible:boolean;reasons:string[]}{
  for(const value of [facts.completeChapters,facts.coverageMismatches,facts.links,facts.healthyLinks])if(!Number.isSafeInteger(value)||value<0)throw new Error('PUBLICATION_FACTS_INVALID');
  if(facts.healthyLinks>facts.links)throw new Error('PUBLICATION_FACTS_INVALID');
  const reasons:string[]=[];
  if(row.riwayah_code!=='hafs_an_asim'||Number(row.canonical_text_available)!==1)reasons.push('HAFS_CANONICAL_REQUIRED');
  if(!hasVerifiedCatalogOffset(row))reasons.push('OFFSET_NOT_VERIFIED');
  if(row.audio_mode!=='surah_slice')reasons.push('SURAH_SLICE_REQUIRED');
  if(row.timing_quality!=='verified'||!['word','letter'].includes(String(row.timing_level)))reasons.push('WORD_TIMING_NOT_VERIFIED');
  if(facts.completeChapters<1)reasons.push('NO_COMPLETE_CHAPTER');
  if(facts.coverageMismatches>0)reasons.push('COVERAGE_MISMATCH');
  if(!facts.links||facts.healthyLinks!==facts.links)reasons.push('AUDIO_LINKS_NOT_ALL_HEALTHY');
  if(facts.youtube)reasons.push('YOUTUBE_SOURCE_PROHIBITED');
  if(['hidden','deprecated'].includes(String(row.status)))reasons.push('ADMIN_STATUS_PROTECTED');
  return {eligible:reasons.length===0,reasons};
}
// D4 policy supersedes the old basmala gate. It remains unverified and is never fabricated.
// COALESCE makes absent JSON evidence reject rather than UNKNOWN (accepted by MySQL CHECK).
export const D4_OFFSET_CHECK="COALESCE(offset_verified=FALSE OR (verification_status='passed' AND offset_check_score BETWEEN 0 AND 1 AND ((verification_method='v1' AND offset_check_score>=0.95) OR (verification_method='v2' AND offset_check_score>=0.90 AND JSON_UNQUOTE(JSON_EXTRACT(verification_details,'$.v2_acceptance.cause'))='codec_processing_only' AND JSON_UNQUOTE(JSON_EXTRACT(verification_details,'$.v2_acceptance.decision'))='accepted_for_data_pipeline_verification' AND JSON_TYPE(JSON_EXTRACT(verification_details,'$.v2_acceptance.sample_count'))='INTEGER' AND JSON_EXTRACT(verification_details,'$.v2_acceptance.sample_count')>=5 AND JSON_EXTRACT(verification_details,'$.v2_acceptance.minimum_VAD_agreement') BETWEEN 0.90 AND 1 AND JSON_EXTRACT(verification_details,'$.v2_acceptance.maximum_absolute_lag_ms') BETWEEN 0 AND 30 AND JSON_EXTRACT(verification_details,'$.v2_acceptance.maximum_duration_difference_ms') BETWEEN 0 AND 30 AND JSON_TYPE(JSON_EXTRACT(verification_details,'$.v2_acceptance.review_blockers'))='ARRAY' AND JSON_LENGTH(JSON_EXTRACT(verification_details,'$.v2_acceptance.review_blockers'))=0))),FALSE)";
export const D4_PUBLISH_CHECK="COALESCE(status<>'published' OR (riwayah_code='hafs_an_asim' AND canonical_text_available=TRUE AND audio_mode='surah_slice' AND offset_verified=TRUE AND verification_status='passed' AND timing_quality='verified' AND timing_level IN ('word','letter') AND verification_method IN ('v1','v2')),FALSE)";
/** Separate reviewed T6 operation, never part of additive migration004. */
export const D4_PUBLICATION_CONSTRAINT_SQL=`ALTER TABLE recitations DROP CHECK chk_catalog_offset, DROP CHECK chk_catalog_publish, ADD CONSTRAINT chk_catalog_offset CHECK (${D4_OFFSET_CHECK}), ADD CONSTRAINT chk_catalog_publish CHECK (${D4_PUBLISH_CHECK});`;

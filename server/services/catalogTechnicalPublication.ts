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

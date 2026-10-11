import {type CatalogRow} from './catalogContracts';
import {hasVerifiedCatalogOffset} from './recitationAudioResolver';
import {validLicensedPublicationDetails} from './catalogLicensedReadiness';
export interface PublicationFacts {completeChapters:number;healthyCompleteChapters:number;coverageMismatches:number;links:number;healthyLinks:number;youtube:boolean;sameAudioConflict:boolean;licensedOffsetVerifiedCompleteChapters?:number;licensedPublicationDetails?:unknown;asOfMs?:number}
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
  const licensed=!!facts.licensedPublicationDetails&&validLicensedPublicationDetails(facts.licensedPublicationDetails,String(row.id),facts.asOfMs??Date.now());
  if(row.riwayah_code!=='hafs_an_asim'||Number(row.canonical_text_available)!==1)reasons.push('HAFS_CANONICAL_REQUIRED');
  if(!licensed&&!hasVerifiedCatalogOffset(row))reasons.push('OFFSET_NOT_VERIFIED');
  if(row.audio_mode!=='surah_slice')reasons.push('SURAH_SLICE_REQUIRED');
  if(row.timing_quality!=='verified'||!['word','letter'].includes(String(row.timing_level)))reasons.push('WORD_TIMING_NOT_VERIFIED');
  if(facts.completeChapters<1)reasons.push('NO_COMPLETE_CHAPTER');
  if(facts.coverageMismatches>0)reasons.push('COVERAGE_MISMATCH');
  if(!licensed&&facts.healthyCompleteChapters<1)reasons.push('NO_HEALTHY_COMPLETE_CHAPTER');
  if(facts.youtube&&!licensed)reasons.push('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE');
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
const chapterProofSchema={type:'object',required:['surah','source_id','source_sha256','rights_ref','offset_evidence_sha256','method','minimum_score','maximum_absolute_lag_ms','maximum_duration_difference_ms','sample_count','distinct_surahs','distinct_chapter_lengths','canonical_complete','expected_ayahs','ready_ayahs','coverage_mismatch','duration_ms','last_word_ms','source_chapter_offset_ms','adapter','v2_human_review_id'],properties:{surah:{type:'integer',minimum:1,maximum:114},source_id:{type:'string',minLength:1},source_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},rights_ref:{type:'string',minLength:1},offset_evidence_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},method:{enum:['v1','v2']},minimum_score:{type:'number',minimum:.9,maximum:1},maximum_absolute_lag_ms:{type:'number',minimum:0,maximum:30},maximum_duration_difference_ms:{type:'number',minimum:0,maximum:30},sample_count:{type:'integer',minimum:5},distinct_surahs:{type:'integer',minimum:3},distinct_chapter_lengths:{type:'integer',minimum:3},canonical_complete:{enum:[true]},expected_ayahs:{type:'integer',minimum:1},ready_ayahs:{type:'integer',minimum:1},coverage_mismatch:{enum:[0]},duration_ms:{type:'number',exclusiveMinimum:true,minimum:0},last_word_ms:{type:'integer',minimum:1},source_chapter_offset_ms:{type:'integer',minimum:0},adapter:{enum:['r2','url_reference']},v2_human_review_id:{type:['string','null']}},anyOf:[{properties:{method:{enum:['v1']},minimum_score:{minimum:.95}}},{properties:{method:{enum:['v2']},v2_human_review_id:{type:'string',minLength:1}}}]};
export const LICENSED_PUBLICATION_JSON_SCHEMA=JSON.stringify({type:'object',required:['schema_version','actor','recitation_id','checked_at_epoch_ms','expires_at_epoch_ms','complete_chapter_count','chapters'],properties:{schema_version:{enum:[1]},actor:{enum:['scoped-licensed-verifier-v1']},recitation_id:{type:'string',minLength:1},checked_at_epoch_ms:{type:'integer',minimum:0},expires_at_epoch_ms:{type:'integer',minimum:0},complete_chapter_count:{type:'integer',minimum:1,maximum:1},chapters:{type:'array',minItems:1,maxItems:1,uniqueItems:true,items:chapterProofSchema}}});
// CHECK cannot join sources or use NOW(). Authoritative live rights/source/expiry rechecks remain mandatory at every public access.
export const D4_LICENSED_PUBLISH_CHECK=every([`JSON_SCHEMA_VALID('${LICENSED_PUBLICATION_JSON_SCHEMA.replace(/'/gu,"''")}',licensed_publication_details)=1`,"JSON_UNQUOTE(JSON_EXTRACT(licensed_publication_details,'$.recitation_id'))=id","JSON_EXTRACT(licensed_publication_details,'$.complete_chapter_count')=JSON_LENGTH(JSON_EXTRACT(licensed_publication_details,'$.chapters'))","JSON_EXTRACT(licensed_publication_details,'$.expires_at_epoch_ms')-JSON_EXTRACT(licensed_publication_details,'$.checked_at_epoch_ms')=300000","JSON_EXTRACT(licensed_publication_details,'$.chapters[0].ready_ayahs')=JSON_EXTRACT(licensed_publication_details,'$.chapters[0].expected_ayahs')","JSON_EXTRACT(licensed_publication_details,'$.chapters[0].last_word_ms')<=JSON_EXTRACT(licensed_publication_details,'$.chapters[0].duration_ms')+30"]);
const catalogPublish=every(["offset_verified=1","verification_status='passed'","verification_method IN ('v1','v2')"]);
export const D4_CATALOG_ONLY_PUBLISH_CHECK=`status<>'published' OR (${every(["riwayah_code='hafs_an_asim'","canonical_text_available=1","audio_mode='surah_slice'","offset_verified=1","verification_status='passed'","timing_quality='verified'","timing_level IN ('word','letter')","verification_method IN ('v1','v2')"])})`;
export const D4_PUBLISH_CHECK=`status<>'published' OR (${every(["riwayah_code='hafs_an_asim'","canonical_text_available=1","audio_mode='surah_slice'","timing_quality='verified'","timing_level IN ('word','letter')",`(${catalogPublish}) OR (${D4_LICENSED_PUBLISH_CHECK})`])})`;
export const D4_CATALOG_ONLY_SLICE_CHECK="audio_mode <> 'surah_slice' OR (offset_verified=TRUE AND verification_status='passed')";
/** A single licensed chapter never promotes the catalog-wide offset_verified field. */
export const D4_SLICE_CHECK=`IFNULL(audio_mode<>'surah_slice',0)=1 OR (IFNULL(audio_mode='surah_slice',0)=1 AND ((${catalogPublish}) OR (${every(["riwayah_code='hafs_an_asim'","canonical_text_available=1","timing_quality='verified'","timing_level IN ('word','letter')",D4_LICENSED_PUBLISH_CHECK])})))`;
export const PUBLICATION_CONSTRAINTS={chk_recitations_offset_gate_v1:D4_OFFSET_CHECK,chk_recitations_publish_gate_v1:D4_PUBLISH_CHECK,chk_recitations_slice_gate_v1:D4_SLICE_CHECK} as const;
/** Exact canonical MySQL text comparison, ignoring whitespace only outside quoted literals. */
const normalizeCheck=(expression:string):string=>{let quote='',out='';for(let i=0;i<expression.length;i++){const c=expression[i];if(quote){out+=c;if(c==='\\'&&i+1<expression.length)out+=expression[++i];else if(c===quote){if(expression[i+1]===quote)out+=expression[++i];else quote='';}}else if(c==="'"||c==='"'||c==='`'){quote=c;out+=c;}else if(!/\s/u.test(c))out+=c;}return out;};
/** The caller must read CHECK_CLAUSE. Existing names alone cannot certify a changed expression. */
export function publicationConstraintSql(existing:readonly string[],clauses:Readonly<Record<string,string>>={},desiredCanonicalClauses:Readonly<Record<string,string>>={},legacyCanonicalSliceClauses:readonly string[]=[]):string[]{
  const changed=Object.entries(PUBLICATION_CONSTRAINTS).filter(([name,expr])=>existing.includes(name)&&clauses[name]!==undefined&&normalizeCheck(clauses[name])!==normalizeCheck(desiredCanonicalClauses[name]??expr));
  const added=Object.entries(PUBLICATION_CONSTRAINTS).filter(([name])=>!existing.includes(name)||changed.some(([n])=>n===name)).map(([name,expr])=>`ADD CONSTRAINT ${name} CHECK (${expr})`);
  const legacySliceNames=existing.filter(name=>/^(?:chk_catalog_slice|recitations_chk_\d+)$/u.test(name)&&clauses[name]!==undefined&&legacyCanonicalSliceClauses.some(c=>clauses[name]===c));
  if(existing.includes('chk_catalog_slice')&&!legacySliceNames.includes('chk_catalog_slice'))throw new Error('LEGACY_SLICE_CANONICAL_EVIDENCE_REQUIRED');
  const removed=['chk_catalog_offset','chk_catalog_publish',...legacySliceNames].filter(n=>existing.includes(n)).map(n=>`DROP CHECK ${n}`);
  return added.length||removed.length?[`ALTER TABLE recitations ${[...removed,...changed.map(([name])=>`DROP CHECK ${name}`),...added].join(', ')};`]:[];
}
/** Separate reviewed K1 operation, never part of additive migration004. */
export const D4_PUBLICATION_CONSTRAINT_SQL=publicationConstraintSql(['chk_catalog_offset','chk_catalog_publish'])[0];

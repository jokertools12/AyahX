import { CatalogError,type CatalogRow } from './catalogContracts';
import { hasVerifiedCatalogOffset } from './recitationAudioResolver';
import { canonicalAuditJson } from './catalogAudit';
export interface AcceptedOffsetProof {raw_report_sha256:string;independent_review_sha256:string;accepted:Record<string,CatalogRow>}
/** Only imports a previously accepted decision. Does not measure or relax v1. */
export function catalogOffsetPatch(row:CatalogRow,readyRows:number,decisions:AcceptedOffsetProof):CatalogRow{
  if(!Number.isSafeInteger(readyRows)||readyRows<0)throw new CatalogError('TIMING_SUMMARY_INVALID',409);
  const patch:CatalogRow={};let candidate={...row};
  const accepted=decisions.accepted[String(row.slug)];
  if(accepted){
    if(!/^[a-f0-9]{64}$/u.test(decisions.raw_report_sha256)||!/^[a-f0-9]{64}$/u.test(decisions.independent_review_sha256))throw new CatalogError('OFFSET_DECISION_EVIDENCE_INVALID',409);
    const previous=typeof row.verification_details==='string'?JSON.parse(row.verification_details):row.verification_details;
    if(!previous||typeof previous!=='object'||Array.isArray(previous))throw new CatalogError('OFFSET_DECISION_EVIDENCE_INVALID',409);
    const details=previous as CatalogRow;
    const stored=details.v2_acceptance as CatalogRow|undefined;
    if(stored){
      if(canonicalAuditJson(stored)!==canonicalAuditJson({...accepted,raw_report_sha256:decisions.raw_report_sha256,independent_review_sha256:decisions.independent_review_sha256}))throw new CatalogError('OFFSET_ACCEPTED_DECISION_CHANGED',409);
    }else if(row.verification_status!=='failed'||Number(row.offset_verified)!==0)throw new CatalogError('OFFSET_V1_ORIGINAL_REQUIRED',409);
    const next={...details,v1_original:details.v1_original??{verification_status:row.verification_status,offset_verified:row.offset_verified,offset_check_score:row.offset_check_score,verification_details:previous},
      v2_acceptance:{...accepted,raw_report_sha256:decisions.raw_report_sha256,independent_review_sha256:decisions.independent_review_sha256}};
    Object.assign(patch,{verification_method:'v2',verification_status:'passed',offset_verified:true,offset_check_score:accepted.offset_check_score,verification_details:next,audio_mode:'surah_slice'});
    candidate={...row,...patch};if(!hasVerifiedCatalogOffset(candidate))throw new CatalogError('OFFSET_ACCEPTED_DECISION_INVALID',409);
  }else if(Number(row.offset_verified)===1&&row.verification_status==='passed'){
    if(row.verification_method!==null&&row.verification_method!==undefined&&row.verification_method!=='v1')throw new CatalogError('OFFSET_METHOD_CONFLICT',409);
    patch.verification_method='v1';candidate={...row,...patch};if(!hasVerifiedCatalogOffset(candidate))throw new CatalogError('OFFSET_V1_INVALID',409);
  }
  patch.timing_level=Number(row.canonical_text_available)===1&&readyRows>0?'word':readyRows>0?'ayah':'none';
  patch.timing_quality=readyRows>0?(Number(row.canonical_text_available)===1&&hasVerifiedCatalogOffset(candidate)?'verified':'aligned'):'needs_review';
  // Keep the existing technical/human/basmala states. T6 alone publishes.
  return patch;
}

import type {CatalogRow} from './catalogContracts';
import {canonicalAuditJson} from './catalogAudit';
import {validLicensedPublicationDetails,type LicensedPublicationDetails} from './catalogLicensedReadiness';
import {technicalPublicationDecision,technicalPublicationMutation,type PublicationFacts} from './catalogTechnicalPublication';
/** Caller supplies a server-generated, live-bound chapter anchor, never client/provider advisory evidence. */
export function planScopedTechnicalPublication(row:CatalogRow,facts:PublicationFacts,details:LicensedPublicationDetails|null,nowMs:number):{patch:CatalogRow;decision:ReturnType<typeof technicalPublicationDecision>;facts:PublicationFacts}{
  const valid=details!==null&&validLicensedPublicationDetails(details,String(row.id),nowMs);
  const trustedFacts={...facts,asOfMs:nowMs,...(valid?{licensedPublicationDetails:details}:{} )};
  const staged=valid?{...row,audio_mode:'surah_slice',timing_quality:'verified'}:row;
  const decision=technicalPublicationDecision(staged,trustedFacts),publication=technicalPublicationMutation(row,decision.eligible),patch:CatalogRow={};
  if(!decision.eligible)return {patch,decision,facts:trustedFacts};
  if(valid&&!['hidden','deprecated'].includes(String(row.status))){
    if(row.audio_mode!==staged.audio_mode)patch.audio_mode=staged.audio_mode;if(row.timing_quality!==staged.timing_quality)patch.timing_quality=staged.timing_quality;
    const old=typeof row.licensed_publication_details==='string'?JSON.parse(row.licensed_publication_details):row.licensed_publication_details;
    const sameAnchor=validLicensedPublicationDetails(old,String(row.id),nowMs)&&canonicalAuditJson(old.chapters)===canonicalAuditJson(details.chapters);
    if(!sameAnchor)patch.licensed_publication_details=details;
  }
  if(publication)Object.assign(patch,{status:publication.status,published_by:publication.published_by,published_at:{sql:'UTC_TIMESTAMP(3)'}});
  return {patch,decision,facts:trustedFacts};
}

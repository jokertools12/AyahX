import {canonicalAuditJson} from './catalogAudit';
import type {CatalogRow} from './catalogContracts';
import {jsonReviewValue,validateReviewEvidence} from './humanReviewService';
export interface VoiceEvidenceRow extends CatalogRow {id:string;slug:string;reciter_id:string;source_reciter_id:string|null;voice_identity_status:string|null;voice_auto_evidence:unknown;voice_auto_verified_at:unknown;voice_confirmed_by:unknown}
export interface VoiceEvidencePlan {id:string;slug:string;evidence:CatalogRow;patch:CatalogRow;human_state_preserved:boolean;advisory_status:'auto_verified'|'unverified'}
const object=(value:unknown):value is CatalogRow=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Only the objectively passing report can grant provisional status; never a human approval. */
function objectivePass(result:CatalogRow,artifact:CatalogRow,siblings:number):boolean{
  const check=(key:string)=>object(result[key])&&result[key].passed===true;
  if(!check('V1')||!check('V2')||!Array.isArray(result.decision_reasons)||result.decision_reasons.length!==0)return false;
  if(object(result.V1)&&result.V1.cross_reader_content_conflict===true)return false;
  const summary=artifact.speaker_measurement_summary;
  if(object(summary)&&summary.model_loaded===true){
    if(!object(summary.calibration)||summary.calibration.accepted!==true||!check('V3'))return false;
    if(!check('V4')&&!(siblings===1&&object(result.V4)&&result.V4.status==='not_applicable'))return false;
  }
  return true;
}
export function planCatalogVoiceEvidence(rows:readonly VoiceEvidenceRow[],artifact:unknown,artifactSha:string):VoiceEvidencePlan[]{
  if(!/^[a-f0-9]{64}$/u.test(artifactSha)||!object(artifact)||artifact.schema_version!==1||artifact.actor!=='auto-verifier-v1'||!object(artifact.results)||typeof artifact.checked_at!=='string'||!Number.isFinite(Date.parse(artifact.checked_at)))throw new Error('VOICE_ARTIFACT_INVALID');
  if(new Set(rows.map(r=>r.slug)).size!==rows.length||JSON.stringify(Object.keys(artifact.results).sort())!==JSON.stringify(rows.map(r=>r.slug).sort()))throw new Error('VOICE_EVIDENCE_COVERAGE_MISMATCH');
  const results=artifact.results,checkedAt=artifact.checked_at;
  return rows.map(row=>{
    const result=results[row.slug];if(!object(result)||result.slug!==row.slug||(result.reciter_id??null)!==row.source_reciter_id||!['unverified','auto_verified'].includes(String(result.voice_identity_status))||result.actor!=='auto-verifier-v1'||result.advisory_only!==true||result.human_confirmation_changed!==false||result.license_changed!==false||result.publication_changed!==false)throw new Error('VOICE_RESULT_INVALID');
    const siblings=rows.filter(r=>r.reciter_id===row.reciter_id).length;
    const passing=objectivePass(result,artifact,siblings);
    if(result.voice_identity_status==='auto_verified'&&!passing)throw new Error('VOICE_AUTO_VERIFICATION_UNEARNED');
    const summary=object(artifact.speaker_measurement_summary)?artifact.speaker_measurement_summary:null;
    const evidence:CatalogRow={actor:artifact.actor,artifact:'docs/data/voice-auto-verification.json',artifact_sha256:artifactSha,checked_at:artifact.checked_at,advisory_only:true,result,shared_provenance:{schema_version:artifact.schema_version,input_sha256:artifact.input_sha256??null,speaker_model:summary?.model??null,speaker_model_loaded:summary?.model_loaded??null,speaker_calibration:summary?.calibration??null,actual_aligner_readiness:artifact.actual_aligner_readiness??null}};
    validateReviewEvidence(evidence);const patch:CatalogRow={};if(canonicalAuditJson(jsonReviewValue(row.voice_auto_evidence)??null)!==canonicalAuditJson(evidence))patch.voice_auto_evidence=evidence;
    const human=['confirmed','mismatch'].includes(String(row.voice_identity_status))||!!row.voice_confirmed_by;
    if(!human&&result.voice_identity_status==='auto_verified'){
      if(row.voice_identity_status!=='auto_verified')patch.voice_identity_status='auto_verified';
      if(row.voice_identity_status!=='auto_verified'||!row.voice_auto_verified_at)patch.voice_auto_verified_at=new Date(checkedAt).toISOString().replace('T',' ').replace('Z','');
    }else if(!human&&row.voice_identity_status==='auto_verified'&&result.voice_identity_status==='unverified'){
      patch.voice_identity_status='unverified';patch.voice_auto_verified_at=null;
    }
    return {id:row.id,slug:row.slug,evidence,patch,human_state_preserved:human,advisory_status:result.voice_identity_status as VoiceEvidencePlan['advisory_status']};
  });
}

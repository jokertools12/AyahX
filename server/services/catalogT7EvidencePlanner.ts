import {canonicalAuditJson} from './catalogAudit';
import type {CatalogRow} from './catalogContracts';
import {jsonReviewValue,validateReviewEvidence} from './humanReviewService';

const object=(value:unknown):value is CatalogRow=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export interface T7EvidencePlan {id:string;slug:string;patch:CatalogRow;v1_passed:boolean;result_status:string}
/** New fixed samples supplement retained evidence. Numeric v2 candidates never grant approval. */
export function planCatalogT7Evidence(rows:readonly CatalogRow[],artifact:unknown,artifactSha:string):T7EvidencePlan[]{
  if(!sha(artifactSha)||!object(artifact)||typeof artifact.real_measurements_complete!=='boolean'||artifact.database_writes!==0||artifact.publication_changed!==false||!object(artifact.results)||!object(artifact.bindings)||!sha(artifact.bindings.selection_sha256)||!sha(artifact.bindings.manifest_file_sha256)||!sha(artifact.checkpoint_file_sha256)||!finite(Date.parse(String(artifact.checked_at))))throw new Error('T7_ARTIFACT_INVALID');
  const results=artifact.results;
  // A terminal source_unavailable result preserves missing measurements honestly.
  // It never grants offset; unfinished/pending results remain invalid below.
  if(artifact.real_measurements_complete===false&&!Object.values(results).some(r=>object(r)&&r.verification_status==='source_unavailable'))throw new Error('T7_ARTIFACT_INVALID');
  if(Object.keys(results).some(slug=>!rows.some(row=>row.slug===slug)))throw new Error('T7_RECITATION_MISSING');
  return Object.entries(results).map(([slug,result])=>{
    if(!object(result)||!['passed','failed','source_unavailable'].includes(String(result.verification_status))||result.publication_changed!==false||result.database_offset_verified_changed!==false||!Array.isArray(result.expected_sample_ids)||!Array.isArray(result.samples))throw new Error('T7_RESULT_INVALID');
    const expected=result.expected_sample_ids as unknown[],samples=result.samples as CatalogRow[];
    const key=(id:unknown)=>JSON.stringify(id);
    if(expected.length<15||new Set(expected.map(key)).size!==expected.length||expected.some(id=>!Array.isArray(id)||id.length!==2||id.some(v=>!Number.isSafeInteger(v)||v<1)))throw new Error('T7_SELECTION_INVALID');
    const groups=new Map<number,number>();for(const id of expected as number[][])groups.set(id[0],(groups.get(id[0])??0)+1);
    if(groups.size<3||[...groups.values()].some(count=>count<5))throw new Error('T7_SELECTION_INVALID');
    if(new Set(samples.map(s=>key([s.surah,s.ayah]))).size!==samples.length||samples.some(s=>!expected.some(id=>key(id)===key([s.surah,s.ayah]))))throw new Error('T7_SAMPLE_SELECTION_CHANGED');
    const rawPass=(sample:CatalogRow)=>{
      const inside=sample.interior_v1,full=sample.full_v1_diagnostic;
      if(!object(inside)||!object(full)||inside.measured!==true||inside.trim_each_side_ms!==300||sample.full_source_window_complete!==true||!sha(sample.catalog_source_sha256)||!sha(sample.hf_clip_sha256))return false;
      // The locked T7 NCC gate uses the 300ms interior. Full NCC remains a boundary diagnostic.
      return finite(inside.score)&&inside.score>=.95&&inside.score<=1&&finite(full.score)&&full.score>=-1&&full.score<=1&&finite(inside.best_lag_ms)&&Math.abs(inside.best_lag_ms)<=30&&finite(full.best_lag_ms)&&Math.abs(full.best_lag_ms)<=30&&finite(sample.duration_difference_ms)&&Math.abs(sample.duration_difference_ms)<=30;
    };
    const v1=samples.length===expected.length&&samples.every(rawPass);
    if(result.verification_status==='passed'&&(!v1||result.verification_method_candidate!=='v1'||result.v1_all_samples_passed!==true))throw new Error('T7_PASS_UNEARNED');
    if(result.verification_status!=='passed'&&v1)throw new Error('T7_RESULT_METRICS_CONFLICT');
    const row=rows.find(r=>r.slug===slug)!;
    // Published/human states are never silently revoked by a metadata import.
    const old=jsonReviewValue(row.verification_details)??{};if(!object(old))throw new Error('T7_STORED_DETAILS_INVALID');
    const proof:CatalogRow={artifact:'docs/data/d4-t7-execution-results.json',artifact_sha256:artifactSha,checked_at:artifact.checked_at,bindings:artifact.bindings,checkpoint_file_sha256:artifact.checkpoint_file_sha256,checkpoint_self_sha256:artifact.checkpoint_self_sha256,result,human_v2_acceptance_required:result.verification_method_candidate==='v2',v1_raw_metrics_revalidated:v1};
    validateReviewEvidence(proof);
    const details={...old,t7:proof};const desired:CatalogRow={verification_details:details};
    if(v1){desired.offset_verified=1;desired.offset_check_score=Math.min(...samples.map(s=>(s.interior_v1 as CatalogRow).score as number));desired.verification_status='passed';desired.verification_method='v1';desired.audio_mode='surah_slice';if(Number(row.canonical_text_available)===1&&['word','letter'].includes(String(row.timing_level)))desired.timing_quality='verified';}
    else {desired.offset_verified=0;desired.verification_status=result.verification_status;desired.verification_method=null;desired.audio_mode='unverified_source';desired.status='needs_review';}
    const patch:CatalogRow={};for(const [name,value]of Object.entries(desired))if(name==='verification_details'?canonicalAuditJson(old)!==canonicalAuditJson(value):row[name]!==value)patch[name]=value;
    if(row.status==='published'&&Object.keys(patch).length)throw new Error('T7_PUBLISHED_RECITATION_REQUIRES_REVIEW');
    return {id:String(row.id),slug,patch,v1_passed:v1,result_status:String(result.verification_status)};
  });
}

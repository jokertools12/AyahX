import {createHash} from 'node:crypto';
import {toRenderTimeline,type SourceAyahTiming} from '../../shared/timing/toRenderTimeline';
import {CatalogError,type CatalogDatabase,type CatalogRow} from './catalogContracts';
import {canonicalAuditJson} from './catalogAudit';
import {assertLicensedOffsetEvidence} from './licensedAudioVerification';
import type {LicensedAudioPlan,LicensedSourceResolver} from './licensedSourceResolver';
export const LICENSED_SNAPSHOT_ACTOR='scoped-licensed-verifier-v1';
export const LICENSED_SNAPSHOT_TTL_MS=5*60*1000;
export interface LicensedChapterProof {surah:number;source_id:string;source_sha256:string;rights_ref:string;offset_evidence_sha256:string;method:'v1'|'v2';minimum_score:number;maximum_absolute_lag_ms:number;maximum_duration_difference_ms:number;sample_count:number;distinct_surahs:number;distinct_chapter_lengths:number;canonical_complete:boolean;expected_ayahs:number;ready_ayahs:number;coverage_mismatch:number;duration_ms:number;last_word_ms:number;source_chapter_offset_ms:number;adapter:'r2'|'url_reference';v2_human_review_id:string|null;source_binding_sha256?:string;timing_binding_sha256?:string}
export interface LicensedPublicationDetails {schema_version:1;actor:typeof LICENSED_SNAPSHOT_ACTOR;recitation_id:string;checked_at_epoch_ms:number;expires_at_epoch_ms:number;complete_chapter_count:number;chapters:LicensedChapterProof[]}
export interface LicensedChapterGate {isChapterReady(recitationId:string,surah:number,completeOnly?:boolean):Promise<boolean>}
const json=(v:unknown):unknown=>typeof v==='string'?JSON.parse(v):v;
const sha=(v:unknown)=>createHash('sha256').update(canonicalAuditJson(v)).digest('hex');
/** Pure snapshot validation. Never turns an advisory cache into a runtime source capability. */
export function validLicensedPublicationDetails(value:unknown,recitationId:string,nowMs:number):value is LicensedPublicationDetails{
  let raw:unknown;try{raw=json(value);}catch{return false;}
  if(!raw||typeof raw!=='object')return false;const s=raw as LicensedPublicationDetails;
  if(s.schema_version!==1||s.actor!==LICENSED_SNAPSHOT_ACTOR||s.recitation_id!==recitationId||!Number.isSafeInteger(s.checked_at_epoch_ms)||s.checked_at_epoch_ms>nowMs||!Number.isSafeInteger(s.expires_at_epoch_ms)||s.expires_at_epoch_ms<=nowMs||s.expires_at_epoch_ms-s.checked_at_epoch_ms!==LICENSED_SNAPSHOT_TTL_MS||!Array.isArray(s.chapters)||s.complete_chapter_count!==1||s.chapters.length!==1)return false;
  return s.chapters.every(c=>Number.isSafeInteger(c.surah)&&c.surah>=1&&c.surah<=114&&!!c.source_id&&!!c.rights_ref&&/^[a-f0-9]{64}$/u.test(c.source_sha256)&&/^[a-f0-9]{64}$/u.test(c.offset_evidence_sha256)&&['r2','url_reference'].includes(c.adapter)&&['v1','v2'].includes(c.method)&&Number.isFinite(c.minimum_score)&&c.minimum_score>=(c.method==='v1'?.95:.9)&&c.minimum_score<=1&&Number.isFinite(c.maximum_absolute_lag_ms)&&c.maximum_absolute_lag_ms>=0&&c.maximum_absolute_lag_ms<=30&&Number.isFinite(c.maximum_duration_difference_ms)&&c.maximum_duration_difference_ms>=0&&c.maximum_duration_difference_ms<=30&&Number.isSafeInteger(c.sample_count)&&c.sample_count>=5&&Number.isSafeInteger(c.distinct_surahs)&&c.distinct_surahs>=3&&Number.isSafeInteger(c.distinct_chapter_lengths)&&c.distinct_chapter_lengths>=3&&c.canonical_complete===true&&Number.isSafeInteger(c.expected_ayahs)&&c.expected_ayahs>0&&c.ready_ayahs===c.expected_ayahs&&c.coverage_mismatch===0&&Number.isFinite(c.duration_ms)&&c.duration_ms>0&&Number.isSafeInteger(c.last_word_ms)&&c.last_word_ms>0&&c.last_word_ms<=c.duration_ms+30&&Number.isSafeInteger(c.source_chapter_offset_ms)&&c.source_chapter_offset_ms>=0&&(c.method!=='v2'||!!c.v2_human_review_id));
}
export function createLicensedPublicationDetails(recitationId:string,chapters:readonly LicensedChapterProof[],nowMs:number):LicensedPublicationDetails|null{
  // A publication anchor attests exactly one healthy complete chapter. It never claims unverified chapters.
  const complete=chapters.filter(c=>c.canonical_complete).sort((a,b)=>a.surah-b.surah).slice(0,1);if(!complete.length)return null;
  const details:LicensedPublicationDetails={schema_version:1,actor:LICENSED_SNAPSHOT_ACTOR,recitation_id:recitationId,checked_at_epoch_ms:nowMs,expires_at_epoch_ms:nowMs+LICENSED_SNAPSHOT_TTL_MS,complete_chapter_count:complete.length,chapters:complete};
  if(!validLicensedPublicationDetails(details,recitationId,nowMs))throw new CatalogError('LICENSED_PUBLICATION_PROOF_INVALID',409);return details;
}
export const LICENSED_CHAPTER_FIELDS=['surah','availability_state','coverage_mismatch','expected_ayahs'] as const;
export const LICENSED_TIMING_VALUE_FIELDS=['ayah','coordinate','source','source_offset_ms','words','review_status','review_reasons','coverage_words','expected_words','missing_words'] as const;
export const LICENSED_TIMING_FIELDS=[...LICENSED_TIMING_VALUE_FIELDS,'timing_binding_sha256'] as const;
export const LICENSED_TIMING_BINDING_EXPRESSION=`SHA2(CAST(JSON_ARRAYAGG(JSON_OBJECT(${LICENSED_TIMING_VALUE_FIELDS.flatMap(f=>["'"+f+"'",f]).join(',')})) OVER (ORDER BY ayah ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS CHAR),256)`;
/** No permanent collector or permission to approve. Every call rechecks source/rights/current bytes. */
export class CatalogLicensedChapterReadiness implements LicensedChapterGate {
  constructor(private readonly db:CatalogDatabase,private readonly resolver:LicensedSourceResolver){}
  async isChapterReady(id:string,surah:number,completeOnly=true):Promise<boolean>{return (await this.assess(id,surah,completeOnly))!==null;}
  async assess(id:string,surah:number,completeOnly=true):Promise<LicensedChapterProof|null>{
    const [chapter]=await this.db.read('SELECT c.surah,c.availability_state,c.coverage_mismatch,s.ayah_count expected_ayahs FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id=? AND c.surah=?',[id,surah]);
    if(!chapter||Number(chapter.coverage_mismatch)!==0||completeOnly&&chapter.availability_state!=='complete')return null;
    const plan=await this.resolver.resolveLicensedSource(id,surah);if(!plan)return null;
    const rows=await this.db.read(`SELECT ${LICENSED_TIMING_VALUE_FIELDS.join(',')},${LICENSED_TIMING_BINDING_EXPRESSION} timing_binding_sha256 FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah`,[id,surah]);
    const ready=rows.filter(r=>r.review_status==='ready');if(!ready.length||completeOnly&&ready.length!==Number(chapter.expected_ayahs))return null;
    if(ready.some((r,i)=>completeOnly&&Number(r.ayah)!==i+1||Number(r.coverage_words)!==Number(r.expected_words)||!Array.isArray(json(r.review_reasons))||(json(r.review_reasons) as unknown[]).length!==0||!Array.isArray(json(r.missing_words))||(json(r.missing_words) as unknown[]).length!==0))return null;
    const timings=ready.map(r=>({ayah:Number(r.ayah),coordinate:r.coordinate,source:r.source,source_offset_ms:r.source_offset_ms===null?null:Number(r.source_offset_ms),words:json(r.words)}) as SourceAyahTiming);
    const proof=scopedLicensedChapterProof(plan,timings,Number(chapter.expected_ayahs),chapter.availability_state==='complete'&&ready.length===Number(chapter.expected_ayahs));if(proof&&typeof rows[0].timing_binding_sha256==='string')proof.timing_binding_sha256=rows[0].timing_binding_sha256;return proof;
  }
}
export function scopedLicensedChapterProof(plan:LicensedAudioPlan,timings:readonly SourceAyahTiming[],expectedAyahs:number,complete:boolean):LicensedChapterProof|null{
  assertLicensedOffsetEvidence(plan.offsetEvidence,plan.recitationId,plan.sha256,plan.surah);
  if(plan.sourceChapterOffsetMs!==plan.offsetEvidence.sourceChapterOffsetMs||!plan.rightsRef||!Number.isFinite(plan.durationMs)||plan.durationMs<=0)return null;
  let last:number;try{last=toRenderTimeline(timings,{chapterOffsetMs:plan.sourceChapterOffsetMs,sourceFormat:'qud_release',padMs:0}).sourceWindow.toMs;}
  catch(error){if(error instanceof Error&&error.message.startsWith('TIMELINE_'))return null;throw error;}
  if(last>plan.durationMs+30)return null;
  const p=plan.offsetEvidence;return {surah:plan.surah,source_id:plan.sourceId,source_sha256:plan.sha256,rights_ref:plan.rightsRef,offset_evidence_sha256:sha(p),method:p.method,minimum_score:Math.min(...p.samples.map(s=>s.ncc)),maximum_absolute_lag_ms:Math.max(...p.samples.map(s=>Math.abs(s.lagMs))),maximum_duration_difference_ms:Math.max(...p.samples.map(s=>Math.abs(s.durationDifferenceMs))),sample_count:p.samples.length,distinct_surahs:new Set(p.samples.map(s=>s.surah)).size,distinct_chapter_lengths:new Set(p.samples.map(s=>s.chapterAyahCount)).size,canonical_complete:complete,expected_ayahs:expectedAyahs,ready_ayahs:timings.length,coverage_mismatch:0,duration_ms:plan.durationMs,last_word_ms:last,source_chapter_offset_ms:plan.sourceChapterOffsetMs,adapter:plan.adapter,v2_human_review_id:p.v2Acceptance?.humanReviewId??null,...(plan.sourceBindingSha256?{source_binding_sha256:plan.sourceBindingSha256}:{})};
}

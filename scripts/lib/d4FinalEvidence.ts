import assert from 'node:assert/strict';
import {availabilityFingerprint,connectedAyahRuns,type ChapterAvailability} from '../../server/services/recitationAvailability';
import type {Inventory} from './railwayQuranOps';

export type EvidenceRow = Record<string,unknown>;
export interface FinalPublicationPlan {
  target:string;applied:boolean;passed:boolean;changes:number;link_health_as_of_ms:number;
  decisions:EvidenceRow[];
}
export const finalProtectedTables=['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'] as const;
const json=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value;
const bool=(value:unknown):boolean=>value===true||value===1;
const zero=(value:unknown):boolean=>value===false||value===0||value==='0';

export function assertFinalProtected(current:Inventory,baseline:Inventory):void{
  assert.equal(current.server_uuid,baseline.server_uuid,'D4_FINAL_SERVER_CHANGED');
  assert.equal(current.canonical_checksum,baseline.canonical_checksum,'D4_FINAL_CANONICAL_CHANGED');
  assert.deepEqual(current.d1_counts,baseline.d1_counts,'D4_FINAL_D1_CHANGED');
  for(const name of finalProtectedTables){
    assert.ok(current.checksums[name]!=null&&baseline.checksums[name]!=null,'D4_FINAL_PROTECTED_CHECKSUM_UNAVAILABLE');
    assert.equal(current.checksums[name],baseline.checksums[name],'D4_FINAL_PROTECTED_CHECKSUM_CHANGED');
    assert.equal(current.row_counts[name],baseline.row_counts[name],'D4_FINAL_PROTECTED_COUNT_CHANGED');
  }
}

/** Rebuild precisely the persisted T2 fingerprint; no inferred healthy/audio coverage. */
export function storedAvailabilityProof(rows:EvidenceRow[],blockedReady:EvidenceRow[]):{fingerprint:string;chapters:ChapterAvailability[]}{
  const ready=new Map<string,number[]>();
  for(const row of blockedReady){const key=String(row.chapter_id),list=ready.get(key)??[];list.push(Number(row.ayah));ready.set(key,list);}
  const chapters=rows.map(row=>{
    const canonical=bool(row.canonical),blocked=!canonical||bool(row.coverage_mismatch)||Number(row.available_ayahs)===0;
    const runs=json(row.available_runs);assert.ok(Array.isArray(runs),'D4_FINAL_RUNS_INVALID');
    const diagnostic=blocked?(canonical?connectedAyahRuns(ready.get(String(row.id))??[]):[]):runs;
    return {id:String(row.id),surah:Number(row.surah),availability_state:String(row.availability_state),
      available_runs:runs,run_count:Number(row.run_count),max_run_ayahs:Number(row.max_run_ayahs),ready_ayahs:Number(row.ready_ayahs),
      near_complete_missing:json(row.near_complete_missing),catalog_blocked:blocked,diagnostic_ready_runs:diagnostic} as ChapterAvailability;
  });
  assert.equal(new Set(chapters.map(row=>row.id)).size,chapters.length,'D4_FINAL_DUPLICATE_CHAPTER');
  return {chapters,fingerprint:availabilityFingerprint(chapters)};
}

/** Consume existing root decisions, never replace or synthesize them from a score/status. */
export function bindFinalPublication(rows:EvidenceRow[],chapters:EvidenceRow[],plan:FinalPublicationPlan,nowMs:number):Map<string,EvidenceRow>{
  assert.equal(plan.target,'production','D4_FINAL_PRODUCTION_PLAN_REQUIRED');
  assert.equal(plan.applied,false,'D4_FINAL_READ_ONLY_PLAN_REQUIRED');
  assert.equal(plan.passed,true,'D4_FINAL_ACCEPTED_PLAN_REQUIRED');
  assert.equal(plan.changes,0,'D4_FINAL_PUBLICATION_REPLAY_NOT_ZERO');
  assert.ok(Number.isFinite(plan.link_health_as_of_ms)&&plan.link_health_as_of_ms<=nowMs&&nowMs-plan.link_health_as_of_ms<24*3600000,'D4_FINAL_PUBLICATION_PLAN_STALE');
  assert.equal(plan.decisions.length,rows.length,'D4_FINAL_PUBLICATION_SET_CHANGED');
  const decisions=new Map(plan.decisions.map(row=>[String(row.id),row]));
  assert.equal(decisions.size,rows.length,'D4_FINAL_DUPLICATE_PUBLICATION_ID');
  for(const row of rows){
    const decision=decisions.get(String(row.id));assert.ok(decision,'D4_FINAL_PUBLICATION_ID_MISSING');
    for(const [db,field]of [['slug','slug'],['reciter_id','reciter_id'],['provider','provider'],['riwayah','riwayah']])
      assert.equal(row[db],decision[field],'D4_FINAL_PUBLICATION_IDENTITY_CHANGED');
    assert.equal(typeof decision.eligible,'boolean','D4_FINAL_ELIGIBLE_BOOLEAN_REQUIRED');
    assert.ok(Array.isArray(decision.reasons)&&decision.reasons.every(reason=>typeof reason==='string'&&/^[A-Z0-9_]+$/u.test(reason)),'D4_FINAL_REASONS_INVALID');
    assert.equal(decision.metadata_change_planned,false,'D4_FINAL_METADATA_REPLAY_NOT_ZERO');
    assert.equal(decision.publication_change_planned,false,'D4_FINAL_STATUS_REPLAY_NOT_ZERO');
    if(decision.eligible)assert.equal(row.status,'published','D4_FINAL_ELIGIBLE_NOT_PUBLISHED');
    const group=chapters.filter(chapter=>chapter.recitation_id===row.id);
    const complete=(chapter:EvidenceRow)=>chapter.availability_state==='complete'&&zero(chapter.coverage_mismatch);
    const healthy=(chapter:EvidenceRow)=>chapter.audio_status==='available'&&Number(chapter.checked_epoch_ms)>nowMs-24*3600000&&Number(chapter.checked_epoch_ms)<=nowMs;
    assert.equal(decision.completeChapters,group.filter(complete).length,'D4_FINAL_COMPLETE_FACT_CHANGED');
    assert.equal(decision.healthyCompleteChapters,group.filter(chapter=>complete(chapter)&&healthy(chapter)).length,'D4_FINAL_HEALTHY_COMPLETE_CHANGED');
    assert.equal(decision.healthyLinks,group.filter(healthy).length,'D4_FINAL_HEALTHY_LINKS_CHANGED');
    assert.equal(decision.links,group.length,'D4_FINAL_LINK_COUNT_CHANGED');
    assert.equal(decision.coverageMismatches,group.filter(chapter=>!zero(chapter.coverage_mismatch)).length,'D4_FINAL_COVERAGE_MISMATCH_CHANGED');
  }
  return decisions;
}

export function finalRecitationRows(rows:EvidenceRow[],chapters:EvidenceRow[],decisions:Map<string,EvidenceRow>,
  licensedReady:Map<string,number>,licensedCandidates:EvidenceRow[],settings:{enabled:boolean;voiceGatePolicy?:string},
  visible:(row:EvidenceRow,enabled:boolean,policy?:string)=>boolean):EvidenceRow[]{
  return rows.map(row=>{
    const decision=decisions.get(String(row.id));assert.ok(decision);
    const group=chapters.filter(chapter=>chapter.recitation_id===row.id),availability:Record<string,number>={};
    for(const chapter of group){const key=String(chapter.availability_state);availability[key]=(availability[key]??0)+1;}
    const count=licensedReady.get(String(row.id))??0;
    assert.equal(decision.licensedOffsetVerifiedCompleteChapters,count,'D4_FINAL_LICENSED_BINDING_CHANGED');
    const fields=['id','slug','reciter_id','name_ar','provider','riwayah','channel','status','published_by','voice_identity_status','is_public',
      'license_status','offset_verified','offset_check_score','verification_status','verification_method','timing_level','timing_quality','audio_mode'];
    const selected=Object.fromEntries(fields.map(field=>[field,row[field]??null]));
    return {...selected,is_public:bool(row.is_public),offset_verified:bool(row.offset_verified),
      offset_method:row.verification_method??null,availability_counts:availability,
      healthy_complete_chapters_24h:Number(decision.healthyCompleteChapters),
      valid_complete_chapters:row.provider==='youtube'||row.channel==='youtube'?count:Number(decision.healthyCompleteChapters),verified_licensed_complete_chapters:count,
      rule_v1_eligible:decision.eligible,rule_v1_reasons:decision.reasons,
      public_visible:visible({...row,is_public:bool(row.is_public)},settings.enabled,settings.voiceGatePolicy),
      youtube_audio_state:row.provider==='youtube'||row.channel==='youtube'
        ?count>0?'جاهزة للريندر':licensedCandidates.some(candidate=>candidate.recitation_id===row.id)?'ملف قيد التحقق':'بحاجة ملف'
        :null};
  });
}

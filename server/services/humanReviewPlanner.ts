import {type CatalogRow} from './catalogContracts';
import {humanReviewId,validateReviewInput,type ReviewInput} from './humanReviewService';
export interface ReviewPreparation {
  recitations:CatalogRow[];providers:CatalogRow[];auditions:CatalogRow[];near_complete:CatalogRow[];
  voice_evidence?:Record<string,CatalogRow>;offset_evidence?:Record<string,CatalogRow>;same_audio_conflicts?:CatalogRow[];label_conflicts?:CatalogRow[];storage_reviews?:CatalogRow[];
  additional_reviews?:ReviewInput[];
}
/** Pure deterministic metadata plan. Does not invent listening or licensing. */
export function planHumanReviews(input:ReviewPreparation):Array<ReviewInput&{id:string}>{
  const items:ReviewInput[]=[];
  const add=(type:ReviewInput['type'],subject_type:string,subject_id:string,evidence:CatalogRow,priority:number)=>items.push({type,subject_type,subject_id,evidence,priority});
  for(const r of input.recitations){const id=String(r.id),slug=String(r.slug);
    add('voice_confirmation','recitation',id,{slug,voice_identity_status:r.voice_identity_status??'unverified',advisory_only:true,absolute_name_identity_not_proven:true,auto_evidence:input.voice_evidence?.[slug]??r.voice_auto_evidence??{reason:'AUTOMATIC_EVIDENCE_UNAVAILABLE'},audition_samples:input.auditions.filter(a=>a.recitation_id===r.id)},100);
    add('basmala_audio','recitation',id,{slug,audio_status:r.surah_start_basmala_audio_status??'unverified',basmala_mode:r.basmala_mode??null,reason:r.basmala_reason??null,required_action:'Listen and record per-recording evidence; do not generalize sampled chapters.'},70);
    if(r.channel==='youtube'){
      add('youtube_rights','recitation',id,{slug,rights_status:'unknown',provenance_report:'docs/data/qud-audio-provenance.md',required_action:'Supply recording-owner rights evidence; IFrame permission is not audio reuse permission.'},100);
      add('youtube_audio_missing','recitation',id,{slug,render_state:'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE',research_candidates:slug==='badr_al_turki_yt'?[{page_url:'https://quranicaudio.com/quran/167',same_recording_proved:false,commercial_terms_restrictive:true}]:[],required_action:'Upload licensed chapter files or provide owned/licensed hosting; never extract YouTube audio.'},90);
    }
    const exception=input.offset_evidence?.[slug];if(r.verification_method==='v2'||exception)add('offset_exception','recitation',id,{slug,verification_method:r.verification_method??null,verification_status:r.verification_status??null,evidence:exception??r.verification_details??null,required_action:'Human acceptance of codec-v2/boundary exception; original v1 evidence retained.'},85);
    if(r.needs_label_review===true||r.needs_label_review===1)add('label_review','recitation',id,{slug,style:r.style??null,catalog_label:r.display_label_ar??null,required_action:'Compare descriptive label with pinned QUD classification.'},65);
  }
  for(const provider of input.providers)add('provider_license','audio_provider',String(provider.id),{code:provider.code,name:provider.name,license_status:provider.license_status??'unreviewed',terms_url:provider.terms_url??null,terms_digest:'docs/data/provider-terms-digest.md',published_terms_commercial_restriction:provider.code==='quranicaudio'?{url:'https://quranicaudio.com/about',finding:'COMMERCIAL_USE_RESTRICTED_BY_PUBLISHED_TERMS'}:null,required_action:'Confirm programmatic access, commercial reuse and attribution separately; no automatic permitted state.'},95);
  for(const chapter of input.near_complete){const recitation=input.recitations.find(r=>r.slug===chapter.slug);if(!recitation)throw new Error('REVIEW_RECITATION_MISSING');add('near_complete_chapters','recitation_chapter',`${recitation.id}:${chapter.surah}`,{...chapter,recitation_id:recitation.id,threshold:'100% words unchanged; near-complete is not complete.'},60);}
  const islam=input.recitations.find(r=>r.slug==='islam_sobhi_mp3quran');if(islam)add('data_conflict','recitation_chapter',String(islam.id)+':44',{slug:islam.slug,surah:44,evidence_ref:'docs/data/d4-islam-sobhi-44.json',guard_preserved:true,required_action:'Review pinned catalog/release discrepancy; no automatic correction.'},95);
  const youtube=input.recitations.filter(r=>r.channel==='youtube');
  if(youtube.length)add('data_conflict','catalog_collection','youtube_recitation_count',{observed_count:youtube.length,source:'database recitations.channel',request_reference:'User K5/K6 describes eight sources; actual set is calculated, never truncated.',slugs:youtube.map(r=>r.slug),required_action:'Review source-count wording; keep all actual recitations.'},70);
  for(const conflict of input.same_audio_conflicts??[])add('same_audio_conflict','audio_conflict',String(conflict.id),{...conflict,exclude_from_rule_v1:true},1000);
  for(const conflict of input.label_conflicts??[]){const r=input.recitations.find(r=>r.slug===conflict.slug);if(r&&!items.some(i=>i.type==='label_review'&&i.subject_id===r.id))add('label_review','recitation',String(r.id),conflict,65);}
  for(const review of input.storage_reviews??[])add(review.type as ReviewInput['type'],String(review.subject_type??'storage_adapter'),String(review.subject_id??review.id),review,95);
  for(const review of input.additional_reviews??[])items.push(review);
  for(const item of items)validateReviewInput(item);
  const keys=items.map(humanReviewId);if(new Set(keys).size!==keys.length)throw new Error('DUPLICATE_REVIEW_PLAN');
  return items.map((item,index)=>({...item,id:keys[index]})).sort((a,b)=>a.id.localeCompare(b.id));
}

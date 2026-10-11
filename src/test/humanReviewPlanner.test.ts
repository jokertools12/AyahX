import {describe,it,expect} from 'vitest';
import {planHumanReviews} from '../../server/services/humanReviewPlanner';
describe('review preparation',()=>{
  const recitations=[{id:'r',slug:'reader_yt',channel:'youtube',voice_identity_status:'unverified',verification_method:'v2'},{id:'i',slug:'islam_sobhi_mp3quran',channel:'mp3quran',needs_label_review:true}];
  const input={recitations,providers:[{id:'p',code:'youtube',name:'YouTube'}],auditions:[],near_complete:[{slug:'reader_yt',surah:4,missing:[]}],same_audio_conflicts:[{id:'pair-a',recitations:['r','i']}]};
  it('covers every recording, provider, deficit and explicit conflict without approvals',()=>{const rows=planHumanReviews(input);expect(rows.filter(r=>r.type==='voice_confirmation')).toHaveLength(2);expect(rows.filter(r=>r.type==='basmala_audio')).toHaveLength(2);for(const type of ['provider_license','offset_exception','youtube_rights','youtube_audio_missing','near_complete_chapters','data_conflict','same_audio_conflict','label_review'])expect(rows.some(r=>r.type===type)).toBe(true);expect(rows.every(r=>!('status'in r))).toBe(true);});
  it('evidence changes retain deterministic identity',()=>{const a=planHumanReviews(input),b=planHumanReviews({...input,voice_evidence:{reader_yt:{new:true}}});expect(a.map(r=>r.id)).toEqual(b.map(r=>r.id));});
  it('unknown recitation rejects a near-complete fixture',()=>{expect(()=>planHumanReviews({...input,near_complete:[{slug:'missing',surah:2}]})).toThrow('REVIEW_RECITATION_MISSING');});
  it('adds an actual duration warning as pending metadata and validates its evidence',()=>{
    const warning={type:'data_conflict' as const,subject_type:'recitation_chapter',subject_id:'r:101',priority:80,evidence:{reason:'DURATION_LAST_TIMED_WORD_DISCREPANCY',advisory_only:true}};
    expect(planHumanReviews({...input,additional_reviews:[warning]}).find(r=>r.subject_id==='r:101')).toMatchObject(warning);
    expect(()=>planHumanReviews({...input,additional_reviews:[{...warning,evidence:{url:'https://example.test/?sig=private'}}]})).toThrow('REVIEW_EVIDENCE_SECRET');
  });
  it('refuses duplicate conflicts and signed evidence',()=>{expect(()=>planHumanReviews({...input,same_audio_conflicts:[{id:'x'},{id:'x'}]})).toThrow('DUPLICATE_REVIEW_PLAN');expect(()=>planHumanReviews({...input,voice_evidence:{reader_yt:{url:'https://example.test/a?token=private'}}})).toThrow('REVIEW_EVIDENCE_SECRET');});
});

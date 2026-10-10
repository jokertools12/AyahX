import {describe,it,expect} from 'vitest';
import {catalogPublicationFacts,technicalPublicationDecision,technicalPublicationMutation,publicationConstraintSql,PUBLICATION_CONSTRAINTS,D4_CATALOG_ONLY_PUBLISH_CHECK} from '../../server/services/catalogTechnicalPublication';
const row={status:'needs_review',riwayah_code:'hafs_an_asim',canonical_text_available:1,offset_verified:1,verification_status:'passed',verification_method:'v1',offset_check_score:.96,timing_level:'word',timing_quality:'verified',audio_mode:'surah_slice'};
const facts={completeChapters:1,healthyCompleteChapters:1,coverageMismatches:0,links:114,healthyLinks:114,youtube:false,sameAudioConflict:false};
describe('technical publication only',()=>{
  it('accepts technical data without human approvals and changes no row',()=>{const before={...row};expect(technicalPublicationDecision(row,facts)).toEqual({eligible:true,reasons:[]});expect(row).toEqual(before);});
  it.each([{riwayah_code:'warsh'},{offset_verified:0},{offset_check_score:.94},{verification_method:null},{timing_quality:'aligned'},{status:'hidden'},{audio_mode:'ayah_clips'}])('rejects unsafe technical state %j',patch=>expect(technicalPublicationDecision({...row,...patch},facts).eligible).toBe(false));
  it.each([{completeChapters:0,healthyCompleteChapters:0},{coverageMismatches:1},{healthyCompleteChapters:0},{youtube:true},{sameAudioConflict:true}])('rejects facts %j',patch=>expect(technicalPublicationDecision(row,{...facts,...patch}).eligible).toBe(false));
  it('accepts one healthy complete chapter despite unrelated unavailable links',()=>{expect(technicalPublicationDecision(row,{...facts,healthyLinks:1})).toEqual({eligible:true,reasons:[]});});
  it('does not confuse a healthy partial chapter with an unhealthy complete one',()=>{
    const now=Date.parse('2026-10-10T12:00:00Z'),group=[{availability_state:'complete',coverage_mismatch:0,audio_status:'unavailable',checked_epoch_ms:now},{availability_state:'partial',coverage_mismatch:0,audio_status:'available',checked_epoch_ms:now}];
    const computed=catalogPublicationFacts({...row,channel:'mp3quran'},group,[],now);expect(computed.completeChapters).toBe(1);expect(computed.healthyLinks).toBe(1);expect(computed.healthyCompleteChapters).toBe(0);expect(technicalPublicationDecision(row,computed).reasons).toContain('NO_HEALTHY_COMPLETE_CHAPTER');
  });
  it('excludes stale, future-dated and unknown-coverage evidence',()=>{
    const now=Date.parse('2026-10-10T12:00:00Z'),base={availability_state:'complete',coverage_mismatch:0,audio_status:'available'};
    const computed=catalogPublicationFacts(row,[{...base,checked_epoch_ms:now-24*3600000},{...base,checked_epoch_ms:now+1},{...base,coverage_mismatch:null,checked_epoch_ms:now}],[],now);
    expect(computed.healthyCompleteChapters).toBe(0);expect(computed.coverageMismatches).toBe(1);
  });
  it('uses channel and excludes both fingerprint-conflict members by ID or slug',()=>{
    const conflicts=[{type:'same_audio_conflict',subject_type:'audio_conflict',subject_id:'pair',status:'approved',evidence:JSON.stringify({recitations:['reader_a','id-b'],exclude_from_rule_v1:true})}];
    expect(catalogPublicationFacts({id:'a',slug:'reader_a',channel:'youtube'},[],conflicts,1).sameAudioConflict).toBe(true);
    expect(catalogPublicationFacts({id:'id-b',slug:'reader_b',channel:'mp3quran'},[],conflicts,1).sameAudioConflict).toBe(true);
    expect(catalogPublicationFacts({id:'c',slug:'reader_c',channel:'mp3quran'},[],conflicts,1).sameAudioConflict).toBe(false);
    expect(catalogPublicationFacts({channel:'youtube'},[],[],1).youtube).toBe(true);
    expect(catalogPublicationFacts({id:'r'},[],[{type:'same_audio_conflict',subject_type:'recitation',subject_id:'r'}],1).sameAudioConflict).toBe(true);
  });
  it('preserves existing human/public metadata when planning technical publication',()=>{
    const human={...row,published_by:'admin-id',published_at:'2026-10-01',is_public:0,voice_identity_status:'confirmed'};
    const before={...human};expect(technicalPublicationMutation(human,true)).toBeNull();expect(human).toEqual(before);
    expect(technicalPublicationMutation({...human,status:'published'},true)).toBeNull();expect(technicalPublicationMutation({...row,status:'published'},true)).toBeNull();
    expect(technicalPublicationMutation({...row,published_at:'unknown-human-stamp'},true)).toBeNull();
    expect(technicalPublicationMutation(row,true)).toEqual({status:'published',published_by:'rule-v1',publication_clock:'UTC_TIMESTAMP(3)'});expect(technicalPublicationMutation(row,false)).toBeNull();
  });
  it('does not treat a future licensed-source count as verified catalog offset or R2 availability',()=>{
    expect(technicalPublicationDecision({...row,offset_verified:0},{...facts,licensedOffsetVerifiedCompleteChapters:1}).reasons).toContain('OFFSET_NOT_VERIFIED');
    expect(technicalPublicationDecision(row,{...facts,youtube:true,licensedOffsetVerifiedCompleteChapters:1}).reasons).toContain('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE');
  });
  it('rejects impossible or missing fact counts',()=>{
    expect(()=>technicalPublicationDecision(row,{...facts,healthyCompleteChapters:2})).toThrow('FACTS_INVALID');
    expect(()=>technicalPublicationDecision(row,{...facts,healthyLinks:0})).toThrow('FACTS_INVALID');
  });
  it('replaces only a changed publish CHECK even when its existing name is unchanged',()=>{
    const existing=Object.keys(PUBLICATION_CONSTRAINTS),clauses={...PUBLICATION_CONSTRAINTS,chk_recitations_publish_gate_v1:D4_CATALOG_ONLY_PUBLISH_CHECK};
    const [sql]=publicationConstraintSql(existing,clauses);expect(sql).toContain('DROP CHECK chk_recitations_publish_gate_v1');expect(sql).toContain('ADD CONSTRAINT chk_recitations_publish_gate_v1');expect(sql).not.toContain('DROP CHECK chk_recitations_offset_gate_v1');expect(publicationConstraintSql(existing,PUBLICATION_CONSTRAINTS)).toEqual([]);
  });
});

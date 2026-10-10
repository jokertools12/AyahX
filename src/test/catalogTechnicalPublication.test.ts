import {describe,it,expect} from 'vitest';
import {technicalPublicationDecision} from '../../server/services/catalogTechnicalPublication';
const row={status:'needs_review',riwayah_code:'hafs_an_asim',canonical_text_available:1,offset_verified:1,verification_status:'passed',verification_method:'v1',offset_check_score:.96,timing_level:'word',timing_quality:'verified',audio_mode:'surah_slice'};
const facts={completeChapters:1,coverageMismatches:0,links:114,healthyLinks:114,youtube:false};
describe('technical publication only',()=>{
  it('accepts technical data without human approvals and changes no row',()=>{const before={...row};expect(technicalPublicationDecision(row,facts)).toEqual({eligible:true,reasons:[]});expect(row).toEqual(before);});
  it.each([{riwayah_code:'warsh'},{offset_verified:0},{offset_check_score:.94},{verification_method:null},{timing_quality:'aligned'},{status:'hidden'},{audio_mode:'ayah_clips'}])('rejects unsafe technical state %j',patch=>expect(technicalPublicationDecision({...row,...patch},facts).eligible).toBe(false));
  it.each([{completeChapters:0},{coverageMismatches:1},{healthyLinks:113},{youtube:true}])('rejects facts %j',patch=>expect(technicalPublicationDecision(row,{...facts,...patch}).eligible).toBe(false));
});

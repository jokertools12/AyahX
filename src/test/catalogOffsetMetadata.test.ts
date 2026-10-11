import {describe,it,expect} from 'vitest';
import {catalogOffsetPatch} from '../../server/services/catalogOffsetMetadata';
import decision from '../../docs/data/d3-offset-v2-accepted.json';
const initial={slug:'ahmed_saud_mp3quran',verification_status:'failed',offset_verified:0,offset_check_score:.89,verification_details:{reason:'original_failure'},canonical_text_available:1,surah_start_basmala_audio_status:'unverified',status:'needs_review'};
describe('accepted offset metadata only',()=>{
  it('retains the original failed v1 evidence and uses only the approved v2 decision',()=>{
    const p=catalogOffsetPatch(initial,300,decision);expect(p).toMatchObject({verification_method:'v2',offset_verified:true,timing_level:'word',timing_quality:'verified'});
    expect(p).not.toHaveProperty('status');expect(p).not.toHaveProperty('surah_start_basmala_audio_status');expect(p).not.toHaveProperty('voice_identity_status');
    expect(p.verification_details).toMatchObject({v1_original:{verification_status:'failed',verification_details:initial.verification_details}});
    expect(catalogOffsetPatch({...initial,...p},300,decision)).toEqual(p);
  });
  it('does not turn another failed recording into success or borrow canonical words',()=>{
    const p=catalogOffsetPatch({...initial,slug:'not-accepted',canonical_text_available:0},50,decision);expect(p).toEqual({timing_level:'ayah',timing_quality:'aligned'});
    expect(()=>catalogOffsetPatch({...initial,offset_verified:1},300,decision)).toThrow('OFFSET_V1_ORIGINAL_REQUIRED');
    expect(()=>catalogOffsetPatch(initial,-1,decision)).toThrow('TIMING_SUMMARY_INVALID');
  });
});

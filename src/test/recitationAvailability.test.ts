import { describe,it,expect } from 'vitest';
import { computeChapterAvailability,connectedAyahRuns,isRangeAvailable,availabilityFingerprint,type AvailabilityChapter,type AvailabilityTiming } from '../../server/services/recitationAvailability';
const legal=new Map([[1,4],[2,3],[3,7]]);
const chapter:AvailabilityChapter={id:'chapter',surah:1,canonical:true,expected_ayahs:3,available_ayahs:3,coverage_mismatch:false,ayahs_complete:true,is_complete:true,timing_complete:true};
const rows=():AvailabilityTiming[]=>[...legal].map(([ayah,n])=>({ayah,coverage_words:n,expected_words:n,review_status:'ready',review_reasons:[],missing_words:[]}));
describe('D4 availability from real D3 contract',()=>{
  it('keeps complete at 100% and never trusts ready when reasons or words are missing',()=>{
    expect(computeChapterAvailability(chapter,rows(),legal)).toMatchObject({availability_state:'complete',available_runs:[[1,3]],ready_ayahs:3,max_run_ayahs:3});
    const changed=rows();changed[1].review_reasons=['INVALID_SOURCE_INTERVAL'];
    expect(computeChapterAvailability(chapter,changed,legal)).toMatchObject({availability_state:'partial',available_runs:[[1,1],[3,3]],ready_ayahs:2});
    changed[1].coverage_words=1;changed[1].missing_words=[[2,'NO_VALID_MAPPED_SOURCE_INTERVAL'],[3,'NO_VALID_MAPPED_SOURCE_INTERVAL']];
    expect(computeChapterAvailability({...chapter,is_complete:false,timing_complete:false},changed,legal)).toMatchObject({availability_state:'near_complete',available_runs:[[1,1],[3,3]]});
  });
  it('preserves D2 catalog mismatch even with complete timings (islam Sobhi 44)',()=>{
    expect(computeChapterAvailability({...chapter,coverage_mismatch:true,available_ayahs:0,is_complete:false},rows(),legal)).toMatchObject({availability_state:'unavailable',available_runs:[],ready_ayahs:3,catalog_blocked:true,diagnostic_ready_runs:[[1,3]]});
  });
  it('never borrows canonical Hafs coverage for another riwayah',()=>{
    const other=rows().map(r=>({...r,coverage_words:0,expected_words:null,review_status:'needs_review',review_reasons:['CANONICAL_TEXT_UNAVAILABLE']}));
    expect(computeChapterAvailability({...chapter,canonical:false,is_complete:false},other,legal)).toMatchObject({availability_state:'unavailable',available_runs:[],ready_ayahs:0});
  });
  it('handles single ayah, range edges, missing interior, gaps, reverse and invalid values',()=>{
    const runs=connectedAyahRuns([7,1,2,4,4]);expect(runs).toEqual([[1,2],[4,4],[7,7]]);
    expect(isRangeAvailable(runs,4,4)).toBe(true);expect(isRangeAvailable(runs,1,2)).toBe(true);
    for(const [a,b] of [[1,4],[2,4],[3,3],[0,2],[4,2],[1.5,2]])expect(isRangeAvailable(runs,a,b)).toBe(false);
    expect(()=>connectedAyahRuns([0])).toThrow('INVALID_AYAH_RUN');
  });
  it('documents absent timing rows and rejects word accounting corruption or duplicates',()=>{
    const partial=computeChapterAvailability({...chapter,is_complete:false,timing_complete:false},rows().filter(r=>r.ayah!==2),legal);
    expect(partial.near_complete_missing).toEqual([{ayah:2,words:[[1,'MISSING_TIMING_ROW'],[2,'MISSING_TIMING_ROW'],[3,'MISSING_TIMING_ROW']],review_reasons:['MISSING_TIMING_ROW']}]);
    const invalid=rows();invalid[0].coverage_words--;expect(()=>computeChapterAvailability(chapter,invalid,legal)).toThrow('TIMING_WORD_ACCOUNTING_MISMATCH');
    expect(()=>computeChapterAvailability(chapter,[...rows(),rows()[0]],legal)).toThrow('DUPLICATE_AYAH_TIMING');
  });
  it('fingerprints are stable across chapter ordering but reflect availability changes',()=>{
    const a=computeChapterAvailability(chapter,rows(),legal);const b={...a,id:'other'};
    expect(availabilityFingerprint([a,b])).toBe(availabilityFingerprint([b,a]));
    expect(availabilityFingerprint([a])).not.toBe(availabilityFingerprint([{...a,available_runs:[]}]));
  });
});

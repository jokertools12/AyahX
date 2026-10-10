import { describe, it, expect } from 'vitest';
import { reconcileChapterTimingCoverage } from '../../server/services/qudTimingVerification';
describe('independent D3 chapter reconciliation',()=>{
  const chapter={recitation_id:'r',surah:1,canonical:1,ayahs_complete:1,covered:3,expected:3,timing_complete:1,is_complete:1};
  const timing={recitation_id:'r',surah:1,rows:2,covered:3,missing:0,review:0};
  const legal={surah:1,ayahs:2,words:3};
  it('requires all legal words and ready rows, and rejects nullable uncomputed coverage',()=>{
    expect(reconcileChapterTimingCoverage([chapter],[timing],[legal]).coverage_errors).toBe(0);
    expect(reconcileChapterTimingCoverage([{...chapter,covered:null}],[timing],[legal]).coverage_errors).toBe(1);
    expect(reconcileChapterTimingCoverage([chapter],[{...timing,review:1}],[legal]).coverage_errors).toBe(1);
    expect(reconcileChapterTimingCoverage([chapter],[{...timing,covered:2,missing:1}],[legal]).coverage_errors).toBe(1);
  });
  it('keeps non-Hafs expected words null and never claims complete without a legal reference',()=>{
    expect(reconcileChapterTimingCoverage([{...chapter,canonical:0,expected:null,timing_complete:0,is_complete:0}],[timing],[legal]).coverage_errors).toBe(0);
    expect(reconcileChapterTimingCoverage([{...chapter,canonical:0,expected:3}],[timing],[legal]).coverage_errors).toBe(1);
  });
});

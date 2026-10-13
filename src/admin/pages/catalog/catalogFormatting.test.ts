import {missingWordEvidence} from './catalogFormatting';
import {describe,it,expect} from 'vitest';
import {isApprovedFontUrl,missingWordCount,timingBounds} from './catalogFormatting';
import {reorderedIds} from './catalogHooks';
import {type CatalogTiming} from './catalogTypes';
describe('Catalog reader display safeguards',()=>{
 it('keeps repeated spoken spans in the diagram bounds',()=>{const row={words:[[1,0,100,160],[1,1,300,350]],segments:[[90,180,false,0],[290,360,false,0]]} as CatalogTiming;expect(timingBounds(row)).toEqual({from:90,to:360});});
 it('does not invent an interval when none is stored',()=>{expect(timingBounds({words:[],segments:[]} as unknown as CatalogTiming)).toBeNull();});
 it('requires a positive span for a diagram',()=>{expect(timingBounds({words:[[null,0,100,100]],segments:[]} as unknown as CatalogTiming)).toBeNull();});
 it('counts missing legal words from persisted per-ayah evidence',()=>{expect(missingWordCount([{ayah:1,words:[[1,'MISSING_TIMING_ROW'],[2,'MISSING_TIMING_ROW']]},{ayah:2,words:[[3,'WORD_DIFF_UNMAPPED']]}])).toBe(3);});
 it('does not infer word counts from reason strings',()=>{expect(missingWordCount([{ayah:1,review_reasons:['INVALID_WORD_INTERVAL']}])).toBe(0);});
 it('accepts the six approved fonts as same-origin files',()=>{expect(isApprovedFontUrl('/fonts/Amiri-Regular.ttf')).toBe(true);expect(isApprovedFontUrl('/fonts/NotoNaskhArabic-Regular.woff2')).toBe(true);});
 it.each(['https://evil.test/font.ttf','//evil.test/font.ttf','/fonts/../private.ttf','/fonts/a.ttf?signature=secret','/fonts/a.ttf#fragment','/fonts/a.svg'])('rejects non-font or unsafe font location %s',url=>{expect(isApprovedFontUrl(url)).toBe(false);});
 it('reorders only displayed IDs without deleting any item',()=>{expect(reorderedIds(['a','b','c'],'a','c')).toEqual(['b','c','a']);});
 it('unknown drag IDs leave the list unchanged',()=>{const ids=['a','b'];expect(reorderedIds(ids,'unknown','b')).toEqual(ids);expect(ids).toEqual(['a','b']);});
});

describe('missing word evidence projection',()=>{
 it('retains actual chapter verse, word position and reason',()=>{expect(missingWordEvidence([{ayah:3,words:[[2,'NO_VALID_MAPPED_SOURCE_INTERVAL']],review_reasons:[]}])).toEqual([{ayah:3,position:2,reason:'NO_VALID_MAPPED_SOURCE_INTERVAL'}]);});
 it('projects verse evidence without inventing a verse or word text',()=>{expect(missingWordEvidence([[7,'SPOKEN_TEXT_UNAVAILABLE']])).toEqual([{ayah:null,position:7,reason:'SPOKEN_TEXT_UNAVAILABLE'}]);expect(missingWordEvidence([{ayah:'3',words:[[2,'reason']]}])).toEqual([]);});
});

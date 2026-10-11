import {describe,it,expect} from 'vitest';
import {withCatalogSort} from './catalogSort';
describe('Atomic catalog URL sorting',()=>{
 it('updates key and direction together and resets pagination',()=>{const initial=new URLSearchParams('page=3&sort=sort_order&direction=asc&tab=recitations&voice=unverified');const sorted=withCatalogSort(initial,'display_label_ar','desc');expect(sorted.get('sort')).toBe('display_label_ar');expect(sorted.get('direction')).toBe('desc');expect(sorted.has('page')).toBe(false);expect(sorted.get('tab')).toBe('recitations');expect(sorted.get('voice')).toBe('unverified');expect(initial.get('page')).toBe('3');});
 it('preserves a shared filter containing multiple words',()=>{const sorted=withCatalogSort(new URLSearchParams({q:'محمود خليل',reciter_id:'reader-id',limit:'100'}),'name_ar','asc');expect(sorted.get('q')).toBe('محمود خليل');expect(sorted.get('reciter_id')).toBe('reader-id');expect(sorted.get('limit')).toBe('100');});
});

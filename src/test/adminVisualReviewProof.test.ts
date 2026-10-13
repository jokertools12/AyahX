// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {snapshotAdminVisualReviews,readAdminVisualReviewSnapshot,proveAdminVisualReviewInvariant,assertAdminVisualReviewInvariant} from '../../tooling/e2e/helpers/adminVisualReviewProof.mjs';
const row=(id:string,status='pending')=>({id,status,type:'voice_confirmation',subject_type:'recitation',subject_id:'recording',priority:10,evidence:{b:2,a:1},notes:null,decision:null,decided_by:null,decided_at:null,created_at:'2026-10-13T00:00:00Z',updated_at:'2026-10-13T00:00:00Z'});
describe('authenticated visual review invariant',()=>{
 it('accepts historical decisions and proves every original pending ID plus complete review state unchanged',()=>{
  const rows=[row('one'),{...row('two','approved'),notes:'Historical decision',decided_by:'owner'},row('three','deferred'),row('four','rejected')];
  const before=snapshotAdminVisualReviews(rows),after=snapshotAdminVisualReviews([...rows].reverse());
  expect(before.counts).toEqual({pending:1,approved:1,rejected:1,deferred:1});
  expect(proveAdminVisualReviewInvariant(before,after).unchanged).toBe(true);
  expect(JSON.stringify(before)).not.toContain('Historical decision');expect(JSON.stringify(before)).not.toContain('recording');
 });
 it('rejects equal-count substitutions, decisions, deletions, additions and metadata changes',()=>{
  const rows=[row('one'),row('two')],before=snapshotAdminVisualReviews(rows);
  for(const changed of [[row('replacement'),row('two')],[row('one','approved'),row('two')],[row('one')],[...rows,row('three')],[{...row('one'),notes:'Changed'},row('two')]])expect(()=>proveAdminVisualReviewInvariant(before,snapshotAdminVisualReviews(changed))).toThrow('ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
 });
 it('rejects duplicate or missing fields and a forged unchanged flag',()=>{
  expect(()=>snapshotAdminVisualReviews([row('one'),row('one')])).toThrow('ROW_INVALID');
  expect(()=>snapshotAdminVisualReviews([{id:'one',status:'pending'}])).toThrow('FIELD_MISSING');
  const before=snapshotAdminVisualReviews([row('one')]),after=snapshotAdminVisualReviews([row('two')]);
  expect(()=>assertAdminVisualReviewInvariant({version:'admin-visual-review-invariant-1',before,after,unchanged:true})).toThrow('ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
  expect(()=>assertAdminVisualReviewInvariant({version:'admin-visual-review-invariant-1',before:{...before,counts:{pending:0}},after,unchanged:true})).toThrow('COUNTS_INVALID');
 });
 it('reads all exact pages without querying zero-decided assumptions',async()=>{
  const rows=Array.from({length:201},(_,index)=>row('r'+index,index===0?'approved':'pending'));
  const get=vi.fn(async(url:string)=>{const page=Number(new URL(url).searchParams.get('page'));return{ok:()=>true,json:async()=>({data:rows.slice((page-1)*100,page*100),meta:{page,limit:100,total:rows.length}})};});
  expect(await readAdminVisualReviewSnapshot({get},'http://localhost:3005')).toEqual(snapshotAdminVisualReviews(rows));
  expect(get).toHaveBeenCalledTimes(3);expect(get.mock.calls.every(([url])=>!url.includes('status='))).toBe(true);
 });
 it('fails closed on failed HTTP, changing totals, partial pages and duplicated row IDs',async()=>{
  const failed={get:async()=>({ok:()=>false})};await expect(readAdminVisualReviewSnapshot(failed,'http://localhost:3005')).rejects.toThrow('READ_FAILED');
  const request=(kind:string)=>({get:async(url:string)=>{const page=Number(new URL(url).searchParams.get('page'));return{ok:()=>true,json:async()=>({data:Array.from({length:kind==='partial'?99:100},(_,i)=>row(kind==='duplicate'?'same':'r'+(page*100+i))),meta:{page,limit:100,total:kind==='changing'&&page===2?201:200}})};}});
  await expect(readAdminVisualReviewSnapshot(request('partial'),'http://localhost:3005')).rejects.toThrow('PAGE_INCOMPLETE');
  await expect(readAdminVisualReviewSnapshot(request('changing'),'http://localhost:3005')).rejects.toThrow('TOTAL_CHANGED');
  await expect(readAdminVisualReviewSnapshot(request('duplicate'),'http://localhost:3005')).rejects.toThrow('ROW_INVALID');
 });
});

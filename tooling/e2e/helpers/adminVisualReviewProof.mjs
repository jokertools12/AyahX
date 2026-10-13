import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const statuses=['pending','approved','rejected','deferred'];
const fields=['id','type','subject_type','subject_id','target_subject_type','target_subject_id','status','priority','evidence','notes','decision','decided_by','decided_at','supersedes_id','created_at','updated_at'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Hash the actual authenticated API review state; never export rows or notes. */
export function snapshotAdminVisualReviews(rows){
 requireProof(Array.isArray(rows),'ADMIN_VISUAL_REVIEW_ROWS_REQUIRED');
 const ids=new Set(),state=[],counts=Object.fromEntries(statuses.map(status=>[status,0]));
 for(const row of rows){
  requireProof(row&&typeof row.id==='string'&&/^[a-zA-Z0-9_-]+$/u.test(row.id)&&statuses.includes(row.status)&&!ids.has(row.id),'ADMIN_VISUAL_REVIEW_ROW_INVALID');
  for(const field of ['type','subject_type','subject_id','priority','evidence','notes','decision','decided_by','decided_at','created_at','updated_at'])requireProof(Object.hasOwn(row,field),'ADMIN_VISUAL_REVIEW_FIELD_MISSING');
  ids.add(row.id);counts[row.status]++;state.push(Object.fromEntries(fields.map(field=>[field,row[field]??null])));
 }
 state.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return{version:'admin-visual-reviews-1',source:'authenticated-review-api',total:state.length,counts,pendingIdsSha256:hash(state.filter(row=>row.status==='pending').map(row=>row.id)),stateSha256:hash(state)};
}

/** Only existing authenticated GET endpoints. A failed/unstable page fails closed. */
export async function readAdminVisualReviewSnapshot(request,base){
 const rows=[];let expectedTotal;
 for(let page=1;;page++){
  const response=await request.get(base+`/api/admin/reviews?page=${page}&limit=100`);
  requireProof(response.ok(),'ADMIN_VISUAL_REVIEW_READ_FAILED');
  const json=await response.json(),meta=json?.meta;
  requireProof(Array.isArray(json?.data)&&meta?.page===page&&meta.limit===100&&Number.isSafeInteger(meta.total)&&meta.total>=0,'ADMIN_VISUAL_REVIEW_PAGE_INVALID');
  if(expectedTotal===undefined)expectedTotal=meta.total;
  requireProof(meta.total===expectedTotal,'ADMIN_VISUAL_REVIEW_TOTAL_CHANGED');
  const remaining=expectedTotal-rows.length;
  requireProof(json.data.length===Math.min(100,remaining),'ADMIN_VISUAL_REVIEW_PAGE_INCOMPLETE');
  rows.push(...json.data);
  if(rows.length===expectedTotal)return snapshotAdminVisualReviews(rows);
 }
}

export function assertAdminVisualReviewInvariant(proof){
 requireProof(proof?.version==='admin-visual-review-invariant-1','ADMIN_VISUAL_REVIEW_INVARIANT_REQUIRED');
 requireProof(proof.unchanged===true,'ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
 for(const snapshot of [proof.before,proof.after]){
  requireProof(snapshot?.version==='admin-visual-reviews-1'&&snapshot.source==='authenticated-review-api'&&Number.isSafeInteger(snapshot.total)&&snapshot.total>=0&&/^[a-f0-9]{64}$/u.test(snapshot.pendingIdsSha256??'')&&/^[a-f0-9]{64}$/u.test(snapshot.stateSha256??''),'ADMIN_VISUAL_REVIEW_SNAPSHOT_INVALID');
  requireProof(isDeepStrictEqual(Object.keys(snapshot.counts??{}).sort(),[...statuses].sort())&&statuses.every(status=>Number.isSafeInteger(snapshot.counts[status])&&snapshot.counts[status]>=0)&&statuses.reduce((sum,status)=>sum+snapshot.counts[status],0)===snapshot.total,'ADMIN_VISUAL_REVIEW_COUNTS_INVALID');
 }
 requireProof(isDeepStrictEqual(proof.before,proof.after),'ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
}

export function proveAdminVisualReviewInvariant(before,after){
 const proof={version:'admin-visual-review-invariant-1',before,after,unchanged:isDeepStrictEqual(before,after)};
 assertAdminVisualReviewInvariant(proof);return proof;
}

// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {allowedAdminVisualWrite,isOwnedAdminVisualPreview,canReuseAdminVisualPreview} from '../../tooling/e2e/helpers/adminVisualDialogPreparation.mjs';
describe('disposable visual preview network admission',()=>{
 const fixture={safeReviewId:'ci-informational-review'};
 it('allows only login and the informational preview for exactly one owned review',()=>{
  expect(allowedAdminVisualWrite('POST','/api/admin/auth/login',{},fixture)).toBe(true);
  expect(allowedAdminVisualWrite('POST','/api/admin/reviews/bulk-preview',{ids:[fixture.safeReviewId],status:'approved'},fixture)).toBe(true);
  for(const body of [{ids:['other'],status:'approved'},{ids:[fixture.safeReviewId,'other'],status:'approved'},{ids:[],status:'approved'},{ids:[fixture.safeReviewId],status:'rejected'}])expect(allowedAdminVisualWrite('POST','/api/admin/reviews/bulk-preview',body,fixture)).toBe(false);
 });
 it('rejects actual approvals, role changes, deletion, rendering and preferences',()=>{
  for(const [method,path]of [['POST','/api/admin/reviews/bulk'],['POST',`/api/admin/reviews/${fixture.safeReviewId}/decision`],['PUT','/api/admin/roles/ci_visual_reviewer/permissions'],['DELETE','/api/admin/render-lab/jobs/fixture'],['POST','/api/admin/render-lab/jobs'],['PATCH','/api/admin/preferences']])expect(allowedAdminVisualWrite(method,path,{ids:[fixture.safeReviewId],status:'approved'},fixture)).toBe(false);
 });
 it('never treats absent fixture metadata as a matching target',()=>{
  expect(allowedAdminVisualWrite('POST','/api/admin/reviews/bulk-preview',{ids:[undefined],status:'approved'},{})).toBe(false);
 });
 it('can reuse only the real one-item informational response and the same visible selected state',()=>{
  const proof={count:1,ids:[fixture.safeReviewId],types:['data_conflict']},ui={previewPresent:true,previewCount:1,selectedCount:1,selectedIds:[fixture.safeReviewId]};
  expect(canReuseAdminVisualPreview(proof,fixture,ui)).toBe(true);
  for(const changed of [{previewPresent:false},{previewCount:0},{previewCount:2},{selectedCount:2},{selectedIds:['other']},{selectedIds:[fixture.safeReviewId,'other']}])expect(canReuseAdminVisualPreview(proof,fixture,{...ui,...changed})).toBe(false);
  for(const changed of [{count:2},{ids:['other']},{ids:[fixture.safeReviewId,'other']},{types:['voice_confirmation']},{types:['data_conflict','provider_license']}])expect(isOwnedAdminVisualPreview({...proof,...changed},fixture)).toBe(false);
  expect(canReuseAdminVisualPreview(undefined,fixture,ui)).toBe(false);expect(isOwnedAdminVisualPreview(proof,{})).toBe(false);
 });
});

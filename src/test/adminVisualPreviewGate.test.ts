// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {ADMIN_ROLES} from '../../server/admin/adminPermissions';
import {allowedAdminVisualWrite,isOwnedAdminVisualPreview,canReuseAdminVisualPreview,assertAdminVisualRoleFixture,adminVisualPreviewRoles,prepareAdminVisualToggle} from '../../tooling/e2e/helpers/adminVisualDialogPreparation.mjs';
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
 it('previews only a supported role actually returned by the real role selector',()=>{
  expect([...adminVisualPreviewRoles].sort()).toEqual(ADMIN_ROLES.filter(role=>role!=='super_admin').sort());
  expect(()=>assertAdminVisualRoleFixture('analyst',ADMIN_ROLES)).not.toThrow();
  for(const role of ['ci_visual_reviewer','super_admin',undefined])expect(()=>assertAdminVisualRoleFixture(role,ADMIN_ROLES)).toThrow('ROLE_FIXTURE_NOT_AVAILABLE');
  expect(()=>assertAdminVisualRoleFixture('analyst',['admin'])).toThrow('ROLE_FIXTURE_NOT_AVAILABLE');
  const server=readFileSync('scripts/admin-visual-ci-server.ts','utf8');expect(server).toContain("fixtureRoleSlug:'analyst'");expect(server).not.toContain("VALUES('ci_visual_reviewer'");
  expect(allowedAdminVisualWrite('PUT','/api/admin/roles/analyst/permissions',{},fixture)).toBe(false);
 });
 it.each(['#merge-reason','#move-reason'])('opens %s only when closed and restores its initial closed state across both measured cases',async selector=>{
  let visible=false;const click=vi.fn(async()=>{visible=!visible;}),prepare=vi.fn(async()=>{});
  const reason={isVisible:async()=>visible,waitFor:vi.fn(async()=>{if(!visible)throw Error('FIELD_HIDDEN');})},scope={locator:()=>reason,getByRole:()=>({click})};
  for(let run=0;run<2;run++){const cleanup=await prepareAdminVisualToggle(scope,selector,/Prepare/u,prepare);expect(visible).toBe(true);await cleanup();expect(visible).toBe(false);}
  expect(click).toHaveBeenCalledTimes(4);expect(prepare).toHaveBeenCalledTimes(2);
 });
 it('does not toggle an already open context closed and cleans up an owned context on preparation failure',async()=>{
  let visible=true;const click=vi.fn(async()=>{visible=!visible;}),reason={isVisible:async()=>visible,waitFor:async()=>{}},scope={locator:()=>reason,getByRole:()=>({click})};
  const cleanup=await prepareAdminVisualToggle(scope,'#merge-reason',/Prepare/u,async()=>{});await cleanup();expect(visible).toBe(true);expect(click).not.toHaveBeenCalled();
  visible=false;await expect(prepareAdminVisualToggle(scope,'#merge-reason',/Prepare/u,async()=>{throw Error('REAL_PREPARATION_FAILURE');})).rejects.toThrow('REAL_PREPARATION_FAILURE');expect(visible).toBe(false);expect(click).toHaveBeenCalledTimes(2);
 });
 it('can reuse only the real one-item informational response and the same visible selected state',()=>{
  const proof={count:1,ids:[fixture.safeReviewId],types:['data_conflict']},ui={previewPresent:true,previewCount:1,selectedCount:1,selectedIds:[fixture.safeReviewId]};
  expect(canReuseAdminVisualPreview(proof,fixture,ui)).toBe(true);
  for(const changed of [{previewPresent:false},{previewCount:0},{previewCount:2},{selectedCount:2},{selectedIds:['other']},{selectedIds:[fixture.safeReviewId,'other']}])expect(canReuseAdminVisualPreview(proof,fixture,{...ui,...changed})).toBe(false);
  for(const changed of [{count:2},{ids:['other']},{ids:[fixture.safeReviewId,'other']},{types:['voice_confirmation']},{types:['data_conflict','provider_license']}])expect(isOwnedAdminVisualPreview({...proof,...changed},fixture)).toBe(false);
  expect(canReuseAdminVisualPreview(undefined,fixture,ui)).toBe(false);expect(isOwnedAdminVisualPreview(proof,{})).toBe(false);
 });
});

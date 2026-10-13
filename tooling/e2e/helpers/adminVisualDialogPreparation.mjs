import {waitForAdminVisualPaint} from './adminVisualPaint.mjs';
/** CI-owned preview only. No confirmation submission or direct API request. */
export function allowedAdminVisualWrite(method,path,body,fixture){
 if(method!=='POST')return false;
 if(path==='/api/admin/auth/login')return true;
 return path==='/api/admin/reviews/bulk-preview'&&typeof fixture.safeReviewId==='string'&&/^[a-zA-Z0-9_-]+$/u.test(fixture.safeReviewId)&&body?.status==='approved'&&Array.isArray(body.ids)&&body.ids.length===1&&body.ids[0]===fixture.safeReviewId;
}

const previewProofs=new WeakMap(),observedPages=new WeakSet();
export const adminVisualPreviewRoles=Object.freeze(['admin','content_manager','moderator','support','finance','analyst']);
export function assertAdminVisualRoleFixture(role,available){
 if(!adminVisualPreviewRoles.includes(role)||!Array.isArray(available)||!available.includes(role))throw new Error('ADMIN_VISUAL_ROLE_FIXTURE_NOT_AVAILABLE');
}
export function isOwnedAdminVisualPreview(proof,fixture){
 return typeof fixture.safeReviewId==='string'&&/^[a-zA-Z0-9_-]+$/u.test(fixture.safeReviewId)&&proof?.count===1&&Array.isArray(proof.ids)&&proof.ids.length===1&&proof.ids[0]===fixture.safeReviewId&&Array.isArray(proof.types)&&proof.types.length===1&&proof.types[0]==='data_conflict';
}
export function canReuseAdminVisualPreview(proof,fixture,ui){
 return isOwnedAdminVisualPreview(proof,fixture)&&ui.previewPresent===true&&ui.previewCount===1&&ui.selectedCount===1&&Array.isArray(ui.selectedIds)&&ui.selectedIds.length===1&&ui.selectedIds[0]===fixture.safeReviewId;
}
function observePreviewDocument(page){
 if(observedPages.has(page))return;
 observedPages.add(page);
 // A response proof can describe only the document that actually rendered it.
 // Reloads and even same-document navigation invalidate it conservatively.
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())previewProofs.delete(page);});
}
async function previewUi(scope){
 const note=scope.locator('#bulk-note'),previewPresent=await note.isVisible();
 const count=text=>Number(/:\s*(\d+)\s*$/u.exec(text??'')?.[1]??NaN);
 const selectedIds=await scope.locator('.admin-table-desktop tbody input[type=checkbox]:checked,.admin-mobile-cards input[type=checkbox]:checked').evaluateAll(elements=>[...new Set(elements.map(el=>(el.getAttribute('aria-label')??'').replace(/^(?:تحديد|Select)\s+/u,'')))]);
 return{previewPresent,selectedIds,selectedCount:count(await scope.locator('.admin-fixed-actions p').first().textContent()),previewCount:previewPresent?count(await scope.locator('section:has(#bulk-note) > p').first().textContent()):NaN};
}

async function firstVisible(locator){const until=performance.now()+20000;do{for(let i=0;i<await locator.count();i++)if(await locator.nth(i).isVisible())return locator.nth(i);await new Promise(resolve=>setTimeout(resolve,50));}while(performance.now()<until);throw new Error('VISUAL_PREVIEW_TARGET_REQUIRED');}
async function pickAnotherReader(page,scope){
 await (await firstVisible(scope.getByRole('combobox',{name:/القارئ الهدف|Target reader/u}))).click();
 await (await firstVisible(page.locator('[data-radix-popper-content-wrapper] .admin-stack button'))).click();
}
export async function prepareAdminVisualToggle(scope,reasonSelector,buttonName,prepare){
 const reason=scope.locator(reasonSelector),button=scope.getByRole('button',{name:buttonName});
 const openedByUs=!await reason.isVisible();
 const cleanup=async()=>{if(openedByUs&&await reason.isVisible())await button.click();};
 try{
  if(openedByUs)await button.click();
  await reason.waitFor({state:'visible'});await prepare(reason);
  return cleanup;
 }catch(error){await cleanup();throw error;}
}
export async function prepareAdminVisualDialogContext(page,scope,fixture){
 const slug=await scope.getAttribute('data-admin-visual-dialog');
 const path=new URL(page.url()).pathname;
 const noCleanup=async()=>{};
 if(slug==='provider-detail'){
  await scope.locator('#license-notes').waitFor({state:'visible'});
  await scope.locator('#license-notes').fill('CI_VISUAL_ONLY: preview, no license decision');
 }else if(slug==='recitation-detail'){
  return prepareAdminVisualToggle(scope,'#move-reason',/نقل لقارئ آخر|Move to another reader/u,async reason=>{
   await pickAnotherReader(page,scope);await reason.fill('CI_VISUAL_ONLY: preview, no recording move');
  });
 }else if(!slug&&path==='/admin/roles'){
  const select=scope.locator('#selected-role'),before=await select.inputValue();
  assertAdminVisualRoleFixture(fixture.fixtureRoleSlug,await select.locator('option').evaluateAll(options=>options.map(option=>option.value)));
  await select.selectOption(fixture.fixtureRoleSlug);
  await (await firstVisible(scope.getByRole('checkbox'))).click();
  return async()=>{await scope.getByRole('button',{name:/إلغاء التغييرات|Discard changes/u}).click();await select.selectOption(before);};
 }else if(!slug&&/^\/admin\/reciters\/[^/]+$/u.test(path)&&!new URL(page.url()).searchParams.get('tab')){
  return prepareAdminVisualToggle(scope,'#merge-reason',/تحضير الدمج|Prepare merge/u,async reason=>{
   await pickAnotherReader(page,scope);await reason.fill('CI_VISUAL_ONLY: preview, no reader merge');
  });
 }else if(!slug&&path==='/admin/reviews'){
  observePreviewDocument(page);
  const checkbox=scope.locator(`input[aria-label="تحديد ${fixture.safeReviewId}"],input[aria-label="Select ${fixture.safeReviewId}"]`);
  const target=await firstVisible(checkbox);if(!await target.isChecked())await target.check();
  if(!canReuseAdminVisualPreview(previewProofs.get(page),fixture,await previewUi(scope))){
   const preview=scope.getByRole('button',{name:/معاينة موافقة المجموعة الآمنة|Preview safe group approval/u});
   const[response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/reviews/bulk-preview'),(await firstVisible(preview)).click()]);
   if(!response.ok())throw new Error('REAL_SAFE_BULK_PREVIEW_FAILED');
   const data=(await response.json()).data;
   if(!isOwnedAdminVisualPreview(data,fixture))throw new Error('REAL_SAFE_BULK_PREVIEW_SHAPE_MISMATCH');
   await scope.locator('#bulk-note').waitFor({state:'visible'});
   if(!canReuseAdminVisualPreview(data,fixture,await previewUi(scope)))throw new Error('REAL_SAFE_BULK_PREVIEW_UI_MISMATCH');
   previewProofs.set(page,data);
  }
  await scope.locator('#bulk-note').waitFor({state:'visible'});await scope.locator('#bulk-note').fill('CI_VISUAL_ONLY: preview, no approval');
  return async()=>{await scope.locator('#bulk-note').fill('');if(await target.isChecked())await target.uncheck();};
 }
 return noCleanup;
}

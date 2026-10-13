/** CI-owned preview only. No confirmation submission or direct API request. */
export function allowedAdminVisualWrite(method,path,body,fixture){
 if(method!=='POST')return false;
 if(path==='/api/admin/auth/login')return true;
 return path==='/api/admin/reviews/bulk-preview'&&typeof fixture.safeReviewId==='string'&&/^[a-zA-Z0-9_-]+$/u.test(fixture.safeReviewId)&&body?.status==='approved'&&Array.isArray(body.ids)&&body.ids.length===1&&body.ids[0]===fixture.safeReviewId;
}

async function firstVisible(locator){const until=performance.now()+20000;do{for(let i=0;i<await locator.count();i++)if(await locator.nth(i).isVisible())return locator.nth(i);await new Promise(resolve=>setTimeout(resolve,50));}while(performance.now()<until);throw new Error('VISUAL_PREVIEW_TARGET_REQUIRED');}
async function pickAnotherReader(page,scope){
 await (await firstVisible(scope.getByRole('combobox',{name:/القارئ الهدف|Target reader/u}))).click();
 await (await firstVisible(page.locator('[data-radix-popper-content-wrapper] .admin-stack button'))).click();
}
export async function prepareAdminVisualDialogContext(page,scope,fixture){
 const slug=await scope.getAttribute('data-admin-visual-dialog');
 const path=new URL(page.url()).pathname;
 const noCleanup=async()=>{};
 if(slug==='provider-detail'){
  await scope.locator('#license-notes').waitFor({state:'visible'});
  await scope.locator('#license-notes').fill('CI_VISUAL_ONLY: preview, no license decision');
 }else if(slug==='recitation-detail'){
  await scope.getByRole('button',{name:/نقل لقارئ آخر|Move to another reader/u}).click();
  await scope.locator('#move-reason').waitFor({state:'visible'});
  await pickAnotherReader(page,scope);
  await scope.locator('#move-reason').fill('CI_VISUAL_ONLY: preview, no recording move');
 }else if(!slug&&path==='/admin/roles'){
  const select=scope.locator('#selected-role'),before=await select.inputValue();
  await select.selectOption(fixture.fixtureRoleSlug);
  await (await firstVisible(scope.getByRole('checkbox'))).click();
  return async()=>{await scope.getByRole('button',{name:/إلغاء التغييرات|Discard changes/u}).click();await select.selectOption(before);};
 }else if(!slug&&/^\/admin\/reciters\/[^/]+$/u.test(path)&&!new URL(page.url()).searchParams.get('tab')){
  await scope.getByRole('button',{name:/تحضير الدمج|Prepare merge/u}).click();
  await scope.locator('#merge-reason').waitFor({state:'visible'});
  await pickAnotherReader(page,scope);
  await scope.locator('#merge-reason').fill('CI_VISUAL_ONLY: preview, no reader merge');
 }else if(!slug&&path==='/admin/reviews'){
  const checkbox=scope.locator(`input[aria-label="تحديد ${fixture.safeReviewId}"],input[aria-label="Select ${fixture.safeReviewId}"]`);
  const target=await firstVisible(checkbox);if(!await target.isChecked())await target.check();
  const preview=scope.getByRole('button',{name:/معاينة موافقة المجموعة الآمنة|Preview safe group approval/u});
  const[response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/reviews/bulk-preview'),(await firstVisible(preview)).click()]);
  if(!response.ok())throw new Error('REAL_SAFE_BULK_PREVIEW_FAILED');
  await scope.locator('#bulk-note').waitFor({state:'visible'});await scope.locator('#bulk-note').fill('CI_VISUAL_ONLY: preview, no approval');
  return async()=>{await scope.locator('#bulk-note').fill('');if(await target.isChecked())await target.uncheck();};
 }
 return noCleanup;
}

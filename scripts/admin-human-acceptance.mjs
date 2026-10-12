/** Root-operated real browser acceptance. No API decisions, mocks or DB clients. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {humanTasks,assertPrivatePath,validateHumanManifest,HumanTaskBudget,allowedHumanApplicationWrite} from '../tooling/e2e/helpers/adminHumanAcceptance.mjs';

const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--manifest')||!args.includes('--output'))throw new Error('PRIVATE_MANIFEST_AND_OUTPUT_REQUIRED');
const manifestPath=assertPrivatePath(arg('--manifest')),output=assertPrivatePath(arg('--output'));
const manifest=validateHumanManifest(JSON.parse(await readFile(manifestPath,'utf8')),args.includes('--production-read-only'));
const auth=JSON.parse(await readFile(manifest.authFile,'utf8'));
if(typeof auth.email!=='string'||typeof auth.password!=='string'||auth.password.length<32)throw new Error('PRIVATE_QA_AUTH_REQUIRED');
const production=manifest.mode==='production-read-only',base=manifest.baseUrl,t=manifest.targets;
const selected=args.includes('--tasks')?arg('--tasks').split(','):humanTasks.map(task=>task.id);
if(selected.some(id=>!humanTasks.some(task=>task.id===id)))throw new Error('UNKNOWN_HUMAN_TASK');
await mkdir(output,{recursive:true,mode:0o700});
const report={version:'admin-human-1',startedAt:new Date().toISOString(),mode:manifest.mode,productionDecisionsAllowed:false,fixtureTag:manifest.fixtureTag,complete:selected.length===humanTasks.length,tasks:[],blockedRequests:[],apiErrors:[],browserErrors:[],passed:false};
const browser=await chromium.launch({headless:!args.includes('--headed')});
const context=await browser.newContext({viewport:{width:1366,height:768},locale:'ar-EG',reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(20000);
const uploadLifecycles=new Set();
const knownCode=error=>/^[A-Z][A-Z0-9_:-]{2,100}$/u.test(String(error?.message))?error.message:'BROWSER_ACTION_FAILED';
page.on('pageerror',()=>report.browserErrors.push({code:'UNCAUGHT_PAGE_ERROR'}));
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),method=request.method();
 if(url.origin===base){
  let body;try{body=request.postDataJSON();}catch{/* An invalid JSON body never grants an upload capability. */}
  if(!production&&method==='POST'&&/^\/api\/admin\/storage\/uploads\/[^/]+\/(parts|finish|abort|resume)$/u.test(url.pathname)&&!uploadLifecycles.has(url.pathname)){
   // Real response.json() is asynchronous; wait for the observer to register
   // its returned ID before the browser's next lifecycle request is admitted.
   for(let attempt=0;attempt<100&&!uploadLifecycles.has(url.pathname);attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  }
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!allowedHumanApplicationWrite(method,url.pathname,manifest,body)&&!(method==='POST'&&uploadLifecycles.has(url.pathname))){report.blockedRequests.push({kind:'application-write',path:url.pathname});await route.abort();return;}
 }else if(['http:','https:'].includes(url.protocol)){
  const read=['GET','HEAD','OPTIONS'].includes(method)&&(manifest.allowedReadOrigins??[]).includes(url.origin);
  const upload=!production&&method==='PUT'&&(manifest.allowedUploadOrigins??[]).includes(url.origin);
  if(!read&&!upload){report.blockedRequests.push({kind:'external-request',method,origin:url.origin});await route.abort();return;}
 }
 await route.continue();
});
context.on('response',async response=>{
 const url=new URL(response.url());
 if(url.origin!==base)return;
 if(url.pathname.startsWith('/api/')&&response.status()>=400)report.apiErrors.push({path:url.pathname,status:response.status()});
 // Only real prepare responses may authorize subsequent upload lifecycle calls.
 // This handler never changes responses or sends its own request.
 if(!production&&url.pathname==='/api/admin/storage/uploads'&&response.request().method()==='POST'&&response.ok()){
  try{const json=await response.json(),data=json.data;if(typeof data?.storageObjectId==='string'&&/^[a-zA-Z0-9_-]+$/u.test(data.storageObjectId))for(const action of ['finish','abort','parts','resume'])uploadLifecycles.add(`/api/admin/storage/uploads/${data.storageObjectId}/${action}`);}catch{report.browserErrors.push({code:'UPLOAD_PREPARE_RESPONSE_INVALID'});}
 }
});
async function visible(locator){const until=performance.now()+20000;do{for(let i=0;i<await locator.count();i++)if(await locator.nth(i).isVisible())return locator.nth(i);await new Promise(resolve=>setTimeout(resolve,50));}while(performance.now()<until);throw new Error('VISIBLE_TARGET_REQUIRED');}
async function enabled(locator){const target=await visible(locator);const until=performance.now()+20000;while(!await target.isEnabled()&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,50));if(!await target.isEnabled())throw new Error('UI_TARGET_DISABLED');return target;}
async function click(budget,locator,label){const target=await enabled(locator);budget.activate(label);await target.click();}
async function heading(name){await page.getByRole('heading',{level:1,name,exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);}
async function start(){await page.goto(base+'/admin');await heading('ابدأ من هنا');}
async function focusByTab(budget,locator){
 const target=await visible(locator);
 for(let attempt=0;attempt<1000&&!await target.isEnabled();attempt++)await new Promise(resolve=>setTimeout(resolve,20));
 if(!await target.isEnabled())throw new Error('KEYBOARD_TARGET_DISABLED');
 for(let i=0;i<180;i++){if(await target.evaluate(el=>document.activeElement===el))return target;await page.keyboard.press('Tab');budget.tabPresses++;}
 throw new Error('KEYBOARD_TARGET_UNREACHABLE');
}
async function type(budget,locator,value){const target=await focusByTab(budget,locator);await target.fill(value);budget.fieldsTyped++;}
async function choose(budget,locator,value,label){
 const target=await focusByTab(budget,locator);
 const options=await target.locator('option').evaluateAll(items=>items.filter(o=>!o.disabled).map(o=>o.value));
 if(!options.includes(String(value)))throw new Error('REAL_SELECT_OPTION_UNAVAILABLE');
 budget.activate(label,'keyboard');budget.selections++;
 await page.keyboard.press('Home');
 for(let i=0;i<options.length+1;i++){if(await target.inputValue()===String(value))return;await page.keyboard.press('ArrowDown');}
 throw new Error('KEYBOARD_SELECTION_FAILED');
}
async function responseTo(path,action){const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).origin===base&&new URL(r.url()).pathname===path&&r.request().method()==='POST'),action()]);if(!response.ok())throw new Error('REAL_UI_MUTATION_REJECTED');return response.json();}
async function link(budget,path,label){await click(budget,page.locator(`a[href="${path}"]`),label);}
async function playAudio(budget){
 const audio=page.locator('audio').first();await audio.waitFor({state:'attached'});
 await click(budget,page.getByRole('button',{name:'تشغيل العينة',exact:true}).first(),'play-sample');
 await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>0&&audio.readyState>=2;},null,{timeout:60000});
 const before=await audio.evaluate(el=>el.currentTime);
 await page.waitForFunction(before=>{const audio=document.querySelector('audio');return audio&&audio.currentTime>before+.2;},before,{timeout:20000});
 // No programmatic pause or playback: leaving this room stops its real player.
 const samplesAvailable=await page.locator('.admin-audio-samples>section').count();if(samplesAvailable!==3)throw new Error('THREE_REAL_LISTENING_SAMPLES_REQUIRED');
 return{realAudioPlayed:true,samplesAvailable};
}
async function readDecisionEvidence(){await page.getByRole('heading',{name:/ما الذي نعرفه|العينات الثلاث|قرارك/u}).first().waitFor();}
async function localNote(budget,id){await type(budget,page.locator(`#decision-note-${id}`),'BATCH5_HUMAN_QA: local disposable fixture; this is not a human approval of the source recording.');}
const handlers={
 async M1(b){
  await link(b,'/admin/listening','open-listening-queue');await heading('غرفة الاستماع');
  await link(b,`/admin/listening/${t.voice.recitationId}`,'open-voice-target');await heading('استمع ثم قرّر');await readDecisionEvidence();
  const evidence=await playAudio(b);
  if(!production){await localNote(b,t.voice.reviewId);await responseTo(`/api/admin/reviews/${t.voice.reviewId}/decision`,()=>click(b,page.getByRole('button',{name:'الصوت مطابق',exact:true}),'confirm-fixture-voice'));}
  return{...evidence,decision:production?'not_attempted_read_only':'local_fixture_ui_completed'};
 },
 async M2(b){
  await link(b,'/admin/provider-licenses','open-provider-licenses');await heading('تراخيص المزوّدين');
  const card=page.locator('article').filter({has:page.getByRole('heading',{level:2,name:t.provider.name,exact:true})});await card.getByText('اقرأ الشروط الأصلية كاملة',{exact:true}).waitFor();
  if(!production){await type(b,page.locator(`#decision-evidence-${t.provider.reviewId}`),'BATCH5_HUMAN_QA: isolated provider fixture; no production rights decision');await type(b,page.locator(`#license-confirm-${t.provider.reviewId}`),t.provider.code);await localNote(b,t.provider.reviewId);await responseTo(`/api/admin/reviews/${t.provider.reviewId}/decision`,()=>click(b,card.getByRole('button',{name:'أسمح بالاستخدام',exact:true}),'permit-fixture-provider'));}
  return{termsAndEvidenceVisible:true,decision:production?'not_attempted_read_only':'local_fixture_ui_completed'};
 },
 async M3(b){
  await link(b,'/admin/labels','open-labels');await heading('الأسماء الوصفية');
  const field=page.locator(`#label-ar-${t.label.recitationId}`);await field.waitFor();
  if(!production){await type(b,field,t.label.labelArAfter);const card=field.locator('xpath=ancestor::article');await responseTo(`/api/admin/labels/${t.label.recitationId}/approve`,()=>click(b,card.getByRole('button',{name:'احفظ الاسم ووافق عليه',exact:true}),'save-fixture-label'));}else if(await field.inputValue()!==t.label.labelArBefore)throw new Error('LABEL_READ_BASELINE_MISMATCH');
  return{labelFieldVisible:true,decision:production?'not_attempted_read_only':'local_fixture_ui_completed'};
 },
 async M4(b){
  await link(b,'/admin/reciters','open-readers');await heading('القراء');
  const control=await visible(page.getByRole('switch',{name:'إظهار القارئ '+t.reader.nameAr,exact:true}));
  if((await control.getAttribute('aria-checked')==='true')!==t.reader.visibleBefore)throw new Error('READER_VISIBILITY_BASELINE_MISMATCH');
  if(!production){for(const label of ['toggle-fixture-reader','restore-fixture-reader'])await responseTo(`/api/admin/catalog/reciters/${t.reader.id}/visibility`,()=>click(b,control,label));if((await control.getAttribute('aria-checked')==='true')!==t.reader.visibleBefore)throw new Error('READER_VISIBILITY_NOT_RESTORED');}
  return{controlVisible:true,restored:production?'unchanged_read_only':true};
 },
 async M5(b){
  await link(b,'/admin/recitations','open-recordings');await heading('التلاوات والمصادر');
  const row=await visible(page.locator('tbody tr,.admin-mobile-cards article').filter({has:page.locator(`a[href="/admin/listening/${t.hidden.recitationId}"]`)}));
  await click(b,row.getByRole('button',{name:'تفاصيل',exact:true}),'open-hidden-reasons');
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'لماذا لا تظهر للعامة؟',exact:true}).waitFor();await dialog.getByText(t.hidden.reasonText,{exact:true}).waitFor();
  return{actualStoredVisibilityReasonVisible:true};
 },
 async M6(b){
  await link(b,'/admin/licensed-audio','open-licensed-recordings');await heading('ملفات صوت YouTube المرخّصة');
  await link(b,`/admin/licensed-audio/${t.youtube.recitationId}`,'open-upload-target');
  const file=page.locator('#licensed-audio-files');await file.waitFor();
  if(production){await page.getByRole('heading',{name:'رفع ملفات صوت مرخّصة',exact:true}).waitFor();return{uploadUiVisible:true,upload:'not_attempted_read_only',rightsGateDisabled:!await file.isEnabled()};}
  await type(b,page.locator(`#decision-evidence-${t.youtube.rightsReviewId}`),t.youtube.rightsEvidenceRef);await localNote(b,t.youtube.rightsReviewId);
  await responseTo(`/api/admin/reviews/${t.youtube.rightsReviewId}/decision`,()=>click(b,page.getByRole('region',{name:'قرار المراجعة'}).getByRole('button',{name:'موافق',exact:true}),'approve-fixture-owned-audio-rights'));
  await enabled(file);
  const bytes=await readFile(t.youtube.audioFile);if(createHash('sha256').update(bytes).digest('hex')!==t.youtube.sha256)throw new Error('OWNED_AUDIO_FILE_SHA_MISMATCH');
  b.activate('choose-owned-audio-file');const chooser=page.waitForEvent('filechooser');await file.click();await (await chooser).setFiles(t.youtube.audioFile);
  const prepared=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/storage/uploads'&&r.request().method()==='POST');
  const finished=page.waitForResponse(r=>new URL(r.url()).origin===base&&/\/storage\/uploads\/[^/]+\/finish$/u.test(new URL(r.url()).pathname),{timeout:120000});
  const [prepareResponse,finishResponse]=await Promise.all([prepared,finished,click(b,page.getByRole('button',{name:'ابدأ الرفع أو استأنف',exact:true}),'start-fixture-upload')]);
  if(!prepareResponse.ok())throw new Error('ACTUAL_UPLOAD_PREPARE_FAILED');
  if(!finishResponse.ok())throw new Error('ACTUAL_UPLOAD_FINISH_FAILED');
  return{upload:'actual_owned_fixture_upload_completed',source:'user_owned_test_audio',youtubeAudioExtracted:false};
 },
 async M7(b){
  b.step('open-wizard');await link(b,'/admin/reciter-wizard','open-reader-wizard');await heading('أضف قارئًا وتلاوة دون كود');
  if(production){await page.getByRole('heading',{level:2,name:'القارئ',exact:true}).waitFor();return{wizardVisible:true,creation:'not_attempted_read_only',plannedWizardSteps:5};}
  b.step('reader-details');for(const [id,value] of [['wizard-name-ar',t.wizard.nameAr],['wizard-name-en',t.wizard.nameEn],['wizard-country',t.wizard.country],['wizard-photo',t.wizard.photoUrl]])if(value)await type(b,page.locator('#'+id),value);
  await click(b,page.getByRole('button',{name:'التالي',exact:true}),'wizard-next-reader');
  b.step('recording-details');await type(b,page.locator('#wizard-label-ar'),t.wizard.displayLabelAr);await type(b,page.locator('#wizard-slug'),t.wizard.slug);await choose(b,page.locator('#wizard-riwayah'),t.wizard.riwayahCode,'choose-riwayah');
  await click(b,page.getByRole('button',{name:'التالي',exact:true}),'wizard-next-recording');
  b.step('source-details');await choose(b,page.locator('#wizard-provider'),t.wizard.providerId,'choose-provider');await type(b,page.locator('#wizard-pattern'),t.wizard.pattern);
  await click(b,page.getByRole('button',{name:'التالي',exact:true}),'wizard-next-source');
  b.step('live-source-check');const checked=await responseTo('/api/admin/reciter-wizard/validate',()=>click(b,page.getByRole('button',{name:'اختبر المصدر والتوقيت الآن',exact:true}),'check-real-source'));
  if(checked.data?.valid!==true)throw new Error('REAL_WIZARD_SOURCE_CHECK_FAILED');
  await click(b,page.getByRole('button',{name:'التالي',exact:true}),'wizard-next-review');
  b.step('review-unpublished-draft');const created=await responseTo('/api/admin/reciter-wizard',()=>click(b,page.getByRole('button',{name:'أنشئ المسودة غير الظاهرة',exact:true}),'create-fixture-draft'));await page.getByRole('heading',{name:'أُنشئت المسودة',exact:true}).waitFor();
  return{creation:'local_fixture_ui_completed',createdReciterId:created.data?.reciter_id,createdRecitationId:created.data?.id,liveChecks:checked.data?.checks?.map(check=>({surah:check.surah,status:check.status,httpStatus:check.http_status})),published:false};
 },
 async M8(b){
  await link(b,'/admin/render-lab','open-render-lab');await heading('تجربة فيديو حقيقية');
  let id=t.render.existingJobId;
  if(!production){await choose(b,page.locator('#render-reader'),t.render.reciterId,'choose-render-reader');await choose(b,page.locator('#render-recitation'),t.render.recitationId,'choose-render-recording');await choose(b,page.locator('#render-surah'),t.render.surah,'choose-render-chapter');await type(b,page.locator('#render-from'),String(t.render.ayahFrom));await type(b,page.locator('#render-to'),String(t.render.ayahTo));const created=await responseTo('/api/admin/render-lab/jobs',()=>click(b,page.getByRole('button',{name:'أنشئ فيديو تجريبيًا',exact:true}),'create-real-render'));id=created.data?.id;}
  else{if(!id)throw new Error('EXISTING_PRODUCTION_RENDER_FIXTURE_REQUIRED');await click(b,page.locator(`[data-admin-render-job="${id}"]`),'view-existing-real-render');}
  const video=page.getByLabel('الفيديو التجريبي الناتج',{exact:true});await video.waitFor({timeout:20*60*1000});
  await focusByTab(b,video);b.activate('play-native-video-keyboard','keyboard');await page.keyboard.press('Space');
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.2&&v.readyState>=2;},null,{timeout:60000});await page.getByRole('heading',{name:'ملخص الجودة',exact:true}).waitFor();
  return{jobId:id,realVideoPlayed:true,qualitySummaryVisible:true,created:!production};
 },
 async M9(b){await link(b,'/admin/project','open-project-status');await heading('ما اكتمل وما تبقّى');for(const code of ['D5','D8'])await page.locator('.admin-stage').filter({has:page.getByRole('heading',{level:2,name:new RegExp('^'+code+'\\b','u')})}).waitFor();await page.getByRole('heading',{name:'ما المطلوب مني؟',exact:true}).waitFor();return{blockedStagesAndOwnerTasksVisible:true};},
 async M10(b){await link(b,'/admin/storage#renewal','open-storage-renewal');await heading('مركز التخزين');const section=page.locator('#renewal');await section.getByRole('heading',{name:'كيف تجدّد رموز R2؟',exact:true}).waitFor();if(await section.locator('ol li').count()<1)throw new Error('NUMBERED_R2_RENEWAL_STEPS_REQUIRED');return{renewal:'read_steps_only_no_credential_change',numberedSteps:await section.locator('ol li').count()};},
 async M11(b){
  await link(b,'/admin/availability','open-availability');await heading('مصفوفة إتاحة السور');
  const picker=page.getByRole('combobox',{name:'اختيار التلاوة',exact:true});
  // The current selection may itself be the target. Otherwise use the genuine
  // visible combobox and its search input, without injecting a route/query.
  if((await picker.textContent())?.trim()!==t.nearComplete.labelAr){
   await click(b,picker,'open-recitation-picker');
   const popup=page.locator('[data-radix-popper-content-wrapper]');await type(b,popup.locator('input'),t.nearComplete.labelAr);await click(b,popup.getByRole('button',{name:t.nearComplete.labelAr,exact:true}),'choose-near-complete-recording');
  }
  const chapter=page.locator('.admin-matrix button').filter({has:page.getByText(String(t.nearComplete.surah),{exact:true})});await click(b,chapter,'open-near-complete-chapter');
  const dialog=page.getByRole('dialog');await dialog.getByText('الكلمات الناقصة',{exact:true}).waitFor();
  const missing=await dialog.locator('dl>div').filter({has:dialog.getByText('الكلمات الناقصة',{exact:true})}).locator('dd').textContent();if(Number(missing)!==t.nearComplete.missingWords)throw new Error('MISSING_WORD_COUNT_MISMATCH');
  const section=dialog.locator('section').filter({has:dialog.getByRole('heading',{level:3,name:'الكلمات التي ينقصها توقيت',exact:true})});await section.waitFor();
  const words=section.locator('ul>li');if(await words.count()!==t.nearComplete.missingWords)throw new Error('HUMAN_MISSING_WORD_LIST_COUNT_MISMATCH');
  for(let index=0;index<await words.count();index++){const word=words.nth(index);await word.getByText(/الكلمة القانونية رقم\s+\d+/u).waitFor();if(!/[\u0600-\u06ff]/u.test(await word.locator('span').last().textContent()??''))throw new Error('HUMAN_MISSING_WORD_REASON_REQUIRED');}
  return{missingWordEvidenceVisible:true,humanWordPositionsAndReasonsVisible:true,expectedMissingWords:t.nearComplete.missingWords};
 },
 async M12(b){await link(b,'/admin/launch','open-launch-preview');await heading('قائمة الإطلاق والمعاينة');await page.getByRole('table',{name:/^معاينة الظهور الافتراضية/u}).waitFor();const button=page.getByRole('button',{name:'افتح الكتالوج للزوار',exact:true});if(await button.isEnabled())throw new Error('PUBLIC_CATALOG_OPEN_CONTROL_MUST_STAY_DISABLED');await page.locator('#catalog-open-reason').waitFor();return{hypotheticalPreviewVisible:true,publicCatalogOpenDisabled:true,flagUnchanged:true};},
};

try{
 await page.goto(base+'/admin');await page.locator('#admin-email').fill(auth.email);await page.locator('#admin-password').fill(auth.password);
 const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/auth/login');await page.locator('form button[type=submit]').click();if(!(await login).ok())throw new Error('REAL_QA_LOGIN_FAILED');await heading('ابدأ من هنا');
 if(await page.locator('.admin-app').getAttribute('lang')!=='ar'){await page.getByRole('button',{name:/تغيير اللغة|Change language/u}).click();await heading('ابدأ من هنا');}
 report.apiErrors=[];
 for(const task of humanTasks.filter(task=>selected.includes(task.id))){
  await start();const budget=new HumanTaskBudget(task,manifest.mode),beforeErrors=report.apiErrors.length,beforeBlocked=report.blockedRequests.length;
  try{
   const result=await handlers[task.id](budget);budget.enforce();
   if(report.apiErrors.length>beforeErrors||report.blockedRequests.length>beforeBlocked)throw new Error('TASK_NETWORK_GATE_FAILED');
   report.tasks.push(budget.result({passed:true,completion:production?'read_only_variant':'local_actual_ui',evidence:result}));
  }catch(error){report.tasks.push(budget.result({passed:false,code:knownCode(error)}));}
  // Evidence stays private. No traces, cookies, passwords, signed request URLs,
  // input values or arbitrary exception text are written to the report/log.
  await page.screenshot({path:join(output,task.id+'.png'),fullPage:true,animations:'disabled'});
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({task:task.id,passed:report.tasks.at(-1).passed,clicks:budget.clicks,steps:budget.steps,elapsedMs:report.tasks.at(-1).elapsedMs}));
 }
 report.finishedAt=new Date().toISOString();report.passed=report.complete&&report.tasks.length===humanTasks.length&&report.tasks.every(task=>task.passed)&&!report.blockedRequests.length&&!report.apiErrors.length&&!report.browserErrors.length;
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});if(!report.passed)process.exitCode=1;
}catch(error){report.failure={code:knownCode(error)};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.error(report.failure.code);process.exitCode=1;}finally{await context.close();await browser.close();}

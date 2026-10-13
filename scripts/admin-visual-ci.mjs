/** Strict visual acceptance against ephemeral real services. Never targets Railway. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import Redis from 'ioredis';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {loadAdminVisualScanner} from '../tooling/e2e/helpers/loadAdminVisualScanner.mjs';
import {buildAdminVisualRoutes,buildAdminVisualDialogs} from '../tooling/e2e/helpers/adminVisualInventory.mjs';
import {selectAdminVisualShard,expectedAdminVisualCases,adminVisualCaseName,ADMIN_VISUAL_SHARD_COUNT} from '../tooling/e2e/helpers/adminVisualSharding.mjs';
import {requireAdminVisualTier,shouldScanAdminVisualDialogs,adminVisualCombinationKey,adminVisualDialogReuseScope} from '../tooling/e2e/helpers/adminVisualTiers.mjs';
import {allowedAdminVisualWrite,prepareAdminVisualDialogContext,openAdminVisualResponsiveDialog} from '../tooling/e2e/helpers/adminVisualDialogPreparation.mjs';
import {measureAdminVisualAccessibility} from '../tooling/e2e/helpers/adminVisualAccessibility.mjs';
import {collectAdminVisualEvidence} from '../tooling/e2e/helpers/adminVisualPixelEvidence.mjs';
import {readAdminVisualReviewSnapshot,proveAdminVisualReviewInvariant} from '../tooling/e2e/helpers/adminVisualReviewProof.mjs';
import {guardAdminVisualEvaluate,withAdminVisualDeadline,startAdminVisualProgressCheckpoint,acquireAdminVisualNativeWorker} from '../tooling/e2e/helpers/adminVisualRuntimeGuards.mjs';
import {waitForAdminVisualPaint} from '../tooling/e2e/helpers/adminVisualPaint.mjs';
if(process.env.CI!=='true'||process.env.AYAHX_ADMIN_VISUAL_CI!=='1')throw new Error('EPHEMERAL_CI_ONLY');
const base=process.env.AYAHX_ADMIN_VISUAL_BASE??'http://127.0.0.1:3005',baseUrl=new URL(base);
if(baseUrl.protocol!=='http:'||!['localhost','127.0.0.1'].includes(baseUrl.hostname)||baseUrl.port!=='3005'||baseUrl.username||baseUrl.password||baseUrl.pathname!=='/'||baseUrl.search||baseUrl.hash||base!==baseUrl.origin)throw new Error('ADMIN_VISUAL_LOOPBACK_ORIGIN_REQUIRED');
const redisDb=process.env.AYAHX_ADMIN_VISUAL_REDIS_DB??'15';
if(!['13','15'].includes(redisDb))throw new Error('ADMIN_VISUAL_REDIS_DB_INVALID');
const directory=resolve(process.env.AYAHX_ADMIN_CI_PRIVATE_DIR??'');
const location=relative(process.cwd(),directory);
if(!process.env.AYAHX_ADMIN_CI_PRIVATE_DIR||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_DIRECTORY_OUTSIDE_GIT_REQUIRED');
if(!/^[01]$/u.test(process.env.AYAHX_ADMIN_VISUAL_SHARD_INDEX??'')||process.env.AYAHX_ADMIN_VISUAL_SHARD_COUNT!==String(ADMIN_VISUAL_SHARD_COUNT))throw new Error('ADMIN_VISUAL_SHARD_CONFIG_REQUIRED');
const shardIndex=Number(process.env.AYAHX_ADMIN_VISUAL_SHARD_INDEX);
const tier=requireAdminVisualTier(process.env.AYAHX_ADMIN_VISUAL_TIER??'tier1');
const budget=process.env.AYAHX_ADMIN_VISUAL_BUDGET_MINUTES===undefined?(tier==='tier1'?35:Infinity):Number(process.env.AYAHX_ADMIN_VISUAL_BUDGET_MINUTES);
if(budget!==Infinity&&(!Number.isInteger(budget)||budget<1))throw new Error('ADMIN_VISUAL_BUDGET_INVALID');
const deadline=Date.now()+budget*60000;
const checkDeadline=()=>{if(Date.now()>=deadline)throw new Error('ADMIN_VISUAL_BUDGET_EXHAUSTED');};
const fixture=JSON.parse(await readFile(join(directory,'fixture.json'),'utf8'));
if(fixture.seedProofSource!==undefined&&!['restored-private-backup','ephemeral-public-pinned-sources'].includes(fixture.seedProofSource))throw new Error('ADMIN_VISUAL_FIXTURE_SOURCE_INVALID');
if(!fixture.safeReviewId||!fixture.fixtureRoleSlug||!fixture.timingsRecitationId||!fixture.renderJobId)throw new Error('COMPLETE_ADMIN_VISUAL_FIXTURE_REQUIRED');
const output=join(directory,'evidence');await mkdir(output,{recursive:true,mode:0o700});
const source=await readFile('src/admin/AdminRoot.tsx','utf8');
// Inventory follows the actual router, including future additions. An unknown
// parameterized route fails instead of receiving a fabricated identifier.
const fullRouteInventory=buildAdminVisualRoutes(source,fixture),routeInventory=selectAdminVisualShard(fullRouteInventory,shardIndex),routes=routeInventory.map(route=>route.path);
async function adminSources(path){const result=[];for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())result.push(...await adminSources(child));else if(entry.name.endsWith('.tsx')&&!/\.(test|spec)\.tsx$/u.test(entry.name))result.push({path:child,source:await readFile(child,'utf8')});}return result;}
const dialogInventory=buildAdminVisualDialogs(await adminSources('src/admin'));
const scanner=await loadAdminVisualScanner();
const axe=await readFile('tooling/e2e/node_modules/axe-core/axe.min.js','utf8');
const extension=join(directory,'native-zoom-extension');await mkdir(extension,{recursive:true});
await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'AyahX CI native zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));
await writeFile(join(extension,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});chrome.tabs.onUpdated.addListener(()=>{});setInterval(()=>{void chrome.runtime.getPlatformInfo();},20000);');
const context=await chromium.launchPersistentContext(join(directory,'chrome-profile'),{channel:'chromium',headless:true,viewport:{width:1366,height:768},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
context.setDefaultTimeout(30000);
const redis=new Redis('redis://127.0.0.1:6380/'+redisDb,{maxRetriesPerRequest:1,retryStrategy:null});
const report={version:'admin-visual-ci-shard-2',startedAt:new Date().toISOString(),mode:'strict',tier,fixtureSource:fixture.seedProofSource??'ephemeral-public-pinned-sources',acceptanceScope:'partial-route-shard',shard:{index:shardIndex,count:ADMIN_VISUAL_SHARD_COUNT},fullRouteInventory,routeInventory,dialogInventory,routes,matrix:[],dialogs:[],apiErrors:[],browserErrors:[],blockedRequests:[],redisErrors:[],phase:'initialization',currentCase:null,activeDialog:null,passed:false,shardComplete:false};
redis.on('error',()=>report.redisErrors.push({code:'EPHEMERAL_REDIS_UNAVAILABLE'}));
// API responses are never mocked. This gate is read-only after real login.
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 const publicFont=url.protocol==='https:'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)&&request.method()==='GET';
 if(url.origin!==base&&!publicFont&&!['data:','blob:'].includes(url.protocol)){report.blockedRequests.push({kind:'external',path:url.origin+url.pathname});await route.abort();return;}
 let body;try{body=request.postDataJSON();}catch{/* Non-JSON cannot authorize the sole informational preview. */}
 if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!allowedAdminVisualWrite(request.method(),url.pathname,body,fixture)){report.blockedRequests.push({kind:'write',path:url.pathname});await route.abort();return;}
 await route.continue();
});
context.on('response',response=>{const url=new URL(response.url());if(url.origin===base&&url.pathname.startsWith('/api/')&&response.status()>=400)report.apiErrors.push({path:url.pathname,status:response.status()});});
const page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);
guardAdminVisualEvaluate(page,{remainingMs:()=>deadline-Date.now()});
const stopProgress=startAdminVisualProgressCheckpoint(report,output,{onError:()=>report.browserErrors.push({code:'ADMIN_VISUAL_PROGRESS_CHECKPOINT_FAILED'})});
page.on('pageerror',()=>report.browserErrors.push({code:'UNCAUGHT_PAGE_ERROR'}));
const extensionWorkerUrl=(await acquireAdminVisualNativeWorker(context,{remainingMs:()=>deadline-Date.now()})).url();
async function zoom(factor){
 const worker=await acquireAdminVisualNativeWorker(context,{expectedUrl:extensionWorkerUrl,remainingMs:()=>deadline-Date.now()});
 const actual=await worker.evaluate(async({base,factor})=>{if(chrome.runtime.getManifest().name!=='AyahX CI native zoom')throw new Error('NATIVE_ZOOM_EXTENSION_IDENTITY_REQUIRED');const tabs=await chrome.tabs.query({url:base+'/*'});if(tabs.length!==1)throw new Error('NATIVE_ZOOM_TARGET_REQUIRED');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},{base,factor});
 if(Math.abs(actual-factor)>.001)throw new Error('NATIVE_ZOOM_NOT_APPLIED');
 // Chrome's tab setting resolves before the page renderer necessarily applies
 // the zoom. Wait on its actual DPR, then two painted frames, never a sleep.
 await page.waitForFunction(factor=>Math.abs(devicePixelRatio-factor)<.02,factor,{polling:'raf',timeout:10000});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function settle(){
 await page.locator('.admin-app h1').first().waitFor({timeout:30000});
 await page.locator('.admin-table-placeholder,section[aria-busy=true],main[aria-busy=true],[data-admin-page-loading]').first().waitFor({state:'hidden',timeout:30000});
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
}
let evidenceSequence=0;
function directEvidenceCaseId(){return adminVisualCaseName(report.currentCase)+(report.activeDialog?'-dialog-'+report.activeDialog:'')+'-measure-'+(++evidenceSequence);}
async function directScan(touch){
 const raw=await page.evaluate(scanner,{mode:'strict',touch});
 if(!raw.indeterminate.length)return raw;
 return(await collectAdminVisualEvidence(page,{evidenceDir:output,caseId:directEvidenceCaseId(),scanner:raw})).scanner;
}
async function scanAll(touch){
 const scans=[];
 const bounds=await page.evaluate(()=>{const active=[...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].filter(el=>el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden').at(-1);return active?{total:innerHeight,step:innerHeight}:{total:document.documentElement.scrollHeight,step:Math.max(1,Math.floor(innerHeight*.8))};});
 for(let top=0;top<bounds.total;top+=bounds.step){checkDeadline();await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),top);await page.evaluate(waitForAdminVisualPaint);scans.push({scrollY:await page.evaluate(()=>scrollY),report:await directScan(touch)});}
 const panels=await page.evaluate(()=>{const active=[...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].filter(el=>el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden').at(-1),root=active??document.querySelector('.admin-app');return [root,...root.querySelectorAll('*')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map((e,id)=>{e.setAttribute('data-ci-scroll',String(id));return{id,total:e.scrollHeight,step:Math.max(1,Math.floor(e.clientHeight*.8))};});});
 for(const panel of panels){for(let top=0;top<panel.total;top+=panel.step){checkDeadline();await page.evaluate(({id,top})=>{const e=document.querySelector(`[data-ci-scroll="${id}"]`);e.scrollIntoView({block:'center',behavior:'instant'});e.scrollTop=top;}, {id:panel.id,top});await page.evaluate(waitForAdminVisualPaint);scans.push({panel:panel.id,scrollTop:top,report:await directScan(touch)});}await page.evaluate(id=>{document.querySelector(`[data-ci-scroll="${id}"]`).scrollTop=0;},panel.id);}
 await page.evaluate(()=>{scrollTo({top:0,behavior:'instant'});document.querySelectorAll('[data-ci-scroll]').forEach(e=>e.removeAttribute('data-ci-scroll'));});await page.evaluate(waitForAdminVisualPaint);return scans;
}
async function scanAccessibility(){
 await page.addScriptTag({content:axe});
 const raw=await page.evaluate(measureAdminVisualAccessibility);
 if(!raw.incomplete.length)return raw;
 return(await collectAdminVisualEvidence(page,{evidenceDir:output,caseId:directEvidenceCaseId(),accessibility:raw})).accessibility;
}
const measuredLaunchDialogs=new Map();
async function scanDialogs(caseId,touch){
 // Only explicitly marked non-submitting openers. Clicking arbitrary action
 // buttons would violate the read-only gate. No mocked routes or responses.
 const results=[],visited=new Set(),applicable=new Set(),previouslyMeasuredDialogs=[];
 async function explore(scope){
  const parentDialog=report.activeDialog;report.phase='dialog-context-preparation';
  const cleanup=await prepareAdminVisualDialogContext(page,scope,fixture);
  try{
   const slugs=await scope.locator('[data-admin-visual-open]').evaluateAll(elements=>[...new Set(elements.filter(el=>!el.matches(':disabled,[aria-disabled="true"]')).map(el=>el.getAttribute('data-admin-visual-open')))]);
   for(const slug of slugs){
    checkDeadline();
    if(visited.has(slug))continue;
  if(typeof slug!=='string'||!/^[a-z0-9-]+$/u.test(slug))throw new Error('INVALID_DIALOG_INVENTORY_ID');
  if(!dialogInventory.some(item=>item.slug===slug))throw new Error('UNDECLARED_DIALOG_OPENER:'+slug);
  const reuseScope=adminVisualDialogReuseScope(dialogInventory.find(dialog=>dialog.slug===slug),report.currentCase);
  const coverageKey=JSON.stringify([slug,reuseScope,adminVisualCombinationKey(report.currentCase)]);
  if(tier==='tier1'&&measuredLaunchDialogs.has(coverageKey)){previouslyMeasuredDialogs.push({slug,reuseScope,caseId:measuredLaunchDialogs.get(coverageKey)});visited.add(slug);continue;}
  const candidates=scope.locator(`[data-admin-visual-open="${slug}"]`);let opener;
  for(let index=0;index<await candidates.count();index++){const candidate=candidates.nth(index);if(await candidate.isVisible()&&await candidate.isEnabled()){opener=candidate;break;}}
  let responsiveOpened=false;
  if(!opener&&['mobile-nav','keyboard-help'].includes(slug)){
   report.activeDialog=slug;report.phase='dialog-responsive-preparation';
   responsiveOpened=await openAdminVisualResponsiveDialog(page,scope,slug,report.currentCase,zoom);
  }
  if(!opener&&!responsiveOpened)continue;
  applicable.add(slug);
  report.activeDialog=slug;report.phase='dialog-open';
  if(opener)await opener.click();
  visited.add(slug);
  const dialog=page.locator(`[data-admin-visual-dialog="${slug}"]`);
  report.phase='dialog-visible';
  await dialog.waitFor({state:'visible',timeout:10000});
  report.phase='dialog-data';
  await dialog.locator('[role=status][aria-label="جار التحميل"],[role=status][aria-label="Loading"]').first().waitFor({state:'hidden',timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  report.phase='dialog-scanner';const scans=await scanAll(touch);report.phase='dialog-axe';const accessibility=await scanAccessibility();
  const passed=scans.every(scan=>!scan.report.shouldFail)&&!accessibility.violations.length&&!accessibility.incomplete.length;
  if(tier==='tier1'&&passed)measuredLaunchDialogs.set(coverageKey,caseId);
  const result={slug,scans,accessibility,passed};results.push(result);report.pendingCase?.dialogs.push(result);report.dialogs.push({caseId,slug,passed,...(tier==='tier1'?{size:report.currentCase.size,zoom:report.currentCase.zoom,theme:report.currentCase.theme,lang:report.currentCase.lang}:{})});
  if(!passed)await page.screenshot({path:join(output,caseId+'-dialog-'+slug+'.png'),fullPage:true,animations:'disabled'});
  await explore(dialog);
  report.phase='dialog-close';report.activeDialog=slug;
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden',timeout:10000});
  report.activeDialog=parentDialog;
   }
  }finally{await cleanup();}
 }
 await explore(page.locator('.admin-app'));
 return{dialogs:results,applicableDialogs:[...applicable],previouslyMeasuredDialogs};
}
async function resetFixtureReadWindow(){
 // Reset ONLY this disposable fixture's read buckets between independently
 // measured routes. Real Redis gate remains active; rate-limit acceptance is a
 // separate real-service test, not inferred from this visual matrix.
 const hash=createHash('sha256').update(fixture.id).digest('hex'),bucket=Math.floor(Date.now()/60000);
 await redis.del(...[bucket-1,bucket,bucket+1].map(b=>`ayahx:admin-rate:read:${b}:${hash}`));
}
const scheduledCases=expectedAdminVisualCases(routeInventory,tier);
report.expectedCases=scheduledCases.length;
try{
 report.phase='login';
 await page.goto(base+'/admin');
 // The initial unauthenticated identity is expected and removed before matrix.
 await page.locator('#admin-email').fill(fixture.email);await page.locator('#admin-password').fill(fixture.password);
 const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/auth/login');await page.locator('form button[type=submit]').click();if((await login).status()!==200)throw new Error('REAL_CI_LOGIN_FAILED');await settle();report.apiErrors=[];
 report.phase='review-baseline';await resetFixtureReadWindow();report.reviewBaseline=await readAdminVisualReviewSnapshot(page.request,base);
 for(const route of routes){
  report.phase='route-navigation';report.currentCase={route};report.activeDialog=null;
  await resetFixtureReadWindow();await page.goto(base+route);await settle();
  for(const scheduled of scheduledCases.filter(item=>item.route===route)){
   checkDeadline();
   const {lang,size,zoom:factor,theme}=scheduled;
   report.currentCase=scheduled;report.phase='case-language';
   await page.setViewportSize({width:1366,height:768});await zoom(1);
   if(await page.locator('.admin-app').getAttribute('lang')!==lang)await page.locator('.admin-app header button').filter({hasText:/^(?:EN|ع)$/u}).click();
   await page.waitForFunction(lang=>document.querySelector('.admin-app')?.getAttribute('lang')===lang,lang);
   await page.setViewportSize(size);report.phase='case-zoom';await zoom(factor);
   report.phase='case-settle';report.activeDialog=null;
   await resetFixtureReadWindow();await page.evaluate(t=>{document.documentElement.classList.toggle('dark',t==='dark');localStorage.setItem('theme',t);},theme);await settle();
   const dpr=await page.evaluate(()=>devicePixelRatio);if(Math.abs(dpr-factor)>.02)throw new Error('NATIVE_ZOOM_DPR_MISMATCH');
   report.phase='page-scanner';const scans=await scanAll(size.width<768);report.phase='page-axe';const accessibility=await scanAccessibility();
   const name=adminVisualCaseName(scheduled);
   report.pendingCase={...scheduled,dpr,scans,accessibility,dialogs:[]};
   const {dialogs,applicableDialogs,previouslyMeasuredDialogs=[]}=shouldScanAdminVisualDialogs(scheduled,tier)?await scanDialogs(name,size.width<768):{dialogs:[],applicableDialogs:[]};report.phase='case-evidence';report.activeDialog=null;
   const passed=scans.every(s=>!s.report.shouldFail)&&!accessibility.violations.length&&!accessibility.incomplete.length&&dialogs.every(dialog=>dialog.passed);
   await writeFile(join(output,name+'.json'),JSON.stringify({...scheduled,dpr,scans,accessibility,applicableDialogs,previouslyMeasuredDialogs,dialogs,passed}));
   if(!passed)await page.screenshot({path:join(output,name+'.png'),fullPage:true,animations:'disabled'});
   report.matrix.push({caseId:name,...scheduled,dpr,passed,violations:scans.reduce((n,s)=>n+s.report.violations.length,0),indeterminate:scans.reduce((n,s)=>n+s.report.indeterminate.length,0),axeViolations:accessibility.violations.length,axeIncomplete:accessibility.incomplete.length});
   delete report.pendingCase;
   await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  }
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({shard:shardIndex,route,matrixCases:report.matrix.length,acceptanceScope:'partial-route-shard'}));
 }
 report.phase='coverage-verification';const expected=scheduledCases.length;
 report.dialogCoverage={scope:'observed-applicable-dialogs',passed:report.dialogs.every(dialog=>dialog.passed),fullDeclaredCoverage:'aggregate-only'};
 await resetFixtureReadWindow();report.phase='review-invariant';report.reviewsStayedPending=false;
 report.reviewAfter=await readAdminVisualReviewSnapshot(page.request,base);
 report.reviewInvariant=proveAdminVisualReviewInvariant(report.reviewBaseline,report.reviewAfter);
 report.reviewsStayedPending=report.reviewInvariant.unchanged;
 report.expectedCases=expected;report.finishedAt=new Date().toISOString();report.phase='finished';report.shardComplete=report.reviewsStayedPending&&report.dialogCoverage.passed&&report.matrix.length===expected&&report.matrix.every(row=>row.passed)&&!report.apiErrors.length&&!report.browserErrors.length&&!report.blockedRequests.length&&!report.redisErrors.length;
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));if(!report.shardComplete)process.exitCode=1;
}catch(error){report.finishedAt=new Date().toISOString();report.failure={code:/^ADMIN_VISUAL_(?:REVIEW_[A-Z_]+|HUMAN_REVIEWS_CHANGED|ROLE_FIXTURE_NOT_AVAILABLE|RESPONSIVE_OPENER_MISSING|EVALUATE_TIMEOUT|NATIVE_ZOOM_TIMEOUT|NATIVE_WORKER_UNAVAILABLE|NATIVE_WORKER_AMBIGUOUS|BUDGET_EXHAUSTED)$/u.test(error?.message??'')?error.message:report.activeDialog?'ADMIN_VISUAL_DIALOG_FAILURE':'ADMIN_VISUAL_BROWSER_FAILURE',phase:report.phase,case:report.currentCase,dialog:report.activeDialog};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));process.exitCode=1;}finally{await stopProgress();await withAdminVisualDeadline(()=>context.close(),{code:'ADMIN_VISUAL_BROWSER_CLOSE_TIMEOUT',timeoutMs:15000});await redis.quit();}

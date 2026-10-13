/** Strict visual acceptance against ephemeral real services. Never targets Railway. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import Redis from 'ioredis';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {loadAdminVisualScanner} from '../tooling/e2e/helpers/loadAdminVisualScanner.mjs';
import {buildAdminVisualRoutes,buildAdminVisualDialogs,assertAdminVisualDialogCoverage} from '../tooling/e2e/helpers/adminVisualInventory.mjs';
import {allowedAdminVisualWrite,prepareAdminVisualDialogContext} from '../tooling/e2e/helpers/adminVisualDialogPreparation.mjs';
if(process.env.CI!=='true'||process.env.AYAHX_ADMIN_VISUAL_CI!=='1')throw new Error('EPHEMERAL_CI_ONLY');
const base='http://127.0.0.1:3005',directory=resolve(process.env.AYAHX_ADMIN_CI_PRIVATE_DIR??'');
const location=relative(process.cwd(),directory);
if(!process.env.AYAHX_ADMIN_CI_PRIVATE_DIR||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_DIRECTORY_OUTSIDE_GIT_REQUIRED');
const fixture=JSON.parse(await readFile(join(directory,'fixture.json'),'utf8'));
if(!fixture.safeReviewId||!fixture.fixtureRoleSlug||!fixture.timingsRecitationId||!fixture.renderJobId)throw new Error('COMPLETE_ADMIN_VISUAL_FIXTURE_REQUIRED');
const output=join(directory,'evidence');await mkdir(output,{recursive:true,mode:0o700});
const source=await readFile('src/admin/AdminRoot.tsx','utf8');
// Inventory follows the actual router, including future additions. An unknown
// parameterized route fails instead of receiving a fabricated identifier.
const routeInventory=buildAdminVisualRoutes(source,fixture),routes=routeInventory.map(route=>route.path);
async function adminSources(path){const result=[];for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())result.push(...await adminSources(child));else if(entry.name.endsWith('.tsx')&&!/\.(test|spec)\.tsx$/u.test(entry.name))result.push({path:child,source:await readFile(child,'utf8')});}return result;}
const dialogInventory=buildAdminVisualDialogs(await adminSources('src/admin'));
const scanner=await loadAdminVisualScanner();
const axe=await readFile('tooling/e2e/node_modules/axe-core/axe.min.js','utf8');
const extension=join(directory,'native-zoom-extension');await mkdir(extension,{recursive:true});
await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'AyahX CI native zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));
await writeFile(join(extension,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
const context=await chromium.launchPersistentContext(join(directory,'chrome-profile'),{channel:'chromium',headless:true,viewport:{width:1366,height:768},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const redis=new Redis('redis://127.0.0.1:6380/15',{maxRetriesPerRequest:1,retryStrategy:null});
const report={version:'admin-visual-ci-1',startedAt:new Date().toISOString(),mode:'strict',routeInventory,dialogInventory,routes,matrix:[],dialogs:[],apiErrors:[],browserErrors:[],blockedRequests:[],redisErrors:[],passed:false};
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
const page=await context.newPage();page.on('pageerror',()=>report.browserErrors.push({code:'UNCAUGHT_PAGE_ERROR'}));
const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
async function zoom(factor){
 const actual=await worker.evaluate(async({base,factor})=>{const tabs=await chrome.tabs.query({url:base+'/*'});if(tabs.length!==1)throw new Error('NATIVE_ZOOM_TARGET_REQUIRED');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},{base,factor});
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
async function scanAll(touch){
 const scans=[];
 const bounds=await page.evaluate(()=>{const active=[...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].filter(el=>el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden').at(-1);return active?{total:innerHeight,step:innerHeight}:{total:document.documentElement.scrollHeight,step:Math.max(1,Math.floor(innerHeight*.8))};});
 for(let top=0;top<bounds.total;top+=bounds.step){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),top);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));scans.push({scrollY:await page.evaluate(()=>scrollY),report:await page.evaluate(scanner,{mode:'strict',touch})});}
 const panels=await page.evaluate(()=>{const active=[...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].filter(el=>el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden').at(-1),root=active??document.querySelector('.admin-app');return [root,...root.querySelectorAll('*')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map((e,id)=>{e.setAttribute('data-ci-scroll',String(id));return{id,total:e.scrollHeight,step:Math.max(1,Math.floor(e.clientHeight*.8))};});});
 for(const panel of panels){for(let top=0;top<panel.total;top+=panel.step){await page.evaluate(({id,top})=>{const e=document.querySelector(`[data-ci-scroll="${id}"]`);e.scrollIntoView({block:'center',behavior:'instant'});e.scrollTop=top;}, {id:panel.id,top});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));scans.push({panel:panel.id,scrollTop:top,report:await page.evaluate(scanner,{mode:'strict',touch})});}await page.evaluate(id=>{document.querySelector(`[data-ci-scroll="${id}"]`).scrollTop=0;},panel.id);}
 await page.evaluate(()=>{scrollTo({top:0,behavior:'instant'});document.querySelectorAll('[data-ci-scroll]').forEach(e=>e.removeAttribute('data-ci-scroll'));});return scans;
}
async function scanAccessibility(){
 await page.addScriptTag({content:axe});
 return page.evaluate(async()=>{
  const dialogs=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(el).visibility!=='hidden';});
  const result=await axe.run(dialogs.at(-1)??document.querySelector('.admin-app'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
  return{violations:result.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target}))}))};
 });
}
async function scanDialogs(caseId,touch){
 // Only explicitly marked non-submitting openers. Clicking arbitrary action
 // buttons would violate the read-only gate. No mocked routes or responses.
 const results=[],visited=new Set();
 async function explore(scope){
  const cleanup=await prepareAdminVisualDialogContext(page,scope,fixture);
  try{
   const slugs=await scope.locator('[data-admin-visual-open]').evaluateAll(elements=>[...new Set(elements.filter(el=>!el.matches(':disabled,[aria-disabled="true"]')).map(el=>el.getAttribute('data-admin-visual-open')))]);
   for(const slug of slugs){
    if(visited.has(slug))continue;
  if(typeof slug!=='string'||!/^[a-z0-9-]+$/u.test(slug))throw new Error('INVALID_DIALOG_INVENTORY_ID');
  const candidates=scope.locator(`[data-admin-visual-open="${slug}"]`);let opener;
  for(let index=0;index<await candidates.count();index++){const candidate=candidates.nth(index);if(await candidate.isVisible()&&await candidate.isEnabled()){opener=candidate;break;}}
  if(!opener)continue;
  if(!dialogInventory.some(item=>item.slug===slug))throw new Error('UNDECLARED_DIALOG_OPENER:'+slug);
  await opener.click();
  visited.add(slug);
  const dialog=page.locator(`[data-admin-visual-dialog="${slug}"]`);
  await dialog.waitFor({state:'visible',timeout:10000});
  await dialog.locator('[role=status][aria-label="جار التحميل"],[role=status][aria-label="Loading"]').first().waitFor({state:'hidden',timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const scans=await scanAll(touch),accessibility=await scanAccessibility();
  const passed=scans.every(scan=>!scan.report.shouldFail)&&!accessibility.violations.length&&!accessibility.incomplete.length;
  const result={slug,scans,accessibility,passed};results.push(result);report.dialogs.push({caseId,slug,passed});
  if(!passed)await page.screenshot({path:join(output,caseId+'-dialog-'+slug+'.png'),fullPage:true,animations:'disabled'});
  await explore(dialog);
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden',timeout:10000});
   }
  }finally{await cleanup();}
 }
 await explore(page.locator('.admin-app'));
 return results;
}
async function resetFixtureReadWindow(){
 // Reset ONLY this disposable fixture's read buckets between independently
 // measured routes. Real Redis gate remains active; rate-limit acceptance is a
 // separate real-service test, not inferred from this visual matrix.
 const hash=createHash('sha256').update(fixture.id).digest('hex'),bucket=Math.floor(Date.now()/60000);
 await redis.del(...[bucket-1,bucket,bucket+1].map(b=>`ayahx:admin-rate:read:${b}:${hash}`));
}
const sizes=[{width:1366,height:768},{width:1536,height:864},{width:1920,height:1080},{width:390,height:844}];
const zoomFactors=[1,1.25,1.5,2];
try{
 await page.goto(base+'/admin');
 // The initial unauthenticated identity is expected and removed before matrix.
 await page.locator('#admin-email').fill(fixture.email);await page.locator('#admin-password').fill(fixture.password);
 const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/auth/login');await page.locator('form button[type=submit]').click();if((await login).status()!==200)throw new Error('REAL_CI_LOGIN_FAILED');await settle();report.apiErrors=[];
 for(const route of routes){
  await resetFixtureReadWindow();await page.goto(base+route);await settle();
  for(const lang of ['ar','en']){
   await page.setViewportSize(sizes[0]);await zoom(1);
   if(await page.locator('.admin-app').getAttribute('lang')!==lang)await page.getByRole('button',{name:/تغيير اللغة|Change language/u}).click();
   await page.waitForFunction(lang=>document.querySelector('.admin-app')?.getAttribute('lang')===lang,lang);
   for(const size of sizes){await page.setViewportSize(size);for(const factor of zoomFactors){await zoom(factor);for(const theme of ['light','dark']){
    await resetFixtureReadWindow();await page.evaluate(t=>{document.documentElement.classList.toggle('dark',t==='dark');localStorage.setItem('theme',t);},theme);await settle();
    const dpr=await page.evaluate(()=>devicePixelRatio);if(Math.abs(dpr-factor)>.02)throw new Error('NATIVE_ZOOM_DPR_MISMATCH');
    const scans=await scanAll(size.width<768),accessibility=await scanAccessibility();
    const name=route.replace(/[^a-zA-Z0-9_-]/gu,'_')+`-${size.width}-${factor*100}-${theme}-${lang}`;
    const dialogs=await scanDialogs(name,size.width<768);
    const passed=scans.every(s=>!s.report.shouldFail)&&!accessibility.violations.length&&!accessibility.incomplete.length&&dialogs.every(dialog=>dialog.passed);
    await writeFile(join(output,name+'.json'),JSON.stringify({route,size,zoom:factor,theme,lang,dpr,scans,accessibility,dialogs,passed}));
    // Only failing visual evidence is uploaded; no cookies, traces or profile.
    if(!passed)await page.screenshot({path:join(output,name+'.png'),fullPage:true,animations:'disabled'});
    report.matrix.push({route,size,zoom:factor,theme,lang,passed,violations:scans.reduce((n,s)=>n+s.report.violations.length,0),indeterminate:scans.reduce((n,s)=>n+s.report.indeterminate.length,0),axeViolations:accessibility.violations.length,axeIncomplete:accessibility.incomplete.length});
   }}}
  }
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({route,matrixCases:report.matrix.length}));
 }
 const expected=routes.length*sizes.length*zoomFactors.length*2*2;
 try{assertAdminVisualDialogCoverage(dialogInventory,report.dialogs);report.dialogCoverage={passed:true};}catch(error){report.dialogCoverage={passed:false,code:error.message};}
 await resetFixtureReadWindow();report.reviewsStayedPending=true;
 for(const status of ['approved','rejected','deferred']){const response=await page.request.get(base+'/api/admin/reviews?status='+status+'&limit=1');if(!response.ok()){report.reviewsStayedPending=false;break;}const json=await response.json();if(Number(json.meta?.total)!==0)report.reviewsStayedPending=false;}
 report.expectedCases=expected;report.finishedAt=new Date().toISOString();report.passed=report.reviewsStayedPending&&report.dialogCoverage.passed&&report.matrix.length===expected&&report.matrix.every(row=>row.passed)&&!report.apiErrors.length&&!report.browserErrors.length&&!report.blockedRequests.length&&!report.redisErrors.length;
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}catch{report.failure={code:'ADMIN_VISUAL_BROWSER_FAILURE'};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));process.exitCode=1;}finally{await context.close();await redis.quit();}

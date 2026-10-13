/** Root-operated, read-only production QA. All captures and credentials stay private. */
import {readFile,writeFile,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {discoverAdminCaptureTargets,buildAdminCaptureInventory,filterAdminCaptureInventory,expectedAdminCaptureCases,assertAdminCaptureCoverage,assertAdminCaptureReadGates,assertAdminCaptureObservation,captureCaseKey,captureZooms} from '../tooling/e2e/helpers/adminVisualCapture.mjs';
import {adminVisualSizes,adminVisualLanguages,adminVisualThemes} from '../tooling/e2e/helpers/adminVisualSharding.mjs';

const local=process.argv.includes('--local'),phase=process.argv.includes('--after')?'after':'before';
const scanOnly=process.argv.includes('--scan-only');
const revisionIndex=process.argv.indexOf('--revision');
const revision=revisionIndex<0?'':process.argv[revisionIndex+1];
if(revisionIndex>=0&&(!revision||!/^[a-z0-9-]{1,24}$/u.test(revision)))throw new Error('EVIDENCE_REVISION_INVALID');
if(phase==='after'&&!revision)throw new Error('AFTER_CAPTURE_REVISION_REQUIRED');
const filtered=process.argv.includes('--routes'),publicOnly=process.argv.includes('--public-only'),partial=filtered||publicOnly;
const renderJobIndex=process.argv.indexOf('--render-job-id'),renderJobId=renderJobIndex<0?undefined:process.argv[renderJobIndex+1];
if(renderJobIndex>=0&&(!renderJobId||renderJobId.startsWith('--')))throw new Error('CAPTURE_RENDER_JOB_ID_REQUIRED');
const timingIndex=process.argv.indexOf('--timing-recitation-id'),timingsRecitationId=timingIndex<0?undefined:process.argv[timingIndex+1];
if(timingIndex>=0&&(!timingsRecitationId||timingsRecitationId.startsWith('--')))throw new Error('CAPTURE_TIMING_RECITATION_ID_REQUIRED');
// tsx adds external __name helpers; compile this trusted local module without
// keepNames before serializing its self-contained browser function.
const scanner=scanOnly?new Function((await transform(await readFile(new URL('../tooling/e2e/helpers/adminVisualScanner.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',keepNames:false,target:'es2022'})).code.replace(/export\s*\{[^}]*\};?/gu,'')+';return scanAdminVisualDocument;')():null;
const base=local?'http://localhost:3005':'https://ayahx.com';
const privateDir=join(process.env.LOCALAPPDATA,'AyahX','private-backups');
const account=JSON.parse(await readFile(join(privateDir,`batch5-${local?'local':'production'}-qa.json`),'utf8'));
if(account.state!=='active'||Date.parse(account.expiresAt)<=Date.now()||account.environment!==(local?'local':'production'))throw new Error('ACTIVE_OWNED_QA_ACCOUNT_REQUIRED');
const output=join(privateDir,`batch5-visual-${phase}-${local?'local':'production'}${scanOnly?'-scanner':process.argv.includes('--public-only')?'-public':''}${revision?'-'+revision:''}`);
await mkdir(output,{recursive:true});
// Every invocation, including resume, gets a fresh private profile/extension.
// Reusing a stale extension service worker can hang before any route is read.
const sessionDir=await mkdtemp(join(privateDir,`batch5-capture-${phase}-${local?'local':'production'}-${revision||'baseline'}-`));
const ext=join(sessionDir,'native-zoom-extension');
await mkdir(ext,{recursive:true});
await writeFile(join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'AyahX private native zoom verification',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));
await writeFile(join(ext,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
const context=await chromium.launchPersistentContext(join(sessionDir,'chrome-profile'),{channel:'chromium',headless:true,reducedMotion:'reduce',viewport:{width:1366,height:768},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const report=process.argv.includes('--resume')?JSON.parse(await readFile(join(output,'report.json'),'utf8')):{version:'admin-visual-capture-2',phase,environment:local?'local':'production',started_at:new Date().toISOString(),account_id:account.id,base,matrix:[],blocked_writes:[],network_errors:[],browser_errors:[],assets:{},public_references:[],complete:false,visual_capture_only:true};
if(report.phase!==phase||report.environment!==(local?'local':'production')||report.account_id!==account.id||report.base!==base)throw new Error('EVIDENCE_RESUME_CONTEXT_MISMATCH');
const tasks=[];
const pathOnly=url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return 'URL_UNAVAILABLE';}};
// Neither review decisions nor application mutations can leave this browser.
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 const own=url.origin===new URL(base).origin;
 if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!(own&&request.method()==='POST'&&['/api/admin/auth/login','/api/admin/auth/logout'].includes(url.pathname))){report.blocked_writes.push({method:request.method(),path:pathOnly(url.href)});await route.abort('blockedbyclient');return;}
 await route.continue();
});
context.on('response',response=>{
 const task=(async()=>{
  const path=pathOnly(response.url());
  if(response.status()>=400)report.network_errors.push({path,status:response.status()});
  if(/\.(?:js|css|woff2?|ttf)$/u.test(new URL(response.url()).pathname)&&response.ok()){
   const bytes=await response.body().catch(()=>null);if(bytes)report.assets[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
 })();tasks.push(task);
});
const page=await context.newPage();
page.on('pageerror',()=>report.browser_errors.push({kind:'pageerror',code:'UNCAUGHT_PAGE_ERROR'}));
page.on('console',message=>{if(message.type()==='error')report.browser_errors.push({kind:'console',code:'BROWSER_CONSOLE_ERROR',path:pathOnly(message.location()?.url??''),...( /Failed to load resource.*\b401\b/u.test(message.text())?{http_status:401}:{})});});
const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000});
const setZoom=async factor=>{
 const actual=await worker.evaluate(async({origin,factor})=>{const tabs=await chrome.tabs.query({url:origin+'/*'});if(tabs.length!==1)throw new Error('ZOOM_TARGET_NOT_UNIQUE');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},{origin:new URL(base).origin,factor});
 if(Math.abs(actual-factor)>0.001)throw new Error('NATIVE_ZOOM_NOT_APPLIED');
 // setZoom acknowledges the browser setting before its renderer may resize.
 await page.waitForFunction(factor=>Math.abs(devicePixelRatio-factor)<0.02,factor);
 return actual;
};
const settle=async()=>{
 const kit=new URL(page.url()).pathname==='/admin/_kit';
 if(kit)await page.locator('.admin-app main').first().waitFor();
 else await page.locator('.admin-app h1').first().waitFor();
 await page.locator('.admin-table-placeholder,[role=status][aria-label="جار التحميل"],[aria-busy=true]').first().waitFor({state:'hidden',timeout:30000});
 if(kit)await page.waitForFunction(()=>document.querySelector('.admin-app h1')||[...document.querySelectorAll('.admin-app [role=alert]')].some(el=>el.textContent.includes('ADMIN_FORBIDDEN')));
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
};
async function scanFullDocument(touch){
 const observations=[];
 const height=await page.evaluate(()=>({total:document.documentElement.scrollHeight,step:Math.max(1,Math.floor(innerHeight*.8))}));
 for(let y=0;y<height.total;y+=height.step){
  await page.evaluate(y=>{scrollTo({top:y,behavior:'instant'});},y);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  observations.push({scrollY:await page.evaluate(()=>scrollY),report:await page.evaluate(scanner,{mode:phase==='before'?'baseline':'strict',touch})});
 }
 // Nested panels can hide content independently of the document scrollbar.
 const containers=await page.evaluate(()=>[...document.querySelectorAll('.admin-app *')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map((e,i)=>{e.setAttribute('data-qa-scroll',String(i));return {id:i,total:e.scrollHeight,step:Math.max(1,Math.floor(e.clientHeight*.8))};}));
 for(const c of containers){for(let top=0;top<c.total;top+=c.step){await page.evaluate(({id,top})=>{const e=document.querySelector(`[data-qa-scroll="${id}"]`);e.scrollIntoView({block:'center',behavior:'instant'});e.scrollTop=top;}, {id:c.id,top});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));observations.push({container:c.id,scrollTop:top,report:await page.evaluate(scanner,{mode:phase==='before'?'baseline':'strict',touch})});}await page.evaluate(id=>{document.querySelector(`[data-qa-scroll="${id}"]`).scrollTop=0;},c.id);}
 await page.evaluate(()=>{scrollTo({top:0,behavior:'instant'});document.querySelectorAll('[data-qa-scroll]').forEach(e=>e.removeAttribute('data-qa-scroll'));});
 return observations;
}
// Baseline observations are evidence, never an acceptance exemption. The strict
// scanner adds the same declared thresholds to this matrix when available.
function observeDocument(){
 const root=document.querySelector('.admin-app')??document.body;
 const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&!e.closest('[aria-hidden=true]');};
 const text=[...root.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,classes:typeof e.className==='string'?e.className:'',font:parseFloat(s.fontSize),lineHeight:s.lineHeight,family:s.fontFamily,left:r.left,right:r.right,width:r.width,text:e.textContent.trim().slice(0,90)};});
 const controls=[...root.querySelectorAll('button,input,select,textarea,[role=button]')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,name:e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent.trim().slice(0,80),width:r.width,height:r.height};});
 return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenWidth:screen.width,visualScale:visualViewport.scale},bodyWidth:document.documentElement.scrollWidth,fontLoaded:document.fonts.check('15px Cairo'),fontStatus:[...document.fonts].map(f=>({family:f.family,status:f.status})),text,controls,fontsUnder15:text.filter(e=>e.font<15).length,controlsUnder40:controls.filter(e=>e.height<40).length};
}
try{
 await page.goto(base+'/admin');
 const identity=await page.evaluate(async()=>{const response=await fetch('/api/admin/auth/me',{credentials:'include'});return {status:response.status,data:response.ok?(await response.json()).data:null};});
 if(identity.status===200){if(identity.data.id!==account.id)throw new Error('OWNED_QA_SESSION_REQUIRED');}
 else{
  if(identity.status!==401)throw new Error('QA_IDENTITY_READ_FAILED');
  await page.locator('#admin-email').fill(account.email);await page.locator('#admin-password').fill(account.password);
  const signedIn=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/auth/login');
  await page.locator('form button[type=submit]').click();if((await signedIn).status()!==200)throw new Error('OWNED_QA_LOGIN_FAILED');
 }
 await settle();
 await Promise.all(tasks);
 // The unauthenticated /auth/me challenge is expected before real login. Keep
 // all asset and application failures; never clear the whole error inventory.
 const expectedAuth=report.network_errors.filter(error=>error.path===base+'/api/admin/auth/me'&&error.status===401);
 report.expected_auth_challenges=(report.expected_auth_challenges??0)+expectedAuth.length;
 report.network_errors=report.network_errors.filter(error=>!expectedAuth.includes(error));
 const expectedAuthConsole=report.browser_errors.filter(error=>error.kind==='console'&&error.path===base+'/api/admin/auth/me'&&error.http_status===401&&expectedAuth.length>0);
 report.expected_auth_console_challenges=(report.expected_auth_console_challenges??0)+expectedAuthConsole.length;
 report.browser_errors=report.browser_errors.filter(error=>!expectedAuthConsole.includes(error));
 const read=async path=>{
  const result=await page.evaluate(async path=>{const response=await fetch(path,{method:'GET',credentials:'include'});return{status:response.status,ok:response.ok,payload:response.ok?await response.json():null};},path);
  if(!result.ok){report.target_read_failure={path,status:result.status};throw new Error('CAPTURE_TARGET_GET_FAILED');}return result.payload;
 };
 let targets,inventory=[];
 if(!publicOnly){
  if(phase==='after')targets=await discoverAdminCaptureTargets(read,{renderJobId,timingsRecitationId,production:!local});
  else{const readers=await read('/api/admin/catalog/reciters?limit=1');targets={fixture:{reciterId:readers.data?.[0]?.id},limitations:[],targetEvidence:{source:'authenticated_get',baseline:'original13'}};}
  const routeSource=await readFile('src/admin/AdminRoot.tsx','utf8');inventory=buildAdminCaptureInventory(routeSource,targets.fixture,phase);
  const sourceSha=createHash('sha256').update(routeSource).digest('hex');
  if(report.route_source_sha256&&report.route_source_sha256!==sourceSha)throw new Error('EVIDENCE_RESUME_SOURCE_MISMATCH');
  report.route_source_sha256=sourceSha;
 }
 if(report.full_route_inventory&&JSON.stringify(report.full_route_inventory)!==JSON.stringify(inventory))throw new Error('EVIDENCE_RESUME_TARGET_MISMATCH');
 report.full_route_inventory=inventory;report.limitations=targets?.limitations??[{code:'PUBLIC_REFERENCE_ONLY',message:'تشغيل تشخيصي للواجهة العامة؛ لم يُلتقط جرد الأدمن.'}];report.target_evidence=targets?.targetEvidence??{source:'public_only'};
 const extra=process.argv.indexOf('--routes');
 if(filtered){if(!process.argv[extra+1]||process.argv[extra+1].startsWith('--'))throw new Error('CAPTURE_DIAGNOSTIC_ROUTES_REQUIRED');inventory=filterAdminCaptureInventory(inventory,JSON.parse(await readFile(process.argv[extra+1],'utf8')));}
 if(report.partial!==undefined&&report.partial!==partial||report.scan_only!==undefined&&report.scan_only!==scanOnly)throw new Error('EVIDENCE_RESUME_MODE_MISMATCH');
 report.partial=partial;report.scan_only=scanOnly;report.complete=false;report.visual_capture_only=true;
 report.route_inventory=inventory;report.expected_cases=expectedAdminCaptureCases(inventory,phase).length;
 assertAdminCaptureCoverage(inventory,report.matrix,phase,{partial,scanOnly,requireComplete:false});
 const done=new Set(report.matrix.map(captureCaseKey));
 // Resume trusts actual owned files, not a route count or a stale report flag.
 for(const row of report.matrix){
  const name=row.route.replaceAll('/','_').replace(/[^\w-]/gu,'_')+`-${row.size.width}x${row.size.height}-${row.zoom*100}-${row.theme}-${row.lang}`;
  const expected=resolve(output,name+'.json');if(await realpath(row.observationPath)!==await realpath(expected))throw new Error('CAPTURE_RESUME_FILE_PATH_INVALID');
  const evidence=JSON.parse(await readFile(expected,'utf8'));assertAdminCaptureObservation(row,evidence,phase,{scanOnly});
  if(!scanOnly){const screenshot=resolve(output,name+'.png');if(await realpath(row.screenshot)!==await realpath(screenshot)||createHash('sha256').update(await readFile(screenshot)).digest('hex')!==row.sha256)throw new Error('CAPTURE_RESUME_SCREENSHOT_SHA_INVALID');}
 }
 const routes=inventory.map(route=>route.path);
 for(const route of routes){
  if(expectedAdminCaptureCases([{path:route}],phase).every(row=>done.has(captureCaseKey(row))))continue;
  await page.goto(base+route);await settle();
  for(const lang of adminVisualLanguages){
   await page.setViewportSize({width:1366,height:768});await setZoom(1);
   if(await page.locator('.admin-app').getAttribute('lang')!==lang){await page.getByRole('button',{name:/تغيير اللغة|تبديل اللغة|Change language|Switch language/u}).click();await page.waitForFunction(lang=>document.querySelector('.admin-app')?.getAttribute('lang')===lang,lang);}
   for(const size of adminVisualSizes){
    await page.setViewportSize(size);
    for(const zoom of captureZooms(phase)){
     const actualZoom=await setZoom(zoom);
     for(const theme of adminVisualThemes){
      if(done.has(captureCaseKey({route,size,zoom,theme,lang})))continue;
      await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('theme',theme);},theme);await settle();
      const observation=await page.evaluate(observeDocument);
      if(Math.abs(observation.viewport.dpr-zoom)>0.02)throw new Error('NATIVE_ZOOM_DPR_MISMATCH');
      const name=route.replaceAll('/','_').replace(/[^\w-]/gu,'_')+`-${size.width}x${size.height}-${zoom*100}-${theme}-${lang}`;
      const screenshot=scanOnly?null:join(output,name+'.png');if(screenshot)await page.screenshot({path:screenshot,fullPage:true,animations:'disabled'});
      const scans=scanOnly?await scanFullDocument(size.width<768):null;
      const evidence={route,size,zoom:actualZoom,theme,lang,screenshot,sha256:screenshot?createHash('sha256').update(await readFile(screenshot)).digest('hex'):null,scans,...observation};
      const observationPath=join(output,name+'.json');await writeFile(observationPath,JSON.stringify(evidence));
      report.matrix.push({route,size,zoom:actualZoom,theme,lang,screenshot,sha256:evidence.sha256,observationPath,fontLoaded:observation.fontLoaded,fontsUnder15:observation.fontsUnder15,controlsUnder40:observation.controlsUnder40,viewport:observation.viewport,bodyWidth:observation.bodyWidth,...(scans?{scanner_violations:scans.reduce((n,s)=>n+s.report.violations.length,0),scanner_indeterminate:scans.reduce((n,s)=>n+s.report.indeterminate.length,0),scanner_pass:scans.every(s=>s.report.compliant)}:{})});
      done.add(captureCaseKey({route,size,zoom:actualZoom,theme,lang}));
     }
    }
   }
  }
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({captured_route:route,matrix_cases:report.matrix.length,environment:report.environment}));
 }
 for(const route of scanOnly?[]:['/','/create','/preview']){
  await page.setViewportSize({width:1536,height:864});await setZoom(1);await page.goto(base+route);await page.locator(route==='/preview'?'h3':'h1').first().waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  // Reveal existing viewport-triggered sections before a full-page screenshot.
  const publicHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
  for(let y=0;y<publicHeight;y+=600){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const path=join(output,`public${route.replaceAll('/','_')}-${theme}.png`);await page.screenshot({path,fullPage:true,animations:'disabled'});report.public_references.push({route,theme,path,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),observation:await page.evaluate(observeDocument)});}
 }
 await Promise.all(tasks);
 report.coverage=assertAdminCaptureCoverage(inventory,report.matrix,phase,{partial,scanOnly});
 if(phase==='after')assertAdminCaptureReadGates(report);
 report.complete=report.coverage.complete;report.finished_at=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({complete:report.complete,scope:report.coverage.scope,cases:report.matrix.length,expected_cases:report.expected_cases,public_references:report.public_references.length,limitation_codes:report.limitations.map(item=>item.code),network_errors:report.network_errors.length,browser_errors:report.browser_errors.length,blocked_writes:report.blocked_writes.length}));
}catch(error){await Promise.allSettled(tasks);const code=error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:'ADMIN_VISUAL_CAPTURE_FAILED';report.complete=false;report.failure={code};report.finished_at=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.error(code);process.exitCode=1;}finally{await context.close();}

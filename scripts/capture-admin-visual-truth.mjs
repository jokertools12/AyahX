/** Root-operated, read-only production QA. All captures and credentials stay private. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';

const local=process.argv.includes('--local'),phase=process.argv.includes('--after')?'after':'before';
const scanOnly=process.argv.includes('--scan-only');
const revisionIndex=process.argv.indexOf('--revision');
const revision=revisionIndex<0?'':process.argv[revisionIndex+1];
if(revision&&!/^[a-z0-9-]{1,24}$/u.test(revision))throw new Error('EVIDENCE_REVISION_INVALID');
// tsx adds external __name helpers; compile this trusted local module without
// keepNames before serializing its self-contained browser function.
const scanner=scanOnly?new Function((await transform(await readFile(new URL('../tooling/e2e/helpers/adminVisualScanner.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',keepNames:false,target:'es2022'})).code.replace(/export\s*\{[^}]*\};?/gu,'')+';return scanAdminVisualDocument;')():null;
const base=local?'http://localhost:3005':'https://ayahx.com';
const privateDir=join(process.env.LOCALAPPDATA,'AyahX','private-backups');
const account=JSON.parse(await readFile(join(privateDir,`batch5-${local?'local':'production'}-qa.json`),'utf8'));
if(account.state!=='active'||Date.parse(account.expiresAt)<=Date.now()||account.environment!==(local?'local':'production'))throw new Error('ACTIVE_OWNED_QA_ACCOUNT_REQUIRED');
const output=join(privateDir,`batch5-visual-${phase}-${local?'local':'production'}${scanOnly?'-scanner':process.argv.includes('--public-only')?'-public':''}${revision?'-'+revision:''}`);
await mkdir(output,{recursive:true});
const ext=join(privateDir,'batch5-zoom-extension');
await mkdir(ext,{recursive:true});
await writeFile(join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'AyahX private native zoom verification',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));
await writeFile(join(ext,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
const context=await chromium.launchPersistentContext(join(privateDir,`batch5-visual-profile-${local?'local':'production'}`),{channel:'chromium',headless:true,reducedMotion:'reduce',viewport:{width:1366,height:768},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const report=process.argv.includes('--resume')?JSON.parse(await readFile(join(output,'report.json'),'utf8')):{phase,environment:local?'local':'production',started_at:new Date().toISOString(),account_id:account.id,base,matrix:[],blocked_writes:[],network_errors:[],browser_errors:[],assets:{},public_references:[]};
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
page.on('pageerror',error=>report.browser_errors.push({kind:'pageerror',message:error.message}));
page.on('console',message=>{if(message.type()==='error')report.browser_errors.push({kind:'console',message:message.text()});});
const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
const setZoom=async factor=>{
 const actual=await worker.evaluate(async({origin,factor})=>{const tabs=await chrome.tabs.query({url:origin+'/*'});if(tabs.length!==1)throw new Error('ZOOM_TARGET_NOT_UNIQUE');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},{origin:new URL(base).origin,factor});
 if(Math.abs(actual-factor)>0.001)throw new Error('NATIVE_ZOOM_NOT_APPLIED');
 // setZoom acknowledges the browser setting before its renderer may resize.
 await page.waitForFunction(factor=>Math.abs(devicePixelRatio-factor)<0.02,factor);
 return actual;
};
const settle=async()=>{
 await page.locator('.admin-app h1').first().waitFor();
 await page.locator('.admin-table-placeholder,[role=status][aria-label="جار التحميل"],[aria-busy=true]').first().waitFor({state:'hidden',timeout:30000});
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
 const reciters=await page.evaluate(async()=>{const r=await fetch('/api/admin/catalog/reciters?limit=1',{credentials:'include'});if(!r.ok)throw new Error('RECITER_READ_FAILED');return r.json();});
 const reciterId=reciters.data[0]?.id;if(!reciterId)throw new Error('REAL_RECITER_REQUIRED');
 const routes=['/admin','/admin/roles','/admin/users','/admin/audit','/admin/settings','/admin/security','/admin/reciters','/admin/reciters/'+reciterId,'/admin/recitations','/admin/availability','/admin/providers','/admin/quran','/admin/timings'];
 const extra=process.argv.indexOf('--routes');if(extra>=0)routes.splice(0,routes.length,...JSON.parse(await readFile(process.argv[extra+1],'utf8')));
 if(process.argv.includes('--public-only'))routes.length=0;
 for(const route of routes){
  if(report.matrix.filter(row=>row.route===route).length===48)continue;
  await page.goto(base+route);await settle();
  for(const lang of ['ar','en']){
   await page.setViewportSize({width:1366,height:768});await setZoom(1);
   if(await page.locator('.admin-app').getAttribute('lang')!==lang){await page.getByRole('button',{name:/تغيير اللغة|Change language/u}).click();await page.waitForFunction(lang=>document.querySelector('.admin-app')?.getAttribute('lang')===lang,lang);}
   for(const size of [{width:1366,height:768},{width:1536,height:864},{width:1920,height:1080},{width:390,height:844}]){
    await page.setViewportSize(size);
    for(const zoom of [1,1.25,1.5]){
     const actualZoom=await setZoom(zoom);
     for(const theme of ['light','dark']){
      await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('theme',theme);},theme);await settle();
      const observation=await page.evaluate(observeDocument);
      if(Math.abs(observation.viewport.dpr-zoom)>0.02)throw new Error('NATIVE_ZOOM_DPR_MISMATCH');
      const name=route.replaceAll('/','_').replace(/[^\w-]/gu,'_')+`-${size.width}x${size.height}-${zoom*100}-${theme}-${lang}`;
      const screenshot=scanOnly?null:join(output,name+'.png');if(screenshot)await page.screenshot({path:screenshot,fullPage:true,animations:'disabled'});
      const scans=scanOnly?await scanFullDocument(size.width<768):null;
      const evidence={route,size,zoom:actualZoom,theme,lang,screenshot,sha256:screenshot?createHash('sha256').update(await readFile(screenshot)).digest('hex'):null,scans,...observation};
      const observationPath=join(output,name+'.json');await writeFile(observationPath,JSON.stringify(evidence));
      report.matrix.push({route,size,zoom:actualZoom,theme,lang,screenshot,sha256:evidence.sha256,observationPath,fontLoaded:observation.fontLoaded,fontsUnder15:observation.fontsUnder15,controlsUnder40:observation.controlsUnder40,viewport:observation.viewport,bodyWidth:observation.bodyWidth,...(scans?{scanner_violations:scans.reduce((n,s)=>n+s.report.violations.length,0),scanner_indeterminate:scans.reduce((n,s)=>n+s.report.indeterminate.length,0),scanner_pass:scans.every(s=>s.report.compliant)}:{})});
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
 await Promise.all(tasks);report.finished_at=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({complete:true,cases:report.matrix.length,public_references:report.public_references.length,network_errors:report.network_errors.length,browser_errors:report.browser_errors.length,blocked_writes:report.blocked_writes.length,private_output:output}));
 if(scanOnly&&phase==='after'&&report.matrix.some(row=>!row.scanner_pass))process.exitCode=1;
}catch(error){const code=error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:'ADMIN_VISUAL_CAPTURE_FAILED';console.error(code);process.exitCode=1;}finally{await context.close();}

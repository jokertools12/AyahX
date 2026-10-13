/** Root-operated real local browser regressions. No review writes or raw auth logs. */
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {waitForAdminVisualPaint} from '../tooling/e2e/helpers/adminVisualPaint.mjs';
const option=name=>{const at=process.argv.indexOf(name);if(at<0||!process.argv[at+1])throw new Error('PRIVATE_ARGUMENT_REQUIRED');return process.argv[at+1];};
const root=await realpath(process.cwd()),output=resolve(option('--output')),manifest=JSON.parse(await readFile(option('--manifest'),'utf8'));
const location=relative(root,output),base=new URL(manifest.baseUrl);
if(!location.startsWith('..')&&!isAbsolute(location)||!['localhost','127.0.0.1'].includes(base.hostname)||base.protocol!=='http:'||manifest.mode!=='local-mutations'||!manifest.prepared||manifest.cleaned)throw new Error('OWNED_LOCAL_RESTORED_FIXTURE_REQUIRED');
await mkdir(output,{recursive:true,mode:0o700});
const auth=JSON.parse(await readFile(manifest.authFile,'utf8'));
const extension=join(output,'zoom-extension');await mkdir(extension,{recursive:true});await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Local display regression native zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));await writeFile(join(extension,'background.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
const context=await chromium.launchPersistentContext(join(output,'profile'),{channel:'chromium',headless:true,viewport:{width:390,height:844},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
const report={scope:'three-local-display-regressions',startedAt:new Date().toISOString(),production:false,applicationWrites:0,blockedWrites:[],cases:[],passed:false};
await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!(url.origin===base.origin&&url.pathname==='/api/admin/auth/login'&&request.method()==='POST')){report.blockedWrites.push({path:url.pathname,method:request.method()});await route.abort();return;}await route.continue();});
const page=await context.newPage();
const paint=async()=>page.evaluate(waitForAdminVisualPaint);
const normalize=text=>text.normalize('NFC').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu,'').replace(/\s+/gu,' ').trim();
try{
 await page.goto(base.origin+'/admin');await page.locator('#admin-email').fill(auth.email);await page.locator('#admin-password').fill(auth.password);await page.locator('form button[type=submit]').click();await page.locator('.admin-task').first().waitFor();await paint();
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const zoom=async factor=>{await worker.evaluate(async({origin,factor})=>{const tabs=await chrome.tabs.query({url:origin+'/*'});if(tabs.length!==1)throw new Error('NATIVE_ZOOM_TARGET_REQUIRED');await chrome.tabs.setZoom(tabs[0].id,factor);},{origin:base.origin,factor});await page.waitForFunction(factor=>Math.abs(devicePixelRatio-factor)<.02,factor);await paint();};
 await zoom(1.5);
 const link=page.locator('.admin-two-columns .admin-card a[href="/admin/launch"]');await link.scrollIntoViewIfNeeded();await paint();
 const bounds=await link.evaluate(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);return{dpr:devicePixelRatio,height:r.height,top:r.top,bottom:r.bottom,textRects:[...range.getClientRects()].map(rect=>({top:rect.top,bottom:rect.bottom,height:rect.height})),heightStyle:getComputedStyle(el).height,lineHeight:getComputedStyle(el).lineHeight};});
 report.cases.push({name:'wrapped-launch-action',...bounds,passed:bounds.height>=44&&bounds.textRects.length>1&&bounds.textRects.every(r=>r.top>=bounds.top-.1&&r.bottom<=bounds.bottom+.1)});
 await page.setViewportSize({width:1366,height:768});await zoom(1);
 const cdp=await context.newCDPSession(page);
 for(const lang of ['ar','en']){
  if(await page.locator('.admin-app').getAttribute('lang')!==lang)await page.getByRole('button',{name:/تغيير اللغة|Change language/u}).click();await paint();
  const button=page.getByRole('button',{name:/تغيير اللغة|Change language/u}),visible=(await button.locator('span').innerText()).trim(),title=await button.getAttribute('title');
  const selector=await page.evaluate(title=>'.admin-topbar button[title="'+CSS.escape(title)+'"]',title),document=await cdp.send('DOM.getDocument'),node=await cdp.send('DOM.querySelector',{nodeId:document.root.nodeId,selector}),description=await cdp.send('DOM.describeNode',{nodeId:node.nodeId}),tree=await cdp.send('Accessibility.getPartialAXTree',{backendNodeId:description.node.backendNodeId,fetchRelatives:false});
  const ax=tree.nodes.find(item=>item.backendDOMNodeId===description.node.backendNodeId&&!item.ignored),name=ax?.name?.value??'';
  report.cases.push({name:'language-name-prefix',lang,visible,accessibleName:name,source:'Chromium Accessibility.getPartialAXTree',passed:ax?.role?.value==='button'&&normalize(name).startsWith(normalize(visible))});
 }
 await cdp.detach();await page.goto(base.origin+'/admin/_kit');await page.getByRole('heading',{level:1,name:'UI Kit — مكتبة المكوّنات'}).waitFor();
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);await page.getByRole('button',{name:'secondary',exact:true}).first().click();const toast=page.locator('[data-sonner-toast][data-front="true"]');await toast.waitFor();await paint();
  const metrics=await toast.evaluate(el=>{const s=getComputedStyle(el),text=el.querySelector('[data-title]'),t=getComputedStyle(text);const rgb=value=>value.match(/[\d.]+/gu)?.slice(0,3).map(Number);const luminance=values=>values.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const a=luminance(rgb(t.color)),b=luminance(rgb(s.backgroundColor));return{font:parseFloat(t.fontSize),lineRatio:parseFloat(t.lineHeight)/parseFloat(t.fontSize),filter:s.filter,backdropFilter:s.backdropFilter,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),opacity:s.opacity};});
  report.cases.push({name:'admin-toast',theme,...metrics,passed:metrics.font>=15&&metrics.lineRatio>=1.7&&metrics.filter==='none'&&metrics.backdropFilter==='none'&&metrics.contrast>=4.5&&Number(metrics.opacity)===1});
 }
 report.passed=report.cases.length===5&&report.cases.every(row=>row.passed)&&!report.blockedWrites.length;
}catch{report.failure={code:'LOCAL_DISPLAY_REGRESSION_EXECUTION_FAILED'};}finally{report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});await context.close();}
console.log(JSON.stringify({scope:report.scope,passed:report.passed,cases:report.cases,failure:report.failure??null}));if(!report.passed)process.exitCode=1;

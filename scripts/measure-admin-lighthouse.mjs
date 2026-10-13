/**
 * Root-only execution against the local production build; no raw LHR artifacts.
 * Setup waits use observed responses only and stay outside measurement time.
 * Other runners sharing this actor must be idle; their rate use is not visible
 * here. No models, paid calls, Redis clears, limit changes or HTTP retries.
 * Source/unit verification alone does not establish live Lighthouse acceptance.
 */
import { readFile,writeFile,mkdir,realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname,join,resolve,relative,isAbsolute } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import {discoverAdminCaptureTargets} from '../tooling/e2e/helpers/adminVisualCapture.mjs';
import {buildAdminLighthouseRoutes,summarizeAdminLighthouse} from '../tooling/e2e/helpers/adminLighthouse.mjs';
import {createAdminLighthouseProgress,classifyAdminLighthouseFailure} from '../tooling/e2e/helpers/adminLighthouseProgress.mjs';
import {withAdminVisualDeadline} from '../tooling/e2e/helpers/adminVisualRuntimeGuards.mjs';
import {createAdminReadWindows} from '../tooling/e2e/helpers/adminReadWindows.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw new Error('ARGUMENT_VALUE_REQUIRED');return process.argv[index+1];};
const requireE2e=createRequire(join(root,'tooling','e2e','package.json'));
const requireApp=createRequire(join(root,'package.json'));
async function privateInput(path){
 const absolute=await realpath(resolve(path)),workspace=await realpath(root),location=relative(workspace,absolute);
 if(!location||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_INPUT_OUTSIDE_GIT_REQUIRED');
 return absolute;
}
async function main(){
 const reportPath=resolve(argument('--report')??join(root,'docs','data','admin-lighthouse.json'));
 const progress=createAdminLighthouseProgress(async report=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});});
 const {report}=progress;let browser,page,cdp,chrome,measurementsDone=false;
 const deadline=Date.now()+45*60*1000;
 const bounded=(operation,timeoutMs=60000)=>withAdminVisualDeadline(operation,{code:'LIGHTHOUSE_PHASE_TIMEOUT',timeoutMs,remainingMs:()=>deadline-Date.now()});
 try{
  await progress.checkpoint('preflight');
  const base=new URL(argument('--base-url')??'http://localhost:3001');
  if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('LOCAL_ORIGIN_REQUIRED');
  report.setupRateWindowWaits=[];report.setupWaitMs=0;
  const readWindows=createAdminReadWindows({origin:base.origin,remainingMs:()=>deadline-Date.now(),onWait:async entry=>{
   let saved=report.setupRateWindowWaits.find(row=>row.startedAt===entry.startedAt);if(!saved){saved={...entry};report.setupRateWindowWaits.push(saved);await progress.checkpoint('rate_window_wait',entry.path);}else Object.assign(saved,entry);
   report.setupWaitMs=report.setupRateWindowWaits.reduce((sum,row)=>sum+row.waitMs,0);await progress.save();
  }});
  const assertNoRateLimit=()=>{if(report.apiErrors.some(row=>row.status===429))throw new Error('LIGHTHOUSE_API_RATE_LIMITED');};
  const beforeReadWindow=async(phase,path=null)=>{assertNoRateLimit();await readWindows.before(phase,path);assertNoRateLimit();Object.assign(report,{readWindows:readWindows.snapshot().readWindows,readWindowScope:'this_browser_responses_only'});await progress.save();};
  const defaultFixtures=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'AyahX','private-backups','a1-browser-fixtures.json'):undefined;
  const fixturePath=argument('--fixtures')??defaultFixtures;if(!fixturePath)throw new Error('PRIVATE_FIXTURE_PATH_REQUIRED');
  const fixtures=JSON.parse(await readFile(await privateInput(fixturePath),'utf8')),raw=fixtures.super_admin?.cookie;
  if(typeof raw!=='string')throw new Error('SUPER_ADMIN_FIXTURE_COOKIE_REQUIRED');
  const token=raw.startsWith('ayahx_admin_session=')?raw.slice('ayahx_admin_session='.length):raw;
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))throw new Error('FIXTURE_COOKIE_FORMAT_INVALID');
  const routesPath=argument('--routes'),requested=routesPath?JSON.parse(await readFile(await privateInput(routesPath),'utf8')):undefined;
  await progress.checkpoint('modules');
  const [{default:lighthouse},chromeLauncher,{default:puppeteer}]=await Promise.all([import(pathToFileURL(requireE2e.resolve('lighthouse')).href),import(pathToFileURL(requireE2e.resolve('chrome-launcher')).href),import(pathToFileURL(requireApp.resolve('puppeteer-core')).href)]);
  const {default:desktopConfig}=await import(pathToFileURL(join(dirname(requireE2e.resolve('lighthouse')),'config','desktop-config.js')).href);
  Object.assign(report,{lighthouseVersion:JSON.parse(await readFile(join(dirname(requireE2e.resolve('lighthouse')),'..','package.json'),'utf8')).version,settings:{formFactor:'desktop',disableStorageReset:true,authentication:'HttpOnly SameSiteStrict cookie scoped to local hostname /api/admin',rawArtifactsPersisted:false,runtimeBudgetsMs:{job:45*60*1000,navigate:60000,settle:45000,lighthouse:120000,evaluate:30000,cleanup:15000},readWindowSetup:{observedGetThreshold:18,windowMs:60000,boundaryMarginMs:100,maxTimerChunkMs:30000,serverRateLimitUnchanged:true,measurementThrottled:false}},thresholds:{accessibility:95,bestPractices:95,cls:.1}});
  await progress.checkpoint('chrome_launch');
  chrome=await bounded(()=>chromeLauncher.launch({chromePath:argument('--chrome-path'),chromeFlags:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check'],handleSIGINT:true,logLevel:'silent'}));
  await progress.checkpoint('connect');
  browser=await bounded(()=>puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`}));page=await bounded(()=>browser.newPage());cdp=await bounded(()=>page.createCDPSession());
  await progress.checkpoint('authenticate');
  const installed=await bounded(()=>cdp.send('Network.setCookie',{name:'ayahx_admin_session',value:token,domain:base.hostname,path:'/api/admin',httpOnly:true,secure:base.protocol==='https:',sameSite:'Strict'}));
  if(!installed.success)throw new Error('SCOPED_FIXTURE_COOKIE_REJECTED');
  await bounded(()=>page.setRequestInterception(true));
  page.on('request',request=>{const url=new URL(request.url());if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.blockedWrites.push({method:request.method(),path:url.pathname});void request.abort();}else void request.continue();});
  page.on('response',response=>{const url=new URL(response.url());readWindows.observe(response.request().method(),response.url());report.readWindows=readWindows.snapshot().readWindows;if(url.origin===base.origin&&url.pathname.startsWith('/api/')&&response.status()>=400)report.apiErrors.push({path:url.pathname,status:response.status()});});
  report.chromeVersion=await bounded(()=>browser.version());
  await beforeReadWindow('bootstrap','/admin');await progress.checkpoint('navigate','/admin');await bounded(()=>page.goto(base.origin+'/admin',{waitUntil:'networkidle0',timeout:60000}));assertNoRateLimit();
  await progress.checkpoint('settle','/admin');await bounded(()=>page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000}),45000);
  await progress.checkpoint('discover');
  const read=async path=>{await beforeReadWindow('discovery');await progress.checkpoint('discover');const result=await bounded(()=>page.evaluate(async path=>{const response=await fetch(path,{method:'GET',credentials:'include'});return{ok:response.ok,payload:response.ok?await response.json():null};},path),30000);assertNoRateLimit();if(!result.ok)throw new Error('LIGHTHOUSE_TARGET_GET_FAILED');return result.payload;};
  const targets=await discoverAdminCaptureTargets(read,{renderJobId:argument('--render-job-id'),timingsRecitationId:argument('--timing-recitation-id')});
  const source=await readFile(join(root,'src/admin/AdminRoot.tsx'),'utf8'),routes=buildAdminLighthouseRoutes(source,targets.fixture,requested);
  Object.assign(report,{expectedRoutes:routes,targetEvidence:targets.targetEvidence,limitations:targets.limitations});await progress.save();
  for(const path of routes){
   const setupWaitBefore=report.setupWaitMs;await beforeReadWindow('page',path);
   console.log(JSON.stringify({phase:'navigate',path,measuredPages:report.pages.length,expectedPages:routes.length}));
   // A stable page header proves this is the authenticated intended page;
   // do not accidentally measure a login screen or a route-not-found panel.
   await progress.checkpoint('navigate',path);await bounded(()=>page.goto(base.origin+path,{waitUntil:'networkidle0',timeout:60000}));assertNoRateLimit();
   await progress.checkpoint('settle',path);await bounded(()=>page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000}),45000);
   await beforeReadWindow('lighthouse',path);await progress.checkpoint('lighthouse',path);
   const result=await bounded(()=>lighthouse(base.origin+path,{port:chrome.port,logLevel:'silent',disableStorageReset:true,disableFullPageScreenshot:true,onlyCategories:['accessibility','best-practices','performance'],output:'json'},desktopConfig,page),120000);
   if(!result?.lhr)throw new Error('LIGHTHOUSE_RESULT_MISSING');
   assertNoRateLimit();
   await progress.checkpoint('settle',path);
   await bounded(()=>page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000}),45000);
   await progress.checkpoint('summarize',path);await progress.page({...summarizeAdminLighthouse(result.lhr,path),setupWaitMs:report.setupWaitMs-setupWaitBefore});
  }
  measurementsDone=true;
 }catch(error){const failure=await progress.fail(error);console.error(JSON.stringify({...failure,passed:false,measuredPages:report.pages.length}));process.exitCode=1;}
 finally{
  await progress.checkpoint('cleanup');
  const clean=async(operation,label)=>{report.cleanupOperation=label;await progress.save();try{await withAdminVisualDeadline(operation,{code:'LIGHTHOUSE_PHASE_TIMEOUT',timeoutMs:15000});}catch(error){await progress.fail(error);process.exitCode=1;}};
  await clean(()=>cdp?.detach(),'cdp_detach');await clean(()=>page?.close(),'page_close');await clean(()=>browser?.disconnect(),'browser_disconnect');await clean(()=>chrome?.kill(),'chrome_kill');
 }
 // Cleanup must also succeed before any complete/pass claim is persisted.
 if(measurementsDone&&!report.failure)await progress.finish();
 console.log(JSON.stringify({passed:report.passed,complete:report.complete,pages:report.pages.map(({path,accessibility,bestPractices,cls,passed})=>({path,accessibility,bestPractices,cls,passed})),failure:report.failure}));if(!report.passed)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({...classifyAdminLighthouseFailure(error),passed:false}));process.exitCode=1;});

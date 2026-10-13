/** Root-only execution against the local production build; no raw LHR artifacts. */
import { readFile,writeFile,mkdir,realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname,join,resolve,relative,isAbsolute } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import {discoverAdminCaptureTargets} from '../tooling/e2e/helpers/adminVisualCapture.mjs';
import {buildAdminLighthouseRoutes,summarizeAdminLighthouse,assertAdminLighthouseCoverage} from '../tooling/e2e/helpers/adminLighthouse.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw new Error('ARGUMENT_VALUE_REQUIRED');return process.argv[index+1];};
const requireE2e=createRequire(join(root,'tooling','e2e','package.json'));
const requireApp=createRequire(join(root,'package.json'));
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/u.test(value)?value:'LIGHTHOUSE_EXECUTION_FAILED';
async function privateInput(path){
 const absolute=await realpath(resolve(path)),workspace=await realpath(root),location=relative(workspace,absolute);
 if(!location||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_INPUT_OUTSIDE_GIT_REQUIRED');
 return absolute;
}
async function main(){
 const base=new URL(argument('--base-url')??'http://localhost:3001');
 if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('LOCAL_ORIGIN_REQUIRED');
 const defaultFixtures=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'AyahX','private-backups','a1-browser-fixtures.json'):undefined;
 const fixturePath=argument('--fixtures')??defaultFixtures;if(!fixturePath)throw new Error('PRIVATE_FIXTURE_PATH_REQUIRED');
 const fixtures=JSON.parse(await readFile(await privateInput(fixturePath),'utf8')),raw=fixtures.super_admin?.cookie;
 if(typeof raw!=='string')throw new Error('SUPER_ADMIN_FIXTURE_COOKIE_REQUIRED');
 const token=raw.startsWith('ayahx_admin_session=')?raw.slice('ayahx_admin_session='.length):raw;
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))throw new Error('FIXTURE_COOKIE_FORMAT_INVALID');
 const [{default:lighthouse},chromeLauncher,{default:puppeteer}]=await Promise.all([import(pathToFileURL(requireE2e.resolve('lighthouse')).href),import(pathToFileURL(requireE2e.resolve('chrome-launcher')).href),import(pathToFileURL(requireApp.resolve('puppeteer-core')).href)]);
 const {default:desktopConfig}=await import(pathToFileURL(join(dirname(requireE2e.resolve('lighthouse')),'config','desktop-config.js')).href);
 const chrome=await chromeLauncher.launch({chromePath:argument('--chrome-path'),chromeFlags:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check'],handleSIGINT:true,logLevel:'silent'});
 const routesPath=argument('--routes'),requested=routesPath?JSON.parse(await readFile(await privateInput(routesPath),'utf8')):undefined;
 let browser,page,cdp;const pages=[],apiErrors=[],blockedWrites=[];
 try{
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`});page=await browser.newPage();cdp=await page.createCDPSession();
  const installed=await cdp.send('Network.setCookie',{name:'ayahx_admin_session',value:token,domain:base.hostname,path:'/api/admin',httpOnly:true,secure:base.protocol==='https:',sameSite:'Strict'});
  if(!installed.success)throw new Error('SCOPED_FIXTURE_COOKIE_REJECTED');
  await page.setRequestInterception(true);
  page.on('request',request=>{const url=new URL(request.url());if(!['GET','HEAD','OPTIONS'].includes(request.method())){blockedWrites.push({method:request.method(),path:url.pathname});void request.abort();}else void request.continue();});
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===base.origin&&url.pathname.startsWith('/api/')&&response.status()>=400)apiErrors.push({path:url.pathname,status:response.status()});});
  const chromeVersion=await browser.version();
  await page.goto(base.origin+'/admin',{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000});
  const read=async path=>{const result=await page.evaluate(async path=>{const response=await fetch(path,{method:'GET',credentials:'include'});return{ok:response.ok,payload:response.ok?await response.json():null};},path);if(!result.ok)throw new Error('LIGHTHOUSE_TARGET_GET_FAILED');return result.payload;};
  const targets=await discoverAdminCaptureTargets(read,{renderJobId:argument('--render-job-id')});
  const source=await readFile(join(root,'src/admin/AdminRoot.tsx'),'utf8'),routes=buildAdminLighthouseRoutes(source,targets.fixture,requested);
  for(const path of routes){
   console.log(JSON.stringify({phase:'measuring',path}));
   // A stable page header proves this is the authenticated intended page;
   // do not accidentally measure a login screen or a route-not-found panel.
   await page.goto(base.origin+path,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000});
   const result=await lighthouse(base.origin+path,{port:chrome.port,logLevel:'silent',disableStorageReset:true,disableFullPageScreenshot:true,onlyCategories:['accessibility','best-practices','performance'],output:'json'},desktopConfig,page);
   if(!result?.lhr)throw new Error('LIGHTHOUSE_RESULT_MISSING');
   await page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000});
   pages.push(summarizeAdminLighthouse(result.lhr,path));
  }
  const report={scope:'local-production-build',observedAt:new Date().toISOString(),lighthouseVersion:JSON.parse(await readFile(join(dirname(requireE2e.resolve('lighthouse')),'..','package.json'),'utf8')).version,chromeVersion,settings:{formFactor:'desktop',disableStorageReset:true,authentication:'HttpOnly SameSiteStrict cookie scoped to local hostname /api/admin',rawArtifactsPersisted:false},thresholds:{accessibility:95,bestPractices:95,cls:.1},expectedRoutes:routes,targetEvidence:targets.targetEvidence,limitations:targets.limitations,pages,apiErrors,blockedWrites,passed:assertAdminLighthouseCoverage(routes,pages)&&!apiErrors.length&&!blockedWrites.length};
  const reportPath=resolve(argument('--report')??join(root,'docs','data','admin-lighthouse.json'));await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n','utf8');console.log(JSON.stringify({passed:report.passed,pages:pages.map(({path,accessibility,bestPractices,cls,passed})=>({path,accessibility,bestPractices,cls,passed}))}));if(!report.passed)process.exitCode=1;
 }catch(error){throw new Error(safeCode(error instanceof Error?error.message:undefined));}
 finally{try{await cdp?.detach();}finally{try{await page?.close();}finally{try{await browser?.disconnect();}finally{await chrome.kill();}}}}
}
main().catch(error=>{console.error(JSON.stringify({code:safeCode(error instanceof Error?error.message:undefined)}));process.exitCode=1;});

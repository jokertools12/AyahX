/** Root-only execution against the local production build; no raw LHR artifacts. */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw new Error('ARGUMENT_VALUE_REQUIRED');return process.argv[index+1];};
const requireE2e=createRequire(join(root,'tooling','e2e','package.json'));
const requireApp=createRequire(join(root,'package.json'));
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/u.test(value)?value:'LIGHTHOUSE_EXECUTION_FAILED';
function summarize(lhr,path){
 const accessibility=number(lhr.categories.accessibility?.score),bestPractices=number(lhr.categories['best-practices']?.score),cls=number(lhr.audits['cumulative-layout-shift']?.numericValue);
 const passed=accessibility!==null&&accessibility>=.95&&bestPractices!==null&&bestPractices>=.95&&cls!==null&&cls<=.1&&!lhr.runtimeError;
 // Only fixed audit identifiers and numeric data leave memory. DOM snippets,
 // request headers, signed URLs, cookies, screenshots and traces never do.
 const failedAudits=Object.entries(lhr.audits).filter(([,audit])=>typeof audit.score==='number'&&audit.score<1).map(([id,audit])=>({id,score:audit.score,scoreDisplayMode:audit.scoreDisplayMode}));
 return{path,accessibility:accessibility===null?null:Math.round(accessibility*10000)/100,bestPractices:bestPractices===null?null:Math.round(bestPractices*10000)/100,cls,lcpMs:number(lhr.audits['largest-contentful-paint']?.numericValue),totalBlockingTimeMs:number(lhr.audits['total-blocking-time']?.numericValue),failedAudits,warningCount:lhr.runWarnings?.length??0,runtimeError:lhr.runtimeError?{code:safeCode(lhr.runtimeError.code)}:null,passed};
}
async function main(){
 const base=new URL(argument('--base-url')??'http://localhost:3001');
 if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('LOCAL_ORIGIN_REQUIRED');
 const defaultFixtures=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'AyahX','private-backups','a1-browser-fixtures.json'):undefined;
 const fixturePath=argument('--fixtures')??defaultFixtures;if(!fixturePath)throw new Error('PRIVATE_FIXTURE_PATH_REQUIRED');
 const fixtures=JSON.parse(await readFile(fixturePath,'utf8')),raw=fixtures.super_admin?.cookie;
 if(typeof raw!=='string')throw new Error('SUPER_ADMIN_FIXTURE_COOKIE_REQUIRED');
 const token=raw.startsWith('ayahx_admin_session=')?raw.slice('ayahx_admin_session='.length):raw;
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))throw new Error('FIXTURE_COOKIE_FORMAT_INVALID');
 const [{default:lighthouse},chromeLauncher,{default:puppeteer}]=await Promise.all([import(pathToFileURL(requireE2e.resolve('lighthouse')).href),import(pathToFileURL(requireE2e.resolve('chrome-launcher')).href),import(pathToFileURL(requireApp.resolve('puppeteer-core')).href)]);
 const {default:desktopConfig}=await import(pathToFileURL(join(dirname(requireE2e.resolve('lighthouse')),'config','desktop-config.js')).href);
 const chrome=await chromeLauncher.launch({chromePath:argument('--chrome-path'),chromeFlags:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check'],handleSIGINT:true,logLevel:'silent'});
 let browser,page,cdp;const pages=[];
 try{
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`});page=await browser.newPage();cdp=await page.createCDPSession();
  const installed=await cdp.send('Network.setCookie',{name:'ayahx_admin_session',value:token,domain:base.hostname,path:'/api/admin',httpOnly:true,secure:base.protocol==='https:',sameSite:'Strict'});
  if(!installed.success)throw new Error('SCOPED_FIXTURE_COOKIE_REJECTED');
  const chromeVersion=await browser.version();
  for(const path of ['/admin','/admin/reciters','/admin/settings']){
   console.log(JSON.stringify({phase:'measuring',path}));
   // A stable page header proves this is the authenticated intended page;
   // do not accidentally measure a login screen or a route-not-found panel.
   await page.goto(base.origin+path,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000});
   const result=await lighthouse(base.origin+path,{port:chrome.port,logLevel:'silent',disableStorageReset:true,disableFullPageScreenshot:true,onlyCategories:['accessibility','best-practices','performance'],output:'json'},desktopConfig,page);
   if(!result?.lhr)throw new Error('LIGHTHOUSE_RESULT_MISSING');
   await page.waitForSelector('#admin-main h1.admin-page-title',{timeout:45000});
   pages.push(summarize(result.lhr,path));
  }
  const report={scope:'local-production-build',observedAt:new Date().toISOString(),lighthouseVersion:JSON.parse(await readFile(join(dirname(requireE2e.resolve('lighthouse')),'..','package.json'),'utf8')).version,chromeVersion,settings:{formFactor:'desktop',disableStorageReset:true,authentication:'HttpOnly SameSiteStrict cookie scoped to local hostname /api/admin',rawArtifactsPersisted:false},thresholds:{accessibility:95,bestPractices:95,cls:.1},pages,passed:pages.every(page=>page.passed)};
  const reportPath=resolve(argument('--report')??join(root,'docs','data','admin-lighthouse.json'));await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n','utf8');console.log(JSON.stringify({passed:report.passed,pages:pages.map(({path,accessibility,bestPractices,cls,passed})=>({path,accessibility,bestPractices,cls,passed}))}));if(!report.passed)process.exitCode=1;
 }catch(error){throw new Error(safeCode(error instanceof Error?error.message:undefined));}
 finally{try{await cdp?.detach();}finally{try{await page?.close();}finally{try{await browser?.disconnect();}finally{await chrome.kill();}}}}
}
main().catch(error=>{console.error(JSON.stringify({code:safeCode(error instanceof Error?error.message:undefined)}));process.exitCode=1;});

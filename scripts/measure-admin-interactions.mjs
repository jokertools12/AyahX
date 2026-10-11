/** Root-only local Chromium measurements with real auth and no raw artifacts. */
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const requireE2e=createRequire(new URL('../tooling/e2e/package.json',import.meta.url));
const {launch}=await import(pathToFileURL(requireE2e.resolve('chrome-launcher')).href);
const {default:puppeteer}=await import('puppeteer-core');
const fixture=JSON.parse(await readFile(join(process.env.LOCALAPPDATA,'AyahX/private-backups/a1-browser-fixtures.json'),'utf8'));
const chrome=await launch({chromeFlags:['--headless=new','--disable-gpu','--no-first-run'],logLevel:'silent'});
const report={observed_at:new Date().toISOString(),scope:'local production build; lab interaction timing, not field INP',measurements:[]};
let browser;
try{
 browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`});
 for(const width of [1440,390]){
  const page=await browser.newPage();await page.setViewport({width,height:1000});const cdp=await page.createCDPSession();
  await cdp.send('Network.setCookie',{name:'ayahx_admin_session',value:fixture.super_admin.cookie,domain:'localhost',path:'/api/admin',httpOnly:true,sameSite:'Strict'});
  await page.evaluateOnNewDocument(()=>{window.adminEvents=[];window.adminShifts=[];new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)window.adminEvents.push({duration:e.duration,id:e.interactionId,name:e.name});}).observe({type:'event',buffered:true,durationThreshold:16});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.adminShifts.push({value:e.value,sources:e.sources.map(s=>s.node?.className??s.node?.nodeName)});}).observe({type:'layout-shift',buffered:true});});
  await page.goto('http://localhost:3001/admin/_kit',{waitUntil:'networkidle0'});await page.waitForSelector('.admin-table tbody tr');
  const selector=width<768?'.admin-mobile-cards input[type=checkbox]':'.admin-table tbody input[type=checkbox]';
  for(let i=0;i<12;i++){
   await page.evaluate(width=>document.querySelector(width<768?'.admin-mobile-cards':'.admin-table-scroll').scrollIntoView({block:'start'}),width);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const point=await page.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.top>0&&r.bottom<innerHeight;});if(!node)throw new Error('VISIBLE_CHECKBOX_REQUIRED');const rect=node.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};},selector);
   await page.mouse.click(point.x,point.y);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  const metrics=await page.evaluate(width=>({viewport:width,declared_rows:Number(document.querySelector('.admin-table')?.getAttribute('aria-rowcount'))-1,rendered_rows:document.querySelectorAll('.admin-table tbody tr[aria-rowindex]').length,rendered_cards:document.querySelectorAll('.admin-mobile-cards article').length,event_samples:window.adminEvents.length,max_interaction_duration_ms:Math.max(0,...window.adminEvents.map(e=>e.duration)),interaction_count:new Set(window.adminEvents.map(e=>e.id)).size,cls:window.adminShifts.reduce((s,e)=>s+e.value,0)}),width);
  if(metrics.declared_rows!==1000||metrics.rendered_rows>25||metrics.rendered_cards>12||metrics.max_interaction_duration_ms>=200)throw new Error('ADMIN_INTERACTION_BUDGET_FAILED');
  await page.goto('http://localhost:3001/admin/reciters/'+fixture.catalog.reciter_id,{waitUntil:'networkidle0'});
  metrics.profile_overflow=await page.evaluate(()=>({viewport:innerWidth,body_width:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('#admin-main *')].map(e=>({tag:e.tagName,classes:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+1||e.left< -1).slice(0,12)}));
  report.measurements.push(metrics);await cdp.detach();await page.close();
 }
 report.passed=report.measurements.every(m=>m.max_interaction_duration_ms<200&&m.profile_overflow.body_width<=m.profile_overflow.viewport);
 await writeFile('docs/data/admin-interaction-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}finally{if(browser)await browser.disconnect();await chrome.kill();}

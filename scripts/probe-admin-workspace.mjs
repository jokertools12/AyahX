/** Private local visual diagnosis only; final acceptance uses the complete matrix. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {loadAdminVisualScanner} from '../tooling/e2e/helpers/loadAdminVisualScanner.mjs';
const dir=join(process.env.LOCALAPPDATA,'AyahX','private-backups'),qa=JSON.parse(await readFile(join(dir,'batch5-local-qa.json'),'utf8'));
if(qa.environment!=='local'||qa.state!=='active'||Date.parse(qa.expiresAt)<=Date.now())throw new Error('LOCAL_ACTIVE_QA_REQUIRED');
const out=join(dir,'batch5-local-probe-'+Date.now());await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'}),page=await context.newPage();
const base='http://localhost:3005',results=[],scanner=await loadAdminVisualScanner();
await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!(u.origin===base&&u.pathname==='/api/admin/auth/login'&&r.method()==='POST'))return route.abort('blockedbyclient');await route.continue();});
try{
 await page.goto(base+'/admin');await page.getByLabel('البريد الإلكتروني').fill(qa.email);await page.getByLabel('كلمة المرور',{exact:true}).fill(qa.password);await page.getByRole('button',{name:'دخول',exact:true}).click();await page.locator('.admin-shell').waitFor();
 const routes=process.argv.slice(2).length?process.argv.slice(2):['/admin','/admin/reviews','/admin/provider-licenses','/admin/reciters','/admin/recitations','/admin/storage','/admin/reciter-wizard','/admin/render-lab'];
 for(const route of routes)for(const size of [{width:1366,height:768},{width:390,height:844}]){
  await page.setViewportSize(size);await page.goto(base+route);await page.locator('.admin-app h1').first().waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const metrics=await page.evaluate(()=>{const canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d');return [...document.querySelectorAll('.admin-app li,.admin-app dt,.admin-app dd')].filter(el=>el.getClientRects().length).slice(0,20).flatMap(el=>[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()).map(n=>{const s=getComputedStyle(el),range=document.createRange();range.selectNodeContents(n);const rect=range.getBoundingClientRect();ctx.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;const m=ctx.measureText(n.textContent);return{rangeCount:range.getClientRects().length,fontFeatureSettings:s.fontFeatureSettings,fontVariationSettings:s.fontVariationSettings,textShadow:s.textShadow,textDecorationLine:s.textDecorationLine,direction:s.direction,rangeHeight:rect.height,rangeY:rect.y,fa:m.fontBoundingBoxAscent,fd:m.fontBoundingBoxDescent,aa:m.actualBoundingBoxAscent,ad:m.actualBoundingBoxDescent,fontSize:s.fontSize,lineHeight:s.lineHeight};}));});
  await writeFile(join(out,route.replaceAll('/','_')+'-'+size.width+'-font-metrics.json'),JSON.stringify(metrics));
  const observations=[],height=await page.evaluate(()=>({total:document.documentElement.scrollHeight,step:Math.floor(innerHeight*.8)}));
  for(let y=0;y<height.total;y+=height.step){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));observations.push(await page.evaluate(scanner,{mode:'strict',touch:size.width<768}));}
  await page.evaluate(()=>scrollTo(0,0));const name=route.replaceAll('/','_')+'-'+size.width;
  await page.screenshot({path:join(out,name+'.png'),fullPage:true,animations:'disabled'});await writeFile(join(out,name+'.json'),JSON.stringify(observations));
  const counts={};for(const scan of observations)for(const v of scan.violations)counts[v.code]=(counts[v.code]??0)+1;
  const row={route,width:size.width,counts,indeterminate:observations.reduce((s,r)=>s+r.indeterminate.length,0)};results.push(row);console.log(JSON.stringify(row));
 }
 await writeFile(join(out,'report.json'),JSON.stringify({local_only:true,diagnostic_only:true,results}));console.log(JSON.stringify({private_output:out}));
}catch{console.error('ADMIN_LOCAL_VISUAL_PROBE_FAILED');process.exitCode=1;}finally{await browser.close();}

import {test} from '@e2e-dev/web';
import {expect} from 'e2e';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const enabled=process.env.AYAHX_ADMIN_PUBLIC_SMOKE==='1';
function approved(base:string|undefined){if(!base||new URL(base).origin!=='https://ayahx.com')throw new Error('EXPLICIT_PRODUCTION_READ_ONLY_TARGET_REQUIRED');}
test('production admin rejects anonymous reads without disclosure',async({app,browser})=>{
 test.skip(!enabled,'Opt-in public read-only production acceptance');approved(app.baseUrl);await app.open('/');
 const sources=['server/routes/admin/adminA1Endpoints.ts','server/routes/adminCatalog.ts'].map(name=>readFileSync(join('..','..',name),'utf8'));
 const paths=[...new Set(sources.flatMap(text=>[...text.matchAll(/method:'get',path:'([^']+)'/gu)].map(match=>'/api/admin'+match[1].replace(/:surah/gu,'1').replace(/:[a-z_]+/gu,'00000000-0000-4000-8000-000000000000')))), '/api/admin/unknown','/API/ADMIN/unknown'];
 for(const path of paths){const result=await browser.evaluate(async path=>{const response=await fetch(path,{credentials:'omit',cache:'no-store'}),body=await response.json();return{status:response.status,cache:response.headers.get('cache-control'),keys:Object.keys(body).sort(),code:body.code,request_id:typeof body.detail?.requestId==='string',data:body.data??null};},path);expect(result).toEqual({status:401,cache:'no-store',keys:['code','detail','message'],code:'ADMIN_UNAUTHENTICATED',request_id:true,data:null});}
});
test('production public entry keeps admin lazy and admin route opens blank login',async({app,browser,screen})=>{
 test.skip(!enabled,'Opt-in public read-only production acceptance');approved(app.baseUrl);await app.open('/');await expect(browser.locator('h1')).toBeVisible();expect(await browser.evaluate(()=>performance.getEntriesByType('resource').some(entry=>/\/assets\/AdminEntry-/u.test(entry.name)))).toBe(false);
 await app.open('/admin/reciters');await expect(browser.locator('h1')).toHaveText('دخول الإدارة');await expect(screen.getByRole('textbox','البريد الإلكتروني')).toBeVisible();expect(await browser.evaluate(()=>performance.getEntriesByType('resource').some(entry=>/\/assets\/AdminEntry-/u.test(entry.name)))).toBe(true);await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

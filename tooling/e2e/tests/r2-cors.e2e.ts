import {test} from '@e2e-dev/web';
import {expect,secrets} from 'e2e';
/** Only the inert test page is intercepted. R2 OPTIONS/PUT/GET are real network requests. */
test('R2 permits the exact staging browser origin and rejects the production origin', {timeout:60000,trace:'off',video:'off'},async({app,browser,screen})=>{
  test.skip(process.env.AYAHX_R2_CORS_TEST!=='staging-test-prefix-only','requires explicit real R2 test-prefix capabilities');
  const allowed='https://ayahx-staging.up.railway.app',denied='https://ayahx.com';
  if(new URL(app.baseUrl!).origin!==allowed)throw new Error('EXACT_STAGING_CORS_TEST_ORIGIN_REQUIRED');
  const page='/__ayahx_r2_cors_owned_test__';
  const fixture='<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><label>رابط القراءة للاختبار<input type="password" id="get"></label><label>رابط الرفع للاختبار<input type="password" id="put"></label></body></html>';
  await browser.route(allowed+page,async route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  await browser.route(denied+page,async route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  await app.open(page);
  await screen.getByLabel('رابط القراءة للاختبار').fill(secrets.get('r2-cors-get'));
  await screen.getByLabel('رابط الرفع للاختبار').fill(secrets.get('r2-cors-put'));
  const body=process.env.R2_CORS_TEST_BODY_BASE64!;
  const result=await browser.evaluate(async(encoded:string)=>{
    const get=(document.getElementById('get') as HTMLInputElement).value,put=(document.getElementById('put') as HTMLInputElement).value;
    const wave=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    try{
      const uploaded=await fetch(put,{method:'PUT',body:wave,headers:{'Content-Type':'audio/wav','If-None-Match':'*'}});
      const read=await fetch(get,{headers:{Range:'bytes=100-1099'}}),ranged=new Uint8Array(await read.arrayBuffer());
      return {put_status:uploaded.status,range_status:read.status,range_bytes:ranged.length,range_matches:ranged.every((b,i)=>b===wave[i+100]),etag_exposed:!!read.headers.get('etag'),content_range_exposed:!!read.headers.get('content-range'),origin:location.origin};
    }catch{return {browser_failed:true,origin:location.origin};}
  },body);
  expect(result).toMatchObject({put_status:200,range_status:206,range_bytes:1000,range_matches:true,etag_exposed:true,content_range_exposed:true,origin:allowed});
  await browser.goto(denied+page);
  await screen.getByLabel('رابط القراءة للاختبار').fill(secrets.get('r2-cors-get'));
  const blocked=await browser.evaluate(async()=>{try{const r=await fetch((document.getElementById('get') as HTMLInputElement).value,{headers:{Range:'bytes=100-1099'}});await r.arrayBuffer();return {blocked:false,origin:location.origin};}catch{return {blocked:true,origin:location.origin};}});
  expect(blocked).toMatchObject({blocked:true,origin:denied});
});

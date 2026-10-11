import {test} from '@e2e-dev/web';
import {expect} from 'e2e';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ADMIN_ROLES,DEFAULT_ROLE_PERMISSIONS} from '../../../server/admin/adminPermissions';
import {adminNavigation} from '../../../src/admin/adminNavigation';
test('all seven roles see only their authorized administration navigation',async({app,browser,screen})=>{
 test.skip(process.env.AYAHX_ADMIN_E2E!=='1','Local real admin fixtures only');
 if(!app.baseUrl||!['localhost','127.0.0.1'].includes(new URL(app.baseUrl).hostname))throw new Error('LOCAL_ONLY');
 const fixtures=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'AyahX/private-backups/a1-browser-fixtures.json'),'utf8'));
 await app.open('/admin');const mobile=await browser.evaluate(()=>innerWidth)<768;
 for(const role of ADMIN_ROLES){
  await browser.setCookies([{domain:new URL(app.baseUrl).hostname,path:'/api/admin',name:'ayahx_admin_session',value:fixtures[role].cookie,httpOnly:true,sameSite:'Strict'}]);
  await app.open('/admin/security');await expect(browser.locator('h1')).toHaveText('الأمان والجلسات');
  if(mobile)await screen.getByRole('button','فتح القائمة').tap();
  const nav=mobile?'.admin-drawer-nav':'.admin-nav';
  for(const item of adminNavigation){const expected=DEFAULT_ROLE_PERMISSIONS[role].includes(item.permission as never);await expect(browser.locator(`${nav} a[href="${item.path}"]${item.path==='/admin'&&!mobile?':not([aria-label="AyahX"])':''}`)).toHaveCount(expected?1:0);}
  if(mobile)await browser.keyboard.press('Escape');
 }
});

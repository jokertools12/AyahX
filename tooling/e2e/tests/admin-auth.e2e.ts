import {test} from '@e2e-dev/web';
import {credentials,expect} from 'e2e';
import axe from 'axe-core';
test('blank admin login has RTL accessibility and both theme screenshots',async({app,browser,screen})=>{
 test.skip(process.env.AYAHX_ADMIN_E2E!=='1','Opt-in local admin only');if(!app.baseUrl||!['localhost','127.0.0.1'].includes(new URL(app.baseUrl).hostname))throw new Error('LOCAL_ADMIN_ONLY');await app.open('/admin');await expect(browser.locator('h1')).toHaveText('دخول الإدارة');await expect(screen.getByLabel('البريد الإلكتروني')).toHaveValue('');await expect(screen.getByLabel('كلمة المرور')).toBeVisible();await browser.evaluate(async()=>{await document.fonts.ready;return true;});for(const dark of [false,true]){await browser.evaluate(v=>document.documentElement.classList.toggle('dark',v),dark);await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await browser.evaluate(`(()=>{${axe.source};return true;})()`);const violations=await browser.evaluate(async()=>{const result=await (window as unknown as {axe:{run:()=>Promise<{violations:Array<{id:string;impact:string}>}>}}).axe.run();return result.violations.filter(v=>v.impact==='critical'||v.impact==='serious').map(v=>v.id);});expect(violations).toEqual([]);await app.screenshot('admin-login-'+(dark?'dark':'light'));}
});
test('admin signs in through existing password authentication',async({app,screen,browser})=>{
 test.skip(process.env.AYAHX_ADMIN_E2E!=='1','Opt-in real local admin fixtures only');
 if(!app.baseUrl||!['localhost','127.0.0.1'].includes(new URL(app.baseUrl).hostname))throw new Error('LOCAL_ADMIN_ONLY');
 const account=credentials.user('super_admin');await app.open('/admin');
 await screen.getByLabel('البريد الإلكتروني').fill(account.username);await screen.getByLabel('كلمة المرور').fill(account.password);await screen.getByRole('button','دخول').tap();await expect(browser.locator('h1')).toHaveText('الرئيسية');if(await browser.evaluate(()=>innerWidth)<768){await screen.getByRole('button','فتح القائمة').tap();await expect(browser.locator('[role=dialog]')).toBeVisible();await browser.keyboard.press('Escape');}else await expect(browser.locator('.admin-sidebar')).toBeVisible();
});

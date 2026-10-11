import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('capture existing AyahX design before admin changes', async ({ app, browser }) => {
  test.skip(process.env.AYAHX_DESIGN_CAPTURE !== '1', 'Opt-in local design evidence');
  if (!app.baseUrl || !['127.0.0.1','localhost'].includes(new URL(app.baseUrl).hostname)) throw new Error('LOCAL_DESIGN_ONLY');
  for (const route of ['/', '/surahs', '/auth']) {
    await app.open(route);
    await expect(browser.locator('h1')).toBeVisible();
    for (const theme of ['light','dark']) {
      await browser.evaluate((dark) => document.documentElement.classList.toggle('dark',dark),theme==='dark');
      await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await app.screenshot(`public-${route.replaceAll('/','')||'home'}-${theme}`);
    }
  }
});

test('UI kit component harness verifies keyboard and windowed rows before admin pages',async({app,browser})=>{
  test.skip(process.env.AYAHX_KIT_COMPONENT_TEST!=='1','Opt-in component harness, no admin auth claims');
  if(!app.baseUrl||!['127.0.0.1','localhost'].includes(new URL(app.baseUrl).hostname))throw new Error('LOCAL_KIT_ONLY');
  await app.open('/tooling/e2e/fixtures/admin-kit.html');
  await expect(browser.locator('h1')).toContainText('UI Kit');
  await expect(browser.locator('.admin-matrix button')).toHaveCount(114);
  await expect.poll(()=>browser.locator('.admin-table tbody tr').count()).toBeLessThan(40);
  await browser.locator('.admin-matrix button').first().press('End');
  await expect.poll(()=>browser.evaluate(()=>document.activeElement?.textContent?.includes('114'))).toBe(true);
  await browser.locator('button').filter({hasText:'RTL / LTR'}).click();
  await expect(browser.locator('div[dir=ltr]').first()).toBeVisible();
  for(const dark of [false,true]){
    await browser.evaluate(v=>document.documentElement.classList.toggle('dark',v),dark);
    await expect.poll(()=>browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await app.screenshot(`kit-component-${dark?'dark':'light'}`);
  }
});

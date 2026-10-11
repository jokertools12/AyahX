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

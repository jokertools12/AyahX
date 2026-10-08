import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Shell tests deliberately exercise the API-unavailable UI locally.
// An explicit remote URL checks real public GET responses; writes stay blocked.
test.beforeEach(async ({ browser }) => {
  await browser.route('**/api/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request.method)) {
      return route.fulfill({ status: 403, json: { error: 'E2E public suite blocks writes' } });
    }
    if (!process.env.AYAHX_E2E_URL) {
      return route.fulfill({ status: 503, json: { error: 'API unavailable in UI shell suite' } });
    }
    await route.continue();
  });
});

test('home has the approved brand, Arabic layout and no horizontal overflow', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('nav a[aria-label="AyahX — الرئيسية"]')).toBeVisible();
  await expect(browser.locator('h1')).toContainText('مقاطع قرآنية');
  await expect.poll(() => browser.evaluate(() => {
    const logo = document.querySelector<HTMLImageElement>('nav img[src="/brand/01_Primary_Horizontal.svg"]');
    return Boolean(logo?.complete && logo.naturalWidth > 0);
  })).toBe(true);
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe('rtl');
  await expect.poll(() => browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('theme toggle changes and preserves the chosen theme after navigation', async ({ app, browser }) => {
  await app.open('/');
  const before = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
  await browser.locator('button').filter({ hasText: 'تبديل الوضع' }).click();
  await expect.poll(() => browser.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
  await app.open('/auth');
  await expect(browser.locator('h1')).toContainText('AyahX');
  await expect.poll(() => browser.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
});

test('registration fields and secure recovery are reachable without submitting forms', async ({ app, browser }) => {
  await app.open('/auth');
  await browser.locator('[role="tab"]').filter({ hasText: 'حساب جديد' }).click();
  await expect(browser.locator('#register-name')).toBeVisible();
  await expect(browser.locator('#confirm-password')).toBeVisible();
  await expect(browser.locator('input[type="checkbox"]')).not.toBeChecked();
  await browser.locator('[role="tab"]').filter({ hasText: 'استعادة كلمة المرور' }).click();
  await expect(browser.locator('h2')).toContainText('استعادة آمنة للحساب');
  await browser.locator('a[href="/contact"]').filter({ hasText: 'التواصل مع الدعم' }).click();
  await expect(browser).toHaveURL('/contact');
});

test('visitor can open creation from the responsive navigation', async ({ app, browser }) => {
  await app.open('/');
  const mobile = await browser.evaluate(() => innerWidth < 768);
  if (mobile) {
    await browser.locator('button[aria-controls="mobile-navigation"]').click();
    await expect.poll(() => browser.evaluate(() => (document.querySelector('#mobile-navigation')?.getBoundingClientRect().height ?? 0) > 260)).toBe(true);
    await browser.locator('#mobile-navigation a[href="/create"]').click();
  } else {
    await browser.locator('nav a[href="/create"]').click();
  }
  await expect(browser).toHaveURL('/create');
  await expect(browser.locator('nav a[aria-label="AyahX — الرئيسية"]')).toBeVisible();
});

test('unknown route offers a working route home', async ({ app, browser }) => {
  await app.open('/e2e-missing-page');
  await expect(browser.locator('h1')).toContainText('الصفحة المطلوبة غير موجودة');
  await browser.locator('a[href="/"]').filter({ hasText: 'الرئيسية' }).click();
  await expect(browser).toHaveURL('/');
  await expect(browser.locator('h1')).toContainText('مقاطع قرآنية');
});

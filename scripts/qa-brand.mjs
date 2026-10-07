import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const executablePath = process.env.BRAND_QA_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set BRAND_QA_BROWSER to a Chromium executable.');
const origin = process.env.BRAND_QA_ORIGIN || 'http://127.0.0.1:8080';
const output = 'qa-output/brand';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] });
const reports = [];
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  for (const [label, width, theme] of [['desktop-light', 1440, 'light'], ['mobile-light', 390, 'light'], ['mobile-dark', 390, 'dark'], ['desktop-dark', 1440, 'dark'], ['small-light', 320, 'light'], ['small-dark', 320, 'dark'], ['tablet-light', 768, 'light'], ['tablet-dark', 768, 'dark'], ['medium-light', 1024, 'light'], ['medium-dark', 1024, 'dark']]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(value => localStorage.setItem('theme', value), theme);
    for (const route of ['/', '/auth', '/create', '/pricing', '/surahs', '/not-a-route']) {
      await page.goto(origin + route, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.waitForSelector('nav img[src^="/brand/"]');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('nav img')).filter(img => getComputedStyle(img).display !== 'none').every(img => img.complete && img.naturalWidth > 0));
      const result = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('img[src^="/brand/"]')].filter(img => {
          const r = img.getBoundingClientRect();
          return getComputedStyle(img).display !== 'none' && r.width && r.height && r.bottom > 0 && r.top < innerHeight;
        });
        return { title: document.title, theme: document.documentElement.className, rtl: getComputedStyle(document.documentElement).direction,
          overflow: document.documentElement.scrollWidth > innerWidth,
          images: visible.map(img => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })),
          logoLink: document.querySelector('nav a')?.getAttribute('aria-label') };
      });
      if (result.overflow || result.images.some(img => !img.loaded) || result.rtl !== 'rtl' || !result.title.includes('AyahX') || !result.theme.includes(theme)) throw new Error(`Brand QA failed ${label} ${route}: ${JSON.stringify(result)}`);
      if (['/', '/auth', '/create'].includes(route)) {
        const name = `${output}/${label}-${route === '/' ? 'home' : route.slice(1)}`;
        await page.screenshot({ path: `${name}-viewport.png` });
        if (route !== '/create') {
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < height; y += 700) {
            await page.evaluate(top => window.scrollTo(0, top), y);
            await new Promise(resolve => setTimeout(resolve, 180));
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          await new Promise(resolve => setTimeout(resolve, 350));
          await page.screenshot({ path: `${name}.png`, fullPage: true });
        }
      }
      reports.push({ viewport: width, expectedTheme: theme, route, ...result });
    }
  }
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector('button[aria-controls="mobile-navigation"]');
  await page.click('button[aria-controls="mobile-navigation"]');
  await page.waitForSelector('#mobile-navigation');
  await page.waitForFunction(() => document.querySelector('#mobile-navigation')?.getBoundingClientRect().height > 260);
  await page.click('#mobile-navigation a[href="/create"]');
  await page.waitForFunction(() => location.pathname === '/create');
  await page.goto(origin + '/auth', { waitUntil: 'networkidle2' });
  await page.click('button[role="tab"][value="register"]').catch(async () => {
    const buttons = await page.$$('button[role="tab"]'); await buttons[1].click();
  });
  const activeTab = await page.$eval('button[role="tab"][data-state="active"]', el => el.textContent);
  if (!activeTab.includes('حساب')) throw new Error('Registration tab failed');
  await page.goto(origin, { waitUntil: 'networkidle2' });
  const oldTheme = await page.$eval('html', el => el.className);
  await page.click('button:has(.sr-only)');
  await page.waitForFunction(previous => document.documentElement.className !== previous, {}, oldTheme);
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label') }));
  await writeFile(`${output}/report.json`, JSON.stringify({ reports, pageErrors, interactions: { mobileMenu: 'passed', createNavigation: 'passed', authTabs: 'passed', themeToggle: 'passed', keyboardFocus: focus }, limitation: 'Local UI QA only. Backend, paid entitlements, authentication and Railway deployment are not live acceptance.' }, null, 2));
  if (pageErrors.length) throw new Error(`Browser JS errors: ${pageErrors.join(', ')}`);
  console.log(`Passed ${reports.length} viewport/theme/route checks and navigation, auth-tab and theme interactions.`);
} finally { await browser.close(); }

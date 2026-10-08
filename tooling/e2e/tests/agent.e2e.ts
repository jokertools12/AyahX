import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('agent opens the public sign-in screen', async ({ app, agent, browser }) => {
  await browser.route('**/api/**', async route => {
    await route.fulfill({ status: 503, json: { error: 'No API access in the local navigation agent test' } });
  });
  await app.open('/');
  await agent.act('Open the sign-in page from the visible navigation. Do not type into fields or submit forms.');
  await expect(browser).toHaveURL('/auth');
  await expect(browser.locator('h1')).toContainText('AyahX');
});

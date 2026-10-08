import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { fileURLToPath } from 'node:url';

// API/config source: node_modules/e2e/docs/{web,reference/config}.mdx
const externalUrl = process.env.AYAHX_E2E_URL;
const url = externalUrl ?? 'http://127.0.0.1:4188';
const parsed = new URL(url);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
  throw new Error('AYAHX_E2E_URL must be an HTTP(S) URL without credentials.');
}
const agentMode = process.env.AYAHX_E2E_AGENT === '1';
if (agentMode && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
  throw new Error('Agent tests are restricted to a local test app.');
}
const agents: E2EConfig['agents'] = agentMode ? await (async () => {
  const { chatgpt } = await import('e2e/oauth/chatgpt');
  return { default: {
    model: chatgpt('gpt-6-luna'),
    maxSteps: 8,
    system: 'Test only public AyahX navigation. Do not submit forms, accept terms, sign in, upload, pay, or generate media. Stay on the configured local origin.',
  } };
})() : undefined;

const app = {
  url,
  ...(externalUrl ? {} : { command: {
    executable: process.execPath,
    args: [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)),
      '--host', '127.0.0.1', '--port', '4188', '--strictPort'],
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    reuseExisting: false,
    log: '.e2e/logs/vite.log',
  } }),
};

export default {
  projectId: 'ayahx-web',
  tests: agentMode
    ? ['tests/agent.e2e.ts', 'tests/agent/**/*.e2e.ts']
    : ['tests/**/*.e2e.ts', '!tests/agent.e2e.ts', '!tests/agent/**/*.e2e.ts'],
  targets: [
    { name: 'desktop', app, engine: web({ viewport: { width: 1440, height: 1000 }, locale: 'ar-EG', timezoneId: 'Africa/Cairo' }) },
    { name: 'mobile', app, engine: web({ viewport: { width: 390, height: 900 }, locale: 'ar-EG', timezoneId: 'Africa/Cairo' }) },
  ],
  workers: 1,
  retries: 0,
  timeout: 60000,
  assertionTimeout: 10000,
  trace: 'retain-on-failure',
  output: '.e2e',
  reporters: ['list', 'junit', 'markdown'],
  ...(agents ? { agents } : {}),
} satisfies E2EConfig;

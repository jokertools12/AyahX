import type { E2EConfig } from 'e2e';

// Explicit, local-only native Chromium adapter. No app command, engine,
// model, credential values or authenticated trace are created by this config.
export default {
  projectId: 'ayahx-admin-display-regressions',
  tests: ['tests/admin-display-regressions.e2e.ts'],
  targets: [{ name: 'native-display', platform: 'admin-display-native' }],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  trace: 'off',
  video: 'off',
  output: '.e2e/admin-display',
  reporters: ['list', 'junit', 'markdown'],
} satisfies E2EConfig;

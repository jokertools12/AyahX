// @vitest-environment node
import { it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runAudioStorageAcceptance } from '../../scripts/test-licensed-audio-storage';
/** Optional true R2 test. Never substitutes unit mocks or a local server for R2 evidence. */
const configured = process.env.AYAHX_R2_ACCEPTANCE === '1' && ['R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_READ_ACCESS_KEY_ID', 'R2_READ_SECRET_ACCESS_KEY'].every(k => !!process.env[k]);
it.skipIf(!configured)('real private R2 staging test/ multipart, Range, SHA, permission scope and cleanup', async () => {
  if (!/staging/u.test(process.env.R2_BUCKET ?? '')) throw new Error('R2_STAGING_BUCKET_REQUIRED');
  const config = { bucket: process.env.R2_BUCKET!, endpoint: process.env.R2_ENDPOINT!, accountId: process.env.R2_ACCOUNT_ID!, access: 'read_write' as const, accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! };
  const result = await runAudioStorageAcceptance({ config, readerConfig: { ...config, access: 'read_only', accessKeyId: process.env.R2_READ_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_READ_SECRET_ACCESS_KEY! }, scratchRoot: path.join(os.tmpdir(), 'ayahx-r2-private-test'), reportPath: path.join(os.tmpdir(), `ayahx-r2-${randomUUID()}.json`), allowedOrigin: process.env.AYAHX_R2_TEST_ORIGIN ?? 'https://ayahx.com', mode: 'r2' });
  expect(result.status).toBe('PASSED_PARTIAL_STORAGE_ACCEPTANCE'); expect(result.test_objects_deleted).toBe(true);
}, 10 * 60 * 1000);

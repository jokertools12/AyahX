import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import quranRouter from '../../server/routes/quran';
import { authenticateToken, signToken } from '../../server/middleware/auth';

vi.mock('../../server/db', () => ({ query: vi.fn(async (_sql: string, params: string[]) => [{ role: params[0] }]) }));
vi.mock('../../server/services/quranFoundationService', () => ({ fetchQuranContent: vi.fn(), getQuranFoundationConfig: vi.fn() }));
vi.mock('../../server/services/audioFingerprintService', () => ({ fingerprintTrustedQuranAudio: vi.fn() }));

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(authenticateToken);
  app.use('/api/quran', quranRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('source catalog authorization', () => {
  it('denies unauthenticated requests', async () => {
    expect((await fetch(`${base}/api/quran/sources`)).status).toBe(401);
  });
  it.each(['user', 'moderator'])('denies %s independently of UI visibility', async role => {
    const token = signToken({ id: role, email: 'fixture@example.test' });
    const response = await fetch(`${base}/api/quran/sources`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
  it('returns only disabled source inventory to an authenticated admin', async () => {
    const token = signToken({ id: 'admin', email: 'fixture@example.test' });
    const response = await fetch(`${base}/api/quran/sources`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = await response.json();
    expect(result.status).toBe('review_pending');
    expect(result.sources).toHaveLength(13);
    expect(result.sources.every((source: { productionEnabled: boolean }) => source.productionEnabled === false)).toBe(true);
  });
});

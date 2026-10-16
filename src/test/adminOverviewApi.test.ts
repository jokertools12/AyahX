import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import adminRouter from '../../server/routes/admin';
import { authenticateToken, signToken } from '../../server/middleware/auth';

vi.mock('../../server/db', () => ({ pingDatabase: vi.fn(async () => ({ ok: true, latencyMs: 3 })), query: vi.fn(async (_sql: string, params: string[]) => [{ role: params?.[0] === 'admin' ? 'admin' : 'user' }]) }));
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(authenticateToken);
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => { const address = server.address(); if (address && typeof address === 'object') base = `http://127.0.0.1:${address.port}`; resolve(); }); });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('admin overview', () => {
  it('requires admin authorization', async () => {
    const response = await fetch(`${base}/api/admin/overview`, { headers: { Authorization: `Bearer ${signToken({ id: 'user', email: 'user@example.test' })}` } });
    expect(response.status).toBe(403);
  });
  it('returns sanitized operational summary to an admin', async () => {
    const response = await fetch(`${base}/api/admin/overview`, { headers: { Authorization: `Bearer ${signToken({ id: 'admin', email: 'admin@example.test' })}` } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.database).toMatchObject({ status: 'connected', latencyMs: 3 });
    expect(body.sources).toMatchObject({ total: 13, activationReady: 0, reviewPending: 13 });
    expect(body).not.toHaveProperty('credentials');
  });
});

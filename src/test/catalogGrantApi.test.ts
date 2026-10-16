// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createCatalogRouter } from '../../server/routes/catalog';
import { authenticateToken, signToken } from '../../server/middleware/auth';
import { CatalogGrantError } from '../../server/services/catalogGrantService';
vi.mock('../../server/db', () => ({ query: vi.fn(async () => [{ role: 'admin' }]) }));
const service = { getAccess: vi.fn(), createGrant: vi.fn(), revokeGrant: vi.fn(), approve: vi.fn() };
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/catalog', createCatalogRouter(service));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => {
    const address = server.address(); if (address && typeof address !== 'string') base = 'http://127.0.0.1:' + address.port; resolve();
  }); });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => { vi.clearAllMocks(); });
const headers = () => ({ Authorization: 'Bearer ' + signToken({ id: 'server-actor', email: 'fixture@example.test' }), 'Content-Type': 'application/json' });
describe('catalog role-management router factory', () => {
  it('requires authentication and disables caching even for denial', async () => {
    const response = await fetch(base + '/api/catalog/access');
    expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(service.getAccess).not.toHaveBeenCalled();
  });
  it('passes only authenticated server actor ID regardless of legacy admin/body claims', async () => {
    service.getAccess.mockResolvedValueOnce({ capabilities: [] });
    const response = await fetch(base + '/api/catalog/access', { headers: headers() });
    expect(await response.json()).toEqual({ capabilities: [] }); expect(service.getAccess).toHaveBeenCalledExactlyOnceWith('server-actor');
    const body = { targetUserId: 'target', role: 'owner', reason: 'fixture', requestId: 'r1', actorId: 'forged' };
    service.createGrant.mockRejectedValueOnce(new CatalogGrantError('CATALOG_INPUT_INVALID', 400));
    const denied = await fetch(base + '/api/catalog/grants', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    expect(denied.status).toBe(400); expect(service.createGrant).toHaveBeenCalledExactlyOnceWith('server-actor', body);
  });
  it('routes create/revoke and returns stable Arabic permission/conflict errors', async () => {
    service.createGrant.mockRejectedValueOnce(new CatalogGrantError('CATALOG_FORBIDDEN', 403));
    const create = await fetch(base + '/api/catalog/grants', { method: 'POST', headers: headers(), body: '{}' });
    expect(create.status).toBe(403); expect(await create.json()).toMatchObject({ code: 'CATALOG_FORBIDDEN', error: expect.stringMatching(/[\u0600-\u06ff]/) });
    service.revokeGrant.mockRejectedValueOnce(new CatalogGrantError('CATALOG_LAST_OWNER', 409));
    const revoke = await fetch(base + '/api/catalog/grants/selected/revoke', { method: 'POST', headers: headers(), body: JSON.stringify({ reason: 'fixture', requestId: 'r' }) });
    expect(revoke.status).toBe(409); expect(service.revokeGrant).toHaveBeenCalledExactlyOnceWith('server-actor', 'selected', { reason: 'fixture', requestId: 'r' });
  });
  it('routes content approval with the authenticated actor identity', async () => {
    const body = { requestId: 'approval-1', reason: 'fixture review', approval: { schemaVersion: 1 } };
    service.approve.mockResolvedValueOnce({ auditEventId: 'event-1', replayed: false });
    const response = await fetch(base + '/api/catalog/approvals', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ auditEventId: 'event-1', replayed: false });
    expect(service.approve).toHaveBeenCalledExactlyOnceWith('server-actor', body);
  });
  it('never exposes bootstrap or raw database diagnostics', async () => {
    expect((await fetch(base + '/api/catalog/bootstrap', { method: 'POST', headers: headers(), body: '{}' })).status).toBe(404);
    service.getAccess.mockRejectedValueOnce(new Error('password=secret SQL diagnostics'));
    const response = await fetch(base + '/api/catalog/access', { headers: headers() });
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toMatch(/secret|diagnostics/);
  });
});

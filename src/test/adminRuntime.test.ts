// @vitest-environment node
import { Readable } from 'node:stream';
import type { Request, Response, Router } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAdminRuntime, isAdminApiPath } from '../../server/admin/adminRuntime';
import { AdminAccessService } from '../../server/admin/adminAccessService';
import { createAdminRouter, adminEndpointInventory } from '../../server/routes/admin/adminRouter';
import { CatalogAudioSource } from '../../server/services/catalogAudioSource';
import type { CatalogDatabase } from '../../server/services/catalogContracts';
import type { AdminRequestContext } from '../../server/admin/adminContracts';

const db: CatalogDatabase = {
  read: vi.fn(async () => { throw new Error('UNEXPECTED_DATABASE_READ'); }),
  execute: vi.fn(async () => { throw new Error('UNEXPECTED_DATABASE_WRITE'); }),
  transaction: vi.fn(async () => { throw new Error('UNEXPECTED_DATABASE_TRANSACTION'); }),
};
const origin = 'https://ayahx.example.test';
const authenticated: Awaited<ReturnType<AdminAccessService['authenticate']>> = {
  user: { id: 'fixture', email: 'fixture@example.test', displayName: 'fixture', roles: ['admin'], permissions: ['settings.write'] },
  actor: { id: 'fixture', kind: 'human' as const, permissions: new Set(['settings.write']) },
  sessionId: 'session', enrollmentRequired: false,
};
function testRouter() {
  const access = new AdminAccessService(db);
  access.authenticate = vi.fn(async () => authenticated);
  const check = vi.fn(async () => {}), handler = vi.fn(async (_ctx: AdminRequestContext) => ({ data: 'saved' }));
  const router = createAdminRouter({ db, access, rate: { check }, origins: [origin], register: register => register({ method: 'patch', path: '/settings/test', permission: 'settings.write', writes: true, body: z.object({ value: z.string() }).strict(), handler }) });
  return { router, access, check, handler };
}

/** Exercise middleware in memory: no socket listen, HTTP request, Redis or DB. */
function invoke(router: Router, method: string, path: string, headers: Record<string, string> = {}, raw?: string) {
  const stream = Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
  const req = Object.assign(stream, { method, url: path, originalUrl: '/api/admin' + path, headers: { ...headers, ...(raw === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }) }, socket: { remoteAddress: '127.0.0.1' }, query: {}, body: raw === undefined ? {} : undefined, get(name: string) { return this.headers[name.toLowerCase()]; } }) as unknown as Request;
  return new Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }>((resolve, reject) => {
    const output: Record<string, string> = {}, res = {
      locals: {}, statusCode: 200,
      set(name: string, value: string) { output[name.toLowerCase()] = value; return this; },
      vary(name: string) { output.vary = name; return this; },
      status(value: number) { this.statusCode = value; return this; },
      json(body: Record<string, unknown>) { resolve({ status: this.statusCode, headers: output, body }); return this; },
      end() { resolve({ status: this.statusCode, headers: output, body: {} }); },
    } as unknown as Response;
    (router as unknown as { handle(request: Request, response: Response, next: (error?: unknown) => void): void }).handle(req, res, error => reject(error ?? new Error('UNEXPECTED_ROUTER_FALLTHROUGH')));
  });
}

describe('production admin runtime boundaries', () => {
  it('registers both modules without I/O or startup DDL', async () => {
    const runtime = createAdminRuntime({ db, catalog: { publicVisibilityReasons: vi.fn(async () => []) }, source: new CatalogAudioSource(), rate: { check: async () => {} } });
    const inventory = adminEndpointInventory(runtime.router);
    expect(inventory.some(row => row.path === '/dashboard')).toBe(true);
    expect(inventory.some(row => row.path === '/catalog/reciters')).toBe(true);
    expect(inventory.some(row => row.path === '/catalog/timings')).toBe(true);
    expect(inventory.some(row => row.path === '/feedback' && row.method === 'post' && row.writes)).toBe(true);
    expect(inventory.some(row => row.path === '/feedback/:id/status' && row.method === 'patch' && row.writes)).toBe(true);
    expect(inventory.filter(row => row.method !== 'get').every(row => row.writes)).toBe(true);
    await runtime.close();
    expect(db.read).not.toHaveBeenCalled(); expect(db.execute).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled();
  });
  it('drains tasks immediately, closes rate storage after HTTP drains, and closes once', async () => {
    const rateClose = vi.fn(async () => {}), runtime = createAdminRuntime({ db, catalog: { publicVisibilityReasons: async () => [] }, source: new CatalogAudioSource(), rate: { check: async () => {}, close: rateClose } });
    const stop = vi.spyOn(runtime.worker, 'close').mockResolvedValue();
    await runtime.stopTasks(); expect(stop).toHaveBeenCalledOnce(); expect(rateClose).not.toHaveBeenCalled();
    const closing = runtime.close(); expect(runtime.close()).toBe(closing); await closing;
    expect(stop).toHaveBeenCalledOnce(); expect(rateClose).toHaveBeenCalledOnce();
  });
  it('matches the admin prefix with Express case semantics but excludes lookalikes', () => {
    for (const path of ['/api/admin', '/api/admin/auth/me', '/API/Admin/a']) expect(isAdminApiPath(path)).toBe(true);
    for (const path of ['/api/administrator', '/api/admin.evil', '/admin', '/api/catalog']) expect(isAdminApiPath(path)).toBe(false);
  });
  it('keeps unknown paths unauthenticated and never queries the database or rate storage', async () => {
    const { router, access, check } = testRouter();
    const result = await invoke(router, 'GET', '/unknown', { origin: 'https://untrusted.example.test' });
    expect(result.status).toBe(401); expect(result.body.code).toBe('ADMIN_UNAUTHENTICATED'); expect(result.headers['cache-control']).toBe('no-store');
    expect(access.authenticate).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });
  it('returns a structured, rate-limited 404 for authenticated unknown paths', async () => {
    const { router, check } = testRouter();
    const result = await invoke(router, 'GET', '/unknown', { cookie: 'ayahx_admin_session=fixture' });
    expect(result.status).toBe(404); expect(result.body.code).toBe('ADMIN_ENDPOINT_NOT_FOUND'); expect(check).toHaveBeenCalledWith('fixture', 'read');
    expect(result.headers['x-request-id']).toBeTruthy();
  });
  it('rejects Origin on authenticated unknown and registered paths before reads or mutations', async () => {
    const { router, check, handler } = testRouter();
    for (const path of ['/unknown', '/settings/test']) {
      const result = await invoke(router, 'PATCH', path, { cookie: 'ayahx_admin_session=fixture', origin: 'https://untrusted.example.test' });
      expect(result.status).toBe(403); expect(result.body.code).toBe('ADMIN_ORIGIN_DENIED');
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(check).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
  });
  it('allows only exact Origin preflights without authentication or administrative metadata', async () => {
    const { router, access, check } = testRouter();
    const response = await invoke(router, 'OPTIONS', '/settings/test', { origin, 'access-control-request-method': 'PATCH' });
    expect(response.status).toBe(204); expect(response.headers['access-control-allow-origin']).toBe(origin); expect(response.body).toEqual({});
    expect((await invoke(router, 'OPTIONS', '/settings/test', { origin: 'https://untrusted.example.test', 'access-control-request-method': 'PATCH' })).status).toBe(403);
    expect(access.authenticate).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });
  it('does not parse malformed JSON before authentication', async () => {
    const { router, access, check } = testRouter();
    const result = await invoke(router, 'PATCH', '/settings/test', { origin }, '{');
    expect(result.status).toBe(401); expect(result.body.code).toBe('ADMIN_UNAUTHENTICATED');
    expect(access.authenticate).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });
  it('parses bounded JSON only after auth/permission/Origin/rate and sanitizes syntax errors', async () => {
    const { router, check, handler } = testRouter(), headers = { cookie: 'ayahx_admin_session=fixture', origin };
    const valid = await invoke(router, 'PATCH', '/settings/test', headers, '{"value":"configured"}');
    expect(valid.status).toBe(200); expect(handler.mock.calls[0]?.[0]?.body).toEqual({ value: 'configured' });
    const invalid = await invoke(router, 'PATCH', '/settings/test', headers, '{"password":"PRIVATE_SENTINEL"');
    expect(invalid.status).toBe(422); expect(invalid.body.code).toBe('ADMIN_INPUT_INVALID'); expect(JSON.stringify(invalid.body)).not.toContain('PRIVATE_SENTINEL');
    expect(check).toHaveBeenCalledTimes(2); expect(handler).toHaveBeenCalledOnce();
    const oversized = await invoke(router, 'PATCH', '/settings/test', headers, JSON.stringify({ value: 'x'.repeat(270000) }));
    expect(oversized.status).toBe(413); expect(handler).toHaveBeenCalledOnce();
  });
});

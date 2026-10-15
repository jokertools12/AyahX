import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import authRouter from '../../server/routes/auth';
import { authenticateToken, signToken } from '../../server/middleware/auth';
import { query } from '../../server/db';
import { CatalogGrantError } from '../../server/services/catalogGrantService';
import { catalogGrantService } from '../../server/services/catalogGrantRuntime';

vi.mock('../../server/db', () => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('../../server/services/catalogGrantRuntime', () => ({ catalogGrantService: { deleteAccount: vi.fn() } }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn() } }));
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/auth', authRouter);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => {
    const address = server.address(); if (address && typeof address === 'object') base = `http://127.0.0.1:${address.port}`; resolve();
  }); });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockImplementation(async sql => sql.includes('FROM user_roles') ? [] : [{ password_hash: 'server-read-fixture-hash' }]);
  vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
  vi.mocked(catalogGrantService.deleteAccount).mockResolvedValue({ deleted: true });
});
const remove = (authenticated = true) => fetch(`${base}/api/auth/delete-account`, {
  method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${signToken({ id: 'verified-user', email: 'fixture@example.test' })}` } : {}) },
  body: JSON.stringify({ password: 'fixture-password', userId: 'forged-user', passwordHash: 'forged-hash' }),
});
describe('account deletion authority integration', () => {
  it('requires authentication before any deletion', async () => {
    expect((await remove(false)).status).toBe(401); expect(catalogGrantService.deleteAccount).not.toHaveBeenCalled();
  });
  it('requires a valid password before acquiring the deletion transaction', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    expect((await remove()).status).toBe(400); expect(catalogGrantService.deleteAccount).not.toHaveBeenCalled();
  });
  it('passes only the authenticated identity and server-read verified hash', async () => {
    expect((await remove()).status).toBe(200);
    expect(bcrypt.compare).toHaveBeenCalledWith('fixture-password', 'server-read-fixture-hash');
    expect(catalogGrantService.deleteAccount).toHaveBeenCalledWith('verified-user', 'server-read-fixture-hash');
    expect(vi.mocked(query).mock.calls.every(([sql]) => !sql.startsWith('DELETE'))).toBe(true);
  });
  it.each(['CATALOG_LAST_OWNER', 'CATALOG_PASSWORD_CHANGED', 'CATALOG_BUSY'])('returns a conflict for %s without claiming deletion', async code => {
    vi.mocked(catalogGrantService.deleteAccount).mockRejectedValueOnce(new CatalogGrantError(code, 409));
    const response = await remove(); expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty('success');
  });
});

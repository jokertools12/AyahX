// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { catalogCapabilitySchema, catalogGrantSchema, catalogRoleSchema, createCatalogAccessPolicy,
  type CatalogCapability, type CatalogGrant, type CatalogRole } from '../../server/services/catalogAccessPolicy';

const now = 10000;
const actor = { id: 'Actor-A', active: true };
const grant = (role: CatalogRole = 'read_only', grantId = 'grant-A'): CatalogGrant => ({ schemaVersion: 1,
  grantId, userId: actor.id, role, grantingAuditEventId: `audit-${grantId}`, grantedAtEpochMs: 1000,
  revokedAtEpochMs: null, revocationAuditEventId: null });
// Explicit expected matrix rather than deriving assertions from the implementation's matrix.
const expected: Record<CatalogRole, CatalogCapability[]> = {
  read_only: ['inspect'], editor: ['inspect', 'draft_write'], approver: ['inspect', 'content_approve', 'content_reject', 'content_revoke'],
  owner: ['inspect', 'draft_write', 'content_approve', 'content_reject', 'content_revoke', 'grant_manage', 'source_activate', 'retention_manage'],
};
describe('fresh server grant catalog capability policy', () => {
  for (const role of catalogRoleSchema.options) {
    it.each(catalogCapabilitySchema.options)(`${role}: %s follows explicit capability matrix`, async capability => {
      const authorize = createCatalogAccessPolicy(async () => [grant(role)], () => now);
      const decision = await authorize(actor, capability);
      expect(decision.allowed).toBe(expected[role].includes(capability));
      if (decision.allowed) expect(decision).toEqual({ allowed: true, actorId: actor.id, capability, role,
        grantId: 'grant-A', grantingAuditEventId: 'audit-grant-A' });
    });
  }
  it('unions independent editor/approver grants without inferring owner authority', async () => {
    const authorize = createCatalogAccessPolicy(async () => [grant('editor', 'e'), grant('approver', 'a')], () => now);
    for (const capability of ['inspect', 'draft_write', 'content_approve', 'content_reject', 'content_revoke'])
      expect((await authorize(actor, capability)).allowed).toBe(true);
    for (const capability of ['grant_manage', 'source_activate', 'retention_manage'])
      expect((await authorize(actor, capability)).allowed).toBe(false);
  });
  it('denies absent/deleted/inactive actors and forged legacy role objects before reading grants', async () => {
    const load = vi.fn(async () => [grant('owner')]); const authorize = createCatalogAccessPolicy(load, () => now);
    for (const input of [undefined, null, {}, { id: actor.id }, { ...actor, active: false }, { ...actor, active: 1 },
      { ...actor, role: 'owner' }, { ...actor, roles: ['owner'] }, { ...actor, deleted: true }, { id: ' ', active: true }])
      expect((await authorize(input, 'inspect')).allowed).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
  it('defaults to deny and rejects unknown capability aliases without reading grants', async () => {
    expect((await createCatalogAccessPolicy()(actor, 'inspect')).allowed).toBe(false);
    const load = vi.fn(async () => [grant('owner')]); const authorize = createCatalogAccessPolicy(load, () => now);
    for (const input of ['admin', 'approve', 'INSPECT', ['inspect'], null, { capability: 'inspect' }])
      expect(await authorize(actor, input)).toEqual({ allowed: false, reason: 'invalid_capability' });
    expect(load).not.toHaveBeenCalled();
  });
  it('requires exact actor ID and role case without coercion or legacy admin inheritance', async () => {
    for (const row of [{ ...grant('owner'), userId: 'other' }, { ...grant('owner'), userId: 'actor-a' },
      { ...grant(), role: 'Owner' }, { ...grant(), role: 'admin' }, { ...grant(), role: ['owner', 'owner'] },
      { ...grant(), role: 'owner', roles: ['owner'] }, { ...grant(), userId: 1 }])
      expect((await createCatalogAccessPolicy(async () => [row], () => now)(actor, 'inspect')).allowed).toBe(false);
  });
  it('requires complete audit-bound version1 grants and rejects fabricated expiry columns', async () => {
    for (const row of [null, {}, { ...grant(), schemaVersion: 2 }, { ...grant(), grantId: '' }, { ...grant(), grantId: ' x' },
      { ...grant(), grantingAuditEventId: '' }, { ...grant(), grantedAtEpochMs: '1000' }, { ...grant(), grantedAtEpochMs: -1 },
      { ...grant(), grantedAtEpochMs: 1.5 }, { ...grant(), grantedAtEpochMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...grant(), expiresAtEpochMs: now + 1 }, { ...grant(), revokedAtEpochMs: undefined }])
      expect((await createCatalogAccessPolicy(async () => [row], () => now)(actor, 'inspect')).allowed).toBe(false);
    const authorize = createCatalogAccessPolicy(async () => [{ ...grant('owner'), role: ['owner'] }, grant('editor')], () => now);
    expect((await authorize(actor, 'draft_write')).allowed).toBe(true);
    expect((await authorize(actor, 'grant_manage')).allowed).toBe(false);
  });
  it('rejects complete, partial, future and chronologically invalid revocations', async () => {
    for (const row of [{ ...grant('owner'), revokedAtEpochMs: 2000, revocationAuditEventId: 'revocation' },
      { ...grant('owner'), revokedAtEpochMs: now + 1, revocationAuditEventId: 'revocation' },
      { ...grant('owner'), revokedAtEpochMs: 2000 }, { ...grant('owner'), revocationAuditEventId: 'revocation' },
      { ...grant('owner'), revokedAtEpochMs: 999, revocationAuditEventId: 'revocation' },
      { ...grant('owner'), revokedAtEpochMs: 2000, revocationAuditEventId: '' }])
      expect((await createCatalogAccessPolicy(async () => [row], () => now)(actor, 'inspect')).allowed).toBe(false);
    expect(catalogGrantSchema.safeParse({ ...grant(), revokedAtEpochMs: 2000 }).success).toBe(false);
  });
  it('samples current time after fresh read and rejects future grants and invalid clocks', async () => {
    let clock = 500;
    const load = vi.fn(async () => { clock = now; return [grant('owner')]; });
    expect((await createCatalogAccessPolicy(load, () => clock)(actor, 'inspect')).allowed).toBe(true);
    expect((await createCatalogAccessPolicy(async () => [{ ...grant(), grantedAtEpochMs: now + 1 }], () => now)(actor, 'inspect')).allowed).toBe(false);
    for (const value of [NaN, Infinity, -1, 1.5])
      expect((await createCatalogAccessPolicy(async () => [grant('owner')], () => value)(actor, 'inspect')).allowed).toBe(false);
  });
  it('reloads grants for every decision so revocation takes effect without an authority cache', async () => {
    const load = vi.fn().mockResolvedValueOnce([grant('owner')]).mockResolvedValueOnce([
      { ...grant('owner'), revokedAtEpochMs: 2000, revocationAuditEventId: 'revocation' }]);
    const authorize = createCatalogAccessPolicy(load, () => now);
    expect((await authorize(actor, 'grant_manage')).allowed).toBe(true);
    expect((await authorize(actor, 'grant_manage')).allowed).toBe(false);
    expect(load.mock.calls).toEqual([[actor.id], [actor.id]]);
  });
  it('selects stable audit evidence by explicit code-unit sort independent of grant order', async () => {
    const rows = [grant('owner', 'grant-z'), grant('read_only', 'grant-B'), grant('editor', 'grant-a')];
    for (const ordered of [rows, [...rows].reverse()]) {
      const authorize = createCatalogAccessPolicy(async () => ordered, () => now);
      expect(await authorize(actor, 'inspect')).toMatchObject({ allowed: true, grantId: 'grant-B', grantingAuditEventId: 'audit-grant-B', role: 'read_only' });
      expect(await authorize(actor, 'draft_write')).toMatchObject({ allowed: true, grantId: 'grant-a', role: 'editor' });
    }
  });
  it('denies duplicate grant IDs rather than selecting conflicting evidence', async () => {
    for (const rows of [[grant('owner'), grant('editor')], [grant(), grant()]])
      expect(await createCatalogAccessPolicy(async () => rows, () => now)(actor, 'inspect')).toEqual({ allowed: false, reason: 'ambiguous_grants' });
  });
  it('denies malformed loader results but propagates loader errors', async () => {
    for (const payload of [undefined, null, grant('owner'), { grants: [grant('owner')] }])
      expect((await createCatalogAccessPolicy(async () => payload, () => now)(actor, 'inspect')).allowed).toBe(false);
    const authorize = createCatalogAccessPolicy(async () => { throw new Error('query unavailable'); }, () => now);
    await expect(authorize(actor, 'inspect')).rejects.toThrow('query unavailable');
  });
});

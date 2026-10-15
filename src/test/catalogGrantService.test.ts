// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCatalogGrantService } from '../../server/services/catalogGrantService';
import { catalogHash, type CatalogGrantConnection } from '../../server/services/catalogGrantRepository';
import type { DatabaseTarget } from '../../server/db/databaseIdentity';

const now = 1000;
const target: DatabaseTarget = { environment: 'staging', host: 'fixture', port: 3306, serverUuid: 'fixture-uuid', schema: 'fixture', version: '9.7.0' };
const bootstrap = { target, expectedUserId: 'owner', expectedEmail: 'owner@example.test', authorizationReferenceSha256: 'a'.repeat(64), reason: 'owner authorization fixture', requestId: 'bootstrap' };
type Store = { users: { id: string; email: string; passwordHash: string }[]; grants: Record<string, unknown>[]; events: Record<string, unknown>[] };
function fixture() {
  let store: Store = { users: ['owner', 'second', 'editor'].map(id => ({ id, email: id + '@example.test', passwordHash: 'hash-' + id })), grants: [], events: [] };
  const log: string[] = []; let snapshot: Store; let locked = false; let rejectAudit = false; let blockLock = false;
  const getConnection = vi.fn(async () => {
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (sql === 'SELECT DATABASE() AS schemaName') return [[{ schemaName: target.schema }]];
      if (sql.startsWith('SELECT DATABASE() AS schemaName,')) return [[{ schemaName: target.schema, ...target }]];
      if (sql.startsWith('SELECT GET_LOCK')) { if (locked || blockLock) return [[{ acquired: 0 }]]; locked = true; return [[{ acquired: 1 }]]; }
      if (sql.startsWith('SELECT RELEASE_LOCK')) { locked = false; return [[{ released: 1 }]]; }
      if (sql.startsWith('SELECT id, email')) return [store.users.filter(u => u.id === params[0])];
      if (sql.includes('FROM catalog_role_grants ORDER BY')) return [structuredClone(store.grants)];
      if (sql.includes('FROM catalog_audit_events ORDER BY')) return [structuredClone(store.events)];
      if (sql.startsWith('SELECT g.id AS grantId')) return [store.grants.filter(g => g.role === 'owner' && g.revokedAtEpochMs === null && store.users.some(u => u.id === g.userId)).map(g => ({ grantId: g.grantId, userId: g.userId }))];
      if (sql.startsWith('INSERT INTO catalog_audit_events')) {
        if (rejectAudit) throw new Error('audit insert failed');
        const keys = ['id', 'action', 'actorUserId', 'authorizingGrantId', 'requiredCapability', 'createdAtEpochMs', 'requestId', 'requestPayloadSha256', 'reason', 'subjectKind', 'subjectId', 'subjectRevision', 'subjectSha256', 'contextJson', 'contextSha256', 'beforeJson', 'afterJson', 'revokesEventId'];
        store.events.push(Object.fromEntries(keys.map((key, i) => [key, params[i]]))); return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO catalog_role_grants')) {
        const [grantId, userId, role, grantingAuditEventId, grantedAtEpochMs] = params;
        store.grants.push({ grantId, userId, role, grantingAuditEventId, grantedAtEpochMs, revokedAtEpochMs: null, revocationAuditEventId: null }); return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE catalog_role_grants SET')) {
        const grant = store.grants.find(g => g.grantId === params[2] && g.revokedAtEpochMs === null);
        if (grant) { grant.revokedAtEpochMs = params[0]; grant.revocationAuditEventId = params[1]; } return [{ affectedRows: grant ? 1 : 0 }];
      }
      if (sql.startsWith('DELETE FROM users')) { const before = store.users.length; store.users = store.users.filter(u => !(u.id === params[0] && u.passwordHash === params[1])); return [{ affectedRows: before - store.users.length }]; }
      throw new Error('unexpected SQL');
    });
    return { query, beginTransaction: async () => { log.push('BEGIN'); snapshot = structuredClone(store); },
      commit: async () => { log.push('COMMIT'); }, rollback: async () => { log.push('ROLLBACK'); store = snapshot; },
      release: () => { log.push('RELEASE_CONNECTION'); } } as unknown as CatalogGrantConnection;
  });
  const service = createCatalogGrantService(getConnection, () => now, { environment: 'staging' });
  return { service, getConnection, log, store: () => store, failAudit: () => { rejectAudit = true; }, block: () => { blockLock = true; } };
}
const create = { targetUserId: 'editor', role: 'editor', reason: 'fixture change', requestId: 'create-editor' };
describe('atomic catalog grant management service', () => {
  it('bootstraps only exact configured identity/account and audit-first grants in one transaction', async () => {
    const f = fixture(); const result = await f.service.bootstrapOwner(bootstrap);
    expect(result.replayed).toBe(false); expect(f.store().events).toHaveLength(1); expect(f.store().grants).toHaveLength(1);
    expect(f.log.findIndex(s => s.startsWith('SELECT GET_LOCK'))).toBeLessThan(f.log.indexOf('BEGIN'));
    expect(f.log.findIndex(s => s.startsWith('INSERT INTO catalog_audit_events'))).toBeLessThan(f.log.findIndex(s => s.startsWith('INSERT INTO catalog_role_grants')));
    expect(f.log.indexOf('COMMIT')).toBeLessThan(f.log.findIndex(s => s.startsWith('SELECT RELEASE_LOCK')));
    expect(f.log.at(-1)).toBe('RELEASE_CONNECTION');
    expect((await f.service.getAccess('owner')).capabilities).toContain('grant_manage');
    const event = f.store().events[0]; expect(event.contextJson).not.toContain(bootstrap.expectedEmail);
    expect(JSON.parse(event.contextJson as string)).toMatchObject({ targetSha256: catalogHash(target), authorizationReferenceSha256: bootstrap.authorizationReferenceSha256 });
  });
  it('rejects bootstrap environment/account/physical identity mismatches and nonempty authority state', async () => {
    for (const body of [{ ...bootstrap, expectedUserId: 'other' }, { ...bootstrap, expectedEmail: 'OWNER@example.test' },
      { ...bootstrap, target: { ...target, serverUuid: 'other' } }, { ...bootstrap, target: { ...target, environment: 'production' } }]) {
      const f = fixture(); await expect(f.service.bootstrapOwner(body)).rejects.toThrow(); expect(f.store().grants).toEqual([]);
    }
    const f = fixture(); await expect(createCatalogGrantService(f.getConnection, () => now).bootstrapOwner(bootstrap)).rejects.toMatchObject({ code: 'CATALOG_ENVIRONMENT_MISMATCH' });
    await f.service.bootstrapOwner(bootstrap);
    await expect(f.service.bootstrapOwner({ ...bootstrap, requestId: 'again' })).rejects.toMatchObject({ code: 'CATALOG_BOOTSTRAP_ALREADY_DONE' });
    await expect(f.service.bootstrapOwner({ ...bootstrap, reason: 'different' })).rejects.toMatchObject({ code: 'CATALOG_REQUEST_CONFLICT' });
    expect((await f.service.bootstrapOwner(bootstrap)).replayed).toBe(true);
    const corrupt = fixture(); corrupt.store().events.push({ malformed: true });
    await expect(corrupt.service.bootstrapOwner(bootstrap)).rejects.toMatchObject({ code: 'CATALOG_BOOTSTRAP_ALREADY_DONE' });
  });
  it('ignores forged actor objects, legacy role fields and request role arrays', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap);
    for (const [actor, body] of [[{ id: 'owner', role: 'owner' }, create], ['editor', { ...create, role: 'owner' }],
      ['owner', { ...create, role: ['owner'] }], ['owner', { ...create, actorId: 'owner' }]])
      await expect(f.service.createGrant(actor, body)).rejects.toThrow();
    expect(f.store().grants).toHaveLength(1);
  });
  it('creates audit-bound grants, unions roles and disallows implicit editor/approver grant management', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap);
    const result = await f.service.createGrant('owner', create);
    expect(result.grantId).toMatch(/^[a-f0-9-]{36}$/);
    expect((await f.service.getAccess('editor')).capabilities).toEqual(['inspect', 'draft_write']);
    await f.service.createGrant('owner', { ...create, role: 'approver', requestId: 'approve-role' });
    expect((await f.service.getAccess('editor')).capabilities).toEqual(['inspect', 'draft_write', 'content_approve', 'content_reject', 'content_revoke']);
    await expect(f.service.createGrant('editor', { ...create, targetUserId: 'second', requestId: 'forged' })).rejects.toMatchObject({ code: 'CATALOG_FORBIDDEN' });
    f.store().grants[1].role = 'owner'; // Immutable row tampering no longer matches its audit evidence.
    expect((await f.service.getAccess('editor')).capabilities).not.toContain('grant_manage');
  });
  it('replays exact actor/request payload without writes and rejects conflicting reuse with409', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap); const first = await f.service.createGrant('owner', create);
    const count = f.store().events.length; const replay = await f.service.createGrant('owner', create);
    expect(replay).toEqual({ ...first, replayed: true }); expect(f.store().events).toHaveLength(count);
    await expect(f.service.createGrant('owner', { ...create, reason: 'changed' })).rejects.toMatchObject({ code: 'CATALOG_REQUEST_CONFLICT', status: 409 });
    await expect(f.service.createGrant('owner', { ...create, requestId: 'duplicate-role' })).rejects.toMatchObject({ code: 'CATALOG_GRANT_EXISTS' });
  });
  it('rolls back grant mutation when audit insert fails and releases the global lock', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap); f.failAudit();
    await expect(f.service.createGrant('owner', create)).rejects.toThrow('audit insert failed');
    expect(f.store().grants).toHaveLength(1); expect(f.store().events).toHaveLength(1);
    expect(f.log).toContain('ROLLBACK'); expect(f.log.at(-1)).toBe('RELEASE_CONNECTION');
  });
  it('never updates revocation columns when its audit insert fails', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap); const created = await f.service.createGrant('owner', create);
    f.failAudit(); await expect(f.service.revokeGrant('owner', created.grantId, { reason: 'fixture', requestId: 'revoke-fails' })).rejects.toThrow('audit insert failed');
    expect(f.store().grants.find(g => g.grantId === created.grantId)?.revokedAtEpochMs).toBeNull();
    expect(f.store().events).toHaveLength(2);
    expect(f.log.some(sql => sql.startsWith('UPDATE catalog_role_grants'))).toBe(false);
  });
  it('soft-revokes with audited before/after, preserves same-ms creator history, and guards last owner', async () => {
    const f = fixture(); const root = await f.service.bootstrapOwner(bootstrap);
    await expect(f.service.revokeGrant('owner', root.grantId, { reason: 'no', requestId: 'last' })).rejects.toMatchObject({ code: 'CATALOG_LAST_OWNER' });
    await f.service.createGrant('owner', { ...create, targetUserId: 'second', role: 'owner', requestId: 'second-owner' });
    const revoked = await f.service.revokeGrant('second', root.grantId, { reason: 'rotate', requestId: 'rotate' });
    expect(f.store().grants[0].revokedAtEpochMs).toBe(now);
    expect((await f.service.getAccess('owner')).capabilities).toEqual([]);
    expect((await f.service.getAccess('second')).capabilities).toContain('grant_manage');
    expect((await f.service.revokeGrant('second', root.grantId, { reason: 'rotate', requestId: 'rotate' })).auditEventId).toBe(revoked.auditEventId);
    const second = f.store().grants[1];
    await expect(f.service.revokeGrant('second', second.grantId, { reason: 'last', requestId: 'last-second' })).rejects.toMatchObject({ code: 'CATALOG_LAST_OWNER' });
  });
  it('serializes concurrent owner removal attempts with the shared schema lock', async () => {
    const f = fixture(); const root = await f.service.bootstrapOwner(bootstrap);
    const second = await f.service.createGrant('owner', { ...create, targetUserId: 'second', role: 'owner', requestId: 'second-owner' });
    const outcomes = await Promise.allSettled([
      f.service.revokeGrant('owner', second.grantId, { reason: 'race', requestId: 'race-a' }),
      f.service.revokeGrant('second', root.grantId, { reason: 'race', requestId: 'race-b' }),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(f.store().grants.filter(g => g.role === 'owner' && g.revokedAtEpochMs === null)).toHaveLength(1);
  });
  it('guards last-owner deletion, hash changes and deleted actors while deleting only users', async () => {
    const f = fixture(); await f.service.bootstrapOwner(bootstrap);
    await expect(f.service.deleteAccount('owner', 'hash-owner')).rejects.toMatchObject({ code: 'CATALOG_LAST_OWNER' });
    await expect(f.service.deleteAccount('editor', 'stale')).rejects.toMatchObject({ code: 'CATALOG_PASSWORD_CHANGED' });
    await f.service.createGrant('owner', { ...create, targetUserId: 'second', role: 'owner', requestId: 'second-owner' });
    await f.service.deleteAccount('owner', 'hash-owner');
    expect(f.store().users.some(u => u.id === 'owner')).toBe(false);
    expect(f.store().grants).toHaveLength(2); expect(f.store().events).toHaveLength(2);
    expect((await f.service.getAccess('second')).capabilities).toContain('grant_manage');
    await expect(f.service.getAccess('owner')).rejects.toMatchObject({ code: 'CATALOG_ACTOR_MISSING' });
    expect(f.log.filter(sql => sql.startsWith('DELETE ')).every(sql => sql.startsWith('DELETE FROM users '))).toBe(true);
  });
  it('does not start a transaction when another migration/membership writer holds the lock', async () => {
    const f = fixture(); f.block(); await expect(f.service.bootstrapOwner(bootstrap)).rejects.toMatchObject({ code: 'CATALOG_BUSY' });
    expect(f.log).not.toContain('BEGIN'); expect(f.log.at(-1)).toBe('RELEASE_CONNECTION');
  });
});

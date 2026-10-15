// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { catalogHash, grantIdentity, readCatalogGrantState, readCatalogUser, verifiedCatalogGrants,
  type CatalogAuditEvent, type CatalogGrantConnection, type CatalogGrantState } from '../../server/services/catalogGrantRepository';
import type { CatalogGrant } from '../../server/services/catalogAccessPolicy';

const grant = (grantId = 'root', userId = 'owner', role: CatalogGrant['role'] = 'owner'): CatalogGrant => ({ schemaVersion: 1,
  grantId, userId, role, grantingAuditEventId: 'event-' + grantId, grantedAtEpochMs: 1000, revokedAtEpochMs: null, revocationAuditEventId: null });
function creation(g: CatalogGrant, owner?: CatalogGrant): CatalogAuditEvent {
  const context = owner ? { schemaVersion: 1, kind: 'grant_create' } : { schemaVersion: 1, kind: 'owner_bootstrap',
    targetSha256: 'a'.repeat(64), accountSha256: 'b'.repeat(64), authorizationReferenceSha256: 'c'.repeat(64) };
  return { id: g.grantingAuditEventId, action: owner ? 'grant_create' : 'owner_bootstrap', actorUserId: owner?.userId ?? g.userId,
    authorizingGrantId: owner?.grantId ?? null, requiredCapability: 'grant_manage', createdAtEpochMs: 1000, requestId: 'request-' + g.grantId,
    requestPayloadSha256: 'd'.repeat(64), reason: 'fixture', subjectKind: 'grant', subjectId: g.grantId, subjectRevision: '1',
    subjectSha256: catalogHash(grantIdentity(g)), contextJson: context, contextSha256: catalogHash(context), beforeJson: null,
    afterJson: structuredClone(g), revokesEventId: null };
}
function fixture(): CatalogGrantState {
  const root = grant(); const child = grant('child', 'editor', 'editor');
  return { grants: [root, child], events: [creation(root), creation(child, root)], rawGrantCount: 2, rawAuditCount: 2 };
}
describe('audit-backed catalog grant repository', () => {
  it('verifies root and recursively owner-authorized grants without legacy role inheritance', () => {
    const state = fixture();
    expect(verifiedCatalogGrants(state, 'owner', 2000)).toEqual([state.grants[0]]);
    expect(verifiedCatalogGrants(state, 'editor', 2000)).toEqual([state.grants[1]]);
    expect(verifiedCatalogGrants(state, 'Editor', 2000)).toEqual([]);
  });
  it('rejects immutable row edits, missing/forged creation evidence and self-authorizing cycles', () => {
    const mutations: ((state: CatalogGrantState) => void)[] = [s => { s.grants[1].role = 'owner'; }, s => { s.events.pop(); },
      s => { s.events[1].subjectSha256 = 'e'.repeat(64); }, s => { s.events[1].afterJson = { role: 'owner' }; },
      s => { s.events[1].actorUserId = 'other'; }, s => { s.events[1].authorizingGrantId = 'child'; },
      s => { s.events[1].requiredCapability = 'inspect'; }, s => { s.events[1].beforeJson = {}; },
      s => { s.events[0].authorizingGrantId = 'child'; }, s => { s.events[0].actorUserId = 'other'; },
      s => { s.events[0].createdAtEpochMs = 3000; }];
    for (const mutate of mutations) { const state = fixture(); mutate(state); expect(verifiedCatalogGrants(state, 'editor', 2000)).toEqual([]); }
  });
  it('preserves history when the authorizing owner is revoked in the same millisecond by the new owner', () => {
    const root = grant(); const other = grant('second', 'second-owner'); const rootCreated = creation(root); const otherCreated = creation(other, root);
    const before = structuredClone(root); root.revokedAtEpochMs = 1000; root.revocationAuditEventId = 'revoke-root';
    const context = { schemaVersion: 1, kind: 'grant_revoke' };
    const revoked: CatalogAuditEvent = { ...rootCreated, id: 'revoke-root', action: 'grant_revoke', actorUserId: other.userId,
      authorizingGrantId: other.grantId, requestId: 'revoke-root', contextJson: context, contextSha256: catalogHash(context),
      beforeJson: before, afterJson: structuredClone(root), revokesEventId: root.grantingAuditEventId };
    const state = { grants: [root, other], events: [rootCreated, otherCreated, revoked], rawGrantCount: 2, rawAuditCount: 3 };
    expect(verifiedCatalogGrants(state, other.userId, 2000)).toEqual([other]);
    expect(verifiedCatalogGrants(state, root.userId, 2000)[0].revokedAtEpochMs).toBe(1000);
    revoked.afterJson = {};
    expect(verifiedCatalogGrants(state, other.userId, 2000)).toEqual([]);
  });
  it('does not authorize history after an earlier owner revocation or with duplicate identity evidence', () => {
    const state = fixture(); state.grants[0].revokedAtEpochMs = 999; state.grants[0].revocationAuditEventId = 'invalid';
    expect(verifiedCatalogGrants(state, 'editor', 2000)).toEqual([]);
    const duplicate = fixture(); duplicate.grants.push(duplicate.grants[0]);
    expect(verifiedCatalogGrants(duplicate, 'owner', 2000)).toEqual([]);
  });
  it('parses safe BIGINT strings/JSON but denies malformed rows while retaining raw counts for bootstrap', async () => {
    const state = fixture();
    const raw = state.grants.map(({ schemaVersion: _, ...g }) => ({ ...g, grantedAtEpochMs: '1000' }));
    const events = state.events.map(e => ({ ...e, createdAtEpochMs: '1000', contextJson: JSON.stringify(e.contextJson),
      beforeJson: null, afterJson: JSON.stringify(e.afterJson) }));
    const query = vi.fn().mockResolvedValueOnce([raw]).mockResolvedValueOnce([events]);
    const parsed = await readCatalogGrantState({ query } as unknown as CatalogGrantConnection, true);
    expect(verifiedCatalogGrants(parsed, 'editor', 2000)).toHaveLength(1);
    expect(query.mock.calls.every(([sql]) => sql.endsWith('FOR UPDATE'))).toBe(true);
    const badQuery = vi.fn().mockResolvedValueOnce([[{ ...raw[0], grantedAtEpochMs: '1e3' }]])
      .mockResolvedValueOnce([[{ ...events[0], contextSha256: 'e'.repeat(64) }]]);
    const invalid = await readCatalogGrantState({ query: badQuery } as unknown as CatalogGrantConnection);
    expect(invalid.grants).toEqual([]); expect(invalid.events).toEqual([]);
    expect(invalid.rawGrantCount).toBe(1); expect(invalid.rawAuditCount).toBe(1);
  });
  it('reads live user by parameterized exact ID and propagates database errors', async () => {
    const query = vi.fn().mockResolvedValueOnce([[{ id: 'owner', email: 'fixture@example.test', passwordHash: 'hash-fixture' }]])
      .mockRejectedValueOnce(new Error('offline'));
    const connection = { query } as unknown as CatalogGrantConnection;
    expect((await readCatalogUser(connection, 'owner', true))?.id).toBe('owner');
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('WHERE BINARY id = BINARY ?'), ['owner']]);
    await expect(readCatalogUser(connection, 'owner')).rejects.toThrow('offline');
  });
});

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { catalogGrantSchema, type CatalogGrant } from './catalogAccessPolicy';
import { canonicalJson, hashBytes } from '../utils/canonicalIntegrity';

export type CatalogGrantConnection = Pick<PoolConnection, 'query' | 'beginTransaction' | 'commit' | 'rollback' | 'release'>;
export const catalogUserId = z.string().min(1).max(36).refine(value => value.trim() === value);
const id = z.string().min(1).max(200).refine(value => value.trim() === value);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const epoch = z.preprocess(value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value, z.number().int().nonnegative().safe());
const userSchema = z.object({ id: catalogUserId, email: z.string().min(1).max(255), passwordHash: z.string().min(1).max(255) }).strict();
export const grantIdentity = (grant: CatalogGrant) => ({ schemaVersion: 1, grantId: grant.grantId, userId: grant.userId,
  role: grant.role, grantingAuditEventId: grant.grantingAuditEventId, grantedAtEpochMs: grant.grantedAtEpochMs });
export const catalogHash = (value: unknown) => hashBytes(canonicalJson(value));
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const auditSchema = z.object({ id, action: z.enum(['owner_bootstrap', 'grant_create', 'grant_revoke', 'draft_write', 'content_approve',
  'content_reject', 'content_revoke', 'source_activate', 'retention_manage']), actorUserId: catalogUserId,
  authorizingGrantId: id.nullable(), requiredCapability: z.string(), createdAtEpochMs: epoch, requestId: id,
  requestPayloadSha256: sha, reason: z.string().min(1).max(1000).refine(v => v.trim() === v), subjectKind: z.string(),
  subjectId: id, subjectRevision: id, subjectSha256: sha, contextJson: z.unknown(), contextSha256: sha,
  beforeJson: z.unknown(), afterJson: z.unknown(), revokesEventId: id.nullable() }).strict();
export type CatalogAuditEvent = z.infer<typeof auditSchema>;
export type CatalogGrantState = { grants: CatalogGrant[]; events: CatalogAuditEvent[]; rawGrantCount: number; rawAuditCount: number };
const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
export async function catalogRows(connection: CatalogGrantConnection, sql: string, parameters: unknown[] = []) {
  return (await connection.query<RowDataPacket[]>(sql, parameters))[0];
}
export async function readCatalogUser(connection: CatalogGrantConnection, userId: string, lock = false) {
  const rows = await catalogRows(connection, 'SELECT id, email, password_hash AS passwordHash FROM users WHERE BINARY id = BINARY ?' + (lock ? ' FOR UPDATE' : ''), [userId]);
  const parsed = rows.length === 1 ? userSchema.safeParse(rows[0]) : null;
  return parsed?.success ? parsed.data : null;
}
export async function readCatalogGrantState(connection: CatalogGrantConnection, lock = false): Promise<CatalogGrantState> {
  const suffix = lock ? ' FOR UPDATE' : '';
  const rawGrants = await catalogRows(connection, `SELECT id AS grantId, user_id AS userId, role,
    granting_audit_event_id AS grantingAuditEventId, granted_at_epoch_ms AS grantedAtEpochMs,
    revoked_at_epoch_ms AS revokedAtEpochMs, revocation_audit_event_id AS revocationAuditEventId
    FROM catalog_role_grants ORDER BY id${suffix}`);
  // Audit rows are immutable. A current shared read preserves locking semantics using SELECT alone;
  // FOR UPDATE would require an unwanted audit UPDATE/DELETE/LOCK TABLES privilege.
  const rawEvents = await catalogRows(connection, `SELECT id, action, actor_user_id AS actorUserId,
    authorizing_grant_id AS authorizingGrantId, required_capability AS requiredCapability, created_at_epoch_ms AS createdAtEpochMs,
    request_id AS requestId, request_payload_sha256 AS requestPayloadSha256, reason, subject_kind AS subjectKind,
    subject_id AS subjectId, subject_revision AS subjectRevision, subject_sha256 AS subjectSha256, context_json AS contextJson,
    context_sha256 AS contextSha256, before_json AS beforeJson, after_json AS afterJson, revokes_event_id AS revokesEventId
    FROM catalog_audit_events ORDER BY id${lock ? ' FOR SHARE' : ''}`);
  const grants: CatalogGrant[] = []; const events: CatalogAuditEvent[] = [];
  for (const row of rawGrants) {
    const parsed = catalogGrantSchema.safeParse({ ...row, schemaVersion: 1, grantedAtEpochMs: epoch.safeParse(row.grantedAtEpochMs).data,
      revokedAtEpochMs: row.revokedAtEpochMs === null ? null : epoch.safeParse(row.revokedAtEpochMs).data });
    if (parsed.success && catalogUserId.safeParse(parsed.data.userId).success) grants.push(parsed.data);
  }
  for (const row of rawEvents) {
    try {
      const event = auditSchema.parse({ ...row, contextJson: decode(row.contextJson), beforeJson: decode(row.beforeJson), afterJson: decode(row.afterJson) });
      if (catalogHash(event.contextJson) === event.contextSha256) events.push(event);
    } catch { /* Malformed persistence is not grant evidence. */ }
  }
  return { grants, events, rawGrantCount: rawGrants.length, rawAuditCount: rawEvents.length };
}

/** Trusted append-only server history, not a cryptographic proof against database compromise. */
export function verifiedCatalogGrants(state: CatalogGrantState, userId: string, now: number): CatalogGrant[] {
  const grants = new Map(state.grants.map(g => [g.grantId, g])); const events = new Map(state.events.map(e => [e.id, e]));
  if (grants.size !== state.grants.length || events.size !== state.events.length || !Number.isSafeInteger(now) || now < 0) return [];
  const visiting = new Set<string>(); const memo = new Map<string, boolean>();
  const initial = (g: CatalogGrant) => ({ ...g, revokedAtEpochMs: null, revocationAuditEventId: null });
  const common = (e: CatalogAuditEvent, g: CatalogGrant) => e.requiredCapability === 'grant_manage' && e.subjectKind === 'grant'
    && e.subjectId === g.grantId && e.subjectRevision === '1' && e.subjectSha256 === catalogHash(grantIdentity(g))
    && e.createdAtEpochMs <= now;
  const revocation = (g: CatalogGrant): CatalogAuditEvent | null => {
    const e = g.revocationAuditEventId ? events.get(g.revocationAuditEventId) : undefined;
    return e && common(e, g) && e.action === 'grant_revoke' && e.createdAtEpochMs === g.revokedAtEpochMs
      && e.revokesEventId === g.grantingAuditEventId && equal(e.beforeJson, initial(g)) && equal(e.afterJson, g)
      && equal(e.contextJson, { schemaVersion: 1, kind: 'grant_revoke' }) ? e : null;
  };
  const creation = (g: CatalogGrant): boolean => {
    if (memo.has(g.grantId)) return memo.get(g.grantId)!;
    if (visiting.has(g.grantId)) return false;
    visiting.add(g.grantId);
    const e = events.get(g.grantingAuditEventId);
    let valid = Boolean(e && common(e, g) && e.createdAtEpochMs === g.grantedAtEpochMs && e.revokesEventId === null
      && e.beforeJson === null && equal(e.afterJson, initial(g)));
    if (valid && e) {
      if (e.action === 'owner_bootstrap') {
        const context = z.object({ schemaVersion: z.literal(1), kind: z.literal('owner_bootstrap'),
          targetSha256: sha, accountSha256: sha, authorizationReferenceSha256: sha }).strict().safeParse(e.contextJson);
        valid = g.role === 'owner' && e.actorUserId === g.userId && e.authorizingGrantId === null && context.success
          && state.events.filter(event => event.action === 'owner_bootstrap').length === 1;
      } else valid = e.action === 'grant_create' && equal(e.contextJson, { schemaVersion: 1, kind: 'grant_create' }) && ownerAt(e);
    }
    visiting.delete(g.grantId); memo.set(g.grantId, valid); return valid;
  };
  const ownerAt = (e: CatalogAuditEvent): boolean => {
    const owner = e.authorizingGrantId ? grants.get(e.authorizingGrantId) : undefined;
    // Same-ms ties trust server transaction order under the global lock; later role loss does not erase history.
    return Boolean(owner && owner.role === 'owner' && owner.userId === e.actorUserId && creation(owner)
      && owner.grantedAtEpochMs <= e.createdAtEpochMs
      && (owner.revokedAtEpochMs === null || owner.revokedAtEpochMs >= e.createdAtEpochMs && revocation(owner)));
  };
  return state.grants.filter(g => g.userId === userId && creation(g)
    && (g.revokedAtEpochMs === null || Boolean(revocation(g) && ownerAt(revocation(g)!))));
}

export async function liveOwnerUserIds(connection: CatalogGrantConnection, state: CatalogGrantState, now: number) {
  const rows = await catalogRows(connection, `SELECT g.id AS grantId, g.user_id AS userId FROM catalog_role_grants g
    JOIN users u ON BINARY u.id = BINARY g.user_id WHERE g.role = 'owner' AND g.revoked_at_epoch_ms IS NULL ORDER BY g.id FOR UPDATE`);
  const ids = new Set<string>();
  for (const row of rows) if (typeof row.userId === 'string' && verifiedCatalogGrants(state, row.userId, now)
    .some(g => g.grantId === row.grantId && g.role === 'owner' && g.revokedAtEpochMs === null && g.grantedAtEpochMs <= now)) ids.add(row.userId);
  return ids;
}
export async function insertCatalogAudit(connection: CatalogGrantConnection, e: CatalogAuditEvent) {
  await connection.query(`INSERT INTO catalog_audit_events (id, action, actor_user_id, authorizing_grant_id, required_capability,
    created_at_epoch_ms, request_id, request_payload_sha256, reason, subject_kind, subject_id, subject_revision, subject_sha256,
    context_json, context_sha256, before_json, after_json, revokes_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [e.id, e.action, e.actorUserId, e.authorizingGrantId, e.requiredCapability, e.createdAtEpochMs, e.requestId, e.requestPayloadSha256,
    e.reason, e.subjectKind, e.subjectId, e.subjectRevision, e.subjectSha256, canonicalJson(e.contextJson), e.contextSha256,
    e.beforeJson === null ? null : canonicalJson(e.beforeJson), canonicalJson(e.afterJson), e.revokesEventId]);
}
export async function insertCatalogGrant(connection: CatalogGrantConnection, g: CatalogGrant) {
  await connection.query(`INSERT INTO catalog_role_grants (id, user_id, role, granting_audit_event_id, granted_at_epoch_ms)
    VALUES (?, ?, ?, ?, ?)`, [g.grantId, g.userId, g.role, g.grantingAuditEventId, g.grantedAtEpochMs]);
}

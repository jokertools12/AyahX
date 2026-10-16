import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { databaseTargetSchema, inspectDatabaseIdentity, type DatabaseTarget } from '../db/databaseIdentity';
import { catalogCapabilitySchema, catalogRoleSchema, createCatalogAccessPolicy, type CatalogGrant } from './catalogAccessPolicy';
import { hashBytes } from '../utils/canonicalIntegrity';
import { catalogHash, catalogRows, catalogUserId, grantIdentity, insertCatalogAudit, insertCatalogGrant, liveOwnerUserIds,
  readCatalogGrantState, readCatalogUser, verifiedCatalogGrants, type CatalogAuditEvent, type CatalogGrantConnection, type CatalogGrantState } from './catalogGrantRepository';

const id = z.string().min(1).max(200).refine(v => v.trim() === v);
const reason = z.string().min(1).max(1000).refine(v => v.trim() === v);
const commonInput = z.object({ reason, requestId: id }).strict();
const createInput = commonInput.extend({ targetUserId: catalogUserId, role: catalogRoleSchema }).strict();
const bootstrapInput = commonInput.extend({ target: databaseTargetSchema, expectedUserId: catalogUserId,
  expectedEmail: z.string().email().max(255).refine(v => v.trim() === v),
  authorizationReferenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export class CatalogGrantError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
const fail = (code: string, status: number): never => { throw new CatalogGrantError(code, status); };
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); return parsed.success ? parsed.data : fail('CATALOG_INPUT_INVALID', 400);
}
const validClock = (clock: () => number) => { const now = clock(); return Number.isSafeInteger(now) && now >= 0 ? now : fail('CATALOG_CLOCK_INVALID', 500); };
type MutationResult = { grantId: string; auditEventId: string; replayed: boolean };
function replay(state: CatalogGrantState, actorId: string, requestId: string, payloadSha256: string, now: number): MutationResult | null {
  const events = state.events.filter(e => e.actorUserId === actorId && e.requestId === requestId);
  if (!events.length) return null;
  if (events.length !== 1 || events[0].requestPayloadSha256 !== payloadSha256) return fail('CATALOG_REQUEST_CONFLICT', 409);
  const event = events[0];
  if (!['owner_bootstrap', 'grant_create', 'grant_revoke'].includes(event.action) || event.subjectKind !== 'grant') return fail('CATALOG_REQUEST_CONFLICT', 409);
  const grant = state.grants.find(g => g.grantId === event.subjectId);
  if (!grant || !verifiedCatalogGrants(state, grant.userId, now).some(g => g.grantId === grant.grantId)
    || (event.action === 'grant_revoke' ? grant.revocationAuditEventId : grant.grantingAuditEventId) !== event.id)
    return fail('CATALOG_REQUEST_CONFLICT', 409);
  return { grantId: event.subjectId, auditEventId: event.id, replayed: true };
}
function eventFor(action: 'owner_bootstrap' | 'grant_create' | 'grant_revoke', grant: CatalogGrant, actorId: string,
  authorizingGrantId: string | null, body: z.infer<typeof commonInput>, payloadSha256: string,
  now: number, before: CatalogGrant | null, context: unknown): CatalogAuditEvent {
  return { id: action === 'grant_revoke' ? grant.revocationAuditEventId! : grant.grantingAuditEventId, action,
    actorUserId: actorId, authorizingGrantId, requiredCapability: 'grant_manage', createdAtEpochMs: now,
    requestId: body.requestId, requestPayloadSha256: payloadSha256, reason: body.reason, subjectKind: 'grant',
    subjectId: grant.grantId, subjectRevision: '1', subjectSha256: catalogHash(grantIdentity(grant)), contextJson: context,
    contextSha256: catalogHash(context), beforeJson: before, afterJson: grant,
    revokesEventId: action === 'grant_revoke' ? grant.grantingAuditEventId : null };
}

export function createCatalogGrantService(getConnection: () => Promise<CatalogGrantConnection>, clock: () => number = Date.now,
  options: { environment?: DatabaseTarget['environment'] } = {}) {
  async function transaction<T>(work: (connection: CatalogGrantConnection) => Promise<T>): Promise<T> {
    const connection = await getConnection(); let lock: string | undefined; let acquired = false; let begun = false;
    try {
      const [database] = await catalogRows(connection, 'SELECT DATABASE() AS schemaName');
      const schema = input(id, database?.schemaName);
      lock = `ayahx_catalog_${catalogHashSchema(schema)}`;
      const [row] = await catalogRows(connection, 'SELECT GET_LOCK(?, 0) AS acquired', [lock]);
      if (Number(row?.acquired) !== 1) { lock = undefined; return fail('CATALOG_BUSY', 409); }
      acquired = true;
      await connection.beginTransaction(); begun = true;
      const result = await work(connection);
      await connection.commit(); begun = false; return result;
    } catch (error) {
      if (begun) await connection.rollback();
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') return fail('CATALOG_REQUEST_CONFLICT', 409);
      throw error;
    } finally {
      try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]); } finally { connection.release(); }
    }
  }
  async function actorState(connection: CatalogGrantConnection, actorId: string) {
    const actor = await readCatalogUser(connection, actorId, true);
    if (!actor) return fail('CATALOG_ACTOR_MISSING', 403);
    const state = await readCatalogGrantState(connection, true); const now = validClock(clock);
    const verified = verifiedCatalogGrants(state, actor.id, now);
    const decision = await createCatalogAccessPolicy(async () => verified, () => now)({ id: actor.id, active: true }, 'grant_manage');
    if (!decision.allowed) return fail('CATALOG_FORBIDDEN', 403);
    return { actor, state, now, authorizingGrantId: decision.grantId };
  }
  async function getAccess(actorIdInput: unknown) {
    const actorId = input(catalogUserId, actorIdInput); const connection = await getConnection();
    try {
      const user = await readCatalogUser(connection, actorId);
      if (!user) return fail('CATALOG_ACTOR_MISSING', 403);
      const state = await readCatalogGrantState(connection); const now = validClock(clock);
      const grants = verifiedCatalogGrants(state, user.id, now);
      const authorize = createCatalogAccessPolicy(async () => grants, () => now);
      const capabilities: string[] = [];
      for (const capability of catalogCapabilitySchema.options) if ((await authorize({ id: user.id, active: true }, capability)).allowed) capabilities.push(capability);
      return { actorId: user.id, capabilities, grants: grants.filter(g => g.revokedAtEpochMs === null)
        .map(g => ({ grantId: g.grantId, role: g.role, grantingAuditEventId: g.grantingAuditEventId })) };
    } finally { connection.release(); }
  }
  async function authorize(actorIdInput: unknown, capabilityInput: unknown): Promise<{ allowed: boolean; grantId?: string }> {
    const actorId = input(catalogUserId, actorIdInput);
    const capability = input(catalogCapabilitySchema, capabilityInput);
    const connection = await getConnection();
    try {
      const user = await readCatalogUser(connection, actorId);
      if (!user) return fail('CATALOG_ACTOR_MISSING', 403);
      const state = await readCatalogGrantState(connection); const now = validClock(clock);
      const grants = verifiedCatalogGrants(state, user.id, now);
      return createCatalogAccessPolicy(async () => grants, () => now)({ id: user.id, active: true }, capability);
    } finally { connection.release(); }
  }
  async function createGrant(actorIdInput: unknown, bodyInput: unknown): Promise<MutationResult> {
    const actorId = input(catalogUserId, actorIdInput); const body = input(createInput, bodyInput);
    const payload = catalogHash({ action: 'grant_create', ...body });
    return transaction(async connection => {
      const { state, now, authorizingGrantId } = await actorState(connection, actorId);
      const prior = replay(state, actorId, body.requestId, payload, now); if (prior) return prior;
      const target = await readCatalogUser(connection, body.targetUserId, true);
      if (!target) return fail('CATALOG_TARGET_MISSING', 404);
      if (state.grants.some(g => g.userId === target.id && g.role === body.role && g.revokedAtEpochMs === null)) return fail('CATALOG_GRANT_EXISTS', 409);
      const grant: CatalogGrant = { schemaVersion: 1, grantId: randomUUID(), userId: target.id, role: body.role,
        grantingAuditEventId: randomUUID(), grantedAtEpochMs: now, revokedAtEpochMs: null, revocationAuditEventId: null };
      await insertCatalogAudit(connection, eventFor('grant_create', grant, actorId, authorizingGrantId, body, payload, now, null, { schemaVersion: 1, kind: 'grant_create' }));
      await insertCatalogGrant(connection, grant);
      return { grantId: grant.grantId, auditEventId: grant.grantingAuditEventId, replayed: false };
    });
  }
  async function revokeGrant(actorIdInput: unknown, grantIdInput: unknown, bodyInput: unknown): Promise<MutationResult> {
    const actorId = input(catalogUserId, actorIdInput); const grantId = input(id, grantIdInput); const body = input(commonInput, bodyInput);
    const payload = catalogHash({ action: 'grant_revoke', grantId, ...body });
    return transaction(async connection => {
      const { state, now, authorizingGrantId } = await actorState(connection, actorId);
      const prior = replay(state, actorId, body.requestId, payload, now); if (prior) return prior;
      const before = state.grants.find(g => g.grantId === grantId);
      if (!before || !verifiedCatalogGrants(state, before.userId, now).some(g => g.grantId === grantId)) return fail('CATALOG_GRANT_MISSING', 404);
      await readCatalogUser(connection, before.userId, true); // Deleted accounts retain history, never new authority.
      if (before.revokedAtEpochMs !== null) return fail('CATALOG_GRANT_REVOKED', 409);
      if (before.role === 'owner') {
        const owners = await liveOwnerUserIds(connection, state, now);
        if (owners.has(before.userId) && owners.size <= 1) return fail('CATALOG_LAST_OWNER', 409);
      }
      const grant = { ...before, revokedAtEpochMs: now, revocationAuditEventId: randomUUID() };
      await insertCatalogAudit(connection, eventFor('grant_revoke', grant, actorId, authorizingGrantId, body, payload, now, before, { schemaVersion: 1, kind: 'grant_revoke' }));
      const [result] = await connection.query('UPDATE catalog_role_grants SET revoked_at_epoch_ms = ?, revocation_audit_event_id = ? WHERE id = ? AND revoked_at_epoch_ms IS NULL', [now, grant.revocationAuditEventId, grantId]);
      if (!result || !('affectedRows' in result) || result.affectedRows !== 1) return fail('CATALOG_REQUEST_CONFLICT', 409);
      return { grantId, auditEventId: grant.revocationAuditEventId, replayed: false };
    });
  }
  async function bootstrapOwner(bodyInput: unknown): Promise<MutationResult> {
    const body = input(bootstrapInput, bodyInput);
    if (!options.environment || options.environment !== body.target.environment) return fail('CATALOG_ENVIRONMENT_MISMATCH', 409);
    const payload = catalogHash({ action: 'owner_bootstrap', ...body });
    return transaction(async connection => {
      if (catalogHash(await inspectDatabaseIdentity(connection, options.environment!)) !== catalogHash(body.target)) return fail('CATALOG_DATABASE_MISMATCH', 409);
      const target = await readCatalogUser(connection, body.expectedUserId, true);
      if (!target || target.email !== body.expectedEmail) return fail('CATALOG_BOOTSTRAP_ACCOUNT_MISMATCH', 409);
      const state = await readCatalogGrantState(connection, true); const now = validClock(clock);
      const prior = replay(state, target.id, body.requestId, payload, now); if (prior) return prior;
      if (state.rawGrantCount !== 0 || state.rawAuditCount !== 0) return fail('CATALOG_BOOTSTRAP_ALREADY_DONE', 409);
      const grant: CatalogGrant = { schemaVersion: 1, grantId: randomUUID(), userId: target.id, role: 'owner',
        grantingAuditEventId: randomUUID(), grantedAtEpochMs: now, revokedAtEpochMs: null, revocationAuditEventId: null };
      const context = { schemaVersion: 1, kind: 'owner_bootstrap', targetSha256: catalogHash(body.target),
        accountSha256: catalogHash({ id: target.id, email: target.email }), authorizationReferenceSha256: body.authorizationReferenceSha256 };
      await insertCatalogAudit(connection, eventFor('owner_bootstrap', grant, target.id, null, body, payload, now, null, context));
      await insertCatalogGrant(connection, grant);
      return { grantId: grant.grantId, auditEventId: grant.grantingAuditEventId, replayed: false };
    });
  }
  /** Caller must verify bcrypt first, then supply that exact server-read hash; this helper rechecks it under the common lock. */
  async function deleteAccount(userIdInput: unknown, expectedPasswordHashInput: unknown) {
    const userId = input(catalogUserId, userIdInput); const expectedPasswordHash = input(z.string().min(1).max(255), expectedPasswordHashInput);
    return transaction(async connection => {
      const user = await readCatalogUser(connection, userId, true);
      if (!user) return fail('CATALOG_TARGET_MISSING', 404);
      if (user.passwordHash !== expectedPasswordHash) return fail('CATALOG_PASSWORD_CHANGED', 409);
      const state = await readCatalogGrantState(connection, true); const owners = await liveOwnerUserIds(connection, state, validClock(clock));
      if (owners.has(userId) && owners.size <= 1) return fail('CATALOG_LAST_OWNER', 409);
      const [result] = await connection.query('DELETE FROM users WHERE BINARY id = BINARY ? AND BINARY password_hash = BINARY ?', [userId, expectedPasswordHash]);
      if (!result || !('affectedRows' in result) || result.affectedRows !== 1) return fail('CATALOG_PASSWORD_CHANGED', 409);
      return { deleted: true };
    });
  }
  return { getAccess, authorize, createGrant, revokeGrant, bootstrapOwner, deleteAccount };
}
// Match the migration lock: raw UTF-8 schema hash, not canonical JSON's quoted string hash.
const catalogHashSchema = (schema: string) => hashBytes(schema).slice(0, 32);
export type CatalogGrantService = ReturnType<typeof createCatalogGrantService>;

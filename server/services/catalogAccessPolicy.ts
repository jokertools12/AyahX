import { z } from 'zod';

const id = z.string().min(1).max(200).refine(value => value.trim() === value);
export const catalogRoleSchema = z.enum(['read_only', 'editor', 'approver', 'owner']);
export const catalogCapabilitySchema = z.enum(['inspect', 'draft_write', 'content_approve', 'content_reject',
  'content_revoke', 'grant_manage', 'source_activate', 'retention_manage']);
export type CatalogRole = z.infer<typeof catalogRoleSchema>;
export type CatalogCapability = z.infer<typeof catalogCapabilitySchema>;
export const catalogCapabilities: Readonly<Record<CatalogRole, readonly CatalogCapability[]>> = Object.freeze({
  read_only: Object.freeze(['inspect'] as const),
  editor: Object.freeze(['inspect', 'draft_write'] as const),
  approver: Object.freeze(['inspect', 'content_approve', 'content_reject', 'content_revoke'] as const),
  owner: Object.freeze(['inspect', 'draft_write', 'content_approve', 'content_reject', 'content_revoke',
    'grant_manage', 'source_activate', 'retention_manage'] as const),
});
export const catalogGrantSchema = z.object({
  schemaVersion: z.literal(1), grantId: id, userId: id, role: catalogRoleSchema,
  grantingAuditEventId: id, grantedAtEpochMs: z.number().int().nonnegative().safe(),
  revokedAtEpochMs: z.number().int().nonnegative().safe().nullable(), revocationAuditEventId: id.nullable(),
}).strict().refine(grant => (grant.revokedAtEpochMs === null) === (grant.revocationAuditEventId === null)
  && (grant.revokedAtEpochMs === null || grant.revokedAtEpochMs >= grant.grantedAtEpochMs), 'Incomplete or invalid revocation');
export type CatalogGrant = z.infer<typeof catalogGrantSchema>;
const actorSchema = z.object({ id, active: z.literal(true) }).strict();
/** Read grants from current server persistence, never JWT/body/legacy role objects. No cache or bootstrap. */
export type CatalogGrantsLoader = (authenticatedActorId: string) => Promise<unknown>;
export type CatalogAccessDecision =
  | { allowed: true; actorId: string; capability: CatalogCapability; role: CatalogRole; grantId: string; grantingAuditEventId: string }
  | { allowed: false; reason: 'invalid_actor' | 'invalid_capability' | 'capability_not_granted' | 'ambiguous_grants' };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Read-time capability evidence only. The caller supplies an authenticated, server-read active actor.
 * A later mutation must lock/revalidate actor, grant and audit evidence in its transaction.
 * This decision is neither atomic mutation authorization nor private-media/provider consent.
 */
export function createCatalogAccessPolicy(loadGrants: CatalogGrantsLoader = async () => [], clock: () => number = Date.now) {
  return async (authenticatedActor: unknown, requestedCapability: unknown): Promise<CatalogAccessDecision> => {
    const actor = actorSchema.safeParse(authenticatedActor);
    if (!actor.success) return { allowed: false, reason: 'invalid_actor' };
    const capability = catalogCapabilitySchema.safeParse(requestedCapability);
    if (!capability.success) return { allowed: false, reason: 'invalid_capability' };
    const input = await loadGrants(actor.data.id);
    const now = clock(); // Sample after the fresh server read; loader errors propagate.
    const denied = { allowed: false, reason: 'capability_not_granted' } as const;
    if (!Array.isArray(input) || !Number.isSafeInteger(now) || now < 0) return denied;
    const grants: CatalogGrant[] = [];
    const grantIds = new Set<string>();
    for (const row of input) {
      const parsed = catalogGrantSchema.safeParse(row);
      if (!parsed.success) continue; // An invalid row grants nothing; independent valid roles can still contribute.
      const grant = parsed.data;
      if (grantIds.has(grant.grantId)) return { allowed: false, reason: 'ambiguous_grants' };
      grantIds.add(grant.grantId);
      if (grant.userId === actor.data.id && grant.grantedAtEpochMs <= now && grant.revokedAtEpochMs === null
        && catalogCapabilities[grant.role].includes(capability.data)) grants.push(grant);
    }
    // Explicit UTF-16 code-unit ordering, independent of row order and host locale.
    grants.sort((a, b) => compare(a.grantId, b.grantId) || compare(a.grantingAuditEventId, b.grantingAuditEventId) || compare(a.role, b.role));
    const selected = grants[0];
    return selected ? { allowed: true, actorId: actor.data.id, capability: capability.data, role: selected.role,
      grantId: selected.grantId, grantingAuditEventId: selected.grantingAuditEventId } : denied;
  };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { approvalEnvelopeSchema, catalogSubjectSha256 } from './catalogApprovalPolicy';
import { catalogAuthorityEvidenceContext, catalogAuthorityEvidenceContextSha256 } from './catalogAuthorityVerifier';
import { canonicalJson } from '../utils/canonicalIntegrity';

export type CatalogApprovalConnection = Pick<{
  query: (sql: string, parameters?: readonly unknown[]) => Promise<[unknown[], unknown]>;
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}, 'query' | 'beginTransaction' | 'commit' | 'rollback' | 'release'>;
export type CatalogApprovalAuthorization = (actorId: string) => Promise<{ allowed: boolean; authorizingGrantId?: string }>;
export type CatalogApprovalInput = { requestId: string; reason: string; approval: unknown };
export type CatalogApprovalResult = { auditEventId: string; replayed: boolean };
export type CatalogContentApprovalService = ReturnType<typeof createCatalogContentApprovalService>;

export const catalogApprovalInputSchema = z.object({
  requestId: z.string().min(1).max(200).refine(value => value.trim() === value),
  reason: z.string().min(1).max(1000).refine(value => value.trim() === value),
  approval: approvalEnvelopeSchema,
}).strict();

export const catalogApprovalExistingRequestSql = `SELECT id, request_payload_sha256 AS requestPayloadSha256
 FROM catalog_audit_events WHERE actor_user_id = ? AND request_id = ? LIMIT 2 FOR UPDATE`;
export const catalogApprovalInsertSql = `INSERT INTO catalog_audit_events
 (id, action, actor_user_id, authorizing_grant_id, required_capability, created_at_epoch_ms,
  request_id, request_payload_sha256, reason, subject_kind, subject_id, subject_revision,
  subject_sha256, context_json, context_sha256, before_json, after_json, revokes_event_id)
 VALUES (?, 'content_approve', ?, ?, 'content_approve', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`;

export class CatalogApprovalError extends Error {
  constructor(public readonly code: 'CATALOG_APPROVAL_FORBIDDEN' | 'CATALOG_REQUEST_CONFLICT' | 'CATALOG_APPROVAL_BUSY', message = code) { super(message); }
}

function parsedInput(input: unknown) {
  const result = catalogApprovalInputSchema.safeParse(input);
  if (!result.success) throw new CatalogApprovalError('CATALOG_REQUEST_CONFLICT', 'CATALOG_APPROVAL_INPUT_INVALID');
  return result.data;
}

/** Append-only approval writer. It never publishes or mutates catalog content. */
export function createCatalogContentApprovalService(
  getConnection: () => Promise<CatalogApprovalConnection>,
  authorize: CatalogApprovalAuthorization,
  clock: () => number = Date.now,
) {
  return {
    async approve(actorId: string, input: CatalogApprovalInput): Promise<CatalogApprovalResult> {
      const body = parsedInput(input);
      const approval = approvalEnvelopeSchema.parse(body.approval);
      const now = clock();
      if (!Number.isSafeInteger(now) || approval.approvedAtEpochMs > now) throw new CatalogApprovalError('CATALOG_REQUEST_CONFLICT', 'CATALOG_APPROVAL_TIME_INVALID');
      const authorization = await authorize(actorId);
      if (!authorization.allowed || !authorization.authorizingGrantId) throw new CatalogApprovalError('CATALOG_APPROVAL_FORBIDDEN');
        const context = approval.subjectKind === 'timing'
          ? { schemaVersion: 1 as const, kind: 'timing_approve' as const, timingSha256: approval.subjectSha256 }
          : catalogAuthorityEvidenceContext(approval);
      const payloadSha256 = catalogSubjectSha256({ action: 'content_approve', ...body });
      const connection = await getConnection();
      let begun = false;
      try {
        await connection.beginTransaction(); begun = true;
        const [rows] = await connection.query(catalogApprovalExistingRequestSql, [actorId, body.requestId]);
        const existing = Array.isArray(rows) ? rows : [];
        if (existing.length > 1) throw new CatalogApprovalError('CATALOG_REQUEST_CONFLICT');
        if (existing.length === 1) {
          const row = existing[0] as Record<string, unknown>;
          if (row.requestPayloadSha256 !== payloadSha256) throw new CatalogApprovalError('CATALOG_REQUEST_CONFLICT');
          await connection.commit(); begun = false;
          return { auditEventId: String(row.id), replayed: true };
        }
        const auditEventId = randomUUID();
        await connection.query(catalogApprovalInsertSql, [auditEventId, actorId, authorization.authorizingGrantId, now,
          body.requestId, payloadSha256, body.reason, approval.subjectKind, approval.subjectId, approval.subjectRevision,
          approval.subjectSha256, canonicalJson(context), catalogAuthorityEvidenceContextSha256(approval), canonicalJson(approval)]);
        await connection.commit(); begun = false;
        return { auditEventId, replayed: false };
      } catch (error) {
        if (begun) await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
  };
}

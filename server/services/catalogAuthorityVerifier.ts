import { z } from 'zod';
import { approvalEnvelopeSchema, catalogSubjectSha256, type CatalogAuthorityRequest, type CatalogAuthorityVerifier } from './catalogApprovalPolicy';
import { canonicalJson } from '../utils/canonicalIntegrity';

export type CatalogAuthorityQuery = (sql: string, parameters: readonly string[]) => Promise<unknown[]>;

export const catalogAuthorityEvidenceReadSql = `SELECT
 id, action, required_capability AS requiredCapability, created_at_epoch_ms AS createdAtEpochMs,
 subject_kind AS subjectKind, subject_id AS subjectId, subject_revision AS subjectRevision,
 subject_sha256 AS subjectSha256, context_json AS contextJson, context_sha256 AS contextSha256
 FROM catalog_audit_events
 WHERE subject_kind = ? AND subject_id = ? AND subject_revision = ?
 ORDER BY created_at_epoch_ms DESC, id DESC LIMIT 20`;

const evidenceRowSchema = z.object({
  id: z.string().min(1).max(200), action: z.literal('content_approve'),
  requiredCapability: z.literal('content_approve'), createdAtEpochMs: z.number().int().nonnegative(),
  subjectKind: z.enum(['source', 'profile', 'coverage']), subjectId: z.string().min(1).max(200),
  subjectRevision: z.string().min(1).max(200), subjectSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contextJson: z.unknown(), contextSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const decodeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
};

const approvalContextSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('content_approve'),
  approvalSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/**
 * Reads immutable catalog approval evidence. The verifier is intentionally
 * fail-closed: malformed rows, mismatched hashes, expired approvals, or a
 * missing evidence event never become runtime authority.
 */
export function createCatalogAuthorityVerifier(query: CatalogAuthorityQuery, clock: () => number = Date.now): CatalogAuthorityVerifier {
  return async (request: CatalogAuthorityRequest): Promise<boolean> => {
    if (request.kind === 'timing_binding') return false;
    const approval = approvalEnvelopeSchema.safeParse(request.approval);
    if (!approval.success) return false;
    const now = clock();
    if (!Number.isSafeInteger(now) || approval.data.approvedAtEpochMs > now) return false;
    const rows = await query(catalogAuthorityEvidenceReadSql, [approval.data.subjectKind, approval.data.subjectId, approval.data.subjectRevision]);
    const expectedApprovalHash = catalogSubjectSha256(approval.data);
    return rows.some(raw => {
      const row = evidenceRowSchema.safeParse({ ...(raw as object), contextJson: decodeJson((raw as Record<string, unknown>)?.contextJson) });
      if (!row.success || row.data.createdAtEpochMs > now) return false;
      if (row.data.subjectSha256 !== approval.data.subjectSha256) return false;
      if (row.data.contextSha256 !== catalogSubjectSha256(row.data.contextJson)) return false;
      const context = approvalContextSchema.safeParse(row.data.contextJson);
      return context.success && context.data.approvalSha256 === expectedApprovalHash;
    });
  };
}

export function catalogAuthorityEvidenceContext(approval: unknown): { schemaVersion: 1; kind: 'content_approve'; approvalSha256: string } {
  const parsed = approvalEnvelopeSchema.parse(approval);
  return { schemaVersion: 1, kind: 'content_approve', approvalSha256: catalogSubjectSha256(parsed) };
}

export function catalogAuthorityEvidenceContextSha256(approval: unknown): string {
  return catalogSubjectSha256(catalogAuthorityEvidenceContext(approval));
}

export { canonicalJson };

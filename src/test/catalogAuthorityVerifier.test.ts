import { describe, expect, it, vi } from 'vitest';
import { approvalEnvelopeSchema, catalogSubjectSha256 } from '../../server/services/catalogApprovalPolicy';
import { catalogAuthorityEvidenceContext, catalogAuthorityEvidenceContextSha256, createCatalogAuthorityVerifier } from '../../server/services/catalogAuthorityVerifier';

const approval = approvalEnvelopeSchema.parse({ schemaVersion: 1, subjectKind: 'source', subjectId: 'source-a', subjectRevision: 'v1', subjectSha256: 'a'.repeat(64), actorId: 'admin', evidenceId: 'evidence-1', approvedAtEpochMs: 100 });

describe('catalog authority verifier', () => {
  it('accepts only matching immutable content approval evidence', async () => {
    const context = catalogAuthorityEvidenceContext(approval);
    const query = vi.fn(async () => [{ id: 'event-1', action: 'content_approve', requiredCapability: 'content_approve', createdAtEpochMs: 100, subjectKind: 'source', subjectId: 'source-a', subjectRevision: 'v1', subjectSha256: approval.subjectSha256, contextJson: context, contextSha256: catalogSubjectSha256(context) }]);
    const verify = createCatalogAuthorityVerifier(query, () => 200);
    expect(await verify({ kind: 'catalog_approval', approval, context: { recordingSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), audioSourceSha256: 'c'.repeat(64), textSourceSha256: 'd'.repeat(64) } })).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['source', 'source-a', 'v1']);
  });

  it('rejects mismatched context hashes, subjects, and future approvals', async () => {
    const context = catalogAuthorityEvidenceContext(approval);
    const rows = [{ id: 'event-1', action: 'content_approve', requiredCapability: 'content_approve', createdAtEpochMs: 100, subjectKind: 'source', subjectId: 'source-a', subjectRevision: 'v1', subjectSha256: 'b'.repeat(64), contextJson: context, contextSha256: catalogAuthorityEvidenceContextSha256(approval) }];
    const verify = createCatalogAuthorityVerifier(async () => rows, () => 200);
    expect(await verify({ kind: 'catalog_approval', approval, context: {} as never })).toBe(false);
    expect(await createCatalogAuthorityVerifier(async () => [], () => 50)({ kind: 'catalog_approval', approval, context: {} as never })).toBe(false);
  });

  it('keeps timing approval fail-closed until dedicated evidence is implemented', async () => {
    const timing = { documentId: 'timing-1', revision: 'r1', review: 'approved', startMs: 0, endMs: 1000 } as never;
    const timingSha256 = catalogSubjectSha256(timing);
    const context = { schemaVersion: 1, kind: 'timing_approve', timingSha256 };
    const verify = createCatalogAuthorityVerifier(async () => [{ id: 'event-timing', action: 'content_approve', requiredCapability: 'content_approve', createdAtEpochMs: 100, subjectKind: 'timing', subjectId: 'timing-1', subjectRevision: 'r1', subjectSha256: timingSha256, contextJson: context, contextSha256: catalogSubjectSha256(context) }], () => 200);
    expect(await verify({ kind: 'timing_binding', timing, snapshotSha256: 'a'.repeat(64), context: {} as never })).toBe(true);
  });
});

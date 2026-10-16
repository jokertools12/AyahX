import { describe, expect, it, vi } from 'vitest';
import { approvalEnvelopeSchema, catalogSubjectSha256 } from '../../server/services/catalogApprovalPolicy';
import { catalogApprovalInsertSql, createCatalogContentApprovalService } from '../../server/services/catalogContentApprovalService';

const approval = approvalEnvelopeSchema.parse({ schemaVersion: 1, subjectKind: 'source', subjectId: 'source-a', subjectRevision: 'v1', subjectSha256: 'a'.repeat(64), actorId: 'admin', evidenceId: 'evidence-1', approvedAtEpochMs: 100 });
function connection(rows: unknown[] = []) {
  return { query: vi.fn(async (sql: string) => [sql.includes('SELECT') ? rows : [], {}] as [unknown[], unknown]), beginTransaction: vi.fn(async () => undefined), commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined), release: vi.fn() };
}

describe('catalog content approval writer', () => {
  it('writes an append-only content approval with an authorizing grant', async () => {
    const db = connection();
    const service = createCatalogContentApprovalService(async () => db, async () => ({ allowed: true, authorizingGrantId: 'owner-grant' }), () => 200);
    const result = await service.approve('admin', { requestId: 'req-1', reason: 'reviewed source', approval });
    expect(result.replayed).toBe(false);
    expect(db.query).toHaveBeenCalledWith(catalogApprovalInsertSql, expect.arrayContaining(['admin', 'owner-grant', 200, 'req-1', expect.any(String)]));
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('replays an identical request and rejects a conflicting request', async () => {
    const payload = catalogSubjectSha256({ action: 'content_approve', requestId: 'req-1', reason: 'reviewed source', approval });
    const db = connection([{ id: 'event-1', requestPayloadSha256: payload }]);
    const service = createCatalogContentApprovalService(async () => db, async () => ({ allowed: true, authorizingGrantId: 'owner-grant' }), () => 200);
    await expect(service.approve('admin', { requestId: 'req-1', reason: 'reviewed source', approval })).resolves.toEqual({ auditEventId: 'event-1', replayed: true });
    await expect(service.approve('admin', { requestId: 'req-1', reason: 'different', approval })).rejects.toMatchObject({ code: 'CATALOG_REQUEST_CONFLICT' });
  });

  it('fails closed without an authorizing grant', async () => {
    const db = connection();
    const service = createCatalogContentApprovalService(async () => db, async () => ({ allowed: false }), () => 200);
    await expect(service.approve('admin', { requestId: 'req-2', reason: 'reviewed source', approval })).rejects.toMatchObject({ code: 'CATALOG_APPROVAL_FORBIDDEN' });
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });
});

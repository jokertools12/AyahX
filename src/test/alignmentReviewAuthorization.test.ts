import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import alignmentsRouter from '../../server/routes/alignments';
import { authenticateToken, signToken } from '../../server/middleware/auth';
import { getAlignmentDocument, saveReviewEvent } from '../../server/services/alignmentRepository';
import { applyAlignmentReview } from '../../server/services/alignmentService';
import { attestTimingMapForUser } from '../../server/services/alignmentAttestation';

vi.mock('../../server/db', () => ({ query: vi.fn(async (_sql: string, params: string[]) => [{ role: params[0] }]) }));
vi.mock('../../server/services/alignmentRepository', () => ({
  getAlignmentDocument: vi.fn(), saveReviewEvent: vi.fn(), deleteAlignmentDocument: vi.fn(),
  listAlignmentDocuments: vi.fn(), saveAlignmentDocument: vi.fn(),
}));
vi.mock('../../server/services/alignmentService', () => ({
  applyAlignmentReview: vi.fn(), getAlignmentProviderDescriptors: vi.fn(), parseAlignmentRequest: vi.fn(), runAlignment: vi.fn(),
}));
vi.mock('../../server/services/alignmentProvider', () => ({ alignmentDocumentToTimingMap: vi.fn(document => ({
  validationStatus: document.validationStatus, review: document.review,
})) }));
vi.mock('../../server/services/alignmentAttestation', () => ({ attestTimingMapForUser: vi.fn(map => map) }));
vi.mock('../../server/services/quranAlignService', () => ({ resolveKnownQuranAlign: vi.fn() }));
vi.mock('../../server/services/quranUniversalAudioService', () => ({ resolveUniversalQuranAudio: vi.fn() }));

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(authenticateToken);
  app.use('/api/alignments', alignmentsRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => vi.clearAllMocks());
const post = (role: string | null, status: unknown) => fetch(`${base}/api/alignments/original/reviews`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? {
    Authorization: `Bearer ${signToken({ id: role, email: 'fixture@example.test' })}`,
  } : {}) }, body: JSON.stringify({ status, revisions: [], reviewerId: 'forged-admin' }),
});

describe('alignment review decision authority', () => {
  it('requires authentication', async () => { expect((await post(null, 'approved')).status).toBe(401); });
  it.each(['user', 'moderator'])('denies approval and rejection by %s before reading private documents', async role => {
    for (const status of ['approved', 'rejected']) {
      const response = await post(role, status);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'ALIGNMENT_APPROVAL_ADMIN_REQUIRED' });
    }
    expect(getAlignmentDocument).not.toHaveBeenCalled();
    expect(applyAlignmentReview).not.toHaveBeenCalled();
    expect(saveReviewEvent).not.toHaveBeenCalled();
    expect(attestTimingMapForUser).not.toHaveBeenCalled();
  });
  it('rejects invalid decisions before repository access', async () => {
    expect((await post('admin', 'published')).status).toBe(400);
    expect(getAlignmentDocument).not.toHaveBeenCalled();
  });
  it('keeps draft editing owner-scoped', async () => {
    vi.mocked(getAlignmentDocument).mockResolvedValueOnce(null);
    expect((await post('user', 'needs_review')).status).toBe(404);
    expect(getAlignmentDocument).toHaveBeenCalledWith('original', { userId: 'user', isAdmin: false });
    expect(saveReviewEvent).not.toHaveBeenCalled();
  });
  it('allows an owner to persist a review-pending revision without escalating the decision', async () => {
    const original = { documentId: 'original' } as Awaited<ReturnType<typeof getAlignmentDocument>>;
    vi.mocked(getAlignmentDocument).mockResolvedValueOnce(original);
    vi.mocked(applyAlignmentReview).mockReturnValueOnce({
      document: { documentId: 'draft', validationStatus: 'needs_review', review: { status: 'needs_review' } },
      validation: { valid: true, status: 'needs_review' },
    } as unknown as ReturnType<typeof applyAlignmentReview>);
    expect((await post('user', 'needs_review')).status).toBe(201);
    expect(applyAlignmentReview).toHaveBeenCalledWith(original, [], expect.objectContaining({ status: 'needs_review', reviewerId: 'user' }));
    expect(attestTimingMapForUser).toHaveBeenCalledWith(expect.objectContaining({ validationStatus: 'needs_review' }), 'user');
  });
  it.each(['approved', 'rejected', 'needs_review'] as const)('uses authenticated reviewer identity for admin %s', async status => {
    const original = { documentId: 'original' } as Awaited<ReturnType<typeof getAlignmentDocument>>;
    vi.mocked(getAlignmentDocument).mockResolvedValueOnce(original);
    vi.mocked(applyAlignmentReview).mockReturnValueOnce({
      document: { documentId: 'revision', validationStatus: status, review: { status } },
      validation: { valid: true, status },
    } as unknown as ReturnType<typeof applyAlignmentReview>);
    expect((await post('admin', status)).status).toBe(201);
    expect(applyAlignmentReview).toHaveBeenCalledWith(original, [], expect.objectContaining({ status, reviewerId: 'admin' }));
    expect(saveReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin', parentDocumentId: 'original' }));
  });
});

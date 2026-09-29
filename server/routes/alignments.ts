import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { aiRateLimiter } from '../middleware/rateLimiter';
import {
  applyAlignmentReview,
  getAlignmentProviderDescriptors,
  parseAlignmentRequest,
  runAlignment,
} from '../services/alignmentService';
import {
  deleteAlignmentDocument,
  getAlignmentDocument,
  listAlignmentDocuments,
  saveAlignmentDocument,
  saveReviewEvent,
} from '../services/alignmentRepository';
import { alignmentDocumentToTimingMap } from '../services/alignmentProvider';
import { issueApprovedTimingMapAttestation } from '../services/alignmentAttestation';
import { resolveKnownQuranAlign } from '../services/quranAlignService';

const router = Router();

function ownerContext(req: AuthenticatedRequest) {
  return { userId: req.user!.id, isAdmin: req.user!.role === 'admin' };
}

function errorStatus(error: unknown): number {
  const message = String((error as any)?.message || error || '');
  if (message.includes('EXPIRED')) return 410;
  if (message.includes('NOT_CONFIGURED') || message.includes('TIMEOUT') || message.includes('HTTP_')
    || message.includes('RESPONSE_TOO_LARGE') || message.includes('ENGINE_')
    || message.includes('QF_STRICT_CREDENTIALS') || message.includes('AUDIO_FINGERPRINT_FETCH')) return 503;
  if (message.includes('REJECTED') || message.includes('INVALID') || message.includes('REQUIRED')
    || message.includes('UNSAFE') || message.includes('GRANULARITY_NOT_SUPPORTED')
    || message.includes('QF_STRICT_SEGMENT') || message.includes('QF_STRICT_TIMESTAMP')) return 400;
  return 500;
}

function publicDocument(document: any, userId: string) {
  const timingMap = alignmentDocumentToTimingMap(document);
  const attestation = issueApprovedTimingMapAttestation(timingMap, userId);
  if (attestation && timingMap.alignment) {
    timingMap.alignment = { ...timingMap.alignment, providerResultId: attestation };
  }
  return {
    document,
    timingMap,
    validation: {
      status: document.validationStatus,
      diagnostics: document.diagnostics?.validation || null,
      errors: document.diagnostics?.validationErrors || [],
      warnings: document.diagnostics?.validationWarnings || [],
    },
  };
}

/** Provider discovery is explicit so the UI cannot accidentally fall back. */
router.get('/providers', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.json({
    providers: getAlignmentProviderDescriptors(),
  });
});

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    const documents = await listAlignmentDocuments(ownerContext(req), Number.isFinite(limit) ? limit : 20);
    return res.json({
      documents: documents.map((document) => ({
        id: document.documentId,
        parentDocumentId: document.parentDocumentId || null,
        providerId: document.providerId,
        validationStatus: document.validationStatus,
        reviewStatus: document.review?.status || 'unreviewed',
        audioContentHash: document.audio.contentHash,
        surahNumber: document.reference.surahNumber,
        ayahRange: document.reference.ayahRange,
        createdAt: document.provenance.createdAt,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'تعذر تحميل سجل المحاذاة', code: error?.message });
  }
});

/**
 * Resolves a selected provider into an ephemeral, fully validated map. This
 * powers the live preview without turning every playback into a saved user
 * document. Persisting provenance remains an explicit action on POST `/`.
 */
router.post('/resolve', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    parseAlignmentRequest(req.body);
    const result = await runAlignment({ ...req.body, jobId: req.body?.jobId || crypto.randomUUID() });
    return res.json({
      accepted: result.validation.valid,
      ...publicDocument(result.document, req.user!.id),
    });
  } catch (error: any) {
    const status = errorStatus(error);
    return res.status(status).json({
      error: status === 503 ? 'مزود المحاذاة المحدد غير متاح حالياً' : status === 400 ? 'بيانات المحاذاة غير صالحة' : 'تعذر تشغيل المحاذاة',
      code: error?.message,
    });
  }
});

/**
 * Resolves a pinned CC-BY quran-align release for an exact EveryAyah source.
 * This is intentionally separate from model adapters: it has no audio upload,
 * no proportional fallback, and rejects ranges containing ambiguous
 * multi-word source segments.
 */
router.post('/resolve-known', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body || {};
    const input = {
      reciterId: String(body.reciterId || ''),
      everyAyahSubfolder: String(body.providerInput?.everyAyahSubfolder || ''),
      audio: body.audio,
      reference: body.reference,
      audioTimestamps: body.providerInput?.audioTimestamps,
    };
    if (!input.reciterId || !input.everyAyahSubfolder || !input.audio || !input.reference || !Array.isArray(input.audioTimestamps)) {
      return res.status(400).json({ error: 'بيانات المحاذاة المعروفة غير مكتملة', code: 'KNOWN_ALIGNMENT_INPUT_REQUIRED' });
    }
    const timingMap = resolveKnownQuranAlign(input as any);
    return res.json({ accepted: true, timingMap, validation: { status: 'approved', errors: [], warnings: [] } });
  } catch (error: any) {
    const code = String(error?.message || error || 'KNOWN_ALIGNMENT_FAILED');
    const status = code.includes('NOT_AVAILABLE') || code.includes('MISSING') || code.includes('MULTIWORD')
      ? 422
      : code.includes('REQUIRED') || code.includes('INPUT') || code.includes('CONTIGUOUS')
      ? 400
      : 503;
    return res.status(status).json({
      error: status === 422 ? 'لا تتوفر حدود كلمات مستقلة لهذا المقطع' : 'تعذر تحميل محاذاة التلاوة المثبتة',
      code,
    });
  }
});

/**
 * Runs one explicitly selected provider.  The provider input is deliberately
 * opaque at the HTTP boundary, but every returned interval is normalized and
 * validated before it is persisted or sent to a renderer.
 */
router.post('/', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Fail early with a clear request error before invoking a model/provider.
    parseAlignmentRequest(req.body);
    const result = await runAlignment({ ...req.body, jobId: req.body?.jobId || crypto.randomUUID() });
    await saveAlignmentDocument(req.user!.id, result.document);
    return res.status(201).json({
      accepted: result.validation.valid,
      ...publicDocument(result.document, req.user!.id),
    });
  } catch (error: any) {
    const status = errorStatus(error);
    return res.status(status).json({
      error: status === 503 ? 'مزود المحاذاة المحدد غير متاح حالياً' : status === 400 ? 'بيانات المحاذاة غير صالحة' : 'تعذر تشغيل المحاذاة',
      code: error?.message,
    });
  }
});

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alignmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const document = await getAlignmentDocument(alignmentId, ownerContext(req));
    if (!document) return res.status(404).json({ error: 'وثيقة المحاذاة غير موجودة' });
    return res.json(publicDocument(document, req.user!.id));
  } catch (error: any) {
    return res.status(500).json({ error: 'تعذر تحميل وثيقة المحاذاة', code: error?.message });
  }
});

router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alignmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = await deleteAlignmentDocument(alignmentId, req.user!.id);
    if (!deleted) return res.status(404).json({ error: 'وثيقة المحاذاة غير موجودة' });
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: 'تعذر حذف وثيقة المحاذاة' });
  }
});

router.post('/:id/reviews', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const alignmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const base = await getAlignmentDocument(alignmentId, ownerContext(req));
    if (!base) return res.status(404).json({ error: 'وثيقة المحاذاة غير موجودة' });
    const status = req.body?.status;
    if (!['approved', 'needs_review', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'قرار المراجعة غير صالح' });
    }
    const revisions = Array.isArray(req.body?.revisions) ? req.body.revisions : [];
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : undefined;
    const result = applyAlignmentReview(base, revisions, {
      status,
      reviewerId: req.user!.id,
      note,
    });
    await saveReviewEvent({
      userId: req.user!.id,
      document: result.document,
      parentDocumentId: base.documentId,
      revisions,
    });
    return res.status(201).json({
      accepted: result.validation.valid && result.validation.status !== 'rejected',
      ...publicDocument(result.document, req.user!.id),
    });
  } catch (error: any) {
    const status = errorStatus(error);
    return res.status(status).json({
      error: status === 400 ? 'بيانات المراجعة غير صالحة' : 'تعذر حفظ مراجعة المحاذاة',
      code: error?.message,
    });
  }
});

export default router;

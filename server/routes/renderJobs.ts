import { Router, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { renderJobQueue } from '../services/renderJobQueue';
import { query, transaction } from '../db';
import { logger } from '../logger';
import { validateRenderManifest } from '../models/renderManifest';
import { validateManifestAssets } from '../services/assetCatalogResolver';
import { getPlanEntitlements, validateRenderEntitlements } from '../../shared/planEntitlements';
import { getActivePlanForUser, getTodayCloudRenderUsage, syncExpiredSubscriptions } from '../services/subscriptionService';
import { isObjectStoragePath, streamStoredRender } from '../services/objectStorage';
import { recordRenderAudit } from '../services/renderObservability';

const router = Router();

// 1. Submit a New Render Job with Strict Quota & Active-Job Guards
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { manifest, idempotencyKey, renderEngine, backgroundAsync } = req.body;

    if (!manifest) {
      return res.status(400).json({ error: 'بيانات أمر الريندر (RenderManifest) مطلوبة' });
    }

    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 128)) {
      return res.status(400).json({ error: 'مفتاح منع التكرار غير صالح' });
    }

    // Validate before claiming a daily cloud-render slot. This also prevents a
    // hand-crafted request from selecting premium-only quality/features.
    const manifestValidation = validateRenderManifest(manifest);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      return res.status(400).json({ error: `خطأ في بيانات أمر الريندر: ${manifestValidation.errors?.join(', ')}` });
    }
    if (renderEngine && ['browser', 'ffmpeg_ass', 'skia_canvas', 'browser_cloud'].includes(renderEngine)) {
      (manifestValidation.manifest as any).renderEngine = renderEngine;
    } else if (renderEngine !== undefined) {
      return res.status(400).json({ error: 'محرك الريندر المحدد غير صالح' });
    }
    if (typeof backgroundAsync === 'boolean') {
      (manifestValidation.manifest as any).backgroundAsync = backgroundAsync;
    }
    const assetValidation = validateManifestAssets(manifestValidation.manifest);
    if (!assetValidation.safe) {
      return res.status(400).json({ error: `فشل التحقق الأمني من وسائط الريندر: ${assetValidation.reason}` });
    }

    await syncExpiredSubscriptions(userId);
    const plan = await getActivePlanForUser(userId);
    const entitlements = getPlanEntitlements(plan);
    const entitlementValidation = validateRenderEntitlements(plan, manifestValidation.manifest);
    if (!entitlementValidation.valid) {
      return res.status(403).json({
        error: entitlementValidation.violations[0],
        entitlementViolation: true,
        violations: entitlementValidation.violations,
      });
    }

    const selectedEngine = manifestValidation.manifest.renderEngine;
    const engineLimit = selectedEngine === 'skia_canvas'
      ? entitlements.skiaCanvasDailyLimit
      : selectedEngine === 'browser_cloud'
      ? entitlements.backgroundAsyncDailyLimit
      : entitlements.ffmpegAssDailyLimit;

    const usageForEngine = (usage: { ffmpegAss: number; skiaCanvas: number; browserCloud: number }) => (
      selectedEngine === 'skia_canvas'
        ? usage.skiaCanvas
        : selectedEngine === 'browser_cloud'
        ? usage.browserCloud
        : usage.ffmpegAss
    );

    // A retry of the same request must be a true no-op. In particular, it
    // must not cancel a currently running job when the caller sent
    // replaceActive along with an idempotency key.
    if (idempotencyKey) {
      const existingRows = await query<Array<{ id: string }>>(
        'SELECT id FROM render_jobs WHERE idempotency_key = ? AND user_id = ? LIMIT 1',
        [idempotencyKey, userId],
      );
      if (existingRows.length > 0) {
        const job = await renderJobQueue.getJobById(existingRows[0].id, userId);
        if (job) {
          const usage = await getTodayCloudRenderUsage(userId);
          const serverRenderCount = usageForEngine(usage);
          return res.status(200).json({
            message: 'مهمة الريندر موجودة بالفعل',
            job,
            serverRenderLimit: engineLimit,
            serverRenderCount,
            serverRenderRemaining: Math.max(0, engineLimit - serverRenderCount),
          });
        }
      }
    }

    // 1. Guard against queue flooding or handle replaceActive
    const activeJobs = await query<any[]>(
      "SELECT id, status, created_at, started_at, updated_at FROM render_jobs WHERE user_id = ? AND status IN ('queued', 'running')",
      [userId]
    );

    if (activeJobs.length > 0) {
      if (req.body.replaceActive) {
        logger.info(`User ${userId} requested replaceActive. Cancelling ${activeJobs.length} active job(s)...`);
        for (const aj of activeJobs) {
          await renderJobQueue.cancelJob(aj.id, userId);
        }
      } else {
        // Only reclaim a job when its lease/heartbeat has truly stopped. A
        // long 4K export can legitimately run for more than fifteen minutes;
        // using started_at here used to cancel healthy exports mid-render.
        const isStale = activeJobs.some((aj) => {
          const leaseTime = aj.updated_at || aj.started_at || aj.created_at;
          return Date.now() - new Date(leaseTime).getTime() > 12 * 60 * 1000;
        });

        if (isStale) {
          logger.warn(`User ${userId} has stale active job(s). Auto-cancelling to unblock user...`);
          for (const aj of activeJobs) {
            await renderJobQueue.cancelJob(aj.id, userId);
          }
        } else {
          return res.status(429).json({
            error: 'لديك مهمة ريندر سحابية قيد المعالجة بالفعل. يرجى الانتظار حتى تكتمل أو إلغاؤها لبدء مهمة جديدة.',
            activeJobId: activeJobs[0].id,
            activeJobStatus: activeJobs[0].status,
          });
        }
      }
    }

    // 2. Atomic daily cloud quota. The per-user/day counter serializes requests
    // from multiple tabs and claims a slot exactly once for every accepted job.
    const queued = await transaction(async (conn) => {
      await conn.query(
        `INSERT INTO daily_cloud_render_usage (id, user_id, date, count)
         VALUES (UUID(), ?, CURDATE(), 0)
         ON DUPLICATE KEY UPDATE id = id`,
        [userId],
      );
      await conn.query(
        'SELECT id, count FROM daily_cloud_render_usage WHERE user_id = ? AND date = CURDATE() FOR UPDATE',
        [userId],
      );

      if (idempotencyKey) {
        const [existingRows] = await conn.query<any[]>(
          'SELECT id, user_id FROM render_jobs WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
          [idempotencyKey],
        );
        if (existingRows.length > 0) {
          if (existingRows[0].user_id !== userId) {
            throw new Error('IDEMPOTENCY_KEY_COLLISION');
          }
          return { jobId: existingRows[0].id, existing: true };
        }
      }

      const [activeRows] = await conn.query<any[]>(
        "SELECT id FROM render_jobs WHERE user_id = ? AND status IN ('queued', 'running') FOR UPDATE",
        [userId],
      );
      if (activeRows.length > 0) {
        const activeError: any = new Error('ACTIVE_RENDER_EXISTS');
        activeError.activeJobId = activeRows[0].id;
        throw activeError;
      }

      const [usageRows] = await conn.query<any[]>(
        'SELECT count FROM daily_cloud_render_usage WHERE user_id = ? AND date = CURDATE() FOR UPDATE',
        [userId],
      );
      const [engineUsageRows] = await conn.query<any[]>(
        `SELECT
           SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'ffmpeg_ass' THEN 1 ELSE 0 END) AS ffmpeg_ass,
           SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'skia_canvas' THEN 1 ELSE 0 END) AS skia_canvas,
           SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'browser_cloud' THEN 1 ELSE 0 END) AS browser_cloud,
           SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.backgroundAsync')), 'false') = 'true' THEN 1 ELSE 0 END) AS background_async
         FROM render_jobs
         WHERE user_id = ? AND created_at >= CURDATE()` ,
        [userId],
      );
      const serverRenderCount = Number(usageRows[0]?.count || 0);
      const engineUsage = engineUsageRows[0] || {};
      const selectedEngineCount = selectedEngine === 'skia_canvas'
        ? Number(engineUsage.skia_canvas || 0)
        : selectedEngine === 'browser_cloud'
        ? Number(engineUsage.browser_cloud || 0)
        : Number(engineUsage.ffmpeg_ass || 0);
      if (selectedEngineCount >= engineLimit) {
        const quotaError: any = new Error('ENGINE_QUOTA_EXCEEDED');
        quotaError.engine = selectedEngine;
        quotaError.serverRenderCount = selectedEngineCount;
        quotaError.serverRenderLimit = engineLimit;
        throw quotaError;
      }

      if (manifestValidation.manifest.backgroundAsync === true && selectedEngine !== 'browser_cloud') {
        const backgroundCount = Number(engineUsage.background_async || 0);
        if (backgroundCount >= entitlements.backgroundAsyncDailyLimit) {
          const quotaError: any = new Error('BACKGROUND_QUOTA_EXCEEDED');
          quotaError.serverRenderCount = backgroundCount;
          quotaError.serverRenderLimit = entitlements.backgroundAsyncDailyLimit;
          throw quotaError;
        }
      }

      await conn.query(
        'UPDATE daily_cloud_render_usage SET count = count + 1 WHERE user_id = ? AND date = CURDATE()',
        [userId],
      );

      const jobId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO render_jobs (
          id, user_id, idempotency_key, status, progress, stage, manifest, max_retries
        ) VALUES (?, ?, ?, 'queued', 0.00, 'جاري تخصيص موارد الإنتاج', ?, 1)`,
        [jobId, userId, idempotencyKey || null, JSON.stringify(manifestValidation.manifest)],
      );

      return { jobId, existing: false, serverRenderCount: serverRenderCount + 1 };
    });

    const job = await renderJobQueue.getJobById(queued.jobId, userId);
    if (!job) {
      throw new Error('تعذر إنشاء مهمة الريندر');
    }
    if (!queued.existing) {
      // BullMQ uses a lower numeric value as a higher priority. Premium
      // subscribers get the fast lane, while free jobs remain fairly served
      // by the worker pool instead of being blocked behind one user's render.
      renderJobQueue.triggerProcessor(queued.jobId, entitlements.features.priorityCloudQueue ? 1 : 10);
      void recordRenderAudit(queued.jobId, userId, 'accepted', { plan });
    }
    const usage = await getTodayCloudRenderUsage(userId);
    const serverRenderCount = usageForEngine(usage);

    return res.status(201).json({
      message: queued.existing ? 'مهمة الريندر موجودة بالفعل' : 'تم قبول مهمة الريندر وبدء تجهيزها',
      job,
      serverRenderLimit: engineLimit,
      serverRenderCount,
      serverRenderRemaining: Math.max(0, engineLimit - serverRenderCount),
      cloudRenderCount: usage.total,
      backgroundRenderCount: usage.backgroundAsync,
    });
  } catch (err: any) {
    if (err.message === 'IDEMPOTENCY_KEY_COLLISION') {
      return res.status(409).json({ error: 'مفتاح منع التكرار مستخدم بالفعل. أعد المحاولة.' });
    }
    if (err.message === 'ACTIVE_RENDER_EXISTS') {
      return res.status(429).json({
        error: 'لديك مهمة ريندر سحابية قيد المعالجة بالفعل. يرجى الانتظار حتى تكتمل أو إلغاؤها لبدء مهمة جديدة.',
        activeJobId: err.activeJobId,
      });
    }
    if (err.message === 'ENGINE_QUOTA_EXCEEDED' || err.message === 'BACKGROUND_QUOTA_EXCEEDED') {
      return res.status(403).json({
        error: err.message === 'BACKGROUND_QUOTA_EXCEEDED'
          ? `لقد استنفدت حصتك اليومية من الريندر في الخلفية (${err.serverRenderLimit} فيديو يومياً).`
          : `لقد استنفدت حصتك اليومية لمحرك ${err.engine === 'skia_canvas' ? 'Skia Canvas' : err.engine === 'browser_cloud' ? 'المتصفح السحابي' : 'FFmpeg ASS'} (${err.serverRenderLimit} فيديو يومياً).`,
        quotaExceeded: true,
        engine: err.engine,
        serverRenderLimit: err.serverRenderLimit,
        serverRenderCount: err.serverRenderCount,
      });
    }
    logger.error('Enqueue render job error:', err);
    return res.status(400).json({ error: err.message || 'فشل تجهيز مهمة الريندر' });
  }
});

// 2. Get currently active or recently completed render job for the authenticated user
router.get('/active', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    // Check for any queued or running job
    const activeRows = await query<any[]>(
      `SELECT * FROM render_jobs 
       WHERE user_id = ? AND status IN ('queued', 'running') 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (activeRows.length > 0) {
      const job = activeRows[0];
      if (typeof job.manifest === 'string') {
        try {
          job.manifest = JSON.parse(job.manifest);
        } catch {
          // Keep the raw manifest for diagnostic visibility if historic data
          // is malformed instead of failing the active-job status endpoint.
        }
      }
      job.progress = Number(job.progress) || 0;
      return res.json({ hasActiveJob: true, job });
    }

    // Check for recently completed job within last hour
    const recentCompleted = await query<any[]>(
      `SELECT * FROM render_jobs 
       WHERE user_id = ? AND status = 'succeeded' AND output_path IS NOT NULL AND completed_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       ORDER BY completed_at DESC LIMIT 1`,
      [userId]
    );

    if (recentCompleted.length > 0) {
      const job = recentCompleted[0];
      if (typeof job.manifest === 'string') {
        try {
          job.manifest = JSON.parse(job.manifest);
        } catch {
          // Keep the raw manifest for diagnostic visibility if historic data
          // is malformed instead of failing the recent-job status endpoint.
        }
      }
      job.progress = 100;
      return res.json({ hasActiveJob: false, recentJob: job });
    }

    return res.json({ hasActiveJob: false, job: null });
  } catch (err: any) {
    logger.error('Get active render job error:', err);
    return res.status(500).json({ error: 'فشل استرجاع حالة مهمة الريندر الحالية' });
  }
});

// 3. Cancel all currently active or queued jobs for the user
router.post('/cancel-active', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const activeJobs = await query<any[]>(
      "SELECT id FROM render_jobs WHERE user_id = ? AND status IN ('queued', 'running')",
      [userId]
    );

    for (const aj of activeJobs) {
      await renderJobQueue.cancelJob(aj.id, userId);
    }

    return res.json({ success: true, cancelledCount: activeJobs.length });
  } catch (err: any) {
    logger.error('Cancel active jobs error:', err);
    return res.status(500).json({ error: 'فشل إلغاء مهام الريندر الجارية' });
  }
});

// 4. Retry a failed/cancelled job using its validated manifest. This does not
// consume another daily render slot and is safe to repeat from multiple tabs.
router.post('/:id/retry', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const job = await renderJobQueue.retryJob(req.params.id as string, userId, isAdmin);
    if (!job) {
      return res.status(409).json({ error: 'لا يمكن إعادة المحاولة لهذه المهمة؛ يجب أن تكون فاشلة أو ملغاة.' });
    }
    return res.status(202).json({ message: 'تمت إعادة تشغيل مهمة الريندر تلقائياً', job });
  } catch (err: any) {
    logger.error('Retry render job error:', err);
    return res.status(500).json({ error: 'فشل إعادة محاولة مهمة الريندر' });
  }
});

// 4. Poll Render Job Status & Progress
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const jobId = req.params.id as string;

    const job = await renderJobQueue.getJobById(jobId, userId, isAdmin);
    if (!job) {
      return res.status(404).json({ error: 'مهمة الريندر غير موجودة أو غير مصرح بالوصول إليها' });
    }

    // Do not calculate a queue rank on every client poll. It adds a database
    // scan under load and creates a misleading user-facing promise: jobs are
    // dispatched by available worker capacity, not by a static position.
    return res.json({ job });
  } catch (err: any) {
    logger.error('Get render job error:', err);
    return res.status(500).json({ error: 'فشل استرجاع حالة مهمة الريندر' });
  }
});

// 3. Cancel Active or Queued Render Job
router.post('/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const jobId = req.params.id as string;

    const cancelled = await renderJobQueue.cancelJob(jobId, userId, isAdmin);
    if (!cancelled) {
      return res.status(400).json({ error: 'لا يمكن إلغاء هذه المهمة (قد تكون منتهية بالفعل أو غير موجودة)' });
    }

    return res.json({ message: 'تم إلغاء مهمة الريندر بنجاح' });
  } catch (err: any) {
    logger.error('Cancel render job error:', err);
    return res.status(500).json({ error: 'فشل إلغاء مهمة الريندر' });
  }
});

// 4. Secure Download of Completed Video Artifact
router.get('/:id/download', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const jobId = req.params.id as string;

    const job = await renderJobQueue.getJobById(jobId, userId, isAdmin);
    if (!job) {
      return res.status(404).json({ error: 'مهمة الريندر غير موجودة' });
    }

    if (job.status !== 'succeeded' || !job.output_path || (!isObjectStoragePath(job.output_path) && !fs.existsSync(job.output_path))) {
      return res.status(410).json({
        error: 'انتهت صلاحية تحميل ملف الفيديو (فترة الحفظ 48 ساعة لحماية مساحة السيرفر). يمكنك إعادة إنتاج الفيديو بسهولة بنقرة واحدة في أي وقت.',
      });
    }

    const filename = job.output_filename || 'quran-reel.mp4';
    if (isObjectStoragePath(job.output_path)) {
      try {
        const stored = await streamStoredRender(job.output_path);
        res.setHeader('Content-Type', stored.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (stored.size !== null) res.setHeader('Content-Length', stored.size);
        void recordRenderAudit(job.id, userId, 'download');

        stored.body.on('error', (error) => {
          logger.error('Object storage render stream error:', error);
          if (!res.headersSent) {
            res.status(502).json({ error: 'تعذر بث ملف الفيديو، يرجى إعادة المحاولة.' });
          } else {
            res.destroy(error as Error);
          }
        });
        stored.body.pipe(res);
        return;
      } catch (error) {
        logger.error('Object storage download error:', error);
        return res.status(410).json({ error: 'ملف الفيديو غير متاح حاليًا، يرجى إعادة الريندر.' });
      }
    }
    const stat = await fs.promises.stat(job.output_path);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(job.output_path);
    void recordRenderAudit(job.id, userId, 'download');
    stream.pipe(res);
  } catch (err: any) {
    logger.error('Download render job error:', err);
    return res.status(500).json({ error: 'فشل تحميل ملف الفيديو' });
  }
});

export default router;

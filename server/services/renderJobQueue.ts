import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { query } from '../db';
import { RenderManifest, validateRenderManifest } from '../models/renderManifest';
import { validateManifestAssets } from './assetCatalogResolver';
import { renderDeterministicVideo } from './deterministicVideoRenderer';
import { logger } from '../logger';
import { config } from '../config';
import { enqueueRenderJob, startRenderWorker } from './renderQueueBroker';
import { deleteStoredRender, isObjectStoragePath, uploadRender } from './objectStorage';
import { recordRenderAudit, renderDurationSeconds } from './renderObservability';
import { resolveConcurrencySetting } from './renderCapacity';

export interface RenderJobRow {
  id: string;
  user_id: string;
  idempotency_key: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  manifest: RenderManifest | string;
  output_path: string | null;
  output_filename: string | null;
  output_size_bytes: number | null;
  duration_seconds: number | null;
  metadata: any;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface CreateJobParams {
  userId: string;
  manifest: unknown;
  idempotencyKey?: string;
}

export class RenderJobQueue {
  private isProcessing = false;
  private maxConcurrency: number;
  private activeJobsCount = 0;
  private activeJobAbortControllers: Map<string, AbortController> = new Map();
  private storageDir: string;

  constructor() {
    this.maxConcurrency = resolveConcurrencySetting(process.env.MAX_CONCURRENT_RENDERS, config.queue.workerConcurrency);
    this.storageDir = path.resolve(process.cwd(), process.env.RENDER_STORAGE_DIR || 'uploads/renders');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // Start automated disk garbage collector (runs every 30 minutes, unref'd for test safety)
    const cleanupInterval = setInterval(() => {
      this.cleanupExpiredRenders().catch(() => {});
    }, 30 * 60 * 1000);
    cleanupInterval.unref?.();

    // A worker can disappear without taking the Node process down (OOM kill,
    // Chromium crash, host interruption). Reclaim only jobs whose heartbeat
    // has stopped, so long-running healthy renders are never interrupted.
    const recoveryInterval = setInterval(() => {
      this.recoverStaleJobs(true).catch(() => {});
    }, 60 * 1000);
    recoveryInterval.unref?.();
  }

  /**
   * Graceful shutdown hook: Aborts all active render workers, freeing Puppeteer and FFmpeg processes.
   */
  public shutdown(): void {
    logger.info(`Shutting down RenderJobQueue. Aborting ${this.activeJobAbortControllers.size} active worker(s)...`);
    for (const [jobId, controller] of this.activeJobAbortControllers.entries()) {
      try {
        controller.abort();
        logger.info(`Aborted render job [${jobId}] due to server shutdown.`);
      } catch {
        // The controller may have already completed; shutdown continues.
      }
    }
    this.activeJobAbortControllers.clear();
  }

  /**
   * Recovers orphaned jobs left in 'running' state after server restart
   * and runs an immediate garbage collection pass.
   */
  public async recoverStaleJobs(onlyStale: boolean = false): Promise<void> {
    try {
      // 1. Run initial garbage collection
      await this.cleanupExpiredRenders();

      const staleJobs = await query<RenderJobRow[]>(
        onlyStale
          ? "SELECT id, retry_count, max_retries FROM render_jobs WHERE status = 'running' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
          : "SELECT id, retry_count, max_retries FROM render_jobs WHERE status = 'running'"
      );

      const requeuedIds: string[] = [];
      const stateUpdates: Promise<unknown>[] = [];
      for (const job of staleJobs) {
        // This process still owns the worker; a quiet render can legitimately
        // spend several minutes inside Chromium/FFmpeg between progress ticks.
        if (onlyStale && this.activeJobAbortControllers.has(job.id)) continue;
        if (job.retry_count < job.max_retries) {
          logger.info(`Re-queueing stale render job [${job.id}] after restart...`);
          stateUpdates.push(query(
            "UPDATE render_jobs SET status = 'queued', stage = 'جاري استعادة الإنتاج تلقائياً', retry_count = retry_count + 1 WHERE id = ?",
            [job.id]
          ));
          requeuedIds.push(job.id);
        } else {
          logger.warn(`Marking non-retryable stale render job [${job.id}] as failed.`);
          stateUpdates.push(query(
            "UPDATE render_jobs SET status = 'failed', stage = 'فشل', error_code = 'WORKER_TERMINATED', error_message = 'تم إيقاف عملية الريندر بسبب إعادة تشغيل الخادم' WHERE id = ?",
            [job.id]
          ));
        }
      }
      // Reclaim all orphaned rows in parallel, then wake the scheduler once.
      // Sequential updates could hold up worker startup behind a large batch
      // of abandoned jobs and made recovery look like another render queue.
      await Promise.all(stateUpdates);
      if (requeuedIds.length > 0) {
        if (config.queue.driver === 'bullmq') {
          for (const jobId of requeuedIds) this.triggerProcessor(jobId);
        } else {
          this.triggerProcessor();
        }
      }
    } catch (err) {
      logger.error('Failed to recover stale render jobs:', err);
    }
  }

  /**
   * Aggressive Garbage Collector for Shared Hosting Disk Space
   * Purges finished MP4 video files older than 1 hour, and failed render artifacts older than 30 minutes.
   */
  public async cleanupExpiredRenders(): Promise<void> {
    try {
      const expiredJobs = await query<RenderJobRow[]>(
        `SELECT id, output_path FROM render_jobs 
         WHERE output_path IS NOT NULL AND (
           (expires_at IS NOT NULL AND expires_at < NOW())
           OR (status IN ('failed', 'cancelled') AND created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
         )
         ORDER BY COALESCE(expires_at, created_at) ASC
         LIMIT 100`
      );

      // Cleanup is intentionally bounded and parallel. A sequential delete +
      // UPDATE for every old artifact can delay worker recovery for seconds
      // when a busy installation has accumulated many failed jobs.
      await Promise.all(expiredJobs.map(async (job) => {
        if (job.output_path && fs.existsSync(job.output_path)) {
          try {
            await fs.promises.unlink(job.output_path);
            logger.info(`Garbage Collector: Deleted expired render artifact [${job.id}]: ${job.output_path}`);
          } catch (e: any) {
            logger.warn(`Failed to unlink expired render artifact [${job.id}]:`, e.message);
          }
        } else if (isObjectStoragePath(job.output_path)) {
          await deleteStoredRender(job.output_path).catch((error) => logger.warn(`Failed to delete expired object [${job.id}]:`, error));
        }
        await query(
          "UPDATE render_jobs SET output_path = NULL, stage = 'تم مسح الملف المؤقت لانتهاء الصلاحية' WHERE id = ? AND output_path IS NOT NULL",
          [job.id]
        );
        await query(
          "UPDATE saved_videos SET video_url = NULL WHERE id = ?",
          [job.id]
        ).catch(() => {});
      }));

      // Sweep expired saved_videos rows to remove download link and protect server disk
      await query(
        `UPDATE saved_videos SET video_url = NULL 
         WHERE expires_at IS NOT NULL AND expires_at < NOW() AND video_url IS NOT NULL`
      ).catch(() => {});
    } catch (err) {
      logger.error('Failed running garbage collector on expired renders:', err);
    }
  }

  /**
   * Submits and enqueues a new render job with idempotency and security validation
   */
  public async enqueueJob(params: CreateJobParams): Promise<RenderJobRow> {
    const { userId, manifest: rawManifest, idempotencyKey } = params;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await query<RenderJobRow[]>(
        'SELECT * FROM render_jobs WHERE idempotency_key = ? AND user_id = ? LIMIT 1',
        [idempotencyKey, userId]
      );
      if (existing.length > 0) {
        return existing[0];
      }
    }

    // 2. Schema Validation
    const manifestValidation = validateRenderManifest(rawManifest);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      throw new Error(`خطأ في بيانات أمر الريندر: ${manifestValidation.errors?.join(', ')}`);
    }

    const manifest = manifestValidation.manifest;

    // 3. Security & Asset Allowlist Validation
    const assetValidation = validateManifestAssets(manifest);
    if (!assetValidation.safe) {
      throw new Error(`فشل التحقق الأمني من وسائط الريندر: ${assetValidation.reason}`);
    }

    // 4. Create Job Record in MySQL
    const jobId = crypto.randomUUID();
    const manifestJson = JSON.stringify(manifest);

    await query(
      `INSERT INTO render_jobs (
        id, user_id, idempotency_key, status, progress, stage, manifest, max_retries
      ) VALUES (?, ?, ?, 'queued', 0.00, 'جاري تخصيص موارد الإنتاج', ?, 1)`,
      [jobId, userId, idempotencyKey || null, manifestJson]
    );

    logger.info(`Enqueued render job [${jobId}] for user [${userId}]`);
    void recordRenderAudit(jobId, userId, 'queued');

    // Kick processor asynchronously
    this.triggerProcessor(jobId);

    const created = await this.getJobById(jobId, userId);
    if (!created) {
      throw new Error('Failed to retrieve newly enqueued job.');
    }
    return created;
  }

  /**
   * Retrieves a job by ID, ensuring user authorization (IDOR protection)
   */
  public async getJobById(jobId: string, userId?: string, isAdmin: boolean = false): Promise<RenderJobRow | null> {
    let sql = 'SELECT * FROM render_jobs WHERE id = ?';
    const params: any[] = [jobId];

    if (!isAdmin && userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }

    const rows = await query<RenderJobRow[]>(sql, params);
    if (rows.length === 0) return null;

    const job = rows[0];
    if (typeof job.manifest === 'string') {
      try {
        job.manifest = JSON.parse(job.manifest);
      } catch {
        // Keep a raw manifest from legacy/corrupt rows visible to callers.
      }
    }
    if (typeof job.metadata === 'string') {
      try {
        job.metadata = JSON.parse(job.metadata);
      } catch {
        // Keep raw metadata from legacy/corrupt rows visible to callers.
      }
    }
    job.progress = Number(job.progress) || 0;
    return job;
  }

  /**
   * Cancels a running or queued job and aborts associated render processes
   */
  public async cancelJob(jobId: string, userId?: string, isAdmin: boolean = false): Promise<boolean> {
    const job = await this.getJobById(jobId, userId, isAdmin);
    if (!job) return false;

    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return false; // Already finalized
    }

    // Abort process if currently executing
    const controller = this.activeJobAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.activeJobAbortControllers.delete(jobId);
    }

    await query(
      "UPDATE render_jobs SET status = 'cancelled', stage = 'تم الإلغاء', completed_at = NOW() WHERE id = ? AND status IN ('queued', 'running')",
      [jobId]
    );

    // Cleanup partial file if any
    if (job.output_path && fs.existsSync(job.output_path)) {
      try {
        await fs.promises.unlink(job.output_path);
      } catch {
        // The worker may have already removed a partial output; cancellation
        // is still successful and must remain idempotent.
      }
    } else if (isObjectStoragePath(job.output_path)) {
      await deleteStoredRender(job.output_path).catch(() => {});
    }

    logger.info(`Cancelled render job [${jobId}]`);
    void recordRenderAudit(jobId, job.user_id, 'cancelled');
    return true;
  }

  /** Requeues a failed/cancelled job without charging another daily slot. */
  public async retryJob(jobId: string, userId?: string, isAdmin: boolean = false): Promise<RenderJobRow | null> {
    const job = await this.getJobById(jobId, userId, isAdmin);
    if (!job || !['failed', 'cancelled'].includes(job.status)) return null;
    if (userId) {
      const activeJobs = await query<{ id: string }[]>(
        "SELECT id FROM render_jobs WHERE user_id = ? AND status IN ('queued', 'running') LIMIT 1",
        [userId],
      );
      if (activeJobs.length > 0) return null;
    }

    const result: any = await query(
      `UPDATE render_jobs SET status = 'queued', progress = 0, stage = 'جاري إعادة تشغيل الإنتاج',
        error_code = NULL, error_message = NULL, output_path = NULL, output_filename = NULL,
        output_size_bytes = NULL, duration_seconds = NULL, metadata = NULL, completed_at = NULL,
        expires_at = NULL, retry_count = 0
       WHERE id = ? AND status IN ('failed', 'cancelled')`,
      [jobId],
    );
    if (!result?.affectedRows) return null;
    void recordRenderAudit(jobId, job.user_id, 'manual_retry');
    // BullMQ requires the durable job id to be re-added explicitly. Calling
    // the processor without an id is a no-op in BullMQ mode, which made a
    // manual retry appear successful while never reaching the worker.
    this.triggerProcessor(jobId);
    return this.getJobById(jobId, userId, isAdmin);
  }

  /**
   * Triggers the queue worker loop
   */
  public triggerProcessor(jobId?: string, priority = 0): void {
    if (config.queue.driver === 'bullmq') {
      if (jobId) {
        enqueueRenderJob(jobId, priority).catch((error) => logger.error(`Failed to enqueue render job [${jobId}] in Redis:`, error));
      }
      return;
    }
    if (this.isProcessing) return;
    this.processNextJobs().catch((err) => {
      logger.error('Unexpected error in render queue worker:', err);
    });
  }

  /** Called by the dedicated BullMQ process after the durable queue grants a job. */
  public async processExternalJob(jobId: string): Promise<void> {
    const leased: any = await query(
      "UPDATE render_jobs SET status = 'running', stage = 'بدء معالجة المشهد', started_at = NOW() WHERE id = ? AND status = 'queued'",
      [jobId],
    );
    if (!leased?.affectedRows) return;
    const job = await this.getJobById(jobId, undefined, true);
    if (!job) return;
    await this.executeJob(job);

    // executeJob deliberately catches render errors so it can persist the
    // durable state. When a transient infrastructure failure moved the job
    // back to `queued`, propagate a failure to BullMQ so its existing job
    // attempt/backoff machinery retries the same id. Re-adding the id while
    // the current BullMQ attempt is active is ignored by BullMQ, so this
    // explicit signal is required for a real retry.
    const state = await query<{ status: RenderJobRow['status'] }[]>(
      'SELECT status FROM render_jobs WHERE id = ? LIMIT 1',
      [jobId],
    );
    if (state[0]?.status === 'queued') {
      throw new Error('Render job requeued after transient infrastructure failure');
    }
  }

  /**
   * Process loop pulling next available queued job
   */
  private async processNextJobs(): Promise<void> {
    if (this.activeJobsCount >= this.maxConcurrency) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.activeJobsCount < this.maxConcurrency) {
        // Atomic lease with Priority to active Premium subscribers
        const candidateRows = await query<RenderJobRow[]>(
          `SELECT rj.id FROM render_jobs rj
           LEFT JOIN subscriptions s ON s.user_id = rj.user_id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
           WHERE rj.status = 'queued'
           -- Premium jobs get priority, but queue aging guarantees that a
           -- free job waiting longer than two minutes cannot be starved.
           ORDER BY
             (CASE WHEN rj.created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE) THEN 2
                   WHEN s.plan IN ('monthly', 'yearly') THEN 1 ELSE 0 END) DESC,
             rj.created_at ASC
           LIMIT 1`
        );

        if (candidateRows.length === 0) {
          break; // No more queued jobs
        }

        const candidateId = candidateRows[0].id;
        const updateResult: any = await query(
          "UPDATE render_jobs SET status = 'running', stage = 'بدء معالجة المشهد', started_at = NOW() WHERE id = ? AND status = 'queued'",
          [candidateId]
        );

        if (updateResult.affectedRows === 0) {
          // Another worker grabbed it, retry loop
          continue;
        }

        const job = await this.getJobById(candidateId, undefined, true);
        if (!job) {
          // Do not leave an invisible lease blocking the queue forever.
          await query(
            "UPDATE render_jobs SET status = 'failed', stage = 'فشل الريندر', error_code = 'JOB_NOT_FOUND', error_message = 'تعذر تحميل بيانات مهمة الريندر' WHERE id = ? AND status = 'running'",
            [candidateId],
          );
          continue;
        }

        this.activeJobsCount++;
        // Execute render job asynchronously
        this.executeJob(job).finally(() => {
          this.activeJobsCount--;
          this.triggerProcessor();
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a leased render job to completion
   */
  private async executeJob(job: RenderJobRow): Promise<void> {
    const jobId = job.id;
    const abortController = new AbortController();
    const startedAt = Date.now();
    this.activeJobAbortControllers.set(jobId, abortController);
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    try {
      const manifest: RenderManifest = typeof job.manifest === 'string' ? JSON.parse(job.manifest) : job.manifest;
      const userStorageDir = path.join(this.storageDir, job.user_id);
      await fs.promises.mkdir(userStorageDir, { recursive: true });
      const outputFilename = `quran_reel_${manifest.canonicalAyahRange.surahNumber}_${manifest.canonicalAyahRange.startAyah}-${manifest.canonicalAyahRange.endAyah}_${jobId.substring(0, 8)}.mp4`;
      const outputPath = path.join(userStorageDir, outputFilename);
      heartbeat = setInterval(() => {
        query("UPDATE render_jobs SET updated_at = NOW() WHERE id = ? AND status = 'running'", [jobId]).catch((err) => {
          logger.warn(`Could not refresh render-job lease [${jobId}]:`, err);
        });
      }, 30 * 1000);
      heartbeat.unref?.();
      logger.info(`Starting execution of render job [${jobId}]...`);
      void recordRenderAudit(jobId, job.user_id, 'started', { workerId: config.queue.workerId });

      // Progress reporting hook
      const onProgress = async (percent: number, curFrame: number, totalFrames: number, stage?: string) => {
        if (curFrame % 10 === 0 || curFrame === totalFrames || curFrame === 0 || percent >= 97) {
          const currentStage = stage || (curFrame > 0 ? `توليد الإطارات (${curFrame}/${totalFrames})` : 'جاري المعالجة...');
          await query(
            "UPDATE render_jobs SET progress = ?, stage = ? WHERE id = ? AND status = 'running'",
            [percent, currentStage, jobId]
          );
        }
      };

      const renderResult = await renderDeterministicVideo({
        manifest,
        outputPath,
        signal: abortController.signal,
        onProgress,
      });

      // Upload to shared object storage before publishing success so every API
      // instance can serve the artifact after the worker's local disk is gone.
      const storedOutputPath = config.storage.driver === 's3'
        ? await uploadRender(outputPath, job.user_id, jobId)
        : outputPath;

      // Mark Job Succeeded (Retains for 48 hours to protect server disk space)
      const completionUpdate: any = await query(
        `UPDATE render_jobs SET 
          status = 'succeeded',
          progress = 100.00,
          stage = 'تم الانتهاء بنجاح',
          output_path = ?,
          output_filename = ?,
          output_size_bytes = ?,
          duration_seconds = ?,
          metadata = ?,
          completed_at = NOW(),
          expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR)
        WHERE id = ? AND status = 'running'`,
        [
          storedOutputPath,
          outputFilename,
          renderResult.fileSizeBytes,
          renderResult.durationSeconds,
          JSON.stringify(renderResult.probe),
          jobId,
        ]
      );

      if (!completionUpdate?.affectedRows) {
        // Cancellation/recovery won the state transition while FFmpeg was
        // finishing. Never expose an output from a job that is no longer live.
        if (fs.existsSync(renderResult.outputPath)) await fs.promises.unlink(renderResult.outputPath).catch(() => {});
        if (isObjectStoragePath(storedOutputPath)) await deleteStoredRender(storedOutputPath).catch(() => {});
        logger.info(`Render job [${jobId}] completed after its lease ended; output discarded.`);
      } else {
        if (config.storage.driver === 's3') await fs.promises.unlink(outputPath).catch(() => {});
        renderDurationSeconds.observe((Date.now() - startedAt) / 1000);
        void recordRenderAudit(jobId, job.user_id, 'succeeded', { durationSeconds: (Date.now() - startedAt) / 1000 });
        logger.info(`Render job [${jobId}] succeeded and is ready for download.`);

        // Idea 3: Automatically save completed background video to user's saved_videos library
        const surahNumber = manifest.canonicalAyahRange?.surahNumber || 1;
        const surahName = manifest.canonicalAyahRange?.surahName || 'سورة';
        const startAyah = manifest.canonicalAyahRange?.startAyah || 1;
        const endAyah = manifest.canonicalAyahRange?.endAyah || 1;
        const reciterId = manifest.reciter?.id || 'default';
        const reciterName = manifest.reciter?.name || 'القارئ';
        const aspectRatio = manifest.aspectRatio || '9:16';
        const bgType = manifest.background?.type || 'image';
        const engineType = (manifest as any).renderEngine || manifest.displaySettings?.renderEngine || 'ffmpeg_ass';
        const videoDownloadUrl = `/api/renders/${jobId}/download`;

        await query(
          `INSERT INTO saved_videos (
            id, user_id, surah_name, surah_number, start_ayah, end_ayah,
            reciter_id, reciter_name, video_url, thumbnail_url,
            aspect_ratio, background_type, is_public, expires_at, render_engine
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 48 HOUR), ?)
          ON DUPLICATE KEY UPDATE
            video_url = VALUES(video_url),
            expires_at = VALUES(expires_at),
            render_engine = VALUES(render_engine)`,
          [
            jobId,
            job.user_id,
            surahName,
            surahNumber,
            startAyah,
            endAyah,
            reciterId,
            reciterName,
            videoDownloadUrl,
            null,
            aspectRatio,
            bgType,
            engineType,
          ]
        ).catch((saveErr) => logger.warn(`Failed auto-saving background render [${jobId}] to saved_videos:`, saveErr));

        // Idea 3: Send instant user notification
        const notifId = crypto.randomUUID();
        const notifTitle = 'اكتمل إنتاج الفيديو بنجاح 🎬';
        const notifMsg = `فيديو سورة ${surahName} (الآيات ${startAyah}-${endAyah}) جاهز الآن في مكتبتك للتحميل والمشاهدة. متاح للتحميل لمدة 48 ساعة.`;
        await query(
          `INSERT INTO notifications (id, user_id, title, message, type, is_read)
           VALUES (?, ?, ?, ?, 'video', FALSE)`,
          [notifId, job.user_id, notifTitle, notifMsg]
        ).catch((notifErr) => logger.warn(`Failed creating notification for render job [${jobId}]:`, notifErr));
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        logger.info(`Render job [${jobId}] was aborted.`);
        void recordRenderAudit(jobId, job.user_id, 'aborted');
        return;
      }

      logger.error(`Render job [${jobId}] failed:`, err);
      void recordRenderAudit(jobId, job.user_id, 'failed', { message: err.message || 'unknown' });
      const errorMessage = String(err?.message || err || '');
      // Chromium/FFmpeg can be terminated by a transient container pressure
      // event. Requeue the same durable job (without charging a new slot) so
      // it is retried after capacity is available instead of exposing a
      // permanent failure for a recoverable infrastructure error.
      const isTransient = /network|timeout|target closed|protocol error|ffmpeg process failed|out of memory|enomem|sigkill/i.test(errorMessage);

      if (isTransient && job.retry_count < job.max_retries) {
        await query(
          "UPDATE render_jobs SET status = 'queued', stage = 'جاري استعادة الإنتاج تلقائياً', retry_count = retry_count + 1 WHERE id = ? AND status = 'running'",
          [jobId]
        );
        // The DB worker can enqueue directly. BullMQ uses the current job's
        // attempts/backoff lifecycle; processExternalJob observes `queued`
        // and throws after this method returns so the same BullMQ job retries.
        if (config.queue.driver !== 'bullmq') this.triggerProcessor(jobId);
      } else {
        await query(
          `UPDATE render_jobs SET 
            status = 'failed',
            stage = 'فشل الريندر',
            error_code = 'RENDER_FAILED',
            error_message = ?,
            completed_at = NOW()
        WHERE id = ? AND status = 'running'`,
          [errorMessage || 'حدث خطأ غير متوقع أثناء معالجة الفيديو', jobId]
        );
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.activeJobAbortControllers.delete(jobId);
    }
  }
}

export const renderJobQueue = new RenderJobQueue();

// In production the API process does not run Chromium. Start this module with
// `npm run worker` (or a separate container) to consume the Redis queue.
export function startDedicatedRenderWorker(): void {
  if (config.queue.driver !== 'bullmq') return;
  startRenderWorker((jobId) => renderJobQueue.processExternalJob(jobId));
}

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { renderJobQueue } from '../../server/services/renderJobQueue';
import { ensureRenderJobsTable } from '../../server/db/migrations/addRenderJobsTable';
import { query } from '../../server/db';
import crypto from 'crypto';

// This suite inserts and deletes database rows. Run explicitly against a test
// database; the default unit suite must not require or mutate a developer DB.
describe.runIf(process.env.RUN_DB_INTEGRATION_TESTS === 'true')('Durable Render Job System & Queue', () => {
  const testUserId1 = crypto.randomUUID();
  const testUserId2 = crypto.randomUUID();

  const validManifest = {
    schemaVersion: '1.0.0',
    rendererVersion: '1.0.0',
    revision: 'rev_test_queue',
    aspectRatio: '9:16',
    outputDimensions: { width: 1080, height: 1920 },
    fps: 30,
    qualityPreset: 'high',
    codecProfile: 'high-4.1',
    reciter: { id: 'mishary_alafasy', name: 'مشاري العفاسي' },
    canonicalAyahRange: {
      surahNumber: 108,
      surahName: 'الكوثر',
      startAyah: 1,
      endAyah: 1,
      ayahs: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' }],
    },
    timingMap: {
      mapId: 'map_queue_test',
      audioContentHash: 'hash_test_12345',
      validationStatus: 'approved',
      words: [{ canonicalWordKey: '108:1:1', displayWordIndex: 0, displayToken: 'إِنَّا', startMs: 0, endMs: 500 }],
    },
    audio: {
      sourceMode: 'single_url',
      audioUrl: 'https://audio.qurancdn.com/test.mp3',
      audioContentHash: 'hash_test_12345',
      durationSeconds: 3.0,
    },
    background: {
      id: 'bg_test',
      type: 'color',
      url: '#000000',
      overlayOpacity: 0.4,
      shadowIntensity: 0.5,
      motionSpeed: 3,
    },
    typography: {
      fontSize: 28,
      fontFamily: '"Noto Naskh Arabic", serif',
      textColor: '#ffffff',
      shadowIntensity: 0.5,
      overlayOpacity: 0.4,
    },
    displaySettings: {
      showSurahName: true,
      showReciterName: true,
      showAyahText: true,
      showAyahNumber: true,
      highlightStyle: 'glow',
      frameStyle: 'none',
      ayahNumberStyle: 'circle',
      ayahNumberColor: 'gold',
      verseDisplayMode: 'full',
      surahNamePosition: 'top',
      surahNameStyle: 'classic',
      reciterNameStyle: 'simple',
      textShadowStyle: 'soft',
      ayahTransition: 'none',
      watermarkEnabled: false,
      watermarkText: '',
      watermarkPosition: 'bottomRight',
      glowStyle: 'golden',
      slideshowTransition: 'crossfade',
    },
    outputFormat: 'mp4',
  };

  beforeAll(async () => {
    await ensureRenderJobsTable();
    // Insert dummy users for FK integrity
    await query("INSERT IGNORE INTO users (id, email, password_hash) VALUES (?, 'user1@render.test', 'hash1')", [testUserId1]);
    await query("INSERT IGNORE INTO users (id, email, password_hash) VALUES (?, 'user2@render.test', 'hash2')", [testUserId2]);
  });

  afterAll(async () => {
    await query('DELETE FROM render_jobs WHERE user_id IN (?, ?)', [testUserId1, testUserId2]);
    await query('DELETE FROM users WHERE id IN (?, ?)', [testUserId1, testUserId2]);
  });

  afterEach(async () => {
    const activeRows = await query<Array<{ id: string }>>(
      "SELECT id FROM render_jobs WHERE user_id IN (?, ?) AND status IN ('queued', 'running')",
      [testUserId1, testUserId2],
    );
    await Promise.all(activeRows.map((row) => renderJobQueue.cancelJob(row.id, undefined, true)));
    await query('DELETE FROM render_jobs WHERE user_id IN (?, ?)', [testUserId1, testUserId2]);
  });

  it('enqueues a valid job and sets initial state to queued', async () => {
    const job = await renderJobQueue.enqueueJob({
      userId: testUserId1,
      manifest: validManifest,
    });

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.user_id).toBe(testUserId1);
    expect(['queued', 'running']).toContain(job.status);
    expect(job.progress).toBe(0);
  });

  it('enforces idempotency: repeated submissions with same idempotencyKey return identical job', async () => {
    const idemKey = `idem_${Date.now()}_${Math.random()}`;

    const job1 = await renderJobQueue.enqueueJob({
      userId: testUserId1,
      manifest: validManifest,
      idempotencyKey: idemKey,
    });

    const job2 = await renderJobQueue.enqueueJob({
      userId: testUserId1,
      manifest: validManifest,
      idempotencyKey: idemKey,
    });

    expect(job1.id).toBe(job2.id);
  });

  it('enforces IDOR / cross-user denial: user2 cannot read user1 job', async () => {
    const job = await renderJobQueue.enqueueJob({
      userId: testUserId1,
      manifest: validManifest,
    });

    const accessedByOwner = await renderJobQueue.getJobById(job.id, testUserId1);
    expect(accessedByOwner).not.toBeNull();
    expect(accessedByOwner?.id).toBe(job.id);

    const accessedByOther = await renderJobQueue.getJobById(job.id, testUserId2);
    expect(accessedByOther).toBeNull(); // Strictly denied!

    const accessedByAdmin = await renderJobQueue.getJobById(job.id, undefined, true);
    expect(accessedByAdmin).not.toBeNull(); // Admin can access
  });

  it('supports job cancellation: sets status to cancelled', async () => {
    const job = await renderJobQueue.enqueueJob({
      userId: testUserId1,
      manifest: validManifest,
    });

    const cancelled = await renderJobQueue.cancelJob(job.id, testUserId1);
    expect(cancelled).toBe(true);

    const checkJob = await renderJobQueue.getJobById(job.id, testUserId1);
    expect(checkJob?.status).toBe('cancelled');
  });

  it('requeues a cancelled job without creating a second job or spending a new slot', async () => {
    const jobId = crypto.randomUUID();
    await query(
      `INSERT INTO render_jobs (id, user_id, status, progress, stage, manifest, retry_count, max_retries)
       VALUES (?, ?, 'cancelled', 42, 'تم الإلغاء', ?, 1, 1)`,
      [jobId, testUserId2, JSON.stringify(validManifest)],
    );

    const retried = await renderJobQueue.retryJob(jobId, testUserId2);
    expect(retried?.id).toBe(jobId);
    expect(['queued', 'running']).toContain(retried?.status);
    expect(retried?.progress).toBe(0);
    expect(retried?.retry_count).toBe(0);
  });

  it('recovers stale jobs after worker restart', async () => {
    const staleJobId = crypto.randomUUID();
    await query(
      `INSERT INTO render_jobs (id, user_id, status, progress, stage, manifest, retry_count, max_retries)
       VALUES (?, ?, 'running', 40, 'جاري الريندر', ?, 0, 1)`,
      [staleJobId, testUserId1, JSON.stringify(validManifest)]
    );

    await renderJobQueue.recoverStaleJobs();

    const recovered = await renderJobQueue.getJobById(staleJobId, testUserId1);
    // Should be re-queued with incremented retry_count
    expect(recovered?.status).toBe('queued');
    expect(recovered?.retry_count).toBe(1);
  });
});

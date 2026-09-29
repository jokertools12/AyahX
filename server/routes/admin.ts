import { Router, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { query, transaction } from '../db';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';
import { aiRateLimiter } from '../middleware/rateLimiter';
import { renderJobQueue } from '../services/renderJobQueue';
import { SUBSCRIPTION_CATALOG, isCheckoutPlan } from '../../shared/subscriptionCatalog';

const router = Router();

// All admin routes require admin privileges
router.use(requireAdmin);

// 1. Overview Stats
router.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [
      usersCount,
      videosCount,
      premiumCount,
      pendingCount,
    ] = await Promise.all([
      query<any[]>('SELECT COUNT(*) as count FROM users'),
      query<any[]>('SELECT COALESCE(SUM(count), 0) as count FROM daily_video_usage'),
      query<any[]>("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND plan != 'free' AND (expires_at IS NULL OR expires_at > NOW())"),
      query<any[]>("SELECT COUNT(*) as count FROM payment_requests WHERE status = 'pending'"),
    ]);

    return res.json({
      totalUsers: Number(usersCount[0]?.count || 0),
      totalVideos: Number(videosCount[0]?.count || 0),
      premiumUsers: Number(premiumCount[0]?.count || 0),
      pendingRequests: Number(pendingCount[0]?.count || 0),
    });
  } catch (err: any) {
    console.error('Fetch admin stats error:', err);
    return res.status(500).json({ error: 'فشل استرجاع إحصائيات الإدارة' });
  }
});

// 2. 7-Day Video Activity
router.get('/daily-stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query<any[]>(
      `SELECT date, SUM(count) as total
       FROM daily_video_usage
       WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY date
       ORDER BY date ASC`
    );

    const map: Record<string, number> = {};
    rows.forEach((r) => {
      map[r.date] = parseInt(r.total, 10) || 0;
    });

    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });
      result.push({ date: dayName, videos: map[dateStr] || 0 });
    }

    return res.json(result);
  } catch (err: any) {
    console.error('Fetch daily stats error:', err);
    return res.status(500).json({ error: 'فشل استرجاع إحصائيات النشاط اليومي' });
  }
});

// 3. All Users List (Paginated & Bounded)
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const offset = (page - 1) * limit;

    const users = await query<any[]>(
      `SELECT u.id, u.email, u.created_at,
              p.display_name, p.avatar_url, p.bio,
              COALESCE(r.role, 'user') as role,
              COALESCE(s.plan, 'free') as plan,
              s.status as subscription_status,
              s.expires_at as subscription_expires_at
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_roles r ON r.user_id = u.id
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json(users);
  } catch (err: any) {
    console.error('Fetch all users error:', err);
    return res.status(500).json({ error: 'فشل استرجاع قائمة المستخدمين' });
  }
});

// 4. Payment Requests List (Paginated & Bounded)
router.get('/payment-requests', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const offset = (page - 1) * limit;

    let sql = `
      SELECT pr.*, u.email, p.display_name
      FROM payment_requests pr
      JOIN users u ON u.id = pr.user_id
      LEFT JOIN profiles p ON p.user_id = pr.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status && status !== 'all') {
      sql += ' AND pr.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY pr.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const requests = await query<any[]>(sql, params);
    return res.json(requests);
  } catch (err: any) {
    console.error('Fetch payment requests error:', err);
    return res.status(500).json({ error: 'فشل استرجاع طلبات الدفع' });
  }
});

// 5. Approve Payment
router.post('/payment-requests/:id/approve', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestId = req.params.id;
    const requests = await query<any[]>('SELECT * FROM payment_requests WHERE id = ? LIMIT 1', [requestId]);
    if (requests.length === 0) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const request = requests[0];
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'تم البت في هذا الطلب مسبقاً (معتمد أو مرفوض)' });
    }

    const userId = request.user_id;
    const plan = request.plan;

    // Requests are validated at checkout, but keep approval authoritative as
    // well: an old/imported malformed row must never turn into a paid plan
    // merely because it reaches an administrator's queue.
    if (!isCheckoutPlan(plan)) {
      return res.status(400).json({ error: 'لا يمكن اعتماد طلب بخطة غير معتمدة.' });
    }
    const expectedPayment = SUBSCRIPTION_CATALOG[plan];
    if (String(request.currency || 'EGP').toUpperCase() !== 'EGP'
      || Number(request.amount) !== expectedPayment.walletAmountEgp) {
      return res.status(400).json({ error: 'بيانات مبلغ أو عملة طلب الدفع لا تطابق الخطة المختارة.' });
    }

    // Rollover: If user has an active unexpired subscription, extend from existing expiration
    const currentSubs = await query<any[]>(
      "SELECT expires_at FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1",
      [userId]
    );
    let baseDate = new Date();
    if (currentSubs.length > 0 && currentSubs[0].expires_at) {
      const activeExpiry = new Date(currentSubs[0].expires_at);
      if (activeExpiry > baseDate) {
        baseDate = activeExpiry;
      }
    }

    const expiresAt = new Date(baseDate);
    if (plan === 'yearly') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    await transaction(async (conn) => {
      // 1. Mark request as approved atomically (compare-and-swap)
      const [updateRes]: any = await conn.query(
        "UPDATE payment_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
        [requestId]
      );

      if (updateRes.affectedRows === 0) {
        throw new Error('ALREADY_PROCESSED');
      }

      // 2. Expire old active subscriptions
      await conn.query(
        "UPDATE subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'active'",
        [userId]
      );

      // 3. Create new active subscription (format dates as standard MySQL TIMESTAMP strings)
      const subId = crypto.randomUUID();
      const toMySQLDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
      await conn.query(
        'INSERT INTO subscriptions (id, user_id, plan, status, starts_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [subId, userId, plan, 'active', toMySQLDate(new Date()), toMySQLDate(expiresAt)]
      );

      // 4. Send notification
      const notifId = crypto.randomUUID();
      await conn.query(
        'INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)',
        [
          notifId,
          userId,
          'تم تفعيل اشتراكك بنجاح! 🎉',
          `تمت الموافقة على طلب ترقية حسابك إلى خطة ${plan === 'yearly' ? 'السنوية' : 'الشهرية'}. استمتع بجميع الميزات المميزة!`,
          'system',
        ]
      );
    });

    return res.json({ success: true, expiresAt: expiresAt.toISOString() });
  } catch (err: any) {
    if (err.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ error: 'تمت معالجة هذا الطلب بالفعل من قبل مسؤول آخر' });
    }
    console.error('Approve payment error:', err);
    return res.status(500).json({ error: 'فشل اعتماد طلب الدفع' });
  }
});

// 6. Reject Payment (Atomic with status = 'pending' check)
router.post('/payment-requests/:id/reject', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestId = req.params.id;
    const { adminNote } = req.body;

    const requests = await query<any[]>('SELECT * FROM payment_requests WHERE id = ? LIMIT 1', [requestId]);
    if (requests.length === 0) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const request = requests[0];
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'تم البت في هذا الطلب مسبقاً (معتمد أو مرفوض)' });
    }
    const note = adminNote ? String(adminNote).trim().slice(0, 500) : 'تعذر تأكيد استلام المبلغ';

    await transaction(async (conn) => {
      const [updateRes]: any = await conn.query(
        "UPDATE payment_requests SET status = 'rejected', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
        [note, requestId]
      );

      if (updateRes.affectedRows === 0) {
        throw new Error('ALREADY_PROCESSED');
      }

      const notifId = crypto.randomUUID();
      await conn.query(
        'INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)',
        [
          notifId,
          request.user_id,
          'تم رفض طلب الترقية',
          `نعتذر، تعذر تفعيل الاشتراك. ملاحظة الإدارة: ${note}`,
          'system',
        ]
      );
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ error: 'تمت معالجة هذا الطلب بالفعل من قبل مسؤول آخر' });
    }
    console.error('Reject payment error:', err);
    return res.status(500).json({ error: 'فشل رفض طلب الدفع' });
  }
});

// ==============================================================================
// 7. System Settings & API Keys Management (Admin Only)
// ==============================================================================

/**
 * GET /api/admin/settings
 * Returns all configured system settings with secrets safely masked
 */
router.get('/settings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { getAllSettingsMasked, getSecretStorageStatus } = await import('../services/settingsService');
    const { getAiProviderStatus } = await import('../services/aiService');
    const settings = await getAllSettingsMasked();
    const aiRuntime = await getAiProviderStatus();
    return res.json({
      settings,
      secretStorage: getSecretStorageStatus(),
      aiRuntime,
    });
  } catch (err: any) {
    console.error('Fetch settings error:', err);
    return res.status(500).json({ error: 'فشل استرجاع إعدادات النظام' });
  }
});

/**
 * POST /api/admin/settings
 * Updates system settings and environment variables
 */
router.post('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'بيانات الإعدادات غير صالحة' });
    }

    const { saveSetting } = await import('../services/settingsService');
    const { isSettingsSecretEncryptionConfigured } = await import('../services/secretSettingsCrypto');

    const knownKeys: Record<string, { isSecret: boolean; category: string }> = {
      GEMINI_API_KEY: { isSecret: true, category: 'ai' },
      AI_PROVIDER: { isSecret: false, category: 'ai' },
      AI_IMAGE_PROVIDER: { isSecret: false, category: 'ai' },
      OPENROUTER_API_KEY: { isSecret: true, category: 'ai' },
      OPENROUTER_TEXT_MODEL: { isSecret: false, category: 'ai' },
      OPENROUTER_TEXT_FALLBACK_MODELS: { isSecret: false, category: 'ai' },
      OPENROUTER_MODEL_FALLBACKS_ENABLED: { isSecret: false, category: 'ai' },
      OPENROUTER_FREE_ONLY: { isSecret: false, category: 'ai' },
      OPENROUTER_ALLOW_PROVIDER_FALLBACKS: { isSecret: false, category: 'ai' },
      OPENROUTER_DATA_COLLECTION: { isSecret: false, category: 'ai' },
      OPENROUTER_SITE_URL: { isSecret: false, category: 'ai' },
      PEXELS_API_KEY: { isSecret: true, category: 'media' },
      REELS_DEFAULT_QUALITY: { isSecret: false, category: 'reels' },
      REELS_DEFAULT_FPS: { isSecret: false, category: 'reels' },
      REELS_DEFAULT_GLOW: { isSecret: false, category: 'reels' },
      REELS_AUDIO_BITRATE: { isSecret: false, category: 'reels' },
    };

    // Validate the whole batch before writing anything.  Without this guard a
    // settings request could persist several non-secret values and then fail
    // halfway through when the first API key needs encryption.
    const hasNewSecret = Object.entries(settings).some(([key, rawVal]) => {
      const meta = knownKeys[key] || { isSecret: key.includes('KEY') || key.includes('SECRET'), category: 'general' };
      if (!meta.isSecret || typeof rawVal !== 'string') return false;
      const cleanVal = rawVal.trim();
      return Boolean(cleanVal) && !cleanVal.includes('****') && cleanVal !== '******';
    });
    if (hasNewSecret && !isSettingsSecretEncryptionConfigured()) {
      return res.status(422).json({
        error: 'اضبط SETTINGS_ENCRYPTION_KEY على الخادم قبل حفظ مفاتيح API من لوحة الإعدادات.',
        code: 'SETTINGS_ENCRYPTION_KEY_NOT_CONFIGURED',
      });
    }

    for (const [key, rawVal] of Object.entries(settings)) {
      if (typeof rawVal === 'string') {
        const meta = knownKeys[key] || { isSecret: key.includes('KEY') || key.includes('SECRET'), category: 'general' };
        await saveSetting(key, rawVal, meta.isSecret, meta.category);
      }
    }

    return res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err: any) {
    console.error('Save settings error:', err);
    const isSecretStorageError = typeof err?.code === 'string' && err.code.startsWith('SETTINGS_');
    return res.status(isSecretStorageError ? 422 : 500).json({
      error: isSecretStorageError ? err.message : 'فشل حفظ إعدادات النظام',
      code: isSecretStorageError ? err.code : undefined,
    });
  }
});

/**
 * POST /api/admin/settings/test-gemini
 * Tests Google Gemini API key
 */
router.post('/settings/test-gemini', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { apiKey } = req.body || {};
    const { getRawSetting } = await import('../services/settingsService');
    const keyToTest = apiKey && !apiKey.includes('****') ? apiKey : (await getRawSetting('GEMINI_API_KEY'));

    if (!keyToTest) {
      return res.json({ success: false, message: 'مفتاح Gemini غير محدد' });
    }

    const startTime = Date.now();
    const resTest = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToTest}`);
    const latencyMs = Date.now() - startTime;

    if (resTest.ok) {
      const modelsData = await resTest.json().catch(() => ({}));
      const modelNames: string[] = (modelsData.models || []).map((m: any) => m.name.replace('models/', ''));
      const activeModern = modelNames.filter((m: string) => m.includes('gemini-3') || m.includes('gemini-2.5'));

      return res.json({
        success: true,
        message: `تم التحقق من مفتاح Gemini بنجاح! النماذج النشطة: ${activeModern.slice(0, 3).join(', ')}`,
        latencyMs,
        activeModels: activeModern,
      });
    }

    const errJson = await resTest.json().catch(() => ({}));
    return res.json({
      success: false,
      message: errJson?.error?.message || `فشل التحقق (${resTest.status})`,
      latencyMs,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/settings/test-openrouter
 * Verifies the key and selected model catalog, then performs a tiny synthetic
 * JSON generation so this checks live inference, not catalog metadata alone.
 */
router.post('/settings/test-openrouter', aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { apiKey, settings: rawOverrides } = req.body || {};
    const { getRawSettings } = await import('../services/settingsService');
    const settings = await getRawSettings([
      'OPENROUTER_API_KEY',
      'OPENROUTER_TEXT_MODEL',
      'OPENROUTER_TEXT_FALLBACK_MODELS',
      'OPENROUTER_MODEL_FALLBACKS_ENABLED',
      'OPENROUTER_ALLOW_PROVIDER_FALLBACKS',
      'OPENROUTER_DATA_COLLECTION',
      'OPENROUTER_FREE_ONLY',
      'OPENROUTER_SITE_URL',
      'OPENROUTER_APP_NAME',
    ]);
    const allowedOverrideKeys = new Set([
      'OPENROUTER_TEXT_MODEL',
      'OPENROUTER_TEXT_FALLBACK_MODELS',
      'OPENROUTER_MODEL_FALLBACKS_ENABLED',
      'OPENROUTER_ALLOW_PROVIDER_FALLBACKS',
      'OPENROUTER_DATA_COLLECTION',
      'OPENROUTER_FREE_ONLY',
      'OPENROUTER_SITE_URL',
      'OPENROUTER_APP_NAME',
    ]);
    const overrides: Record<string, string> = {};
    if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
      for (const [key, value] of Object.entries(rawOverrides)) {
        if (allowedOverrideKeys.has(key) && typeof value === 'string') {
          overrides[key] = value.slice(0, 2000);
        }
      }
    }
    const resolvedSettings = { ...settings, ...overrides };
    const keyToTest = typeof apiKey === 'string' && !apiKey.includes('****')
      ? apiKey.trim().slice(0, 512)
      : resolvedSettings.OPENROUTER_API_KEY;
    const {
      getOpenRouterConfig,
      inspectOpenRouterModels,
      smokeTestOpenRouterGeneration,
    } = await import('../services/openRouterService');
    const config = getOpenRouterConfig(keyToTest, resolvedSettings);
    const catalog = await inspectOpenRouterModels(config);
    if (!catalog.success || !config) {
      return res.json({ ...catalog, generationTested: false });
    }

    const generationStartedAt = Date.now();
    try {
      const generation = await smokeTestOpenRouterGeneration(config);
      return res.json({
        ...catalog,
        success: true,
        message: `نجح الاتصال والتوليد المنظّم باستخدام ${generation.model}.`,
        latencyMs: catalog.latencyMs + generation.latencyMs,
        catalogLatencyMs: catalog.latencyMs,
        generationTested: true,
        generationLatencyMs: generation.latencyMs,
        generationModel: generation.model,
        ...(generation.generationId ? { generationId: generation.generationId } : {}),
      });
    } catch (generationError: any) {
      return res.json({
        ...catalog,
        success: false,
        message: generationError?.message || 'نجح فحص الكتالوج، لكن فشل التوليد الفعلي.',
        latencyMs: catalog.latencyMs + (Date.now() - generationStartedAt),
        catalogLatencyMs: catalog.latencyMs,
        generationTested: true,
        generationLatencyMs: Date.now() - generationStartedAt,
        ...(generationError?.code ? { generationErrorCode: String(generationError.code).slice(0, 100) } : {}),
        ...(Number.isInteger(generationError?.status) ? { generationHttpStatus: generationError.status } : {}),
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message || 'حدث خطأ أثناء فحص OpenRouter' });
  }
});

/**
 * POST /api/admin/settings/test-pexels
 * Tests Pexels API key
 */
router.post('/settings/test-pexels', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { apiKey } = req.body || {};
    const { getRawSetting } = await import('../services/settingsService');
    const keyToTest = apiKey && !apiKey.includes('****') ? apiKey : (await getRawSetting('PEXELS_API_KEY'));

    if (!keyToTest) {
      return res.json({ success: false, message: 'مفتاح Pexels غير محدد' });
    }

    const startTime = Date.now();
    const resTest = await fetch('https://api.pexels.com/videos/popular?per_page=1', {
      headers: { Authorization: keyToTest },
    });
    const latencyMs = Date.now() - startTime;

    if (resTest.ok) {
      return res.json({
        success: true,
        message: 'تم التحقق من مفتاح Pexels بنجاح',
        latencyMs,
      });
    }

    return res.json({
      success: false,
      message: `فشل التحقق من مفتاح Pexels (${resTest.status})`,
      latencyMs,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Recursive disk size helper
function getDirSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    }
  } catch {
    // Render statistics are best effort; an inaccessible optional output path
    // must not prevent the administrative dashboard from loading.
  }
  return total;
}

/**
 * GET /api/admin/render-stats
 * Returns live overview of render queue, today's jobs, storage size, and policies.
 */
router.get('/render-stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [counts] = await query<any[]>(
      `SELECT 
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'succeeded' AND created_at >= CURDATE() THEN 1 ELSE 0 END) as succeededToday,
        SUM(CASE WHEN status = 'failed' AND created_at >= CURDATE() THEN 1 ELSE 0 END) as failedToday
       FROM render_jobs`
    );

    const storageDir = path.resolve(process.cwd(), process.env.RENDER_STORAGE_DIR || 'uploads/renders');
    const diskBytes = getDirSizeBytes(storageDir);
    const diskUsageMb = Math.round((diskBytes / (1024 * 1024)) * 100) / 100;
    const engineCapacity = await query<any[]>(
      'SELECT engine, replicas, slots_per_replica, waiting_jobs, active_jobs, updated_at FROM render_engine_capacity ORDER BY engine',
    ).catch(() => []);
    const queueByEngine = await query<any[]>(
      `SELECT engine,
              SUM(status = 'queued') AS waiting,
              SUM(status = 'running') AS active,
              MAX(CASE WHEN status = 'queued' THEN TIMESTAMPDIFF(SECOND, created_at, NOW()) ELSE 0 END) AS oldestWaitingSeconds,
              SUM(status = 'failed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)) AS failures15m,
              SUM(status IN ('failed', 'succeeded') AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)) AS terminal15m
       FROM render_jobs
       GROUP BY engine
       ORDER BY engine`,
    ).catch(() => []);
    const maxConcurrency = engineCapacity.reduce((sum, row) => sum + Number(row.replicas || 0) * Number(row.slots_per_replica || 0), 0);

    return res.json({
      queued: Number(counts?.queued || 0),
      running: Number(counts?.running || 0),
      succeededToday: Number(counts?.succeededToday || 0),
      failedToday: Number(counts?.failedToday || 0),
      maxConcurrency,
      engineCapacity,
      queueByEngine,
      retentionHours: 48,
      diskUsageMb,
      storageDir,
    });
  } catch (err: any) {
    console.error('Fetch render stats error:', err);
    return res.status(500).json({ error: 'فشل استرجاع إحصائيات الريندر' });
  }
});

/**
 * POST /api/admin/render-jobs/cleanup
 * Manually triggers the garbage collector to purge all expired videos and failed artifacts immediately.
 */
router.post('/render-jobs/cleanup', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await renderJobQueue.cleanupExpiredRenders();
    const storageDir = path.resolve(process.cwd(), process.env.RENDER_STORAGE_DIR || 'uploads/renders');
    const diskBytes = getDirSizeBytes(storageDir);
    const diskUsageMb = Math.round((diskBytes / (1024 * 1024)) * 100) / 100;

    return res.json({
      success: true,
      message: 'تم فحص وتنظيف جميع الفيديوهات المنتهية والملفات المؤقتة بنجاح',
      currentDiskUsageMb: diskUsageMb,
    });
  } catch (err: any) {
    console.error('Manual render cleanup error:', err);
    return res.status(500).json({ success: false, message: err.message || 'فشل تنظيف ملفات الريندر' });
  }
});

export default router;

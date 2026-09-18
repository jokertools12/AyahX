import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, transaction } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { getPlanEntitlements, isPremiumPlan } from '../../shared/planEntitlements';
import {
  getActivePlanForUser,
  getTodayCloudRenderCount,
  syncExpiredSubscriptions,
} from '../services/subscriptionService';
import { SUBSCRIPTION_CATALOG, isCheckoutPlan, isWalletMethod } from '../../shared/subscriptionCatalog';

const router = Router();

// 1. Get current subscription
router.get('/current', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await syncExpiredSubscriptions(userId);

    const subs = await query<any[]>(
      `SELECT * FROM subscriptions
       WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (subs.length === 0) {
      // Default to free
      return res.json({
        id: 'free',
        user_id: userId,
        plan: 'free',
        status: 'active',
        starts_at: new Date().toISOString(),
        expires_at: null,
      });
    }

    return res.json(subs[0]);
  } catch (err: any) {
    console.error('Fetch subscription error:', err);
    return res.status(500).json({ error: 'فشل استرجاع بيانات الاشتراك' });
  }
});

// 2. Get daily usage
router.get('/usage', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await syncExpiredSubscriptions(userId);
    const plan = await getActivePlanForUser(userId);
    const entitlements = getPlanEntitlements(plan);
    const isPremium = isPremiumPlan(plan);

    const usage = await query<any[]>(
      `SELECT count
       FROM daily_video_usage
       WHERE user_id = ? AND date = CURDATE()
       LIMIT 1`,
      [userId],
    );
    const browserRenderCount = Number(usage[0]?.count || 0);
    const browserRenderLimit = entitlements.browserDailyLimit;
    const browserRenderRemaining = browserRenderLimit === null
      ? null
      : Math.max(0, browserRenderLimit - browserRenderCount);

    const serverRenderCount = await getTodayCloudRenderCount(userId);
    const serverRenderLimit = entitlements.cloudDailyLimit;
    const serverRenderRemaining = Math.max(0, serverRenderLimit - serverRenderCount);

    return res.json({
      plan,
      isPremium,
      // Legacy aliases retained for existing clients. They now represent Browser Canvas usage.
      count: browserRenderCount,
      limit: browserRenderLimit,
      browserRenderCount,
      browserRenderLimit,
      browserRenderRemaining,
      cloudRenderCount: serverRenderCount,
      cloudRenderLimit: serverRenderLimit,
      cloudRenderRemaining: serverRenderRemaining,
      serverRenderLimit,
      serverRenderCount,
      serverRenderRemaining,
    });
  } catch (err: any) {
    console.error('Fetch usage error:', err);
    return res.status(500).json({ error: 'فشل استرجاع بيانات الاستخدام اليومي' });
  }
});

// 3. Increment daily usage (Atomic with FOR UPDATE and ON DUPLICATE KEY)
router.post('/usage/increment', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await syncExpiredSubscriptions(userId);
    const plan = await getActivePlanForUser(userId);
    const entitlements = getPlanEntitlements(plan);
    const limit = entitlements.browserDailyLimit;

    // A per-user/day row is created before locking. This makes the check + increment
    // serializable even when two tabs begin a Browser Canvas export simultaneously.
    const result = await transaction(async (conn) => {
      await conn.query(
        `INSERT INTO daily_video_usage (id, user_id, date, count)
         VALUES (UUID(), ?, CURDATE(), 0)
         ON DUPLICATE KEY UPDATE id = id`,
        [userId],
      );
      const [rows] = await conn.query<any[]>(
        'SELECT id, count FROM daily_video_usage WHERE user_id = ? AND date = CURDATE() FOR UPDATE',
        [userId],
      );

      const currentCount = rows[0]?.count || 0;
      if (limit !== null && currentCount >= limit) {
        return { allowed: false, count: currentCount };
      }

      await conn.query('UPDATE daily_video_usage SET count = count + 1 WHERE id = ?', [rows[0].id]);

      return { allowed: true, count: currentCount + 1 };
    });

    if (!result.allowed) {
      return res.status(403).json({
        error: 'لقد وصلت للحد اليومي لإنشاء الفيديوهات. يرجى الترقية للمتابعة.',
        count: result.count,
        limit,
      });
    }

    return res.json({
      success: true,
      count: result.count,
      limit,
      browserRenderCount: result.count,
      browserRenderLimit: limit,
      browserRenderRemaining: limit === null ? null : Math.max(0, limit - result.count),
    });
  } catch (err: any) {
    console.error('Increment usage error:', err);
    return res.status(500).json({ error: 'فشل تحديث الاستخدام اليومي' });
  }
});

// 4. Request subscription payment (Robust validation, duplicate prevention)
router.post('/request-payment', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { plan, amount, payment_method, phone_number, transfer_reference } = req.body;

    if (!plan || !payment_method || !phone_number) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    if (!isCheckoutPlan(plan)) {
      return res.status(400).json({ error: 'خطة الاشتراك غير صالحة (يسمح فقط بـ monthly أو yearly)' });
    }
    if (!isWalletMethod(payment_method)) {
      return res.status(400).json({ error: 'طريقة الدفع غير مدعومة' });
    }
    const checkout = SUBSCRIPTION_CATALOG[plan];

    // Amount is canonical on the server. Accepting an arbitrary client amount
    // would let a user request a $96 annual subscription for any value.
    if (amount !== undefined && amount !== null && Number(amount) !== checkout.walletAmountEgp) {
      return res.status(400).json({ error: 'قيمة الدفع لا تطابق الخطة المختارة' });
    }

    // Validate Egyptian wallet phone format
    const cleanPhone = String(phone_number).trim();
    if (!/^01[0-9]{9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'رقم الهاتف غير صالح. يجب أن يكون رقم محفظة إلكترونية صحيح مكون من 11 رقم يبدأ بـ 01' });
    }
    const cleanReference = transfer_reference === undefined || transfer_reference === null || transfer_reference === ''
      ? null
      : String(transfer_reference).trim();
    if (cleanReference && (!/^[A-Za-z0-9._#\-/]{4,100}$/.test(cleanReference))) {
      return res.status(400).json({ error: 'مرجع التحويل غير صالح. استخدم رقم العملية الظاهر في المحفظة.' });
    }

    const id = crypto.randomUUID();
    await transaction(async (conn) => {
      // Lock the user row before looking for a pending request. A simple
      // preflight SELECT is racy: two browser tabs could both observe no
      // request and insert duplicates. This lock serializes checkout attempts
      // for one account while retaining normal concurrency for all others.
      const [userRows] = await conn.query<any[]>(
        'SELECT id FROM users WHERE id = ? FOR UPDATE',
        [userId],
      );
      if (userRows.length === 0) {
        throw new Error('PAYMENT_USER_NOT_FOUND');
      }

      const [existingPending] = await conn.query<any[]>(
        "SELECT id FROM payment_requests WHERE user_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [userId],
      );
      if (existingPending.length > 0) {
        const duplicateError: Error & { existingRequestId?: string } = new Error('PENDING_PAYMENT_EXISTS');
        duplicateError.existingRequestId = existingPending[0].id;
        throw duplicateError;
      }

      await conn.query(
        `INSERT INTO payment_requests (
          id, user_id, plan, amount, currency, payment_method, phone_number, transfer_reference, status
        ) VALUES (?, ?, ?, ?, 'EGP', ?, ?, ?, 'pending')`,
        [id, userId, plan, checkout.walletAmountEgp, payment_method, cleanPhone, cleanReference]
      );

      // Notify user that request is received
      await conn.query(
        'INSERT INTO notifications (id, user_id, title, message, type) VALUES (UUID(), ?, ?, ?, ?)',
        [userId, 'طلب اشتراك جديد', 'تم استلام طلب ترقية حسابك وهو قيد المراجعة حالياً.', 'system']
      );
    });

    return res.status(201).json({
      success: true,
      id,
      amount: checkout.walletAmountEgp,
      currency: 'EGP',
      message: 'تم تسجيل طلب الدفع بنجاح وهو الآن قيد المراجعة.',
    });
  } catch (err: any) {
    if (err.message === 'PENDING_PAYMENT_EXISTS') {
      return res.status(409).json({
        error: 'لديك بالفعل طلب دفع قيد المراجعة. يرجى الانتظار حتى تتم مراجعته من قبل الإدارة.',
        existingRequestId: err.existingRequestId,
      });
    }
    if (err.message === 'PAYMENT_USER_NOT_FOUND') {
      return res.status(401).json({ error: 'تعذر التحقق من حسابك. يرجى تسجيل الدخول مجدداً.' });
    }
    console.error('Request payment error:', err);
    return res.status(500).json({ error: 'فشل تقديم طلب الدفع' });
  }
});

// 5. User's payment history
router.get('/payment-history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const requests = await query<any[]>(
      'SELECT * FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return res.json(requests);
  } catch (err: any) {
    console.error('Fetch payment history error:', err);
    return res.status(500).json({ error: 'فشل استرجاع سجل المدفوعات' });
  }
});

export default router;

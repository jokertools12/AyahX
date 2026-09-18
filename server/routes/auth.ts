import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, transaction } from '../db';
import { AuthenticatedRequest, signToken, requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Register new user
router.post('/register', authRateLimiter, async (req, res: Response) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'صيغة البريد الإلكتروني أو كلمة المرور غير صالحة' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.length > 191) {
      return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صالحة أو الطول يتجاوز الحد المسموح' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
    }

    if (password.length > 72) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تزيد عن 72 حرفاً' });
    }

    // Check if user already exists
    const existing = await query<any[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const profileId = crypto.randomUUID();
    const cleanDisplayName = typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim().slice(0, 100)
      : normalizedEmail.split('@')[0];

    await transaction(async (conn) => {
      // 1. Create User
      await conn.query(
        'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
        [userId, normalizedEmail, passwordHash]
      );

      // 2. Create Profile
      await conn.query(
        'INSERT INTO profiles (id, user_id, display_name) VALUES (?, ?, ?)',
        [profileId, userId, cleanDisplayName]
      );

      // 3. Create Default Free Subscription
      const subId = crypto.randomUUID();
      await conn.query(
        'INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, ?)',
        [subId, userId, 'free', 'active']
      );

      // 4. Default user role
      const roleId = crypto.randomUUID();
      await conn.query(
        'INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)',
        [roleId, userId, 'user']
      );
    });

    const token = signToken({ id: userId, email: normalizedEmail });

    return res.status(201).json({
      token,
      user: {
        id: userId,
        email: normalizedEmail,
        display_name: cleanDisplayName,
        avatar_url: null,
        bio: null,
        role: 'user',
      },
    });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الحساب' });
  }
});

// Login
router.post('/login', authRateLimiter, async (req, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    if (password.length > 72) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const users = await query<any[]>(
      'SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const profiles = await query<any[]>(
      'SELECT display_name, avatar_url, bio FROM profiles WHERE user_id = ? LIMIT 1',
      [user.id]
    );
    const roles = await query<any[]>(
      'SELECT role FROM user_roles WHERE user_id = ? LIMIT 1',
      [user.id]
    );

    const token = signToken({ id: user.id, email: user.email });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: profiles[0]?.display_name || user.email.split('@')[0],
        avatar_url: profiles[0]?.avatar_url || null,
        bio: profiles[0]?.bio || null,
        role: roles[0]?.role || 'user',
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// Get current logged-in user profile
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const profiles = await query<any[]>(
      'SELECT display_name, avatar_url, bio FROM profiles WHERE user_id = ? LIMIT 1',
      [userId]
    );

    return res.json({
      user: {
        id: userId,
        email: req.user!.email,
        display_name: profiles[0]?.display_name || null,
        avatar_url: profiles[0]?.avatar_url || null,
        bio: profiles[0]?.bio || null,
        role: req.user!.role,
      },
    });
  } catch (err: any) {
    console.error('Get me error:', err);
    return res.status(500).json({ error: 'فشل استرجاع بيانات المستخدم' });
  }
});

// Update Profile
router.put('/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { display_name, avatar_url, bio } = req.body;

    const cleanDisplayName = display_name !== undefined ? (typeof display_name === 'string' ? display_name.trim().slice(0, 100) : null) : undefined;
    const cleanBio = bio !== undefined ? (typeof bio === 'string' ? bio.trim().slice(0, 500) : null) : undefined;
    const cleanAvatar = avatar_url !== undefined ? (typeof avatar_url === 'string' ? avatar_url.trim() : null) : undefined;

    // Validate avatar URL protocol (strictly HTTPS, HTTP, or safe image dataURL to prevent javascript: XSS)
    if (cleanAvatar && !/^(https?:\/\/|data:image\/(png|jpeg|webp|gif|svg\+xml);base64,)/i.test(cleanAvatar)) {
      return res.status(400).json({ error: 'رابط الصورة الرمزية غير صالح (يجب أن يكون رابط HTTP/HTTPS آمن)' });
    }

    await query(
      `INSERT INTO profiles (id, user_id, display_name, avatar_url, bio)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(?, display_name),
         avatar_url = COALESCE(?, avatar_url),
         bio = COALESCE(?, bio),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, cleanDisplayName ?? null, cleanAvatar ?? null, cleanBio ?? null, cleanDisplayName ?? null, cleanAvatar ?? null, cleanBio ?? null]
    );

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'فشل تحديث الملف الشخصي' });
  }
});

// Self-service resets require a verified, expiring email token. Until an email
// delivery provider is configured, never accept an email address plus a new
// password as proof of account ownership.
router.post('/reset-password', authRateLimiter, (_req, res: Response) => {
  return res.status(410).json({
    error: 'استعادة كلمة المرور الآمنة غير مفعلة بعد. تواصل مع الدعم للتحقق من ملكية الحساب.',
  });
});

// Change Password (Authenticated user)
router.put('/password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'كلمة المرور الحالية وكلمة المرور الجديدة مطلوبتان' });
    }

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'صيغة كلمة المرور غير صالحة' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' });
    }

    if (newPassword.length > 72) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تزيد عن 72 حرفاً' });
    }

    const users = await query<any[]>(
      'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const match = await bcrypt.compare(currentPassword, users[0].password_hash);
    if (!match) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    return res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (err: any) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'فشل تغيير كلمة المرور' });
  }
});

// Delete Account permanently (Authenticated user, password-verified, cascading data removal)
router.delete('/delete-account', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'يرجى إدخال كلمة المرور لتأكيد حذف الحساب' });
    }

    const users = await query<any[]>(
      'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const match = await bcrypt.compare(password, users[0].password_hash);
    if (!match) {
      return res.status(400).json({ error: 'كلمة المرور غير صحيحة، تعذر حذف الحساب' });
    }

    // Cascades deletion across profiles, saved_videos, video_comments, video_likes, follows, favorites, notifications
    await query('DELETE FROM users WHERE id = ?', [userId]);

    return res.json({
      success: true,
      message: 'تم حذف الحساب وجميع البيانات المرتبطة به بنجاح نهائي'
    });
  } catch (err: any) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'فشل حذف الحساب، يرجى المحاولة لاحقاً' });
  }
});

export default router;

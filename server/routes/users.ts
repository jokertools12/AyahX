import { Router, Response } from 'express';
import { query } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

// 1. Get user profile by userId
router.get('/:id/profile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user?.id || null;

    const profiles = await query<any[]>(
      `SELECT p.*, u.email,
              (SELECT COUNT(*) FROM saved_videos v WHERE v.user_id = p.user_id AND v.is_public = TRUE) as public_videos_count,
              (SELECT COUNT(*) FROM user_follows f WHERE f.following_id = p.user_id) as followers_count,
              (SELECT COUNT(*) FROM user_follows f WHERE f.follower_id = p.user_id) as following_count
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? LIMIT 1`,
      [targetUserId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const isOwnerOrAdmin = currentUserId === targetUserId || req.user?.role === 'admin';
    const profile = {
      ...profiles[0],
      email: isOwnerOrAdmin ? profiles[0].email : undefined,
    };

    let isFollowing = false;

    if (currentUserId && currentUserId !== targetUserId) {
      const follow = await query<any[]>(
        'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
        [currentUserId, targetUserId]
      );
      isFollowing = follow.length > 0;
    }

    return res.json({
      profile,
      isFollowing,
    });
  } catch (err: any) {
    console.error('Fetch profile error:', err);
    return res.status(500).json({ error: 'فشل استرجاع الملف الشخصي' });
  }
});

// 2. Toggle follow (Existence check, idempotent race handling)
router.post('/:id/follow/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const followerId = req.user!.id;
    const followingId = req.params.id;

    if (followerId === followingId) {
      return res.status(400).json({ error: 'لا يمكنك متابعة نفسك' });
    }

    // Verify target user exists
    const targetUser = await query<any[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [followingId]);
    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'المستخدم المراد متابعته غير موجود' });
    }

    const existing = await query<any[]>(
      'SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
      [followerId, followingId]
    );

    let isFollowing = false;
    if (existing.length > 0) {
      await query('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?', [followerId, followingId]);
      isFollowing = false;
    } else {
      try {
        await query(
          'INSERT INTO user_follows (id, follower_id, following_id) VALUES (UUID(), ?, ?)',
          [followerId, followingId]
        );
        isFollowing = true;

        // Add notification for the followed user (de-duplicate unread notification to prevent spamming)
        const followerProfile = await query<any[]>('SELECT display_name FROM profiles WHERE user_id = ?', [followerId]);
        const followerName = followerProfile[0]?.display_name || 'مستخدم';
        const notifTitle = 'متابع جديد';
        const notifMsg = `بدأ ${followerName} بمتابعتك`;

        const existingNotif = await query<any[]>(
          "SELECT id FROM notifications WHERE user_id = ? AND type = 'social' AND message = ? AND is_read = FALSE LIMIT 1",
          [followingId, notifMsg]
        );

        if (existingNotif.length === 0) {
          await query(
            'INSERT INTO notifications (id, user_id, title, message, type) VALUES (UUID(), ?, ?, ?, ?)',
            [followingId, notifTitle, notifMsg, 'social']
          );
        }
      } catch (insertErr: any) {
        if (insertErr.code === 'ER_DUP_ENTRY') {
          isFollowing = true;
        } else {
          throw insertErr;
        }
      }
    }

    const counts = await query<any[]>(
      'SELECT COUNT(*) as count FROM user_follows WHERE following_id = ?',
      [followingId]
    );

    return res.json({
      isFollowing,
      followersCount: counts[0]?.count || 0,
    });
  } catch (err: any) {
    console.error('Toggle follow error:', err);
    return res.status(500).json({ error: 'فشل تحديث المتابعة' });
  }
});

// 3. Get user favorites
router.get('/me/favorites', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [surahs, reciters, performers] = await Promise.all([
      query<any[]>('SELECT surah_number FROM favorite_surahs WHERE user_id = ?', [userId]),
      query<any[]>('SELECT reciter_id FROM favorite_reciters WHERE user_id = ?', [userId]),
      query<any[]>('SELECT performer_id FROM favorite_performers WHERE user_id = ?', [userId]),
    ]);

    return res.json({
      surahs: surahs.map((s) => s.surah_number),
      reciters: reciters.map((r) => r.reciter_id),
      performers: performers.map((p) => p.performer_id),
    });
  } catch (err: any) {
    console.error('Fetch favorites error:', err);
    return res.status(500).json({ error: 'فشل استرجاع التفضيلات' });
  }
});

type FavoriteTable = 'favorite_surahs' | 'favorite_reciters' | 'favorite_performers';
type FavoriteColumn = 'surah_number' | 'reciter_id' | 'performer_id';

/**
 * Reusable helper for toggling user favorites across entities (Surahs, Reciters, Performers)
 * Enforces atomic lookup, delete or insert with ER_DUP_ENTRY idempotency.
 */
export async function toggleUserFavorite(
  table: FavoriteTable,
  column: FavoriteColumn,
  userId: string,
  entityId: string | number
): Promise<boolean> {
  const existing = await query<any[]>(
    `SELECT id FROM ${table} WHERE user_id = ? AND ${column} = ? LIMIT 1`,
    [userId, entityId]
  );

  if (existing.length > 0) {
    await query(`DELETE FROM ${table} WHERE user_id = ? AND ${column} = ?`, [userId, entityId]);
    return false;
  }

  try {
    await query(
      `INSERT INTO ${table} (id, user_id, ${column}) VALUES (UUID(), ?, ?)`,
      [userId, entityId]
    );
    return true;
  } catch (insertErr: any) {
    if (insertErr.code === 'ER_DUP_ENTRY') {
      return true;
    }
    throw insertErr;
  }
}

// 4. Toggle favorite surah (Boundary check 1-114 and idempotent)
router.post('/me/favorites/surah/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { surah_number } = req.body;
    const surahNum = parseInt(surah_number, 10);
    if (isNaN(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({ error: 'رقم السورة غير صالح (يجب أن يكون بين 1 و 114)' });
    }

    const isFavorite = await toggleUserFavorite('favorite_surahs', 'surah_number', userId, surahNum);
    return res.json({ isFavorite });
  } catch (err: any) {
    console.error('Toggle favorite surah error:', err);
    return res.status(500).json({ error: 'فشل تحديث السورة المفضلة' });
  }
});

// 5. Toggle favorite reciter (Idempotent and sanitized)
router.post('/me/favorites/reciter/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { reciter_id } = req.body;
    if (!reciter_id || typeof reciter_id !== 'string' || !reciter_id.trim()) {
      return res.status(400).json({ error: 'reciter_id مطلوب' });
    }
    const cleanReciterId = reciter_id.trim().slice(0, 100);

    const isFavorite = await toggleUserFavorite('favorite_reciters', 'reciter_id', userId, cleanReciterId);
    return res.json({ isFavorite });
  } catch (err: any) {
    console.error('Toggle favorite reciter error:', err);
    return res.status(500).json({ error: 'فشل تحديث القارئ المفضل' });
  }
});

// 6. Toggle favorite performer (Idempotent and sanitized)
router.post('/me/favorites/performer/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { performer_id } = req.body;
    if (!performer_id || typeof performer_id !== 'string' || !performer_id.trim()) {
      return res.status(400).json({ error: 'performer_id مطلوب' });
    }
    const cleanPerformerId = performer_id.trim().slice(0, 100);

    const isFavorite = await toggleUserFavorite('favorite_performers', 'performer_id', userId, cleanPerformerId);
    return res.json({ isFavorite });
  } catch (err: any) {
    console.error('Toggle favorite performer error:', err);
    return res.status(500).json({ error: 'فشل تحديث المنشد المفضل' });
  }
});

export default router;

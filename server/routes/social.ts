import { Router, Response } from 'express';
import { query } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

// 1. Activity Feed
router.get('/feed', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    let videos: any[] = [];
    let achievements: any[] = [];
    let followingCount = 0;

    if (userId) {
      const followCountRes = await query<any[]>(
        'SELECT COUNT(*) as count FROM user_follows WHERE follower_id = ?',
        [userId]
      );
      followingCount = followCountRes[0]?.count || 0;

      if (followingCount > 0) {
        // Direct join with user_follows executes in parallel and eliminates massive IN parameter arrays
        [videos, achievements] = await Promise.all([
          query<any[]>(
            `SELECT 'video' as type, v.id, v.created_at, v.surah_name, v.reciter_name, v.start_ayah, v.end_ayah,
                    v.user_id, p.display_name, p.avatar_url
             FROM saved_videos v
             JOIN profiles p ON p.user_id = v.user_id
             JOIN user_follows uf ON uf.following_id = v.user_id AND uf.follower_id = ?
             WHERE v.is_public = TRUE
             ORDER BY v.created_at DESC LIMIT 20`,
            [userId]
          ),
          query<any[]>(
            `SELECT 'achievement' as type, ua.id, ua.unlocked_at as created_at, a.title, a.icon,
                    ua.user_id, p.display_name, p.avatar_url
             FROM user_achievements ua
             JOIN achievements a ON a.id = ua.achievement_id
             JOIN profiles p ON p.user_id = ua.user_id
             JOIN user_follows uf ON uf.following_id = ua.user_id AND uf.follower_id = ?
             ORDER BY ua.unlocked_at DESC LIMIT 10`,
            [userId]
          ),
        ]);
      }
    }

    if (videos.length === 0) {
      // Fallback to recent public videos from any user
      videos = await query<any[]>(
        `SELECT 'video' as type, v.id, v.created_at, v.surah_name, v.reciter_name, v.start_ayah, v.end_ayah,
                v.user_id, p.display_name, p.avatar_url
         FROM saved_videos v
         JOIN profiles p ON p.user_id = v.user_id
         WHERE v.is_public = TRUE
         ORDER BY v.created_at DESC LIMIT 20`
      );
    }

    const items = [
      ...videos.map(v => ({
        id: `video-${v.id}`,
        type: 'video',
        user_id: v.user_id,
        display_name: v.display_name,
        avatar_url: v.avatar_url,
        created_at: v.created_at,
        data: {
          surah_name: v.surah_name,
          reciter_name: v.reciter_name,
          start_ayah: v.start_ayah,
          end_ayah: v.end_ayah,
        },
      })),
      ...achievements.map(a => ({
        id: `achievement-${a.id}`,
        type: 'achievement',
        user_id: a.user_id,
        display_name: a.display_name,
        avatar_url: a.avatar_url,
        created_at: a.created_at,
        data: {
          title: a.title,
          icon: a.icon,
        },
      })),
    ];

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({
      followingCount,
      activities: items.slice(0, 30),
    });
  } catch (err: any) {
    console.error('Fetch feed error:', err);
    return res.status(500).json({ error: 'فشل استرجاع خلاصة النشاط' });
  }
});

// 2. Notifications
router.get('/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const offset = Math.min(100000, Math.max(0, Math.floor(Number(req.query.offset) || 0)));
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit) || 30)));
    const notifications = await query<any[]>(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
    return res.json(notifications);
  } catch (err: any) {
    console.error('Fetch notifications error:', err);
    return res.status(500).json({ error: 'فشل استرجاع الإشعارات' });
  }
});

// 3. Mark notification as read
router.put('/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    await query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [id, userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Mark notification read error:', err);
    return res.status(500).json({ error: 'فشل تحديث الإشعار' });
  }
});

// 4. Mark all notifications as read
router.put('/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    await query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [userId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Mark all read error:', err);
    return res.status(500).json({ error: 'فشل تحديث الإشعارات' });
  }
});

export default router;

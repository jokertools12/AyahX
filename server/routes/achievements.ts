import { Router, Response } from 'express';
import { query, transaction } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

// In-memory caches with TTL to eliminate repetitive heavy multi-table aggregations
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let cachedAchievementsList: CacheEntry<any[]> | null = null;
let cachedLeaderboard: CacheEntry<any[]> | null = null;
const ACHIEVEMENTS_LIST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LEADERBOARD_TTL_MS = 60 * 1000; // 60 seconds

export function invalidateLeaderboardCache() {
  cachedLeaderboard = null;
}

// 1. Get all available achievements (Cached)
router.get('/', async (_req, res: Response) => {
  try {
    const now = Date.now();
    if (cachedAchievementsList && now - cachedAchievementsList.timestamp < ACHIEVEMENTS_LIST_TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return res.json(cachedAchievementsList.data);
    }

    const list = await query<any[]>('SELECT * FROM achievements ORDER BY category, points ASC');
    cachedAchievementsList = { data: list, timestamp: now };

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json(list);
  } catch (err: any) {
    console.error('Fetch achievements error:', err);
    return res.status(500).json({ error: 'فشل استرجاع قائمة الإنجازات' });
  }
});

// 2. Get user's unlocked achievements
router.get('/my', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const unlocked = await query<any[]>(
      `SELECT ua.id, ua.achievement_id, ua.unlocked_at,
              a.key, a.title, a.description, a.icon, a.points, a.category
       FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = ?
       ORDER BY ua.unlocked_at DESC`,
      [userId]
    );

    return res.json(unlocked);
  } catch (err: any) {
    console.error('Fetch my achievements error:', err);
    return res.status(500).json({ error: 'فشل استرجاع إنجازات المستخدم' });
  }
});

// 3. Unlock achievement (Optimized: O(1) memory DB aggregations)
router.post('/unlock', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'مفتاح الإنجاز مطلوب' });

    const ach = await query<any[]>('SELECT id, title, points, threshold FROM achievements WHERE `key` = ? LIMIT 1', [key]);
    if (ach.length === 0) {
      return res.status(404).json({ error: 'الإنجاز غير موجود' });
    }

    const achievement = ach[0];

    // Check if already unlocked
    const existing = await query<any[]>(
      'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ? LIMIT 1',
      [userId, achievement.id]
    );

    if (existing.length > 0) {
      return res.json({ alreadyUnlocked: true });
    }

    // Database-level aggregations: transfers 4 numbers instead of loading thousands of row objects into Node RAM
    const [videoStats, favCounts] = await Promise.all([
      query<any[]>(
        `SELECT COUNT(*) as video_count,
                COUNT(DISTINCT reciter_name) as unique_reciters,
                COUNT(DISTINCT surah_name) as unique_surahs
         FROM saved_videos WHERE user_id = ?`,
        [userId]
      ),
      query<any[]>(
        `SELECT (SELECT COUNT(*) FROM favorite_surahs WHERE user_id = ?) +
                (SELECT COUNT(*) FROM favorite_reciters WHERE user_id = ?) +
                (SELECT COUNT(*) FROM favorite_performers WHERE user_id = ?) as total_favs`,
        [userId, userId, userId]
      ),
    ]);

    const videoCount = parseInt(videoStats[0]?.video_count, 10) || 0;
    const uniqueReciters = parseInt(videoStats[0]?.unique_reciters, 10) || 0;
    const uniqueSurahs = parseInt(videoStats[0]?.unique_surahs, 10) || 0;
    const totalFavs = parseInt(favCounts[0]?.total_favs, 10) || 0;

    const statsMap: Record<string, number> = {
      first_video: videoCount,
      five_videos: videoCount,
      twenty_videos: videoCount,
      fifty_videos: videoCount,
      hundred_videos: videoCount,
      first_favorite: totalFavs,
      five_favorites: totalFavs,
      five_reciters: uniqueReciters,
      ten_surahs: uniqueSurahs,
    };

    const currentValue = statsMap[key];
    if (currentValue !== undefined && currentValue < (achievement.threshold || 1)) {
      return res.status(403).json({ error: 'لم تستوفِ شروط هذا الإنجاز بعد' });
    }

    const result = await transaction(async (conn) => {
      // Check if already unlocked inside transaction
      const [existingRows] = await conn.query<any[]>(
        'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ? LIMIT 1',
        [userId, achievement.id]
      );

      if (existingRows.length > 0) {
        return { alreadyUnlocked: true };
      }

      try {
        await conn.query(
          'INSERT INTO user_achievements (id, user_id, achievement_id) VALUES (UUID(), ?, ?)',
          [userId, achievement.id]
        );
      } catch (insertErr: any) {
        if (insertErr.code === 'ER_DUP_ENTRY' || insertErr.errno === 1062) {
          return { alreadyUnlocked: true };
        }
        throw insertErr;
      }

      // Send notification atomically with achievement record
      await conn.query(
        'INSERT INTO notifications (id, user_id, title, message, type) VALUES (UUID(), ?, ?, ?, ?)',
        [userId, 'إنجاز جديد مكتمل! 🏆', `تهانينا! لقد حصلت على وسام: ${achievement.title} (+${achievement.points} نقطة)`, 'achievement']
      );

      return { success: true, achievement };
    });

    if (result.success) {
      // Invalidate leaderboard cache only when new achievement points are actually unlocked
      invalidateLeaderboardCache();
    }

    return res.json(result);
  } catch (err: any) {
    console.error('Unlock achievement error:', err);
    return res.status(500).json({ error: 'فشل فتح الإنجاز' });
  }
});

// 4. Leaderboard (Optimized with 60s in-memory TTL caching and HTTP caching headers)
router.get('/leaderboard', async (_req, res: Response) => {
  try {
    const now = Date.now();
    if (cachedLeaderboard && now - cachedLeaderboard.timestamp < LEADERBOARD_TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      return res.json(cachedLeaderboard.data);
    }

    const creators = await query<any[]>(
      `SELECT p.user_id, p.display_name, p.avatar_url, p.bio,
              COALESCE(v.videos_count, 0) as videos_count,
              COALESCE(v.total_likes, 0) as total_likes,
              COALESCE(ach.total_points, 0) as total_points
       FROM profiles p
       LEFT JOIN (
         SELECT sv.user_id,
                COUNT(DISTINCT sv.id) as videos_count,
                COUNT(DISTINCT l.id) as total_likes
         FROM saved_videos sv
         LEFT JOIN video_likes l ON l.video_id = sv.id
         WHERE sv.is_public = TRUE
         GROUP BY sv.user_id
       ) v ON v.user_id = p.user_id
       LEFT JOIN (
         SELECT ua.user_id,
                SUM(a.points) as total_points
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         GROUP BY ua.user_id
       ) ach ON ach.user_id = p.user_id
       ORDER BY total_points DESC, total_likes DESC, videos_count DESC
       LIMIT 50`
    );

    cachedLeaderboard = { data: creators, timestamp: now };
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.json(creators);
  } catch (err: any) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'فشل استرجاع لوحة المتصدرين' });
  }
});

export default router;

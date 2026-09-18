import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { videoCreationLimiter } from '../middleware/rateLimiter';

/**
 * Canonical surah verse counts (1..114) for backend data validation and range enforcement
 */
export const SURAH_AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
  123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
  15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
  5, 4, 5, 6,
];

const router = Router();


// 1. Get all public videos (for Discover / Browse)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id || null;
    const { surah, reciter, search, userId } = req.query;
    const params: any[] = [];

    let isLikedSelect = '0 as is_liked';
    if (currentUserId) {
      isLikedSelect = '(SELECT COUNT(*) > 0 FROM video_likes vl WHERE vl.video_id = v.id AND vl.user_id = ?) as is_liked';
      params.push(currentUserId);
    }

    let sql = `
      SELECT v.*, p.display_name, p.avatar_url,
             (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) as likes_count,
             (SELECT COUNT(*) FROM video_comments c WHERE c.video_id = v.id) as comments_count,
             ${isLikedSelect}
      FROM saved_videos v
      LEFT JOIN profiles p ON p.user_id = v.user_id
      WHERE 1=1
    `;

    if (userId) {
      sql += ' AND v.user_id = ?';
      params.push(userId);
      // IDOR / BOLA Prevention: Non-owners and non-admins may only view public videos
      if (currentUserId !== userId && req.user?.role !== 'admin') {
        sql += ' AND v.is_public = TRUE';
      }
    } else {
      sql += ' AND v.is_public = TRUE';
    }

    if (surah) {
      sql += ' AND v.surah_number = ?';
      params.push(parseInt(surah as string, 10));
    }

    if (reciter) {
      sql += ' AND (v.reciter_id = ? OR v.reciter_name LIKE ?)';
      params.push(reciter, `%${reciter}%`);
    }

    if (search) {
      sql += ' AND (v.surah_name LIKE ? OR v.reciter_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const offset = (page - 1) * limit;

    sql += ' ORDER BY v.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const videos = await query<any[]>(sql, params);
    return res.json(videos);
  } catch (err: any) {
    console.error('Fetch videos error:', err);
    return res.status(500).json({ error: 'فشل استرجاع الفيديوهات' });
  }
});

// 2. Get user's own saved videos (for Library - Paginated & Bounded)
router.get('/my', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const offset = (page - 1) * limit;

    const videos = await query<any[]>(
      `SELECT v.*,
              (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) as likes_count,
              (SELECT COUNT(*) FROM video_comments c WHERE c.video_id = v.id) as comments_count
       FROM saved_videos v
       WHERE v.user_id = ?
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    return res.json(videos);
  } catch (err: any) {
    console.error('Fetch my videos error:', err);
    return res.status(500).json({ error: 'فشل استرجاع مكتبة الفيديوهات' });
  }
});

// 3. Get single video details
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const currentUserId = req.user?.id || null;

    const videos = await query<any[]>(
      `SELECT v.*, p.display_name, p.avatar_url, p.bio,
              (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) as likes_count
       FROM saved_videos v
       LEFT JOIN profiles p ON p.user_id = v.user_id
       WHERE v.id = ? LIMIT 1`,
      [videoId]
    );

    if (videos.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    const video = videos[0];

    // IDOR / Privacy Guard: Non-owners and non-admins cannot access private videos
    if (!video.is_public && video.user_id !== currentUserId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'هذا الفيديو خاص ولا يمكن عرضه' });
    }

    let isLiked = false;

    if (currentUserId) {
      const userLike = await query<any[]>(
        'SELECT id FROM video_likes WHERE video_id = ? AND user_id = ? LIMIT 1',
        [videoId, currentUserId]
      );
      isLiked = userLike.length > 0;
    }

    return res.json({
      video,
      likesCount: video.likes_count || 0,
      isLiked,
    });
  } catch (err: any) {
    console.error('Fetch video detail error:', err);
    return res.status(500).json({ error: 'فشل استرجاع تفاصيل الفيديو' });
  }
});

// 4. Save a completed video project. Browser Canvas quota is claimed when an
// export starts, not when a user saves the already-created result to a library.
router.post('/', requireAuth, videoCreationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      surah_name,
      surah_number,
      start_ayah,
      end_ayah,
      reciter_id,
      reciter_name,
      video_url,
      thumbnail_url,
      aspect_ratio,
      background_type,
      is_public,
    } = req.body;

    // Determine mode: Ibtahalat tracks explicitly use surah_number: 0 or reciter_id: 'ibtahalat'
    const rawSurah = parseInt(surah_number, 10);
    const isIbtahalat = rawSurah === 0 || reciter_id === 'ibtahalat';

    let numSurah = 0;
    let startAyah = 0;
    let endAyah = 0;

    if (isIbtahalat) {
      numSurah = 0;
      startAyah = 0;
      endAyah = 0;
    } else {
      numSurah = Math.min(114, Math.max(1, Number.isNaN(rawSurah) ? 1 : rawSurah));
      const maxAyahsInSurah = SURAH_AYAH_COUNTS[numSurah - 1];
      const parsedStart = parseInt(start_ayah, 10);
      const parsedEnd = parseInt(end_ayah, 10);

      startAyah = Math.min(maxAyahsInSurah, Math.max(1, Number.isNaN(parsedStart) ? 1 : parsedStart));
      endAyah = Math.min(maxAyahsInSurah, Math.max(startAyah, Number.isNaN(parsedEnd) ? startAyah : parsedEnd));
    }

    const validAspectRatios = ['9:16', '16:9', '1:1'];
    const validRatio = validAspectRatios.includes(aspect_ratio) ? aspect_ratio : '9:16';
    const cleanSurahName = typeof surah_name === 'string' ? surah_name.trim().slice(0, 100) : (isIbtahalat ? 'ابتهال' : 'سورة');
    const cleanReciterName = typeof reciter_name === 'string' ? reciter_name.trim().slice(0, 100) : (isIbtahalat ? 'منشد' : 'قارئ');
    const cleanReciterId = typeof reciter_id === 'string' ? reciter_id.trim().slice(0, 100) : (isIbtahalat ? 'ibtahalat' : 'default');

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO saved_videos (
        id, user_id, surah_name, surah_number, start_ayah, end_ayah,
        reciter_id, reciter_name, video_url, thumbnail_url,
        aspect_ratio, background_type, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        cleanSurahName,
        numSurah,
        startAyah,
        endAyah,
        cleanReciterId,
        cleanReciterName,
        video_url || null,
        thumbnail_url || null,
        validRatio,
        background_type || 'color',
        is_public === true || is_public === 1 ? 1 : 0,
      ],
    );

    const [createdVideo] = await query<any[]>('SELECT * FROM saved_videos WHERE id = ? LIMIT 1', [id]);
    return res.status(201).json(createdVideo);
  } catch (err: any) {
    console.error('Create video error:', err);
    return res.status(500).json({ error: 'فشل حفظ الفيديو' });
  }
});

// 5. Delete video
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const video = await query<any[]>('SELECT user_id FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    if (video.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    if (video[0].user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'غير مصرح بحذف هذا الفيديو' });
    }

    await query('DELETE FROM saved_videos WHERE id = ?', [videoId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Delete video error:', err);
    return res.status(500).json({ error: 'فشل حذف الفيديو' });
  }
});

// 5b. Update / Rename video
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const { surah_name, is_public } = req.body;

    const videos = await query<any[]>('SELECT * FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    if (videos.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    if (videos[0].user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'غير مصرح بتعديل هذا الفيديو' });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (typeof surah_name === 'string' && surah_name.trim().length > 0) {
      updates.push('surah_name = ?');
      params.push(surah_name.trim().slice(0, 100));
    }

    if (typeof is_public === 'boolean') {
      updates.push('is_public = ?');
      params.push(is_public);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لا توجد بيانات صالحة للتعديل' });
    }

    params.push(videoId);
    await query(`UPDATE saved_videos SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await query<any[]>('SELECT * FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    return res.json(updated);
  } catch (err: any) {
    console.error('Update video error:', err);
    return res.status(500).json({ error: 'فشل تحديث بيانات الفيديو' });
  }
});

// 5c. Duplicate video project
router.post('/:id/duplicate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const videos = await query<any[]>('SELECT * FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    if (videos.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    const original = videos[0];
    if (original.user_id !== userId && !original.is_public && !isAdmin) {
      return res.status(403).json({ error: 'غير مصرح بنسخ هذا الفيديو الخاص' });
    }

    const newId = crypto.randomUUID();
    const clonedName = `${original.surah_name} (نسخة)`.slice(0, 100);

    await query(
      `INSERT INTO saved_videos (
        id, user_id, surah_name, surah_number, start_ayah, end_ayah,
        reciter_id, reciter_name, video_url, thumbnail_url, aspect_ratio,
        background_type, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        userId,
        clonedName,
        original.surah_number,
        original.start_ayah,
        original.end_ayah,
        original.reciter_id,
        original.reciter_name,
        original.video_url,
        original.thumbnail_url,
        original.aspect_ratio,
        original.background_type,
        false // Cloned project starts private by default
      ]
    );

    const [cloned] = await query<any[]>('SELECT * FROM saved_videos WHERE id = ? LIMIT 1', [newId]);
    return res.status(201).json(cloned);
  } catch (err: any) {
    console.error('Duplicate video error:', err);
    return res.status(500).json({ error: 'فشل تكرار الفيديو' });
  }
});

// 6. Comments for a video (Threaded)
router.get('/:id/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const comments = await query<any[]>(
      `SELECT c.id, c.video_id, c.user_id, c.parent_id, c.content, c.created_at,
              p.display_name, p.avatar_url
       FROM video_comments c
       LEFT JOIN profiles p ON p.user_id = c.user_id
       WHERE c.video_id = ?
       ORDER BY c.created_at ASC`,
      [videoId]
    );

    return res.json(comments);
  } catch (err: any) {
    console.error('Fetch comments error:', err);
    return res.status(500).json({ error: 'فشل استرجاع التعليقات' });
  }
});

// 7. Add Comment (Existence check, parent validation, length bound)
router.post('/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;
    const { content, parent_id } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'نص التعليق لا يمكن أن يكون فارغاً' });
    }

    const cleanContent = content.trim();
    if (cleanContent.length > 1000) {
      return res.status(400).json({ error: 'نص التعليق يجب ألا يتجاوز 1000 حرف' });
    }

    // Verify video exists
    const videoCheck = await query<any[]>('SELECT id FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    if (videoCheck.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    // Verify parent comment if nested reply
    if (parent_id) {
      const parentCheck = await query<any[]>(
        'SELECT id FROM video_comments WHERE id = ? AND video_id = ? LIMIT 1',
        [parent_id, videoId]
      );
      if (parentCheck.length === 0) {
        return res.status(400).json({ error: 'التعليق الأصلي غير موجود أو لا ينتمي لهذا الفيديو' });
      }
    }

    const commentId = crypto.randomUUID();
    await query(
      'INSERT INTO video_comments (id, video_id, user_id, parent_id, content) VALUES (?, ?, ?, ?, ?)',
      [commentId, videoId, userId, parent_id || null, cleanContent]
    );

    const created = await query<any[]>(
      `SELECT c.id, c.video_id, c.user_id, c.parent_id, c.content, c.created_at,
              p.display_name, p.avatar_url
       FROM video_comments c
       LEFT JOIN profiles p ON p.user_id = c.user_id
       WHERE c.id = ? LIMIT 1`,
      [commentId]
    );

    return res.status(201).json(created[0]);
  } catch (err: any) {
    console.error('Add comment error:', err);
    return res.status(500).json({ error: 'فشل إضافة التعليق' });
  }
});

// 8. Delete Comment
router.delete('/:id/comments/:commentId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const { commentId } = req.params;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    // Verify comment exists AND belongs strictly to the target video (prevent cross-video IDOR)
    const comment = await query<any[]>(
      'SELECT user_id, video_id FROM video_comments WHERE id = ? AND video_id = ? LIMIT 1',
      [commentId, videoId]
    );
    if (comment.length === 0) {
      return res.status(404).json({ error: 'التعليق غير موجود في هذا الفيديو' });
    }

    // Allow comment author, video owner (moderation), or system admin
    const video = await query<any[]>('SELECT user_id FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    const isVideoOwner = video.length > 0 && video[0].user_id === userId;

    if (comment[0].user_id !== userId && !isVideoOwner && !isAdmin) {
      return res.status(403).json({ error: 'غير مصرح بحذف هذا التعليق' });
    }

    await query('DELETE FROM video_comments WHERE id = ? AND video_id = ?', [commentId, videoId]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Delete comment error:', err);
    return res.status(500).json({ error: 'فشل حذف التعليق' });
  }
});

// 9. Toggle Like (Existence validation and idempotent duplicate handling)
router.post('/:id/likes/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.id;

    // Verify video exists
    const videoCheck = await query<any[]>('SELECT id FROM saved_videos WHERE id = ? LIMIT 1', [videoId]);
    if (videoCheck.length === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    }

    const existing = await query<any[]>(
      'SELECT id FROM video_likes WHERE video_id = ? AND user_id = ? LIMIT 1',
      [videoId, userId]
    );

    let isLiked = false;
    if (existing.length > 0) {
      await query('DELETE FROM video_likes WHERE video_id = ? AND user_id = ?', [videoId, userId]);
      isLiked = false;
    } else {
      try {
        await query(
          'INSERT INTO video_likes (id, video_id, user_id) VALUES (UUID(), ?, ?)',
          [videoId, userId]
        );
        isLiked = true;
      } catch (insertErr: any) {
        if (insertErr.code === 'ER_DUP_ENTRY') {
          // Handled idempotently on race condition
          isLiked = true;
        } else {
          throw insertErr;
        }
      }
    }

    const countRes = await query<any[]>(
      'SELECT COUNT(*) as count FROM video_likes WHERE video_id = ?',
      [videoId]
    );

    return res.json({
      isLiked,
      likesCount: countRes[0]?.count || 0,
    });
  } catch (err: any) {
    console.error('Toggle like error:', err);
    return res.status(500).json({ error: 'فشل تحديث الإعجاب' });
  }
});

export default router;

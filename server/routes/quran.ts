import { Router, Request, Response } from 'express';
import {
  fetchQuranContent,
  getQuranFoundationConfig,
} from '../services/quranFoundationService';
import { logger } from '../logger';

const router = Router();

// In-memory cache for Quran content (chapters, recitations, etc.) to minimize upstream calls
const contentCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for static Quran text/chapters

function getCached(key: string): any | null {
  const item = contentCache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL_MS) {
    return item.data;
  }
  return null;
}

function setCached(key: string, data: any) {
  if (contentCache.size > 200) {
    const oldest = contentCache.keys().next().value;
    if (oldest) contentCache.delete(oldest);
  }
  contentCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Check if Quran Foundation credentials are setup
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const config = await getQuranFoundationConfig();
    return res.json({
      configured: config.hasCredentials,
      environment: config.env,
      clientIdMasked: config.clientId ? `${config.clientId.slice(0, 6)}...` : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * List all Quran chapters (Surahs)
 */
router.get('/chapters', async (req: Request, res: Response) => {
  const language = typeof req.query.language === 'string' ? req.query.language : 'ar';
  const cacheKey = `chapters:${language}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(cached);
  }

  try {
    const data = await fetchQuranContent('/chapters', { language });
    setCached(cacheKey, data);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch (err: any) {
    logger.error(`Error fetching chapters: ${err.message}`);
    return res.status(500).json({ error: 'فشل استرجاع قائمة السور' });
  }
});

/**
 * List recitations / reciters
 */
router.get('/recitations', async (req: Request, res: Response) => {
  const language = typeof req.query.language === 'string' ? req.query.language : 'ar';
  const cacheKey = `recitations:${language}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(cached);
  }

  try {
    const data = await fetchQuranContent('/resources/recitations', { language });
    setCached(cacheKey, data);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch (err: any) {
    logger.error(`Error fetching recitations: ${err.message}`);
    return res.status(500).json({ error: 'فشل استرجاع قائمة التلاوات' });
  }
});

/**
 * Fetch chapter recitation audio with millisecond word timestamps and segments
 */
router.get('/chapter-recitation/:reciterId/:chapterNumber', async (req: Request, res: Response) => {
  const { reciterId, chapterNumber } = req.params;
  const segments = req.query.segments !== 'false';
  const cacheKey = `audio:${reciterId}:${chapterNumber}:${segments}`;

  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(cached);
  }

  try {
    const data = await fetchQuranContent(`/chapter_recitations/${reciterId}/${chapterNumber}`, {
      segments: segments ? 'true' : 'false',
    });
    setCached(cacheKey, data);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch (err: any) {
    logger.error(`Error fetching recitation audio for ${reciterId}/${chapterNumber}: ${err.message}`);
    return res.status(500).json({ error: 'فشل استرجاع التسجيل الصوتي وتوقيتاته' });
  }
});

/**
 * Fetch verses of a chapter with full Uthmani text and word metadata
 */
router.get('/chapter/:id/verses', async (req: Request, res: Response) => {
  const chapterId = req.params.id;
  const page = typeof req.query.page === 'string' ? req.query.page : '1';
  const perPage = typeof req.query.per_page === 'string' ? req.query.per_page : '286';

  const cacheKey = `verses:${chapterId}:${page}:${perPage}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(cached);
  }

  try {
    const data = await fetchQuranContent(`/verses/by_chapter/${chapterId}`, {
      language: 'ar',
      words: 'true',
      page,
      per_page: perPage,
      fields: 'text_uthmani,chapter_id,verse_number,verse_key',
      word_fields: 'text_uthmani,location,text_imlaei',
    });
    setCached(cacheKey, data);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch (err: any) {
    logger.error(`Error fetching verses for chapter ${chapterId}: ${err.message}`);
    return res.status(500).json({ error: 'فشل استرجاع آيات السورة' });
  }
});

export default router;

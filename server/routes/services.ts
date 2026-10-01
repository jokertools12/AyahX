import { Router, Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { getRawSetting } from '../services/settingsService';
import { generateAiLogoSvg } from '../services/aiLogoService';
import { proxyRateLimiter, aiRateLimiter, aiMediaRateLimiter, transcribeRateLimiter, pexelsRateLimiter, contactRateLimiter } from '../middleware/rateLimiter';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { canUseFeature, type PremiumFeature } from '../../shared/planEntitlements';
import { getActivePlanForUser, syncExpiredSubscriptions } from '../services/subscriptionService';
import {
  getAiConfig,
  getAiProviderStatus,
  getImageAiConfig,
  safeParseJson,
  transcribeAudioWithAi,
  refineTextWithAi,
  generateImageWithAi,
} from '../services/aiService';

export { safeParseJson };

const router = Router();

const ALLOWED_PROXY_DOMAINS = ['pexels.com', 'everyayah.com', 'quran.com', 'images.pexels.com', 'videos.pexels.com'];
const ALLOWED_AUDIO_DOMAINS = ['everyayah.com', 'quran.com', 'cdn.islamic.network', 'download.quranicaudio.com', 'surah.my'];

/**
 * Sanitized capability metadata for the settings redesign.  It never returns
 * an API key and is safe for an authenticated user to use for feature gating.
 */
router.get('/ai-status', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.json(await getAiProviderStatus());
});

/** Enforce paid capabilities at the API boundary, not only in the React UI. */
function requirePremiumFeature(feature: PremiumFeature) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });
      await syncExpiredSubscriptions(userId);
      const plan = await getActivePlanForUser(userId);
      if (!canUseFeature(plan, feature)) {
        return res.status(403).json({
          error: 'هذه الميزة متاحة للعضوية المميزة فقط',
          code: 'PREMIUM_FEATURE_REQUIRED',
          feature,
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * SSRF Prevention: Reject loopback, private RFC1918, link-local, and cloud metadata addresses
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const parts = host.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p) && parseInt(p, 10) >= 0 && parseInt(p, 10) <= 255)) {
    const b0 = parseInt(parts[0], 10);
    const b1 = parseInt(parts[1], 10);
    if (b0 === 10 || b0 === 127 || b0 === 0) return true;
    if (b0 === 169 && b1 === 254) return true; // Link-local & cloud metadata (169.254.169.254)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
  }
  return false;
}

/**
 * 1. Video Proxy (Streaming, Rate-limited, SSRF-protected, Redirect-safe)
 * Avoids browser tainted canvas when capturing frames into MediaRecorder.
 * Streams data directly without buffering entire video files into Node.js heap memory.
 */
router.post('/video-proxy', requireAuth, requirePremiumFeature('pexelsVideos'), proxyRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl مطلوب' });
    }

    let parsed: URL;
    try {
      parsed = new URL(videoUrl);
    } catch {
      return res.status(400).json({ error: 'رابط الفيديو غير صالح' });
    }

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'يسمح فقط بروابط HTTPS المشفرة' });
    }

    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHost(host)) {
      return res.status(403).json({ error: 'الوصول إلى عناوين الشبكة المحلية محظور (SSRF Blocked)' });
    }

    const isAllowed = ALLOWED_PROXY_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
    if (!isAllowed) {
      return res.status(403).json({ error: 'النطاق غير مصرح به عبر البروكسي' });
    }

    // Abort controller to terminate upstream fetch if client disconnects early or after 25s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    res.on('close', () => {
      if (res.writableEnded) return;
      clearTimeout(timeoutId);
      controller.abort();
    });

    // redirect: 'manual' prevents open-redirect SSRF bypasses
    const response = await fetch(videoUrl, { signal: controller.signal, redirect: 'manual' });
    clearTimeout(timeoutId);

    if (response.status >= 300 && response.status < 400) {
      return res.status(400).json({ error: 'إعادة التوجيه غير مسموح بها عبر البروكسي' });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: 'فشل جلب الفيديو من المصدر الخارجي' });
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    const contentLength = response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    if (!response.body) {
      return res.end();
    }

    // Direct stream piping to client response without loading full video into RAM.
    // Current Node typings accept the WHATWG stream directly; keep this path
    // streaming so a large background video never occupies the API heap.
    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.on('error', (err) => {
      console.error('Video proxy stream error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    nodeStream.pipe(res);
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    console.error('Video proxy error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'حدث خطأ أثناء نقل الفيديو' });
    }
  }
});

/**
 * 2. Transcribe Audio (Authenticated, Rate-limited, SSRF-protected, Size-bounded)
 */
router.post('/transcribe-audio', requireAuth, transcribeRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { audioUrl, audioBase64: inputBase64, mimeType, language, contentKind } = req.body;
    if (!audioUrl && !inputBase64) {
      return res.status(400).json({ error: 'audioUrl أو audioBase64 مطلوب' });
    }

    // An LLM transcript is useful for an Ibtahalat draft, but it must never be
    // mistaken for the source of Quran word timing.  Quran alignment goes
    // through the attested provider/review pipeline instead.
    if (contentKind === 'quran') {
      return res.status(422).json({
        error: 'لا يُستخدم التفريغ العام لمحاذاة كلمات القرآن. استخدم مسار المحاذاة المعتمدة والمراجعة.',
        code: 'QURAN_ALIGNMENT_REQUIRES_ATTESTED_PROVIDER',
      });
    }

    const aiConfig = await getAiConfig();
    if (!aiConfig) {
      return res.status(503).json({
        error: 'خدمة الذكاء الاصطناعي غير مهيأة في الخادم (اضبط AI_PROVIDER وOPENROUTER_API_KEY في بيئة الخادم)',
        code: 'AI_PROVIDER_NOT_CONFIGURED',
        configured: false,
      });
    }

    if (aiConfig.type === 'openrouter') {
      return res.status(501).json({
        error: 'OpenRouter مفعّل للنص فقط في AyahX؛ لم يُرسل الملف الصوتي إلى أي مزوّد.',
        code: 'OPENROUTER_AUDIO_UNSUPPORTED',
      });
    }

    let audioBase64 = inputBase64;
    if (!audioBase64 && audioUrl) {
      if (typeof audioUrl !== 'string') {
        return res.status(400).json({ error: 'رابط الصوت غير صالح' });
      }

      let parsed: URL;
      try {
        parsed = new URL(audioUrl);
      } catch {
        return res.status(400).json({ error: 'رابط الصوت غير صالح' });
      }

      if (parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'يسمح فقط بروابط HTTPS المشفرة للملفات الصوتية' });
      }

      const host = parsed.hostname.toLowerCase();
      if (isPrivateOrLocalHost(host)) {
        return res.status(403).json({ error: 'غير مسموح بالوصول إلى عناوين الشبكة المحلية (SSRF Blocked)' });
      }

      const isAllowedAudio = ALLOWED_AUDIO_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
      if (!isAllowedAudio) {
        return res.status(403).json({ error: 'نطاق الصوت غير مصرح به للتحميل المباشر' });
      }

      const audioController = new AbortController();
      const audioTimeout = setTimeout(() => audioController.abort(), 15000);
      try {
        const audioResp = await fetch(audioUrl, { signal: audioController.signal, redirect: 'manual' });
        clearTimeout(audioTimeout);

        if (audioResp.status >= 300 && audioResp.status < 400) {
          return res.status(400).json({ error: 'إعادة التوجيه غير مسموح بها لتحميل الملفات الصوتية' });
        }

        if (!audioResp.ok) return res.status(400).json({ error: 'فشل تحميل الملف الصوتي من الرابط المحدد' });

        // Enforce 25MB maximum size limit to prevent memory exhaustion DoS
        const declaredLen = parseInt(audioResp.headers.get('content-length') || '0', 10);
        if (declaredLen > 25 * 1024 * 1024) {
          return res.status(400).json({ error: 'حجم الملف الصوتي يتجاوز الحد الأقصى المسموح (25 ميجابايت)' });
        }

        const buf = await audioResp.arrayBuffer();
        if (buf.byteLength > 25 * 1024 * 1024) {
          return res.status(400).json({ error: 'حجم الملف الصوتي يتجاوز الحد الأقصى المسموح (25 ميجابايت)' });
        }

        audioBase64 = Buffer.from(buf).toString('base64');
      } catch {
        clearTimeout(audioTimeout);
        return res.status(400).json({ error: 'تعذر تحميل الملف الصوتي (انتهت مهلة الاتصال أو تم حظره)' });
      }
    }

    try {
      const result = await transcribeAudioWithAi(audioBase64, aiConfig, mimeType, language);
      return res.json(result);
    } catch (aiErr: any) {
      console.error('AI provider error:', aiErr);
      return res.status(502).json({ error: aiErr.message || 'فشل معالجة الصوت عبر خدمة الذكاء الاصطناعي' });
    }
  } catch (err: any) {
    console.error('Transcribe audio error:', err);
    return res.status(500).json({ error: 'فشل تفريغ الصوت بالذكاء الاصطناعي' });
  }
});

/**
 * 3. Refine Text (Authenticated, Rate-limited, Bounded inputs)
 */
router.post('/refine-text', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lines } = req.body;
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines مطلوب' });
    }

    if (lines.length > 100) {
      return res.status(400).json({ error: 'عدد الأسطر يجب ألا يتجاوز 100 سطر في المرة الواحدة' });
    }

    const aiConfig = await getAiConfig();
    if (!aiConfig) {
      return res.status(503).json({
        error: 'خدمة الذكاء الاصطناعي غير مهيأة في الخادم (اضبط AI_PROVIDER وOPENROUTER_API_KEY في بيئة الخادم)',
        code: 'AI_PROVIDER_NOT_CONFIGURED',
        configured: false,
      });
    }

    const refinedLines = await refineTextWithAi(lines, aiConfig);
    return res.json({ refinedLines });
  } catch (err: any) {
    console.error('Refine text error:', err);
    return res.status(500).json({ error: 'فشل تحسين النصوص' });
  }
});

/**
 * 4. Refine Timing (Authenticated, Rate-limited, Bounded inputs)
 */
router.post('/refine-timing', requireAuth, aiRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lines } = req.body;
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines مطلوب' });
    }

    if (lines.length > 100) {
      return res.status(400).json({ error: 'عدد الأسطر يجب ألا يتجاوز 100 سطر' });
    }

    // Do not let a language model invent timing.  Keep this endpoint as a
    // compatibility response for the old client and direct real alignment to
    // /api/alignments, where an attested source and human review are required.
    return res.json({
      refinedLines: lines,
      timingStatus: 'untrusted',
      requiresAlignmentReview: true,
      message: 'لم يتم تعديل التوقيتات؛ التوقيت الدقيق يمر عبر مزود المحاذاة والمراجعة.',
    });
  } catch (err: any) {
    console.error('Refine timing error:', err);
    return res.status(500).json({ error: 'فشل ضبط التوقيتات' });
  }
});

// In-memory cache for Pexels responses to preserve third-party API rate quotas and reduce latency
interface PexelsCacheEntry {
  data: any;
  timestamp: number;
}
const pexelsCache = new Map<string, PexelsCacheEntry>();
const PEXELS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PEXELS_CACHE_MAX_ENTRIES = 200;

function setPexelsCache(key: string, data: any) {
  if (pexelsCache.size >= PEXELS_CACHE_MAX_ENTRIES) {
    const oldestKey = pexelsCache.keys().next().value;
    if (oldestKey) pexelsCache.delete(oldestKey);
  }
  pexelsCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Reusable helper for cached Pexels video proxy calls
 */
async function fetchCachedPexels(
  endpoint: 'search' | 'popular',
  params: URLSearchParams,
  res: Response
) {
  const pexelsKey = (await getRawSetting('PEXELS_API_KEY')).trim();
  if (!pexelsKey) {
    return res.status(503).json({ error: 'مفتاح Pexels غير مهيأ في الخادم (PEXELS_API_KEY missing in .env)' });
  }

  const cacheKey = `${endpoint}:${params.toString()}`;
  const cached = pexelsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PEXELS_CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(cached.data);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(`https://api.pexels.com/videos/${endpoint}?${params}`, {
      headers: { Authorization: pexelsKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `فشل استرجاع مقاطع Pexels من المصدر (${resp.status})` });
    }

    const data = await resp.json();
    setPexelsCache(cacheKey, data);
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(data);
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'انتهت مهلة استرجاع مقاطع الفيديو من Pexels' });
    }
    console.error(`Pexels ${endpoint} proxy error:`, err);
    return res.status(500).json({ error: 'فشل استرجاع مقاطع الفيديو من Pexels' });
  }
}

/**
 * 5. Pexels Search Proxy (Cached, Rate-limited, Eliminates Client Bundle Key Leakage)
 */
router.get('/pexels/search', requireAuth, requirePremiumFeature('pexelsVideos'), pexelsRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { query = 'nature landscape', orientation = 'portrait', size = 'medium', per_page = '15', page = '1' } = req.query;
  const cleanQuery = typeof query === 'string' ? query.slice(0, 100) : 'nature';
  const params = new URLSearchParams({
    query: cleanQuery,
    orientation: typeof orientation === 'string' ? orientation : 'portrait',
    size: typeof size === 'string' ? size : 'medium',
    per_page: Math.min(30, Math.max(1, parseInt(per_page as string, 10) || 15)).toString(),
    page: Math.max(1, parseInt(page as string, 10) || 1).toString(),
  });
  return fetchCachedPexels('search', params, res);
});

/**
 * 6. Pexels Popular Videos Proxy (Cached, Rate-limited, Eliminates Client Bundle Key Leakage)
 */
router.get('/pexels/popular', requireAuth, requirePremiumFeature('pexelsVideos'), pexelsRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { per_page = '15', page = '1' } = req.query;
  const params = new URLSearchParams({
    per_page: Math.min(30, Math.max(1, parseInt(per_page as string, 10) || 15)).toString(),
    page: Math.max(1, parseInt(page as string, 10) || 1).toString(),
  });
  return fetchCachedPexels('popular', params, res);
});

/**
 * 7. Contact & Support Submission (Rate-limited, Input-validated, Admin notification)
 */
router.post('/contact', contactRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, subject, message, category = 'general' } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'الاسم مطلوب' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'موضوع الرسالة مطلوب' });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 5) {
      return res.status(400).json({ error: 'نص الرسالة يجب أن يكون 5 أحرف على الأقل' });
    }

    const cleanName = name.trim().slice(0, 100);
    const cleanEmail = email.trim().toLowerCase().slice(0, 150);
    const cleanSubject = subject.trim().slice(0, 200);
    const cleanMessage = message.trim().slice(0, 3000);
    const cleanCategory = typeof category === 'string' ? category.trim().slice(0, 50) : 'general';
    let hasPrioritySupport = false;

    // Priority is derived from the signed-in account, never accepted from a
    // browser form field. Public contact remains available to everyone.
    if (req.user?.id) {
      try {
        await syncExpiredSubscriptions(req.user.id);
        const plan = await getActivePlanForUser(req.user.id);
        hasPrioritySupport = canUseFeature(plan, 'prioritySupport');
      } catch (priorityErr) {
        console.warn('Could not resolve support priority for contact message:', priorityErr);
      }
    }
    const priorityLabel = hasPrioritySupport ? ' [أولوية مميزة]' : '';

    // Notify all admin users of the incoming inquiry
    try {
      const { query } = await import('../db');
      const adminUsers = await query<any[]>(
        "SELECT user_id FROM user_roles WHERE role = 'admin'"
      );
      for (const admin of adminUsers) {
        await query(
          'INSERT INTO notifications (id, user_id, title, message, type) VALUES (UUID(), ?, ?, ?, ?)',
          [
            admin.user_id,
            `رسالة تواصل جديدة${priorityLabel} [${cleanCategory}]: ${cleanSubject}`,
            `من: ${cleanName} (${cleanEmail})\n\n${cleanMessage.slice(0, 300)}...`,
            'system'
          ]
        );
      }
    } catch (notifErr) {
      console.warn('Could not dispatch admin notification for contact message:', notifErr);
    }

    return res.status(200).json({
      success: true,
      prioritySupport: hasPrioritySupport,
      message: hasPrioritySupport
        ? 'تم استلام رسالتك وإرسالها إلى مسار الدعم ذي الأولوية.'
        : 'تم استلام رسالتك بنجاح وسيتواصل معك فريق الدعم قريباً بإذن الله.'
    });
  } catch (err: any) {
    console.error('Contact endpoint error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة، يرجى المحاولة لاحقاً' });
  }
});

/**
 * 6. Generate an SVG logo using the configured text provider.
 */
router.post('/generate-logo', requireAuth, requirePremiumFeature('aiLogo'), aiMediaRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { brandName, subtitle, style } = req.body || {};
    const safeBrand = (brandName || 'آيات قرآنية').toString().trim().slice(0, 60);
    const safeSub = (subtitle || 'تلاوات خاشعة').toString().trim().slice(0, 60);
    const safeStyle = (style || 'goldMedallion') as any;

    const aiConfig = await getAiConfig();
    if (!aiConfig) return res.status(503).json({ error: 'مزود الذكاء الاصطناعي غير مهيأ لتصميم الشعار', code: 'AI_PROVIDER_NOT_CONFIGURED' });
    const generated = await generateAiLogoSvg(safeBrand, safeSub, safeStyle, aiConfig);
    const generatedSvg = generated.svg;

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(generatedSvg).toString('base64')}`;

    return res.status(200).json({
      success: true,
      svg: generatedSvg,
      provider: generated.provider,
      modelUsed: generated.modelUsed,
      dataUrl,
      brandName: safeBrand,
      style: safeStyle
    });
  } catch (err: any) {
    console.error('Generate logo endpoint error:', err);
    return res.status(err.status || 502).json({ error: err.message || 'حدث خطأ أثناء توليد الشعار', code: err.code || 'AI_LOGO_PROVIDER_FAILED' });
  }
});

/**
 * 7. Generate Visual Art & Background Images with Gemini Generative Media (Nano Banana)
 */
router.post('/generate-image', requireAuth, requirePremiumFeature('aiBackgrounds'), aiMediaRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompt, aspectRatio, style } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'يرجى إدخال وصف الصورة المراد توليدها' });
    }

    const aiConfig = await getImageAiConfig();
    if (!aiConfig) {
      return res.status(503).json({
        error: 'خدمة توليد الصور غير متاحة حاليًا. اختر خلفية من المكتبة أو ارفع صورة.',
        code: 'AI_IMAGE_PROVIDER_NOT_CONFIGURED',
        configured: false,
      });
    }

    const safePrompt = prompt.trim().slice(0, 500);
    const safeAspect = (['9:16', '16:9', '1:1', '4:5'].includes(aspectRatio) ? aspectRatio : '9:16') as any;

    const result = await generateImageWithAi(safePrompt, aiConfig, {
      aspectRatio: safeAspect,
      style: style || 'cinematic',
    });

    return res.status(200).json({
      success: true,
      base64: result.base64,
      mimeType: result.mimeType,
      dataUrl: result.dataUrl,
      prompt: safePrompt,
      aspectRatio: safeAspect,
    });
  } catch (err: any) {
    console.error('Generate image error:', err);
    return res.status(err.status || 502).json({
      error: err.message || 'فشل توليد الصورة بالذكاء الاصطناعي',
      code: err.code || 'AI_IMAGE_PROVIDER_FAILED',
    });
  }
});


export default router;

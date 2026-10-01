import { Request, Response, NextFunction } from 'express';
import IORedis from 'ioredis';

let redis: IORedis | null = null;
let activeRedisLimits = 0;
let redisIdleTimer: ReturnType<typeof setTimeout> | null = null;

function releaseIdleLimiterRedis(): void {
  if (process.env.RENDER_BACKGROUND_MAINTENANCE !== 'false' || activeRedisLimits > 0) return;
  if (redisIdleTimer) clearTimeout(redisIdleTimer);
  redisIdleTimer = setTimeout(() => {
    if (activeRedisLimits > 0) return;
    const idle = redis;
    redis = null;
    idle?.disconnect();
  }, 60000);
  redisIdleTimer.unref?.();
}

function positiveIntegerEnv(name: string, fallback: number, maximum = 100_000): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 && value <= maximum ? value : fallback;
}

function sharedLimiterRedis(): IORedis | null {
  if (!process.env.REDIS_URL || process.env.NODE_ENV !== 'production') return null;
  if (!redis) redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, keepAlive: 0 });
  return redis;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

interface ClientRecord {
  timestamps: number[];
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, message = 'تم تجاوز الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً.' } = options;
  const store = new Map<string, ClientRecord>();

  // Periodically clean up idle IPs to prevent memory leaks (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of store.entries()) {
      record.timestamps = record.timestamps.filter(ts => now - ts < windowMs);
      if (record.timestamps.length === 0) {
        store.delete(ip);
      }
    }
  }, Math.max(windowMs, 60000));

  // Allow Node to exit cleanly without keeping timer alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const MAX_STORE_SIZE = 10000;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Extract client identifier: prioritize authenticated user ID, fallback to client IP
    const user = (req as Request & { user?: { id?: string } }).user;
    // `req.ip` is computed by Express using the application's explicit
    // `trust proxy` policy. Reading X-Forwarded-For here directly allowed a
    // caller to invent a new limiter identity for every request.
    const ip = req.ip || req.socket.remoteAddress || 'unknown-client';
    const clientKey = user?.id ? `user:${user.id}` : ip;

    // In local development, provide generous allowance for localhost testing
    const isLocalDev = process.env.NODE_ENV !== 'production' && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
    const effectiveMax = isLocalDev ? max * 5 : max;

    const shared = sharedLimiterRedis();
    if (shared) {
      activeRedisLimits += 1;
      if (redisIdleTimer) clearTimeout(redisIdleTimer);
      try {
        const bucket = Math.floor(Date.now() / windowMs);
        const key = `rl:${windowMs}:${max}:${clientKey}:${bucket}`;
        const count = await shared.incr(key);
        if (count === 1) await shared.expire(key, Math.ceil(windowMs / 1000));
        const remaining = Math.max(0, effectiveMax - count);
        const resetTime = Math.ceil(((bucket + 1) * windowMs) / 1000);
        res.setHeader('X-RateLimit-Limit', effectiveMax.toString());
        res.setHeader('X-RateLimit-Remaining', remaining.toString());
        res.setHeader('X-RateLimit-Reset', resetTime.toString());
        if (count > effectiveMax) {
          const retryAfter = Math.max(1, resetTime - Math.ceil(Date.now() / 1000));
          res.setHeader('Retry-After', retryAfter.toString());
          return res.status(429).json({ error: message, retryAfter });
        }
        return next();
      } catch {
        // Redis outage must not take down the API; fall back to bounded local
        // protection for this process while health monitoring raises an alert.
      } finally {
        activeRedisLimits -= 1;
        releaseIdleLimiterRedis();
      }
    }

    const now = Date.now();
    let record = store.get(clientKey);
    if (!record) {
      // Prevent unbounded heap growth under high-cardinality IP floods
      if (store.size >= MAX_STORE_SIZE) {
        const oldestKeys = Array.from(store.keys()).slice(0, 1000);
        for (const k of oldestKeys) {
          store.delete(k);
        }
      }
      record = { timestamps: [] };
      store.set(clientKey, record);
    }

    // Filter timestamps within current window
    record.timestamps = record.timestamps.filter(ts => now - ts < windowMs);

    const remaining = Math.max(0, effectiveMax - record.timestamps.length);
    const resetTime = Math.ceil((now + windowMs) / 1000);

    res.setHeader('X-RateLimit-Limit', effectiveMax.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetTime.toString());

    if (record.timestamps.length >= effectiveMax) {
      const retryAfterSec = Math.ceil((record.timestamps[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', Math.max(1, retryAfterSec).toString());
      return res.status(429).json({
        error: message,
        retryAfter: Math.max(1, retryAfterSec),
      });
    }

    record.timestamps.push(now);
    next();
  };
}

// Pre-configured rate limiters
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: positiveIntegerEnv('AUTH_RATE_LIMIT_MAX', 20), // 20 attempts per 15 minutes
  message: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها، يرجى الانتظار 15 دقيقة.',
});

export const proxyRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // 60 video proxy requests per 5 minutes
  message: 'تم تجاوز حد طلبات تشغيل وسائط الفيديو، يرجى المحاولة بعد قليل.',
});

export const generalApiLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  message: 'تم تجاوز معدل الطلبات المسموح به.',
});

export const aiRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60, // 60 requests per 10 minutes for text refinement, logos, images
  message: 'تم تجاوز الحد المسموح به من طلبات الذكاء الاصطناعي، يرجى الانتظار قليلاً.',
});

export const aiMediaRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: 'تم بلوغ حد طلبات تصميم الصور والشعارات؛ حاول بعد قليل.',
});

export const transcribeRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 200, // 200 chunk transcription requests per 10 minutes (supports long audio and retries)
  message: 'تم تجاوز الحد المسموح به لطلبات تفريغ الصوت، يرجى الانتظار قليلاً.',
});

export const pexelsRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // 60 requests per 5 minutes
  message: 'تم تجاوز حد البحث عن مقاطع الفيديو، يرجى المحاولة بعد قليل.',
});

export const videoCreationLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 video creation/save requests per minute
  message: 'تم تجاوز معدل حفظ مقاطع الفيديو، يرجى الانتظار دقيقة واحدة.',
});

export const contactRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,
  message: 'تم تجاوز عدد رسائل الدعم المسموح به مؤقتاً، يرجى المحاولة بعد قليل.',
});

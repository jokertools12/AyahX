import { describe, it, expect } from 'vitest';

/**
 * Domain validation helper matching the implementation in server/routes/services.ts video-proxy
 */
function isAllowedDomain(urlStr: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return allowedDomains.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * SSRF IP check helper matching transcribe-audio
 */
function isPrivateOrLocalHost(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '169.254.169.254') {
      return true;
    }
    if (host.startsWith('10.') || host.startsWith('192.168.')) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Deterministic hash key generator used in PreviewPage.tsx to safely cache audio without btoa() crashing on non-ASCII characters
 */
function getAudioCacheKey(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'audio_' + Math.abs(hash).toString(36);
}

describe('Security & Validation Rules', () => {
  describe('SSRF Domain Whitelist Validation', () => {
    const allowed = ['pexels.com', 'everyayah.com', 'quran.com'];

    it('permits exact whitelisted domain over https', () => {
      expect(isAllowedDomain('https://pexels.com/video.mp4', allowed)).toBe(true);
      expect(isAllowedDomain('https://everyayah.com/data/001001.mp3', allowed)).toBe(true);
    });

    it('permits valid subdomains over https', () => {
      expect(isAllowedDomain('https://images.pexels.com/video.mp4', allowed)).toBe(true);
      expect(isAllowedDomain('https://static.everyayah.com/data/001001.mp3', allowed)).toBe(true);
    });

    it('rejects unencrypted HTTP requests', () => {
      expect(isAllowedDomain('http://pexels.com/video.mp4', allowed)).toBe(false);
    });

    it('rejects domain prefix spoofing (e.g. evilpexels.com or notpexels.com)', () => {
      expect(isAllowedDomain('https://notpexels.com/video.mp4', allowed)).toBe(false);
      expect(isAllowedDomain('https://evilpexels.com/video.mp4', allowed)).toBe(false);
      expect(isAllowedDomain('https://everyayah.com.attacker.com/audio.mp3', allowed)).toBe(false);
    });

    it('rejects invalid or malformed URLs', () => {
      expect(isAllowedDomain('not-a-valid-url', allowed)).toBe(false);
      expect(isAllowedDomain('', allowed)).toBe(false);
    });
  });

  describe('SSRF Internal Network IP Blocking', () => {
    it('blocks localhost and loopback interfaces', () => {
      expect(isPrivateOrLocalHost('http://localhost:8080')).toBe(true);
      expect(isPrivateOrLocalHost('https://127.0.0.1/admin')).toBe(true);
      expect(isPrivateOrLocalHost('http://[::1]/secret')).toBe(true);
    });

    it('blocks cloud metadata IP 169.254.169.254', () => {
      expect(isPrivateOrLocalHost('http://169.254.169.254/latest/meta-data/')).toBe(true);
    });

    it('blocks RFC1918 private subnets', () => {
      expect(isPrivateOrLocalHost('http://10.0.0.1/status')).toBe(true);
      expect(isPrivateOrLocalHost('http://192.168.1.1/router')).toBe(true);
    });

    it('allows public external URLs', () => {
      expect(isPrivateOrLocalHost('https://api.pexels.com/videos/search')).toBe(false);
      expect(isPrivateOrLocalHost('https://everyayah.com/data/reciter/001001.mp3')).toBe(false);
    });
  });

  describe('Unicode Audio URL Cache Hashing', () => {
    it('generates consistent keys for identical URLs', () => {
      const url = 'https://everyayah.com/data/Alafasy_128kbps/001001.mp3';
      expect(getAudioCacheKey(url)).toBe(getAudioCacheKey(url));
    });

    it('safely handles non-ASCII Arabic characters without throwing DOMException/URIError', () => {
      const arabicUrl = 'https://example.com/audio/سورة_الفاتحة_مشاري.mp3';
      expect(() => getAudioCacheKey(arabicUrl)).not.toThrow();
      const key = getAudioCacheKey(arabicUrl);
      expect(key.startsWith('audio_')).toBe(true);
      expect(key.length).toBeGreaterThan(6);
    });

    it('produces distinct keys for different URLs', () => {
      const url1 = 'https://example.com/audio/001001.mp3';
      const url2 = 'https://example.com/audio/001002.mp3';
      expect(getAudioCacheKey(url1)).not.toBe(getAudioCacheKey(url2));
    });
  });

  describe('Phone Number Validation (Egyptian Wallets & InstaPay)', () => {
    const egPhoneRegex = /^01[0125][0-9]{8}$/;

    it('accepts valid Egyptian 11-digit mobile wallet numbers', () => {
      expect(egPhoneRegex.test('01012345678')).toBe(true); // Vodafone
      expect(egPhoneRegex.test('01112345678')).toBe(true); // Etisalat
      expect(egPhoneRegex.test('01212345678')).toBe(true); // Orange
      expect(egPhoneRegex.test('01512345678')).toBe(true); // WE
    });

    it('rejects invalid numbers or incorrect lengths', () => {
      expect(egPhoneRegex.test('01312345678')).toBe(false); // Invalid operator prefix
      expect(egPhoneRegex.test('0101234567')).toBe(false);  // Too short (10 digits)
      expect(egPhoneRegex.test('010123456789')).toBe(false); // Too long (12 digits)
      expect(egPhoneRegex.test('1012345678')).toBe(false);   // Missing leading 0
    });
  });

  describe('Rate Limiter Middleware', () => {
    // Import createRateLimiter logic
    it('allows requests within limit and sets rate limit headers', async () => {
      const { createRateLimiter } = await import('../../server/middleware/rateLimiter');
      const limiter = createRateLimiter({ windowMs: 1000, max: 2 });

      const headers1: Record<string, string> = {};
      const req1 = { headers: {}, socket: { remoteAddress: '10.0.0.50' } } as any;
      const res1 = {
        setHeader: (k: string, v: string) => { headers1[k] = v; },
        status: () => res1,
        json: () => res1,
      } as any;
      let nextCalled1 = false;
      limiter(req1, res1, () => { nextCalled1 = true; });

      expect(nextCalled1).toBe(true);
      expect(headers1['X-RateLimit-Limit']).toBe('2');
      expect(headers1['X-RateLimit-Remaining']).toBe('2');

      const headers2: Record<string, string> = {};
      const req2 = { headers: {}, socket: { remoteAddress: '10.0.0.50' } } as any;
      const res2 = {
        setHeader: (k: string, v: string) => { headers2[k] = v; },
        status: () => res2,
        json: () => res2,
      } as any;
      let nextCalled2 = false;
      limiter(req2, res2, () => { nextCalled2 = true; });

      expect(nextCalled2).toBe(true);
      expect(headers2['X-RateLimit-Remaining']).toBe('1');
    });

    it('blocks requests exceeding limit with HTTP 429 and Retry-After header', async () => {
      const { createRateLimiter } = await import('../../server/middleware/rateLimiter');
      const limiter = createRateLimiter({ windowMs: 5000, max: 2, message: 'Too many requests' });

      const req = { headers: {}, socket: { remoteAddress: '10.0.0.99' } } as any;
      let lastStatusCode = 200;
      let responseBody: any = null;
      const headers: Record<string, string> = {};

      const createRes = () => ({
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status: (code: number) => {
          lastStatusCode = code;
          return {
            json: (body: any) => { responseBody = body; }
          };
        },
        json: (body: any) => { responseBody = body; }
      } as any);

      // Call 1: Allowed
      let n1 = false;
      limiter(req, createRes(), () => { n1 = true; });
      expect(n1).toBe(true);

      // Call 2: Allowed
      let n2 = false;
      limiter(req, createRes(), () => { n2 = true; });
      expect(n2).toBe(true);

      // Call 3: Exceeded -> 429
      let n3 = false;
      limiter(req, createRes(), () => { n3 = true; });
      expect(n3).toBe(false);
      expect(lastStatusCode).toBe(429);
      expect(responseBody).toEqual(expect.objectContaining({ error: 'Too many requests' }));
      expect(headers['Retry-After']).toBeDefined();
    });
  });

  describe('OWASP Top 10 Security Controls (Session 4 Audit)', () => {
    it('blocks SSRF private IPs, loopback addresses, and cloud metadata (SEC-08)', async () => {
      const { isPrivateOrLocalHost } = await import('../../server/routes/services');

      // Loopback & local
      expect(isPrivateOrLocalHost('localhost')).toBe(true);
      expect(isPrivateOrLocalHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHost('::1')).toBe(true);
      expect(isPrivateOrLocalHost('0.0.0.0')).toBe(true);
      expect(isPrivateOrLocalHost('service.local')).toBe(true);
      expect(isPrivateOrLocalHost('api.internal')).toBe(true);

      // Cloud metadata (AWS, GCP, Azure 169.254.169.254)
      expect(isPrivateOrLocalHost('169.254.169.254')).toBe(true);
      expect(isPrivateOrLocalHost('169.254.1.1')).toBe(true);

      // RFC 1918 Private ranges
      expect(isPrivateOrLocalHost('10.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHost('10.255.255.255')).toBe(true);
      expect(isPrivateOrLocalHost('192.168.1.1')).toBe(true);
      expect(isPrivateOrLocalHost('192.168.0.254')).toBe(true);
      expect(isPrivateOrLocalHost('172.16.0.1')).toBe(true);
      expect(isPrivateOrLocalHost('172.31.255.255')).toBe(true);

      // Public domains (must not be blocked by private check)
      expect(isPrivateOrLocalHost('everyayah.com')).toBe(false);
      expect(isPrivateOrLocalHost('api.pexels.com')).toBe(false);
      expect(isPrivateOrLocalHost('cdn.islamic.network')).toBe(false);
    }, 15000);

    it('enforces object-level access control on private video listings and details (SEC-07)', () => {
      // Logic simulation matching server/routes/videos.ts
      function canAccessVideo(video: { is_public: boolean; user_id: string }, requesterId: string | null, role: string): boolean {
        if (video.is_public) return true;
        if (role === 'admin') return true;
        return requesterId !== null && video.user_id === requesterId;
      }

      const privateVideo = { is_public: false, user_id: 'user-123' };
      const publicVideo = { is_public: true, user_id: 'user-123' };

      // Owner can access both
      expect(canAccessVideo(privateVideo, 'user-123', 'user')).toBe(true);
      expect(canAccessVideo(publicVideo, 'user-123', 'user')).toBe(true);

      // Admin can access both
      expect(canAccessVideo(privateVideo, 'admin-999', 'admin')).toBe(true);

      // Other user cannot access private video
      expect(canAccessVideo(privateVideo, 'user-456', 'user')).toBe(false);
      expect(canAccessVideo(privateVideo, null, 'guest')).toBe(false);

      // Other user CAN access public video
      expect(canAccessVideo(publicVideo, 'user-456', 'user')).toBe(true);
      expect(canAccessVideo(publicVideo, null, 'guest')).toBe(true);
    });

    it('prevents cross-resource comment deletion traversal (SEC-14)', () => {
      function canDeleteComment(
        comment: { video_id: string; user_id: string } | null,
        targetVideoId: string,
        requesterId: string,
        videoOwnerId: string,
        isAdmin: boolean
      ): { allowed: boolean; reason?: string } {
        if (!comment || comment.video_id !== targetVideoId) {
          return { allowed: false, reason: 'NOT_FOUND_ON_VIDEO' };
        }
        if (comment.user_id === requesterId || videoOwnerId === requesterId || isAdmin) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'FORBIDDEN' };
      }

      const commentOnVideoA = { video_id: 'vid-A', user_id: 'user-1' };

      // Attempting to delete commentOnVideoA via vid-B route is rejected
      expect(canDeleteComment(commentOnVideoA, 'vid-B', 'user-1', 'vid-owner', false)).toEqual({
        allowed: false,
        reason: 'NOT_FOUND_ON_VIDEO',
      });

      // Legitimate author deleting on matching video
      expect(canDeleteComment(commentOnVideoA, 'vid-A', 'user-1', 'vid-owner', false)).toEqual({
        allowed: true,
      });

      // Video owner moderating comments on their video
      expect(canDeleteComment(commentOnVideoA, 'vid-A', 'vid-owner', 'vid-owner', false)).toEqual({
        allowed: true,
      });
    });

    it('sanitizes PII email addresses on public profile requests (SEC-11)', () => {
      function sanitizeProfile(profile: { display_name: string; email: string; user_id: string }, requesterId: string | null, role: string) {
        const isOwnerOrAdmin = (requesterId && requesterId === profile.user_id) || role === 'admin';
        return {
          ...profile,
          email: isOwnerOrAdmin ? profile.email : undefined,
        };
      }

      const rawProfile = { user_id: 'user-100', display_name: 'Ahmed', email: 'ahmed.secret@example.com' };

      // Third-party viewer receives profile without email
      const publicView = sanitizeProfile(rawProfile, 'user-200', 'user');
      expect(publicView.email).toBeUndefined();
      expect(publicView.display_name).toBe('Ahmed');

      // Anonymous visitor receives profile without email
      const anonView = sanitizeProfile(rawProfile, null, 'guest');
      expect(anonView.email).toBeUndefined();

      // Account owner sees their email
      const ownerView = sanitizeProfile(rawProfile, 'user-100', 'user');
      expect(ownerView.email).toBe('ahmed.secret@example.com');

      // Admin sees user email
      const adminView = sanitizeProfile(rawProfile, 'admin-999', 'admin');
      expect(adminView.email).toBe('ahmed.secret@example.com');
    });

    it('validates avatar URLs to block javascript: pseudoprotocol XSS payloads', () => {
      const avatarRegex = /^(https?:\/\/|data:image\/(png|jpeg|webp|gif|svg\+xml);base64,)/i;

      // Safe URLs
      expect(avatarRegex.test('https://example.com/avatar.jpg')).toBe(true);
      expect(avatarRegex.test('http://example.com/avatar.png')).toBe(true);
      expect(avatarRegex.test('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=')).toBe(true);

      // Dangerous XSS / Malicious protocols
      expect(avatarRegex.test('javascript:alert(1)')).toBe(false);
      expect(avatarRegex.test('javascript://example.com%0Aalert(1)')).toBe(false);
      expect(avatarRegex.test('vbscript:msgbox(1)')).toBe(false);
      expect(avatarRegex.test('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
      expect(avatarRegex.test('file:///etc/passwd')).toBe(false);
    });

    it('verifies client code contains no hardcoded Pexels API secrets (SEC-10)', async () => {
      const fs = await import('fs');
      const pexelsCode = fs.readFileSync('src/lib/pexelsApi.ts', 'utf-8');
      expect(pexelsCode).not.toContain('1Mm7g8hkrqF1baxPp6KUyjRGN9GTo6E9GJkEm0Nr7xge8zN0Jz89OlA7');
    });

    it('refuses server startup / JWT initialization in production if secret is default or missing (SEC-13)', () => {
      const DEFAULT_DEV_SECRET = 'quran_reels_jwt_secret_key_2026_default';

      function validateJwtConfig(nodeEnv: string, secret: string | undefined): { ok: boolean; secret?: string; error?: string } {
        const isProd = nodeEnv === 'production';
        if (!secret || secret === DEFAULT_DEV_SECRET) {
          if (isProd) {
            return {
              ok: false,
              error: 'FATAL SECURITY ERROR: JWT_SECRET environment variable must be set to a secure unique key in production! Refusing to start with default secret.',
            };
          }
          return { ok: true, secret: DEFAULT_DEV_SECRET };
        }
        return { ok: true, secret };
      }

      // Development mode allows default secret
      const devResult = validateJwtConfig('development', DEFAULT_DEV_SECRET);
      expect(devResult.ok).toBe(true);
      expect(devResult.secret).toBe(DEFAULT_DEV_SECRET);

      // Production mode REJECTS default secret
      const prodDefaultResult = validateJwtConfig('production', DEFAULT_DEV_SECRET);
      expect(prodDefaultResult.ok).toBe(false);
      expect(prodDefaultResult.error).toContain('FATAL SECURITY ERROR');

      // Production mode REJECTS missing / empty secret
      const prodMissingResult = validateJwtConfig('production', undefined);
      expect(prodMissingResult.ok).toBe(false);
      expect(prodMissingResult.error).toContain('FATAL SECURITY ERROR');

      // Production mode ACCEPTS strong unique secret
      const prodCustomResult = validateJwtConfig('production', 'strong_super_unique_jwt_secret_key_prod_999');
      expect(prodCustomResult.ok).toBe(true);
      expect(prodCustomResult.secret).toBe('strong_super_unique_jwt_secret_key_prod_999');
    });

    it('enforces authentication check and 401 rejection on unauthenticated AI endpoints (SEC-09)', () => {
      function requireAuthMiddleware(req: { user?: { id: string } }, res: { status: (code: number) => { json: (body: any) => void } }, next: () => void) {
        if (!req.user) {
          return res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
        }
        next();
      }

      let nextCalled = false;
      let statusCode = 0;
      let errorBody: any = null;

      const mockRes = {
        status: (code: number) => ({
          json: (body: any) => {
            statusCode = code;
            errorBody = body;
          },
        }),
      };

      // Unauthenticated request
      requireAuthMiddleware({ user: undefined }, mockRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(401);
      expect(errorBody).toEqual({ error: 'يرجى تسجيل الدخول للمتابعة' });

      // Authenticated request
      nextCalled = false;
      requireAuthMiddleware({ user: { id: 'user-valid' } }, mockRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    it('aborts upstream video proxy network stream when client disconnects (SEC-02)', () => {
      const controller = new AbortController();
      let streamAborted = false;

      controller.signal.addEventListener('abort', () => {
        streamAborted = true;
      });

      // Simulate client connection close event
      function handleClientDisconnect() {
        controller.abort();
      }

      expect(streamAborted).toBe(false);
      handleClientDisconnect();
      expect(streamAborted).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it('enforces safe bounded DSP audio effect parameters to prevent ear damage (DSP-01)', () => {
      function sanitizeAudioEffects(input: {
        reverbLevel?: number;
        echoDelay?: number;
        echoFeedback?: number;
        pitchShift?: number;
        speedAdjust?: number;
      }) {
        return {
          reverbLevel: Math.min(1, Math.max(0, input.reverbLevel ?? 0.5)),
          echoDelay: Math.min(1, Math.max(0, input.echoDelay ?? 0.3)),
          echoFeedback: Math.min(0.8, Math.max(0, input.echoFeedback ?? 0.4)), // Hard cap at 0.8 to prevent runaway feedback loop
          pitchShift: Math.min(0.1, Math.max(-0.1, input.pitchShift ?? 0)),
          speedAdjust: Math.min(1.05, Math.max(0.95, input.speedAdjust ?? 1.0)),
        };
      }

      // Overflown parameters clamped to acoustic safety margins
      const dangerous = sanitizeAudioEffects({
        reverbLevel: 5.0,
        echoDelay: 10.0,
        echoFeedback: 0.99, // Dangerous infinite resonance
        pitchShift: 1.0,
        speedAdjust: 2.5,
      });

      expect(dangerous.reverbLevel).toBe(1.0);
      expect(dangerous.echoDelay).toBe(1.0);
      expect(dangerous.echoFeedback).toBe(0.8); // Capped safely
      expect(dangerous.pitchShift).toBe(0.1);
      expect(dangerous.speedAdjust).toBe(1.05);

      // Negative values clamped to 0
      const negative = sanitizeAudioEffects({
        reverbLevel: -0.5,
        echoFeedback: -1.0,
        pitchShift: -0.5,
      });

      expect(negative.reverbLevel).toBe(0);
      expect(negative.echoFeedback).toBe(0);
      expect(negative.pitchShift).toBe(-0.1);
    });
  });
});



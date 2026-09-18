import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getAuthToken,
  setAuthToken,
  onAuthStateChanged,
  notifyAuthListeners,
  api,
  User,
} from '@/lib/api';

describe('Client API Client & Auth Token Lifecycle (src/lib/api.ts)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Auth Token Storage', () => {
    it('stores token in localStorage when setAuthToken is called with valid string', () => {
      expect(getAuthToken()).toBeNull();

      setAuthToken('test-jwt-token-12345');
      expect(getAuthToken()).toBe('test-jwt-token-12345');
      expect(localStorage.getItem('quran_reels_jwt')).toBe('test-jwt-token-12345');
    });

    it('clears token from localStorage when setAuthToken is called with null', () => {
      setAuthToken('token-to-be-removed');
      expect(getAuthToken()).toBe('token-to-be-removed');

      setAuthToken(null);
      expect(getAuthToken()).toBeNull();
      expect(localStorage.getItem('quran_reels_jwt')).toBeNull();
    });
  });

  describe('Auth State Change Event Listeners', () => {
    it('notifies registered listeners when auth state transitions occur', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      const unsubscribeA = onAuthStateChanged(listenerA);
      const unsubscribeB = onAuthStateChanged(listenerB);

      const mockUser: User = {
        id: 'user-001',
        email: 'creator@example.com',
        display_name: 'القارئ أحمد',
        avatar_url: 'https://example.com/avatar.jpg',
        bio: 'صانع محتوى قرآني',
        role: 'user',
      };

      notifyAuthListeners(mockUser);
      expect(listenerA).toHaveBeenCalledWith(mockUser);
      expect(listenerB).toHaveBeenCalledWith(mockUser);

      // Unsubscribe listener A
      unsubscribeA();

      notifyAuthListeners(null);
      expect(listenerA).toHaveBeenCalledTimes(1); // Was unsubscribed, not called with null
      expect(listenerB).toHaveBeenCalledTimes(2); // Still subscribed, called with null
      expect(listenerB).toHaveBeenLastCalledWith(null);

      unsubscribeB();
    });
  });

  describe('Request Mechanics & Authorization Headers', () => {
    it('attaches Bearer token header to outgoing requests when authenticated', async () => {
      setAuthToken('bearer-jwt-token-xyz');

      let capturedHeaders: any = null;
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
        capturedHeaders = options?.headers;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: 'vid-1', surah_name: 'الفاتحة' }),
        } as any;
      });

      const video = await api.videos.getById('vid-1');
      expect(video).toBeDefined();
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders['Authorization']).toBe('Bearer bearer-jwt-token-xyz');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });

    it('omits Authorization header when token is not present', async () => {
      setAuthToken(null);

      let capturedHeaders: any = null;
      vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
        capturedHeaders = options?.headers;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [],
        } as any;
      });

      await api.videos.getPublic();
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders['Authorization']).toBeUndefined();
    });
  });

  describe('401 Unauthorized Automatic Eviction & Stale Session Cleanup', () => {
    it('clears token from localStorage and dispatches null user on HTTP 401 error', async () => {
      setAuthToken('expired-or-invalid-jwt');
      const authListener = vi.fn();
      const unsub = onAuthStateChanged(authListener);

      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ error: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' }),
        } as any;
      });

      await expect(api.videos.getMy()).rejects.toThrow('انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');

      // Verify token was evicted from storage
      expect(getAuthToken()).toBeNull();
      // Verify listeners were notified with null
      expect(authListener).toHaveBeenCalledWith(null);

      unsub();
    });
  });

  describe('Safe Parsing on Non-JSON & HTML Error Pages', () => {
    it('safely extracts text error without JSON SyntaxError when server returns HTML error page (e.g. 502/504)', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: false,
          status: 502,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '502 Bad Gateway: Upstream Server Down',
        } as any;
      });

      await expect(api.achievements.getAll()).rejects.toThrow('502 Bad Gateway: Upstream Server Down');
    });

    it('uses fallback HTTP error message when response body is empty', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: false,
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => null,
          text: async () => '',
        } as any;
      });

      await expect(api.social.getFeed()).rejects.toThrow('خطأ في الخادم (500)');
    });
  });

  describe('Concurrent Request Deduplication & Connection Storm Prevention', () => {
    it('deduplicates concurrent getMe calls into a single network request', async () => {
      setAuthToken('valid-token-123');
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ user: { id: 'u1', email: 'test@example.com' } }),
        } as any;
      });

      // Fire 20 concurrent getMe requests (as when dozens of components mount)
      const results = await Promise.all(
        Array.from({ length: 20 }, () => api.auth.getMe())
      );

      expect(results).toHaveLength(20);
      expect(results[0].user?.id).toBe('u1');
      // Must only make ONE network call, not 20!
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent getFavorites calls and serves from in-memory cache', async () => {
      setAuthToken('valid-token-123');
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ surahs: [1, 2, 3], reciters: ['mishari'], performers: [] }),
        } as any;
      });

      // Fire 114 concurrent getFavorites requests (as when 114 SurahCards mount)
      const results = await Promise.all(
        Array.from({ length: 114 }, () => api.users.getFavorites())
      );

      expect(results).toHaveLength(114);
      expect(results[0].surahs).toEqual([1, 2, 3]);
      // Must only make ONE network call, not 114!
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Subsequent call also served from cache
      const cached = await api.users.getFavorites();
      expect(cached.surahs).toEqual([1, 2, 3]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Password Management', () => {
    it('sends PUT /api/auth/password with Authorization header, currentPassword and newPassword', async () => {
      setAuthToken('user-valid-token');
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
        expect(url).toBe('/api/auth/password');
        expect(init?.method).toBe('PUT');
        const headers = init?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer user-valid-token');
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ currentPassword: 'OldSecret123', newPassword: 'NewSecret123' });
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true, message: 'تم تحديث كلمة المرور بنجاح' }),
        } as any;
      });

      const res = await api.auth.changePassword('OldSecret123', 'NewSecret123');
      expect(res.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Quran & Ibtahalat Reel Maker - Centralized MySQL Backend API Client
 */

const TOKEN_KEY = 'quran_reels_jwt';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: 'admin' | 'moderator' | 'user';
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  email?: string;
  public_videos_count?: number;
  followers_count?: number;
  following_count?: number;
}

export interface SavedVideo {
  id: string;
  user_id: string;
  surah_name: string;
  surah_number: number;
  start_ayah: number;
  end_ayah: number;
  reciter_id: string;
  reciter_name: string;
  video_url: string | null;
  thumbnail_url: string | null;
  aspect_ratio: string;
  background_type: string;
  is_public: boolean;
  created_at: string;
  display_name?: string | null;
  avatar_url?: string | null;
  likes_count?: number;
  comments_count?: number;
}

export interface VideoComment {
  id: string;
  video_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  replies?: VideoComment[];
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'free' | 'monthly' | 'yearly';
  status: string;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

export interface PaymentRequest {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  currency?: string;
  payment_method: string;
  phone_number: string;
  transfer_reference?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  email?: string;
  display_name?: string;
}

export interface Achievement {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  threshold: number;
  points: number;
  unlocked_at?: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    cachedMeUser = null;
    getMePromise = null;
    cachedFavorites = null;
    getFavoritesPromise = null;
  }
}

let authListeners: Array<(user: User | null) => void> = [];
let cachedMeUser: User | null = null;
let getMePromise: Promise<{ user: User | null }> | null = null;
let cachedFavorites: { surahs: number[]; reciters: string[]; performers: string[] } | null = null;
let getFavoritesPromise: Promise<{ surahs: number[]; reciters: string[]; performers: string[] }> | null = null;

export function invalidateFavoritesCache() {
  cachedFavorites = null;
  getFavoritesPromise = null;
}

export function onAuthStateChanged(listener: (user: User | null) => void) {
  authListeners.push(listener);
  return () => {
    authListeners = authListeners.filter((l) => l !== listener);
  };
}

export function notifyAuthListeners(user: User | null) {
  cachedMeUser = user;
  if (!user) {
    cachedFavorites = null;
    getFavoritesPromise = null;
  }
  authListeners.forEach((l) => l(user));
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Abort controller with 30s timeout to prevent indefinitely hung network requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(endpoint, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');
    let data: any = null;
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      try {
        data = await response.text();
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      // If unauthorized, clean up invalid expired token
      if (response.status === 401 && token) {
        setAuthToken(null);
        notifyAuthListeners(null);
      }

      const errorMsg = data?.error || (typeof data === 'string' && data.length > 0 ? data : `خطأ في الخادم (${response.status})`);
      throw new Error(errorMsg);
    }

    return data as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت.');
    }
    throw err;
  }
}

export const api = {
  auth: {
    async register(email: string, password: string, displayName?: string) {
      const res = await request<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      setAuthToken(res.token);
      notifyAuthListeners(res.user);
      return res;
    },

    async login(email: string, password: string) {
      const res = await request<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(res.token);
      notifyAuthListeners(res.user);
      return res;
    },

    async logout() {
      setAuthToken(null);
      notifyAuthListeners(null);
      return { success: true };
    },

    async getMe(): Promise<{ user: User | null }> {
      const token = getAuthToken();
      if (!token) {
        cachedMeUser = null;
        return { user: null };
      }
      if (cachedMeUser) {
        return { user: cachedMeUser };
      }
      if (getMePromise) {
        return getMePromise;
      }
      getMePromise = (async () => {
        try {
          const res = await request<{ user: User }>('/api/auth/me');
          cachedMeUser = res.user;
          notifyAuthListeners(res.user);
          return res;
        } catch {
          setAuthToken(null);
          cachedMeUser = null;
          notifyAuthListeners(null);
          return { user: null };
        } finally {
          getMePromise = null;
        }
      })();
      return getMePromise;
    },

    async updateProfile(profileData: { display_name?: string; avatar_url?: string; bio?: string }) {
      return request<{ success: boolean }>('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(profileData),
      });
    },

    async changePassword(currentPassword: string, newPassword: string) {
      return request<{ success: boolean; message: string }>('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },

    async deleteAccount(password: string) {
      const res = await request<{ success: boolean; message: string }>('/api/auth/delete-account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      setAuthToken(null);
      notifyAuthListeners(null);
      return res;
    },
  },

  videos: {
    async getPublic(params: { surah?: number; reciter?: string; search?: string; userId?: string } = {}) {
      const query = new URLSearchParams();
      if (params.surah) query.set('surah', params.surah.toString());
      if (params.reciter) query.set('reciter', params.reciter);
      if (params.search) query.set('search', params.search);
      if (params.userId) query.set('userId', params.userId);

      const qs = query.toString();
      return request<SavedVideo[]>(`/api/videos${qs ? `?${qs}` : ''}`);
    },

    async getMy() {
      return request<SavedVideo[]>('/api/videos/my');
    },

    async getById(id: string) {
      return request<{ video: SavedVideo; likesCount: number; isLiked: boolean }>(`/api/videos/${id}`);
    },

    async create(videoData: Partial<SavedVideo>) {
      return request<SavedVideo>('/api/videos', {
        method: 'POST',
        body: JSON.stringify(videoData),
      });
    },

    async delete(id: string) {
      return request<{ success: boolean }>(`/api/videos/${id}`, {
        method: 'DELETE',
      });
    },

    async update(id: string, data: { surah_name?: string; is_public?: boolean }) {
      return request<SavedVideo>(`/api/videos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    async duplicate(id: string) {
      return request<SavedVideo>(`/api/videos/${id}/duplicate`, {
        method: 'POST',
      });
    },

    async getComments(videoId: string) {
      return request<VideoComment[]>(`/api/videos/${videoId}/comments`);
    },

    async addComment(videoId: string, content: string, parentId?: string | null) {
      return request<VideoComment>(`/api/videos/${videoId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parent_id: parentId }),
      });
    },

    async deleteComment(videoId: string, commentId: string) {
      return request<{ success: boolean }>(`/api/videos/${videoId}/comments/${commentId}`, {
        method: 'DELETE',
      });
    },

    async toggleLike(videoId: string) {
      return request<{ isLiked: boolean; likesCount: number }>(`/api/videos/${videoId}/likes/toggle`, {
        method: 'POST',
      });
    },
  },

  users: {
    async getProfile(userId: string) {
      return request<{ profile: Profile; isFollowing: boolean }>(`/api/users/${userId}/profile`);
    },

    async toggleFollow(userId: string) {
      return request<{ isFollowing: boolean; followersCount: number }>(`/api/users/${userId}/follow/toggle`, {
        method: 'POST',
      });
    },

    async getFavorites() {
      const token = getAuthToken();
      if (!token) {
        return { surahs: [], reciters: [], performers: [] };
      }
      if (cachedFavorites) {
        return cachedFavorites;
      }
      if (getFavoritesPromise) {
        return getFavoritesPromise;
      }
      getFavoritesPromise = (async () => {
        try {
          const res = await request<{ surahs: number[]; reciters: string[]; performers: string[] }>('/api/users/me/favorites');
          cachedFavorites = {
            surahs: Array.isArray(res?.surahs) ? res.surahs : [],
            reciters: Array.isArray(res?.reciters) ? res.reciters : [],
            performers: Array.isArray(res?.performers) ? res.performers : [],
          };
          return cachedFavorites;
        } finally {
          getFavoritesPromise = null;
        }
      })();
      return getFavoritesPromise;
    },

    async toggleFavoriteSurah(surah_number: number) {
      const res = await request<{ isFavorite: boolean }>('/api/users/me/favorites/surah/toggle', {
        method: 'POST',
        body: JSON.stringify({ surah_number }),
      });
      if (cachedFavorites) {
        if (res.isFavorite) {
          if (!cachedFavorites.surahs.includes(surah_number)) {
            cachedFavorites.surahs = [...cachedFavorites.surahs, surah_number];
          }
        } else {
          cachedFavorites.surahs = cachedFavorites.surahs.filter((n) => n !== surah_number);
        }
      }
      return res;
    },

    async toggleFavoriteReciter(reciter_id: string) {
      const res = await request<{ isFavorite: boolean }>('/api/users/me/favorites/reciter/toggle', {
        method: 'POST',
        body: JSON.stringify({ reciter_id }),
      });
      if (cachedFavorites) {
        if (res.isFavorite) {
          if (!cachedFavorites.reciters.includes(reciter_id)) {
            cachedFavorites.reciters = [...cachedFavorites.reciters, reciter_id];
          }
        } else {
          cachedFavorites.reciters = cachedFavorites.reciters.filter((id) => id !== reciter_id);
        }
      }
      return res;
    },

    async toggleFavoritePerformer(performer_id: string) {
      const res = await request<{ isFavorite: boolean }>('/api/users/me/favorites/performer/toggle', {
        method: 'POST',
        body: JSON.stringify({ performer_id }),
      });
      if (cachedFavorites) {
        if (res.isFavorite) {
          if (!cachedFavorites.performers.includes(performer_id)) {
            cachedFavorites.performers = [...cachedFavorites.performers, performer_id];
          }
        } else {
          cachedFavorites.performers = cachedFavorites.performers.filter((id) => id !== performer_id);
        }
      }
      return res;
    },
  },

  subscriptions: {
    async getCurrent() {
      return request<Subscription>('/api/subscriptions/current');
    },

    async getUsage() {
      return request<{
        count: number;
        limit: number | null;
        plan?: 'free' | 'monthly' | 'yearly';
        isPremium: boolean;
        browserRenderCount?: number;
        browserRenderLimit?: number | null;
        browserRenderRemaining?: number | null;
        cloudRenderCount?: number;
        cloudRenderLimit?: number;
        cloudRenderRemaining?: number;
        serverRenderLimit?: number;
        serverRenderCount?: number;
        serverRenderRemaining?: number;
      }>('/api/subscriptions/usage');
    },

    async incrementUsage() {
      return request<{
        success: boolean;
        count: number;
        limit: number | null;
        browserRenderCount?: number;
        browserRenderLimit?: number | null;
        browserRenderRemaining?: number | null;
      }>('/api/subscriptions/usage/increment', {
        method: 'POST',
      });
    },

    async requestPayment(payload: {
      plan: 'monthly' | 'yearly';
      amount?: number;
      payment_method: 'vodafone_cash' | 'etisalat_cash' | 'orange_cash' | 'we_pay';
      phone_number: string;
      transfer_reference?: string;
    }) {
      return request<{ success: boolean; id: string; amount: number; currency: string; message?: string }>('/api/subscriptions/request-payment', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async getHistory() {
      return request<PaymentRequest[]>('/api/subscriptions/payment-history');
    },
  },

  achievements: {
    async getAll() {
      return request<Achievement[]>('/api/achievements');
    },

    async getMy() {
      return request<Achievement[]>('/api/achievements/my');
    },

    async unlock(key: string) {
      return request<{ success: boolean; achievement?: Achievement; alreadyUnlocked?: boolean }>('/api/achievements/unlock', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
    },

    async getLeaderboard() {
      return request<any[]>('/api/achievements/leaderboard');
    },
  },

  social: {
    async getFeed() {
      return request<any[]>('/api/social/feed');
    },

    async getNotifications() {
      return request<NotificationItem[]>('/api/social/notifications');
    },

    async markNotificationRead(id: string) {
      return request<{ success: boolean }>(`/api/social/notifications/${id}/read`, {
        method: 'PUT',
      });
    },

    async markAllNotificationsRead() {
      return request<{ success: boolean }>('/api/social/notifications/read-all', {
        method: 'PUT',
      });
    },
  },

  admin: {
    async getStats() {
      return request<{ totalUsers: number; totalVideos: number; premiumUsers: number; pendingRequests: number }>('/api/admin/stats');
    },

    async getDailyStats() {
      return request<Array<{ date: string; videos: number }>>('/api/admin/daily-stats');
    },

    async getUsers() {
      return request<any[]>('/api/admin/users');
    },

    async getPaymentRequests(status?: string) {
      return request<PaymentRequest[]>(`/api/admin/payment-requests${status ? `?status=${status}` : ''}`);
    },

    async approvePayment(id: string) {
      return request<{ success: boolean }>(`/api/admin/payment-requests/${id}/approve`, {
        method: 'POST',
      });
    },

    async rejectPayment(id: string, adminNote?: string) {
      return request<{ success: boolean }>(`/api/admin/payment-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ adminNote }),
      });
    },

    async getSettings() {
      return request<{
        settings: Record<string, { value: string; isSecret: boolean; category: string }>;
      }>('/api/admin/settings');
    },

    async saveSettings(settings: Record<string, string>) {
      return request<{ success: boolean; message: string }>('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ settings }),
      });
    },

    async testQuranFoundation(payload?: { clientId?: string; clientSecret?: string; env?: string }) {
      return request<{
        success: boolean;
        message: string;
        environment: string;
        latencyMs: number;
        scopes?: string;
        expiresIn?: number;
        chaptersCount?: number;
        error?: string;
      }>('/api/admin/settings/test-quran-foundation', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    },

    async testGemini(apiKey?: string) {
      return request<{ success: boolean; message: string; latencyMs: number }>('/api/admin/settings/test-gemini', {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
    },

    async testPexels(apiKey?: string) {
      return request<{ success: boolean; message: string; latencyMs: number }>('/api/admin/settings/test-pexels', {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
    },

    async getRenderStats() {
      return request<{
        queued: number;
        running: number;
        succeededToday: number;
        failedToday: number;
        maxConcurrency: number;
        retentionHours: number;
        diskUsageMb: number;
        storageDir: string;
      }>('/api/admin/render-stats');
    },

    async cleanupRenderArtifacts() {
      return request<{
        success: boolean;
        message: string;
        currentDiskUsageMb: number;
      }>('/api/admin/render-jobs/cleanup', {
        method: 'POST',
      });
    },
  },

  quran: {
    async getStatus() {
      return request<{ configured: boolean; environment: string; clientIdMasked: string | null }>('/api/quran/status');
    },

    async getChapters(language: string = 'ar') {
      return request<{ chapters: any[] }>(`/api/quran/chapters?language=${encodeURIComponent(language)}`);
    },

    async getChapterVerses(chapterId: number, perPage: number = 300) {
      return request<{ verses: any[] }>(`/api/quran/chapter/${chapterId}/verses?per_page=${perPage}`);
    },

    async getChapterRecitation(recitationId: number, chapterNumber: number, segments: boolean = true) {
      return request<{ audio_file?: any; audio_url?: string; timestamps?: any[] }>(
        `/api/quran/chapter-recitation/${recitationId}/${chapterNumber}?segments=${segments ? 'true' : 'false'}`
      );
    },

    async getRecitations(language: string = 'ar') {
      return request<{ recitations: any[] }>(`/api/quran/recitations?language=${encodeURIComponent(language)}`);
    },
  },

  services: {
    async videoProxy(videoUrl: string): Promise<Blob> {
      const token = getAuthToken();
      const response = await fetch('/api/services/video-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ videoUrl }),
      });
      if (!response.ok) throw new Error('Video proxy request failed');
      return response.blob();
    },

    async transcribeAudio(audioBase64: string, chunkOffset?: number, language?: string, mimeType?: string) {
      return request<any>('/api/services/transcribe-audio', {
        method: 'POST',
        body: JSON.stringify({ audioBase64, chunkOffset, language, mimeType }),
      });
    },

    async refineText(lines: any[]) {
      return request<any>('/api/services/refine-text', {
        method: 'POST',
        body: JSON.stringify({ lines }),
      });
    },

    async refineTiming(lines: any[], audioDuration: number) {
      return request<any>('/api/services/refine-timing', {
        method: 'POST',
        body: JSON.stringify({ lines, audioDuration }),
      });
    },

    async pexelsSearch(params: { query?: string; orientation?: string; size?: string; per_page?: number; page?: number }) {
      const searchParams = new URLSearchParams();
      if (params.query) searchParams.set('query', params.query);
      if (params.orientation) searchParams.set('orientation', params.orientation);
      if (params.size) searchParams.set('size', params.size);
      if (params.per_page) searchParams.set('per_page', params.per_page.toString());
      if (params.page) searchParams.set('page', params.page.toString());
      return request<any>(`/api/services/pexels/search?${searchParams}`);
    },

    async pexelsPopular(params: { per_page?: number; page?: number }) {
      const searchParams = new URLSearchParams();
      if (params.per_page) searchParams.set('per_page', params.per_page.toString());
      if (params.page) searchParams.set('page', params.page.toString());
      return request<any>(`/api/services/pexels/popular?${searchParams}`);
    },

    async submitContact(data: { name: string; email: string; subject: string; message: string; category?: string }) {
      return request<{ success: boolean; message: string; prioritySupport?: boolean }>('/api/services/contact', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async generateAiImage(prompt: string, aspectRatio: '9:16' | '16:9' | '1:1' = '9:16', style: string = 'cinematic') {
      return request<{
        success: boolean;
        base64: string;
        mimeType: string;
        dataUrl: string;
        modelUsed: string;
        prompt: string;
        aspectRatio: string;
      }>('/api/services/generate-image', {
        method: 'POST',
        body: JSON.stringify({ prompt, aspectRatio, style }),
      });
    },

    async generateLogo(data: { brandName: string; subtitle?: string; style?: string }) {
      return request<{
        success: boolean;
        svg: string;
        dataUrl: string;
        brandName: string;
        style: string;
      }>('/api/services/generate-logo', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },

  renderJobs: {
    async createJob(manifest: any, idempotencyKey?: string, options?: { replaceActive?: boolean }) {
      return request<{ message: string; job: any }>('/api/render-jobs', {
        method: 'POST',
        body: JSON.stringify({
          manifest,
          idempotencyKey,
          replaceActive: options?.replaceActive,
        }),
      });
    },

    async getActiveJob() {
      return request<{
        hasActiveJob: boolean;
        job?: any;
        recentJob?: any;
      }>('/api/render-jobs/active');
    },

    async cancelActiveJob() {
      return request<{ success: boolean; cancelledCount: number }>('/api/render-jobs/cancel-active', {
        method: 'POST',
      });
    },

    async getJob(id: string) {
      return request<{ job: any }>(`/api/render-jobs/${id}`);
    },

    async cancelJob(id: string) {
      return request<{ message: string }>(`/api/render-jobs/${id}/cancel`, {
        method: 'POST',
      });
    },

    async retryJob(id: string) {
      return request<{ message: string; job: any }>(`/api/render-jobs/${id}/retry`, {
        method: 'POST',
      });
    },

    async downloadVideo(id: string): Promise<Blob> {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`/api/render-jobs/${id}/download`, {
        headers,
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || 'فشل تحميل ملف الفيديو');
      }
      return response.blob();
    },
  },
};

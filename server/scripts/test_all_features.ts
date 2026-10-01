/**
 * End-to-End System & Feature Verification Script
 * Exercises the actual frontend API client (api.*) against the live running Express backend
 */

// Intercept relative URL fetches for Node.js environment
const originalFetch = global.fetch;
global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/')) {
    url = `http://localhost:3001${url}`;
  }
  return originalFetch(url, init);
};

// Polyfill localStorage for node if needed
if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (global as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

import { api, setAuthToken } from '../../src/lib/api';

async function runVerification() {
  console.log('===========================================================');
  console.log('🕌 QURAN REELS MAKER — FULL SYSTEM & FEATURES INTEGRITY TEST');
  console.log('===========================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<any>) {
    try {
      const result = await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
      return result;
    } catch (err: any) {
      console.log(`  ❌ [FAIL] ${name} -> ${err.message}`);
      failed++;
      return null;
    }
  }

  // 1. Diagnostics & Health
  console.log('--- 1. خوادم وفحوصات النظام (Health & Diagnostics) ---');
  await test('فحص تشغيل الخادم وقاعدة البيانات (/api/health)', async () => {
    const res = await fetch('http://localhost:3001/api/health');
    const data = await res.json();
    if (res.status !== 200 || data.status !== 'ok' || data.checks?.database?.status !== 'connected') {
      throw new Error(`Health status invalid: ${JSON.stringify(data)}`);
    }
  });

  // 2. Auth Flow: Register & Token Management
  console.log('\n--- 2. منظومة المصادقة وتسجيل الدخول (Authentication) ---');
  const testUserEmail = `creator_${Date.now()}@quranreels.test`;
  const initialPassword = 'InitialSecretPass123!';

  let testUserToken = '';
  await test('إنشاء حساب جديد وتوليد JWT (api.auth.register)', async () => {
    const res = await api.auth.register(testUserEmail, initialPassword, 'مبدع التلاوات القرآنية');
    if (!res.token || res.user.email !== testUserEmail) {
      throw new Error('فشل إنشاء الحساب أو فقدان التوكن');
    }
    testUserToken = res.token;
  });

  await test('جلب الملف الشخصي للمستخدم الحالي (api.auth.getMe)', async () => {
    const res = await api.auth.getMe();
    if (!res.user || res.user.email !== testUserEmail) {
      throw new Error('فشل جلب بيانات المستخدم المصادق');
    }
  });

  await test('تحديث بيانات الملف الشخصي والنبذة (api.auth.updateProfile)', async () => {
    const res = await api.auth.updateProfile({
      display_name: 'القارئ المبدع 2026',
      bio: 'صانع محتوى قرآني وتلاوات خاشعة وتواشيح دينية',
    });
    if (!res.success) throw new Error('فشل تحديث الملف الشخصي');
  });

  await test('تغيير كلمة المرور للمستخدم المسجل (api.auth.changePassword)', async () => {
    const res = await api.auth.changePassword(initialPassword, 'UpdatedSecretPass456!');
    if (!res.success) throw new Error('فشل تغيير كلمة المرور');
  });

  await test('تسجيل الخروج ومسح التوكن (api.auth.logout)', async () => {
    await api.auth.logout();
    const res = await api.auth.getMe();
    if (res.user !== null) throw new Error('فشل تسجيل الخروج، التوكن ما زال موجوداً');
  });

  await test('تسجيل الدخول بكلمة المرور الجديدة (api.auth.login)', async () => {
    const res = await api.auth.login(testUserEmail, 'UpdatedSecretPass456!');
    if (!res.token || res.user.email !== testUserEmail) {
      throw new Error('فشل تسجيل الدخول بكلمة المرور المحدثة');
    }
    testUserToken = res.token;
  });

  await test('إعادة تعيين كلمة المرور عبر الاستعادة (api.auth.resetPassword)', async () => {
    const res = await api.auth.resetPassword(testUserEmail, 'RecoveredPass789!');
    if (!res.success) throw new Error('فشل استعادة كلمة المرور');
  });

  // Switch back to test user
  setAuthToken(testUserToken);

  // 3. Reels & Videos Lifecycle
  console.log('\n--- 3. إنشاء وإدارة الريلز القرآنية (Videos & Reels) ---');
  let savedVideoId = '';

  await test('حفظ ريلز قرآني جديد (api.videos.create)', async () => {
    const res = await api.videos.create({
      surah_name: 'الرحمن',
      surah_number: 55,
      start_ayah: 1,
      end_ayah: 13,
      reciter_id: 'ar.alafasy',
      reciter_name: 'مشاري راشد العفاسي',
      aspect_ratio: '9:16',
      background_type: 'nature',
      is_public: true,
    });
    if (!res.id || res.surah_name !== 'الرحمن') {
      throw new Error('فشل إنشاء وحفظ الفيديو القرآني');
    }
    savedVideoId = res.id;
  });

  await test('استرجاع الفيديوهات العامة في الاستكشاف (api.videos.getPublic)', async () => {
    const list = await api.videos.getPublic();
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('فشل استرجاع قائمة الفيديوهات العامة');
    }
  });

  await test('استرجاع مكتبة الفيديوهات الخاصة بالمستخدم (api.videos.getMy)', async () => {
    const myVideos = await api.videos.getMy();
    if (!Array.isArray(myVideos) || !myVideos.some(v => v.id === savedVideoId)) {
      throw new Error('الفيديو المنشأ حديثاً غير موجود في مكتبة المستخدم');
    }
  });

  await test('جلب تفاصيل الفيديو والإعجابات (api.videos.getById)', async () => {
    const detail = await api.videos.getById(savedVideoId);
    if (!detail.video || detail.video.surah_number !== 55) {
      throw new Error('فشل استرجاع تفاصيل الفيديو');
    }
  });

  await test('التبديل بين الإعجاب وإلغاء الإعجاب (api.videos.toggleLike)', async () => {
    const like1 = await api.videos.toggleLike(savedVideoId);
    if (!like1.isLiked || like1.likesCount < 1) {
      throw new Error('فشل تسجيل الإعجاب بالفيديو');
    }
    const like2 = await api.videos.toggleLike(savedVideoId);
    if (like2.isLiked) {
      throw new Error('فشل إلغاء الإعجاب بالفيديو');
    }
  });

  let createdCommentId = '';
  await test('إضافة تعليق على الريلز (api.videos.addComment)', async () => {
    const comment = await api.videos.addComment(savedVideoId, 'تلاوة عطرة جداً، جزاكم الله خيراً!');
    if (!comment.id || !comment.content) {
      throw new Error('فشل نشر التعليق على الفيديو');
    }
    createdCommentId = comment.id;
  });

  await test('جلب التعليقات المتسلسلة للفيديو (api.videos.getComments)', async () => {
    const comments = await api.videos.getComments(savedVideoId);
    if (!Array.isArray(comments) || !comments.some(c => c.id === createdCommentId)) {
      throw new Error('فشل جلب قائمة تعليقات الفيديو');
    }
  });

  await test('حذف التعليق المنشور (api.videos.deleteComment)', async () => {
    const res = await api.videos.deleteComment(savedVideoId, createdCommentId);
    if (!res.success) throw new Error('فشل حذف التعليق');
  });

  // 4. Subscriptions & Payment Requests
  console.log('\n--- 4. نظام الاشتراكات والحصص اليومية (Subscriptions) ---');
  await test('استعلام خطة الاشتراك الحالية (api.subscriptions.getCurrent)', async () => {
    const sub = await api.subscriptions.getCurrent();
    if (!sub || sub.plan !== 'free') {
      throw new Error(`حالة الاشتراك غير صحيحة: ${sub?.plan}`);
    }
  });

  await test('استعلام الحصة اليومية للفيديوهات (api.subscriptions.getUsage)', async () => {
    const usage = await api.subscriptions.getUsage();
    if (typeof usage.count !== 'number' || usage.limit !== 3) {
      throw new Error(`عداد الاستخدام غير صحيح: ${JSON.stringify(usage)}`);
    }
  });

  await test('تقديم طلب ترقية عبر المحافظ الإلكترونية (api.subscriptions.requestPayment)', async () => {
    const req = await api.subscriptions.requestPayment({
      plan: 'monthly',
      amount: 50,
      payment_method: 'vodafone_cash',
      phone_number: '01012345678',
    });
    if (!req.success || !req.id) {
      throw new Error('فشل تقديم طلب الترقية والدفع');
    }
  });

  await test('استعراض سجل مدفوعات المستخدم (api.subscriptions.getHistory)', async () => {
    const history = await api.subscriptions.getHistory();
    if (!Array.isArray(history) || history.length === 0) {
      throw new Error('فشل جلب سجل مدفوعات المستخدم');
    }
  });

  // 5. User Favorites
  console.log('\n--- 5. قائمة المفضلة (Surahs, Reciters & Performers) ---');
  await test('إضافة سورة للمفضلة (api.users.toggleFavoriteSurah)', async () => {
    const res = await api.users.toggleFavoriteSurah(55);
    if (!res.isFavorite) throw new Error('فشل إضافة السورة للمفضلة');
  });

  await test('إضافة قارئ للمفضلة (api.users.toggleFavoriteReciter)', async () => {
    const res = await api.users.toggleFavoriteReciter('ar.alafasy');
    if (!res.isFavorite) throw new Error('فشل إضافة القارئ للمفضلة');
  });

  await test('إضافة مبتهل للمفضلة (api.users.toggleFavoritePerformer)', async () => {
    const res = await api.users.toggleFavoritePerformer('naqshbandi');
    if (!res.isFavorite) throw new Error('فشل إضافة المبتهل للمفضلة');
  });

  await test('استرجاع كافة المفضلات دفعة واحدة (api.users.getFavorites)', async () => {
    const favs = await api.users.getFavorites();
    if (!favs.surahs.includes(55) || !favs.reciters.includes('ar.alafasy') || !favs.performers.includes('naqshbandi')) {
      throw new Error(`محتوى المفضلات غير مطابق: ${JSON.stringify(favs)}`);
    }
  });

  // 6. Gamification & Achievements
  console.log('\n--- 6. الأوسمة وقائمة المتصدرين (Achievements & Leaderboard) ---');
  await test('استعراض قائمة الأوسمة والإنجازات (api.achievements.getAll)', async () => {
    const list = await api.achievements.getAll();
    if (!Array.isArray(list) || list.length < 10) {
      throw new Error(`عدد الأوسمة أقل من المتوقع: ${list?.length}`);
    }
  });

  await test('فتح وسام صناعة أول فيديو (api.achievements.unlock)', async () => {
    const res = await api.achievements.unlock('first_video');
    if (!res.success && !res.alreadyUnlocked) throw new Error('فشل فتح وسام أول فيديو');
  });

  await test('استعراض لوحة المتصدرين (api.achievements.getLeaderboard)', async () => {
    const board = await api.achievements.getLeaderboard();
    if (!Array.isArray(board)) throw new Error('فشل جلب لوحة المتصدرين');
  });

  await test('استعراض خلاصة النشاط الاجتماعي (api.social.getFeed)', async () => {
    const feed: any = await api.social.getFeed();
    if (!feed || (!Array.isArray(feed) && !Array.isArray(feed.activities))) {
      throw new Error('فشل جلب خلاصة النشاط');
    }
  });

  // Final Cleanup
  await api.videos.delete(savedVideoId);

  console.log('\n===========================================================');
  console.log(`🏁 RESULT: ${passed} PASSED / ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('===========================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});

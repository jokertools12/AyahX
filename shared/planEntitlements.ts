/**
 * Product-plan rules shared by the browser application and the API.
 *
 * Keep this file deliberately framework-free: the UI uses it to avoid showing
 * unavailable controls while the API uses the same rules as the final source
 * of truth for cloud renders and paid services.
 */

export const SUBSCRIPTION_PLANS = ['free', 'monthly', 'yearly'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const EXPORT_QUALITIES = ['medium', 'high', 'ultra'] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

export const EXPORT_FPS = [30, 60] as const;
export type ExportFps = (typeof EXPORT_FPS)[number];

export const AUDIO_BITRATES = ['128k', '192k', '320k'] as const;
export type AudioBitrate = (typeof AUDIO_BITRATES)[number];

export const FREE_FONTS = [
  '"Noto Naskh Arabic", serif',
  '"Amiri", serif',
  '"Cairo", sans-serif',
] as const;

/** The complete Arabic/Ottoman font catalog rendered by both engines. */
export const PREMIUM_FONTS = [
  '"Amiri Quran", serif',
  '"Scheherazade New", serif',
  '"Aref Ruqaa", serif',
  '"Reem Kufi", sans-serif',
  '"Lateef", serif',
  '"El Messiri", sans-serif',
  '"Tajawal", sans-serif',
  '"Mada", sans-serif',
  '"Katibeh", serif',
  '"Rakkas", serif',
  '"Lalezar", cursive',
  '"Mirza", serif',
  '"Marhey", cursive',
] as const;

export const ARABIC_FONT_CATALOG = [...FREE_FONTS, ...PREMIUM_FONTS] as const;

export const BASIC_BACKGROUND_CATEGORIES = [
  'islamic',
  'nature',
  'sky',
  'water',
  'mountain',
  'forest',
  'desert',
] as const;

/**
 * The free plan is intentionally limited to the curated still-image catalog.
 * A category alone is not a sufficient permission check: it is user supplied
 * in a render manifest and could otherwise turn any remote URL into a
 * "nature" background.
 */
export const FREE_BACKGROUND_ASSET_URLS: Readonly<Record<string, string>> = {
  'mountain-1': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4',
  'mountain-2': 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b',
  'mountain-3': 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606',
  'mountain-4': 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99',
  'mountain-5': 'https://images.unsplash.com/photo-1519681393784-d120267933ba',
  'mountain-6': 'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5',
  'desert-1': 'https://images.unsplash.com/photo-1509316785289-025f5b846b35',
  'desert-2': 'https://images.unsplash.com/photo-1473580044384-7ba9967e16a0',
  'desert-3': 'https://images.unsplash.com/photo-1542401886-65d6c61db217',
  'desert-4': 'https://images.unsplash.com/photo-1547234935-80c7145ec969',
  'ocean-img-1': 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0',
  'ocean-img-2': 'https://images.unsplash.com/photo-1518837695005-2083093ee35b',
  'waterfall-1': 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9',
  'lake-1': 'https://images.unsplash.com/photo-1439066615861-d1af74d74000',
  'lake-2': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
  'rain-1': 'https://images.unsplash.com/photo-1428592953211-077101b2021b',
  'ocean-3': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
  'waterfall-2': 'https://images.unsplash.com/photo-1494472155656-f34e81b17ddc',
  'sky-1': 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6',
  'stars-img-1': 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a',
  'aurora-1': 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7',
  'sunset-1': 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869',
  'sunset-2': 'https://images.unsplash.com/photo-1472120435266-53107fd0c44a',
  'clouds-1': 'https://images.unsplash.com/photo-1534088568595-a066f410bcda',
  'milkyway-1': 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564',
  'sunrise-1': 'https://images.unsplash.com/photo-1500382017468-9049fed747ef',
  'sunset-3': 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
  'forest-img-1': 'https://images.unsplash.com/photo-1448375240586-882707db888b',
  'forest-img-2': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e',
  'forest-img-3': 'https://images.unsplash.com/photo-1476362174823-3a23f4aa6d76',
  'forest-img-4': 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d',
  'forest-img-5': 'https://images.unsplash.com/photo-1425913397330-cf8af2ff40a1',
  'forest-img-6': 'https://images.unsplash.com/photo-1440581572325-0bea30075d9d',
  'mosque-1': 'https://images.unsplash.com/photo-1564769625905-50e93615e769',
  'mosque-2': 'https://images.unsplash.com/photo-1591604129939-f1efa0a2d71c',
  'mosque-3': 'https://images.unsplash.com/photo-1584551246679-0daf3d275d0f',
  'mosque-4': 'https://images.unsplash.com/photo-1545167496-c1f3de6d96c3',
  'mosque-5': 'https://images.unsplash.com/photo-1542816417-0983c9c9ad53',
  'mosque-6': 'https://images.unsplash.com/photo-1519817650390-64a93db51149',
  'nature-1': 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05',
  'nature-2': 'https://images.unsplash.com/photo-1501854140801-50d01698950b',
  'nature-3': 'https://images.unsplash.com/photo-1469474968028-56623f02e42e',
  'flower-1': 'https://images.unsplash.com/photo-1490750967868-88aa4486c946',
  'nature-4': 'https://images.unsplash.com/photo-1433086966358-54859d0ed716',
  'nature-5': 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e',
  'nature-6': 'https://images.unsplash.com/photo-1465056836900-8f1e940f2114',
  'nature-7': 'https://images.unsplash.com/photo-1518173946687-a1e0e1efbd7e',
  'nature-8': 'https://images.unsplash.com/photo-1491002052546-bf38f186af56',
};

export const RENDER_ENGINES = ['browser', 'ffmpeg_ass', 'skia_canvas'] as const;
export type RenderEngineType = (typeof RENDER_ENGINES)[number];

export type PremiumFeature =
  | 'pexelsVideos'
  | 'aiBackgrounds'
  | 'animatedBackgrounds'
  | 'premiumFonts'
  | 'customBranding'
  | 'aiLogo'
  | 'audioFilters'
  | 'copyrightProtection'
  | 'premiumTemplates'
  | 'prioritySupport'
  | 'priorityCloudQueue'
  | 'customBackgrounds'
  | 'ffmpegAss'
  | 'backgroundAsync';

export interface PlanEntitlements {
  plan: SubscriptionPlan;
  /** null means unlimited. */
  browserDailyLimit: number | null;
  cloudDailyLimit: number;
  /** Idea 1: Native FFmpeg ASS superfast renderer daily limit */
  ffmpegAssDailyLimit: number;
  /** Idea 2: Native Skia / Rust Canvas frame-by-frame studio daily limit */
  skiaCanvasDailyLimit: number;
  /** Idea 3: Asynchronous background rendering with notification daily limit */
  backgroundAsyncDailyLimit: number;
  allowedQualities: readonly ExportQuality[];
  allowedFps: readonly ExportFps[];
  allowedAudioBitrates: readonly AudioBitrate[];
  features: Readonly<Record<PremiumFeature, boolean>>;
}

const FREE_FEATURES: Readonly<Record<PremiumFeature, boolean>> = {
  pexelsVideos: false,
  aiBackgrounds: false,
  animatedBackgrounds: false,
  premiumFonts: false,
  customBranding: false,
  aiLogo: false,
  audioFilters: false,
  copyrightProtection: false,
  premiumTemplates: false,
  prioritySupport: false,
  priorityCloudQueue: false,
  customBackgrounds: false,
  ffmpegAss: false,
  backgroundAsync: false,
};

const PREMIUM_FEATURES: Readonly<Record<PremiumFeature, boolean>> = {
  pexelsVideos: true,
  aiBackgrounds: true,
  animatedBackgrounds: true,
  premiumFonts: true,
  customBranding: true,
  aiLogo: true,
  audioFilters: true,
  copyrightProtection: true,
  premiumTemplates: true,
  prioritySupport: true,
  priorityCloudQueue: true,
  customBackgrounds: true,
  ffmpegAss: true,
  backgroundAsync: true,
};

export const PLAN_ENTITLEMENTS: Readonly<Record<SubscriptionPlan, PlanEntitlements>> = {
  free: {
    plan: 'free',
    browserDailyLimit: 5,
    cloudDailyLimit: 1,
    ffmpegAssDailyLimit: 1,
    skiaCanvasDailyLimit: 2,
    backgroundAsyncDailyLimit: 0,
    allowedQualities: ['medium', 'high'],
    allowedFps: [30],
    allowedAudioBitrates: ['192k'],
    features: FREE_FEATURES,
  },
  monthly: {
    plan: 'monthly',
    browserDailyLimit: null,
    cloudDailyLimit: 15,
    ffmpegAssDailyLimit: 30,
    skiaCanvasDailyLimit: 15,
    backgroundAsyncDailyLimit: 20,
    allowedQualities: ['medium', 'high', 'ultra'],
    allowedFps: [30, 60],
    allowedAudioBitrates: ['128k', '192k', '320k'],
    features: PREMIUM_FEATURES,
  },
  yearly: {
    plan: 'yearly',
    browserDailyLimit: null,
    cloudDailyLimit: 25,
    ffmpegAssDailyLimit: 60,
    skiaCanvasDailyLimit: 30,
    backgroundAsyncDailyLimit: 50,
    allowedQualities: ['medium', 'high', 'ultra'],
    allowedFps: [30, 60],
    allowedAudioBitrates: ['128k', '192k', '320k'],
    features: PREMIUM_FEATURES,
  },
};

export function normalizePlan(plan: unknown): SubscriptionPlan {
  return typeof plan === 'string' && (SUBSCRIPTION_PLANS as readonly string[]).includes(plan)
    ? (plan as SubscriptionPlan)
    : 'free';
}

export function getPlanEntitlements(plan: unknown): PlanEntitlements {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)];
}

export function isPremiumPlan(plan: unknown): boolean {
  const normalized = normalizePlan(plan);
  return normalized === 'monthly' || normalized === 'yearly';
}

export function canUseFeature(plan: unknown, feature: PremiumFeature): boolean {
  return getPlanEntitlements(plan).features[feature];
}

export function isFreeFont(fontFamily: string | undefined | null): boolean {
  return typeof fontFamily === 'string' && (FREE_FONTS as readonly string[]).includes(fontFamily);
}

export function isArabicCatalogFont(fontFamily: string | undefined | null): boolean {
  return typeof fontFamily === 'string'
    && (ARABIC_FONT_CATALOG as readonly string[]).includes(fontFamily);
}

export function isBasicBackground(category: unknown, type: unknown): boolean {
  return type === 'image' && typeof category === 'string'
    && (BASIC_BACKGROUND_CATEGORIES as readonly string[]).includes(category);
}

export function isFreeBackgroundAsset(background: {
  id?: unknown;
  type?: unknown;
  category?: unknown;
  url?: unknown;
  slideImages?: unknown;
} | undefined | null): boolean {
  if (!background || !isBasicBackground(background.category, background.type)
    || (Array.isArray(background.slideImages) && background.slideImages.length > 1)) {
    return false;
  }

  if (typeof background.id !== 'string' || typeof background.url !== 'string') {
    return false;
  }

  const expectedUrl = FREE_BACKGROUND_ASSET_URLS[background.id];
  return Boolean(expectedUrl) && background.url.split('?')[0] === expectedUrl;
}

export function getQualityDimensions(
  quality: ExportQuality,
  aspectRatio: '9:16' | '16:9',
): { width: number; height: number } {
  const portrait = quality === 'medium'
    ? { width: 720, height: 1280 }
    : quality === 'high'
    ? { width: 1080, height: 1920 }
    : { width: 2160, height: 3840 };

  return aspectRatio === '16:9'
    ? { width: portrait.height, height: portrait.width }
    : portrait;
}

export interface RenderEntitlementCandidate {
  qualityPreset?: unknown;
  fps?: unknown;
  outputDimensions?: { width?: unknown; height?: unknown };
  aspectRatio?: unknown;
  audioBitrate?: unknown;
  background?: {
    id?: unknown;
    type?: unknown;
    category?: unknown;
    url?: unknown;
    slideImages?: unknown;
    motionSpeed?: unknown;
  };
  typography?: { fontFamily?: unknown };
  audioEffects?: Record<string, unknown>;
  displaySettings?: Record<string, unknown>;
}

export interface EntitlementValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Validates the parts of a cloud-render request that a client must never be
 * allowed to upgrade by changing local state or hand-crafting an HTTP request.
 */
export function validateRenderEntitlements(
  plan: unknown,
  manifest: RenderEntitlementCandidate,
): EntitlementValidationResult {
  const entitlements = getPlanEntitlements(plan);
  const violations: string[] = [];
  const quality = manifest.qualityPreset as ExportQuality;
  const fps = Number(manifest.fps);
  const audioBitrate = (manifest.audioBitrate || '192k') as AudioBitrate;

  if (!entitlements.allowedQualities.includes(quality)) {
    violations.push('دقة التصدير المختارة غير متاحة في خطتك');
  }

  if (!entitlements.allowedFps.includes(fps as ExportFps)) {
    violations.push('معدل الإطارات المختار غير متاح في خطتك');
  }

  if (!entitlements.allowedAudioBitrates.includes(audioBitrate)) {
    violations.push('جودة الصوت المختارة غير متاحة في خطتك');
  }

  if (!isArabicCatalogFont(manifest.typography?.fontFamily as string | undefined)) {
    violations.push('الخط المختار غير متاح في كتالوج الخطوط العربي');
  }

  if ((quality === 'medium' || quality === 'high' || quality === 'ultra')
    && (manifest.aspectRatio === '9:16' || manifest.aspectRatio === '16:9')) {
    const expected = getQualityDimensions(quality, manifest.aspectRatio);
    const actual = manifest.outputDimensions;
    if (Number(actual?.width) !== expected.width || Number(actual?.height) !== expected.height) {
      violations.push('أبعاد التصدير لا تطابق الدقة المختارة');
    }
  }

  if (!isPremiumPlan(plan)) {
    const background = manifest.background;
    if (!isFreeBackgroundAsset(background)) {
      violations.push('الخطة المجانية تدعم الخلفيات الإسلامية والطبيعية الثابتة فقط');
    }

    // The API schema uses a minimum value of 1 for backwards compatibility.
    // In the free plan it is a sentinel for a static still image: the browser
    // preview renders it with zero motion and the server must reject any
    // client-crafted attempt to request animated Ken-Burns movement.
    if (Number(background?.motionSpeed) !== 1) {
      violations.push('الخلفيات المتحركة متاحة للعضوية المميزة فقط');
    }

    if (!isFreeFont(manifest.typography?.fontFamily as string | undefined)) {
      violations.push('الخط المختار متاح للعضوية المميزة فقط');
    }

    const effects = manifest.audioEffects || {};
    const usesAudioFilters = [
      'reverbEnabled',
      'echoEnabled',
      'eqEnabled',
      'normalizeEnabled',
      'copyrightProtectionEnabled',
    ].some((key) => effects[key] === true)
      || (typeof effects.pitchShift === 'number' && effects.pitchShift !== 0)
      || (typeof effects.speedAdjust === 'number' && effects.speedAdjust !== 1);
    if (usesAudioFilters) {
      violations.push('الفلاتر الصوتية وحماية الحقوق متاحة للعضوية المميزة فقط');
    }

    const display = manifest.displaySettings || {};
    if (display.logoWatermarkEnabled === true || display.socialWatermarkEnabled === true
      || (typeof display.logoWatermarkUrl === 'string' && display.logoWatermarkUrl.length > 0)) {
      violations.push('الشعار والهوية المخصصة متاحان للعضوية المميزة فقط');
    }
  }

  return { valid: violations.length === 0, violations };
}

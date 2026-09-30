/**
 * ============================================================================
 * SINGLE SOURCE OF TRUTH FOR DISPLAY / ANIMATION OPTIONS
 * ============================================================================
 * CreatePage's "advanced motion" card and the preview DisplaySettingsPanel
 * each used to declare their own copy of these lists. That caused two defects
 * which are now structurally impossible:
 *
 * 1. Drift — the same option carried different labels in the two places.
 * 2. Dead ends — `reciterNameStyle`, `surahNameStyle`, `textShadowStyle`, and
 *    `surahNamePosition` had values the production renderers honour but the UI
 *    could not express, so users could never reach them.
 *
 * Inherited non-negotiable (docs/alignment-architecture.md): these options
 * change how an immutable TimingMap is *presented*. They never manufacture a
 * word or letter boundary.
 */

import type { AnimationProfile, VerseDisplayMode } from '@/lib/animationTimeline';
import type {
  AyahNumberColor,
  AyahNumberStyle,
  AyahTransition,
  FrameStyle,
  GlowStyle,
  HighlightStyle,
  LogoWatermarkPosition,
  LogoWatermarkPreset,
  ReciterNameStyle,
  ScreenBorderColor,
  ScreenBorderStyle,
  SocialPlatform,
  SocialWatermarkPosition,
  SurahNamePosition,
  SurahNameStyle,
  TextShadowStyle,
  WatermarkPosition,
} from './displayValueUnions';

export interface DisplayOption<TValue extends string = string> {
  value: TValue;
  label: string;
  description: string;
  /** Swatch colour for options whose identity is a colour. */
  color?: string;
  /** Marks the premium/professional tier in the UI. */
  badge?: string;
}

// ── Verse display & motion ────────────────────────────────────────────────────

export const VERSE_DISPLAY_MODE_OPTIONS: ReadonlyArray<DisplayOption<VerseDisplayMode>> = [
  { value: 'full', label: 'الآية كاملة', description: 'الآية كلها ظاهرة مع تمييز الكلمة المقروءة لحظياً' },
  { value: 'wordByWord', label: 'كلمة بكلمة', description: 'الكلمة الحالية وحدها، وتثبت أثناء الوقفة' },
  { value: 'letterByLetter', label: 'حرفاً بحرف (Animate)', description: 'كشف الحروف بتوقيت معتمد من القارئ', badge: 'Animate' },
  { value: 'twoWords', label: 'كلمتان كلمتان', description: 'مقطع ثنائي إيقاعي بالتناوب' },
  { value: 'threeTwo', label: 'ثلاث ثم اثنتان', description: 'تقسيم إيقاعي ٣-٢ على طول الآية' },
];

export const ANIMATION_PROFILE_OPTIONS: ReadonlyArray<DisplayOption<AnimationProfile>> = [
  { value: 'karaoke', label: 'كاريوكي دقيق', description: 'الآية كاملة وتُميَّز الكلمة المقروءة بلطف' },
  { value: 'teleprompter', label: 'تمرير Teleprompter', description: 'نافذة متحركة ناعمة حول الكلمة الحالية' },
  { value: 'reveal', label: 'كشف تدريجي', description: 'الكلمات تظهر تباعاً بعد نطقها' },
  { value: 'fade', label: 'تلاشي متتابع', description: 'الماضي يهدأ والقادم ينتظر بوقار' },
  { value: 'spotlight', label: 'تسليط ضوء', description: 'بؤرة بصرية قوية على الكلمة المقروءة' },
  { value: 'isolate', label: 'عزل الكلمة', description: 'عرض الكلمة الحالية وحدها في المشهد' },
  { value: 'consume', label: 'استهلاك النص', description: 'الكلمات المنطوقة تختفي تدريجياً' },
  { value: 'static', label: 'ثابت وقور', description: 'نص كامل هادئ بلا حركة زمنية' },
];

export const AYAH_TRANSITION_OPTIONS: ReadonlyArray<DisplayOption<AyahTransition>> = [
  { value: 'none', label: 'بدون انتقال', description: 'ظهور مباشر فوري' },
  { value: 'fade', label: 'تلاشي ناعم', description: 'ظهور تدريجي سينمائي' },
  { value: 'slide', label: 'انزلاق', description: 'دخول انسيابي من الأسفل' },
  { value: 'zoom', label: 'تكبير ناعم', description: 'تقريب هادئ للداخل' },
  { value: 'blur', label: 'كشف ضبابي', description: 'إزالة الضبابية تدريجياً' },
  { value: 'rise', label: 'صعود ناعم', description: 'ارتفاع سينمائي وقور' },
  { value: 'rotate', label: 'دوران خفيف', description: 'ميل احترافي خفيف' },
  { value: 'cinematic', label: 'سينمائي درامي', description: 'دخول درامي مركب' },
  { value: 'elastic', label: 'مرن وأنيق', description: 'ارتداد هادئ ومريح' },
  { value: 'random', label: 'عشوائي', description: 'تأثير مختلف لكل آية' },
];

// ── Highlight, glow, shadow ───────────────────────────────────────────────────

export const HIGHLIGHT_STYLE_OPTIONS: ReadonlyArray<DisplayOption<HighlightStyle>> = [
  { value: 'glow', label: 'توهج الكلمة', description: 'إضاءة محيطية حول الكلمة المقروءة' },
  { value: 'solid', label: 'تظليل ممتلئ', description: 'كبسولة خلفية ملوّنة أنيقة' },
  { value: 'underline', label: 'خط سفلي', description: 'خط ذهبي أنيق تحت الكلمة' },
  { value: 'shadow', label: 'ظل ناعم', description: 'ظل عميق يبرز الكلمة' },
  { value: 'none', label: 'بدون تمييز', description: 'نص نقي بلا تظليل إضافي' },
];

export const GLOW_STYLE_OPTIONS: ReadonlyArray<DisplayOption<GlowStyle>> = [
  { value: 'golden', label: 'ذهبي أصيل', color: '#D4AF37', description: 'توهج ملكي دافئ' },
  { value: 'soft', label: 'إشراقة بيضاء', color: '#FFFFFF', description: 'إضاءة نورانية هادئة' },
  { value: 'emerald', label: 'أخضر زمردي', color: '#10B981', description: 'توهج قرآني فاخر' },
  { value: 'neon', label: 'نيون سماوي', color: '#38BDF8', description: 'توهج أزرق سماوي ساطع' },
  { value: 'pulse', label: 'نبض عنبري', color: '#F59E0B', description: 'توهج متموّج ومتحرك' },
  { value: 'royal', label: 'بنفسجي ملكي', color: '#8B5CF6', description: 'توهج مهيب فاخر' },
  { value: 'none', label: 'بدون توهج', color: '#6B7280', description: 'لون نص طبيعي ثابت' },
];

export const TEXT_SHADOW_OPTIONS: ReadonlyArray<DisplayOption<TextShadowStyle>> = [
  { value: 'none', label: 'بدون ظل', description: 'نص مسطح نقي كريلز احترافية' },
  { value: 'soft', label: 'ظل سينمائي ناعم', description: 'تدرج خفيف يعطي بعداً جمالياً' },
  { value: 'strong', label: 'ظل داكن بارز', description: 'ظل عميق عالي التباين' },
  { value: '3d', label: 'تجسيم 3D عميق', description: 'بروز واقعي ثلاثي الأبعاد' },
  { value: 'glow', label: 'توهج نوراني', description: 'هالة ضوئية مشعة' },
  { value: 'outline', label: 'تحديد محيطي', description: 'حدود دقيقة حول الحروف' },
  { value: 'double', label: 'ظل مزدوج', description: 'طبقتا ظل لفصل النص عن الخلفية' },
];

// ── Ayah number ───────────────────────────────────────────────────────────────

export const AYAH_NUMBER_STYLE_OPTIONS: ReadonlyArray<DisplayOption<AyahNumberStyle>> = [
  { value: 'quran3d', label: 'قوس قرآني 3D', description: 'أقواس مجسّمة عائمة حول الرقم' },
  { value: 'circle', label: 'دائرة', description: 'إطار دائري كلاسيكي' },
  { value: 'star', label: 'نجمة ثمانية', description: 'نجمة إسلامية ثمانية' },
  { value: 'diamond', label: 'معين', description: 'شكل المعين الهندسي' },
  { value: 'octagon', label: 'ثماني الأضلاع', description: 'إطار مثمن هندسي' },
  { value: 'flower', label: 'وردة', description: 'زخرفة وردية' },
  { value: 'square', label: 'مربع', description: 'إطار مربع بسيط' },
  { value: 'hexagon', label: 'سداسي', description: 'إطار سداسي أنيق' },
];

export const AYAH_NUMBER_COLOR_OPTIONS: ReadonlyArray<DisplayOption<AyahNumberColor>> = [
  { value: 'gold', label: 'ذهبي', color: '#D4AF37', description: 'ذهبي كلاسيكي' },
  { value: 'metallicGold3D', label: 'ذهبي معدني 3D', color: '#F5D061', description: 'معدن مصقول متدرّج' },
  { value: 'white', label: 'أبيض', color: '#FFFFFF', description: 'أبيض نقي' },
  { value: 'silver', label: 'فضي', color: '#C0C0C0', description: 'فضي هادئ' },
  { value: 'emerald', label: 'أخضر زمردي', color: '#10B981', description: 'زمردي ملكي' },
  { value: 'royal', label: 'أزرق ملكي', color: '#3B82F6', description: 'أزرق عميق' },
];

// ── Surah / reciter name ──────────────────────────────────────────────────────

export const SURA_NAME_POSITION_OPTIONS: ReadonlyArray<DisplayOption<SurahNamePosition>> = [
  { value: 'top', label: 'أعلى الوسط', description: 'أعلى الإطار في المنتصف' },
  { value: 'center', label: 'المنتصف', description: 'وسط المشهد تماماً' },
  { value: 'bottom', label: 'أسفل الوسط', description: 'أسفل الإطار في المنتصف' },
  { value: 'topLeft', label: 'أعلى اليسار', description: 'الزاوية العلوية اليسرى' },
  { value: 'topRight', label: 'أعلى اليمين', description: 'الزاوية العلوية اليمنى' },
];

export const SURA_NAME_STYLE_OPTIONS: ReadonlyArray<DisplayOption<SurahNameStyle>> = [
  { value: 'classic', label: 'كلاسيكي', description: 'نص عادي بسيط' },
  { value: 'goldenBadge', label: 'شارة ذهبية', description: 'شارة معدنية ذهبية' },
  { value: 'banner', label: 'لافتة', description: 'شريط أفقي عريض' },
  { value: 'calligraphy', label: 'خط عربي', description: 'بخط نسخي مزخرف' },
  { value: 'circle', label: 'دائرة', description: 'وحدة دائرية' },
  { value: 'diamond', label: 'معين', description: 'وحدة هندسية معينية' },
  { value: 'ribbon', label: 'شريط', description: 'شريط مائل أنيق' },
  { value: 'modern', label: 'حديث', description: 'خط حديث رفيع وواضح' },
  { value: 'ornate', label: 'مزخرف', description: 'زخرفة إسلامية غنية' },
  { value: 'minimal', label: 'بسيط جداً', description: 'أقل قدر من الزخرفة' },
];

export const RECITER_NAME_STYLE_OPTIONS: ReadonlyArray<DisplayOption<ReciterNameStyle>> = [
  { value: 'simple', label: 'بسيط نقي', description: 'نص أنيق بلا زخرفة' },
  { value: 'elegant', label: 'أنيق', description: 'خط رفيع مع مسافة' },
  { value: 'pill', label: 'كبسولة صوتية', description: 'شارة بيضاوية مع أيقونة صوت' },
  { value: 'badge', label: 'شارة', description: 'شارة مستطيلة واضحة' },
  { value: 'tag', label: 'بطاقة', description: 'بطاقة جانبية مصغّرة' },
  { value: 'glow', label: 'توهج', description: 'هالة ضوئية حول الاسم' },
  { value: 'gold', label: 'ذهبي', description: 'إطار ذهبي فاخر' },
  { value: 'bordered', label: 'محدَّد', description: 'إطار رفيع مزدوج' },
];

// ── Frame & screen border ─────────────────────────────────────────────────────

export const FRAME_STYLE_OPTIONS: ReadonlyArray<DisplayOption<FrameStyle>> = [
  { value: 'none', label: 'بدون إطار', description: 'لا إطار خارجي' },
  { value: 'simple', label: 'بسيط', description: 'خط رفيع واحد' },
  { value: 'ornate', label: 'مزخرف', description: 'زخارف إسلامية' },
  { value: 'golden', label: 'ذهبي', description: 'إطار ذهبي لامع' },
  { value: 'geometric', label: 'هندسي', description: 'أشكال هندسية حادة' },
  { value: 'modern', label: 'حديث', description: 'زوايا حديثة مفتوحة' },
  { value: 'minimal', label: 'بسيط جداً', description: 'خط مزدوج رقيق' },
];

export const SCREEN_BORDER_STYLE_OPTIONS: ReadonlyArray<DisplayOption<ScreenBorderStyle>> = [
  { value: 'none', label: 'بدون', description: 'ملء الشاشة بلا إطار' },
  { value: 'goldenTrim', label: 'حافة ذهبية', description: 'خط ذهبي مزدوج متوهج' },
  { value: 'islamicCorners', label: 'زوايا إسلامية', description: 'زخارف أركان الأربعة' },
  { value: 'doubleCinema', label: 'سينمائي مزدوج', description: 'خطّان سينمائيان رفيعان' },
  { value: 'royalCrest', label: 'تاج ملكي', description: 'ترويسة وزخارف ملكية' },
  { value: 'subtleVignette', label: 'تظليل خفيف', description: 'تدرّج داكن عند الحواف' },
];

export const SCREEN_BORDER_COLOR_OPTIONS: ReadonlyArray<DisplayOption<ScreenBorderColor>> = [
  { value: 'gold', label: 'ذهبي', color: '#D4AF37', description: 'ذهبي ملكي' },
  { value: 'emerald', label: 'أخضر زمردي', color: '#10B981', description: 'زمردي' },
  { value: 'silver', label: 'فضي', color: '#D1D5DB', description: 'فضي هادئ' },
  { value: 'white', label: 'أبيض', color: '#FFFFFF', description: 'أبيض نقي' },
];

// ── Watermarks ────────────────────────────────────────────────────────────────

export const WATERMARK_POSITION_OPTIONS: ReadonlyArray<DisplayOption<WatermarkPosition>> = [
  { value: 'bottomLeft', label: 'أسفل اليسار', description: '' },
  { value: 'bottomRight', label: 'أسفل اليمين', description: '' },
  { value: 'topLeft', label: 'أعلى اليسار', description: '' },
  { value: 'topRight', label: 'أعلى اليمين', description: '' },
  { value: 'bottomCenter', label: 'أسفل الوسط', description: '' },
];

export const SOCIAL_WATERMARK_POSITION_OPTIONS: ReadonlyArray<DisplayOption<SocialWatermarkPosition>> = [
  { value: 'bottomCenter', label: 'أسفل الوسط', description: '' },
  { value: 'bottomRight', label: 'أسفل اليمين', description: '' },
  { value: 'bottomLeft', label: 'أسفل اليسار', description: '' },
  { value: 'topCenter', label: 'أعلى الوسط', description: '' },
];

export const LOGO_WATERMARK_POSITION_OPTIONS: ReadonlyArray<DisplayOption<LogoWatermarkPosition>> = [
  { value: 'topRight', label: 'أعلى اليمين', description: '' },
  { value: 'topLeft', label: 'أعلى اليسار', description: '' },
  { value: 'bottomRight', label: 'أسفل اليمين', description: '' },
  { value: 'bottomLeft', label: 'أسفل اليسار', description: '' },
];

export const SOCIAL_PLATFORM_OPTIONS: ReadonlyArray<DisplayOption<SocialPlatform> & { handlePrefix: string; icon: string }> = [
  { value: 'youtube', label: 'يوتيوب', handlePrefix: '@', icon: '▶', description: 'قناة يوتيوب' },
  { value: 'instagram', label: 'إنستغرام', handlePrefix: '@', icon: '📸', description: 'حساب إنستغرام' },
  { value: 'tiktok', label: 'تيك توك', handlePrefix: '@', icon: '🎵', description: 'حساب تيك توك' },
  { value: 'facebook', label: 'فيسبوك', handlePrefix: '', icon: 'ⓕ', description: 'صفحة فيسبوك' },
  { value: 'x', label: 'إكس (تويتر)', handlePrefix: '@', icon: '𝕏', description: 'حساب إكس' },
  { value: 'custom', label: 'نص مخصص', handlePrefix: '', icon: '✏️', description: 'نص حر بالكامل' },
];

export const LOGO_WATERMARK_PRESET_OPTIONS: ReadonlyArray<DisplayOption<LogoWatermarkPreset>> = [
  { value: 'goldCalligraphy', label: 'خط ذهبي', description: 'شعار بخط ذهبي كلاسيكي' },
  { value: 'circularMedallion', label: 'ميدالية دائرية', description: 'وحدة دائرية مزخرفة' },
  { value: 'geometricEmblem', label: 'شعار هندسي', description: 'أشكال هندسية متوازنة' },
  { value: 'glassMonogram', label: 'حرف زجاجي', description: 'حرف واحد بلمسة زجاجية' },
  { value: 'custom', label: 'شعار مرفوع', description: 'استخدم شعارك الخاص' },
];

// ── Lookups ───────────────────────────────────────────────────────────────────

/** Resolve an option's Arabic label, falling back when the value is unknown. */
export function optionLabel<TValue extends string>(
  options: ReadonlyArray<DisplayOption<TValue>>,
  value: string | undefined,
  fallback = '',
): string {
  if (!value) return fallback;
  return options.find((option) => option.value === value)?.label ?? fallback;
}

/** Resolve an option's Arabic description, or undefined when unknown. */
export function optionDescription<TValue extends string>(
  options: ReadonlyArray<DisplayOption<TValue>>,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  return options.find((option) => option.value === value)?.description || undefined;
}

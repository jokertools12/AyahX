/**
 * ============================================================================
 * DISPLAY SETTING INTERLOCKS
 * ============================================================================
 * A display panel is a matrix of options, not a bag of independent switches.
 * Several combinations are meaningless or actively misleading:
 *
 *   - highlightStyle 'none'  → the glow section has nothing to colour.
 *   - glowStyle 'none'       → there is no glow to recolour.
 *   - animationProfile 'static' → reduced motion is a no-op, the profile
 *                              already removes the pulse.
 *   - verseDisplayMode 'full'  → the whole verse is on screen, so the word
 *                              window profiles (isolate / teleprompter
 *                              chunking) cannot produce their narrow read.
 *   - letterByLetter without a trusted letter tier → the honest result is
 *     the complete active word, so we fall back rather than pretend.
 *
 * These helpers are pure and shared by the create page and the preview panel,
 * so the two surfaces can never disagree about what is legal.
 */

import type { AnimationProfile, VerseDisplayMode } from '@/lib/animationTimeline';
import type { GlowStyle, HighlightStyle } from '@/data/displayValueUnions';

/** The subset of display settings the interlock rules reason about. */
export interface InterlockSubject {
  verseDisplayMode?: VerseDisplayMode;
  animationProfile?: AnimationProfile;
  highlightStyle?: HighlightStyle;
  glowStyle?: GlowStyle;
  animationReducedMotion?: boolean;
}

/** Whether the glow section should accept input at all. */
export function isGlowSectionEnabled(settings: InterlockSubject): boolean {
  return (settings.highlightStyle || 'glow') !== 'none';
}

/** Whether the glow colour picker should accept input. */
export function isGlowColorEnabled(settings: InterlockSubject): boolean {
  return isGlowSectionEnabled(settings) && (settings.glowStyle || 'golden') !== 'none';
}

/**
 * `static` never pulses, so the reduced-motion switch would be misleading:
 * it would appear to control something that is already off.
 */
export function isReducedMotionEnabled(settings: InterlockSubject): boolean {
  return (settings.animationProfile || 'karaoke') !== 'static';
}

/** A profile that only reads well when the verse is broken into a window. */
export function profileNeedsChunkedVerse(profile: AnimationProfile | undefined): boolean {
  return profile === 'isolate' || profile === 'teleprompter';
}

/**
 * Warn (never silently rewrite) when a window-only profile is combined with
 * the full verse. The render harness does the right thing by itself, so this
 * is disclosure rather than coercion.
 */
export function describeVerseModeConflict(settings: InterlockSubject): string | null {
  if ((settings.verseDisplayMode || 'full') !== 'full') return null;
  if (!profileNeedsChunkedVerse(settings.animationProfile)) return null;
  return 'النمط المختار يعمل على مقطع الكلمة الحالية فقط، لكن وضع «الآية كاملة» يعرض الآية كلها. غيّر وضع العرض إلى «كلمة بكلمة» أو «كلمتان» أو «ثلاث ثم اثنتان» لرؤية التأثير بوضوح.';
}

export type LetterTimingTier = 'idle' | 'loading' | 'available' | 'unavailable' | 'requires-auth' | 'unsupported';

export interface LetterTimingNotice {
  tone: 'info' | 'loading' | 'ready' | 'warning';
  message: string;
}

const LETTER_TIMING_NOTICES: Record<LetterTimingTier, LetterTimingNotice> = {
  idle: { tone: 'info', message: 'جارٍ التحقق من توفر توقيت الحروف لهذا القارئ…' },
  loading: {
    tone: 'loading',
    message: 'جارٍ تحميل توقيت الحروف من الحزمة المعتمدة؛ تبقى مزامنة الكلمات فعّالة أثناء التحميل.',
  },
  available: { tone: 'ready', message: 'توقيت الحروف المعتمد جاهز — سيظهر كل حرف عند نطقه بدقة.' },
  unavailable: {
    tone: 'warning',
    message: 'لا تتوفّر طبقة حروف كاملة لهذا النطاق؛ سيعرض المشهد الكلمة الموقّتة كاملة دون اختلاق أي توقيت.',
  },
  'requires-auth': {
    tone: 'warning',
    message: 'سجّل الدخول لتحميل طبقة الحروف المعتمدة لهذا القارئ.',
  },
  unsupported: {
    tone: 'warning',
    message: 'هذا القارئ لا يوفّر حالياً طبقة حروف موثّقة؛ سيعرض المشهد الكلمة الموقّتة كاملة.',
  },
};

export function describeLetterTiming(tier: LetterTimingTier): LetterTimingNotice {
  return LETTER_TIMING_NOTICES[tier] || LETTER_TIMING_NOTICES.idle;
}

/**
 * `letterByLetter` is only truthful when a letter tier actually exists.
 * Returning `false` tells the caller to degrade to word timing and explain why
 * rather than leave a broken-looking animation on screen.
 */
export function canAnimateLetters(tier: LetterTimingTier): boolean {
  return tier === 'available' || tier === 'loading' || tier === 'idle';
}

/** The mode to actually render when letter mode is unavailable. */
export function resolveEffectiveVerseMode(
  requested: VerseDisplayMode | undefined,
  tier: LetterTimingTier,
): VerseDisplayMode {
  if (requested !== 'letterByLetter') return requested || 'full';
  return canAnimateLetters(tier) ? 'letterByLetter' : 'wordByWord';
}

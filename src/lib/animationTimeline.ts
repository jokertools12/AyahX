import type { TimingWord } from './timingMap';

/**
 * Deterministic presentation profiles. They change only how an immutable
 * TimingMap is presented; they never manufacture or stretch audio timings.
 */
export type AnimationProfile =
  | 'static'
  | 'karaoke'
  | 'teleprompter'
  | 'reveal'
  | 'fade'
  | 'spotlight'
  | 'isolate'
  | 'consume';

export const ANIMATION_PROFILES: readonly AnimationProfile[] = [
  'static',
  'karaoke',
  'teleprompter',
  'reveal',
  'fade',
  'spotlight',
  'isolate',
  'consume',
] as const;

export interface AnimationWordState {
  index: number;
  occurrenceId: string;
  opacity: number;
  scale: number;
  translateY: number;
  emphasis: number;
  isActive: boolean;
}

export interface AnimationTimelineOptions {
  /** Disable pulse/scale motion while preserving timing and emphasis. */
  reducedMotion?: boolean;
  /** Number of words visible around the active word in teleprompter mode. */
  windowSize?: number;
}

export type VerseDisplayMode = 'full' | 'twoWords' | 'threeTwo' | 'wordByWord';

export interface VerseWordWindow {
  startIndex: number;
  wordCount: number;
}

export function normalizeAnimationProfile(value: unknown): AnimationProfile {
  return ANIMATION_PROFILES.includes(value as AnimationProfile)
    ? value as AnimationProfile
    : 'karaoke';
}

/**
 * Select the visible word chunk without inferring an index when the audio clock
 * is between the current ayah boundary and its first approved word event.
 */
export function resolveVerseWordWindow(
  mode: VerseDisplayMode,
  totalWords: number,
  activeWordIndex: number | null,
): VerseWordWindow {
  const safeTotal = Number.isFinite(totalWords) ? Math.max(0, Math.floor(totalWords)) : 0;
  if (mode === 'full') return { startIndex: 0, wordCount: safeTotal };
  const safeActive = Number.isInteger(activeWordIndex) ? activeWordIndex : null;
  if (safeTotal === 0 || safeActive === null || safeActive < 0 || safeActive >= safeTotal) {
    return { startIndex: 0, wordCount: 0 };
  }

  if (mode === 'wordByWord') return { startIndex: safeActive, wordCount: 1 };
  if (mode === 'twoWords') {
    const startIndex = Math.floor(safeActive / 2) * 2;
    return { startIndex, wordCount: Math.min(2, safeTotal - startIndex) };
  }

  const pattern = [3, 2] as const;
  let startIndex = 0;
  let patternIndex = 0;
  while (startIndex < safeTotal) {
    const wordCount = Math.min(pattern[patternIndex % pattern.length], safeTotal - startIndex);
    if (safeActive < startIndex + wordCount) return { startIndex, wordCount };
    startIndex += wordCount;
    patternIndex += 1;
  }
  return { startIndex: 0, wordCount: 0 };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function occurrenceIdFor(word: TimingWord, index: number): string {
  return word.occurrenceId || `${word.canonicalWordKey || 'word'}:occurrence:${index + 1}`;
}

/**
 * Resolve all visual states at one audio-clock instant. The function is pure,
 * occurrence-aware, and suitable for browser preview, native canvas, and
 * golden-frame tests.
 */
export function resolveAnimationStates(
  words: readonly TimingWord[],
  activeIndex: number | null,
  activeProgress: number,
  profileInput: unknown,
  options: AnimationTimelineOptions = {},
): AnimationWordState[] {
  const profile = normalizeAnimationProfile(profileInput);
  const reducedMotion = options.reducedMotion === true;
  // Match the render harness default: active word plus two words on each side.
  const windowSize = Math.max(1, Math.floor(options.windowSize || 5));
  const safeActive = activeIndex == null || activeIndex < 0 || activeIndex >= words.length
    ? null
    : activeIndex;
  const progress = clamp(activeProgress);

  return words.map((word, index) => {
    const distance = safeActive == null ? Number.POSITIVE_INFINITY : Math.abs(index - safeActive);
    const isActive = safeActive === index;
    let opacity = 1;
    let emphasis = isActive ? 1 : 0;
    let scale = 1;
    let translateY = 0;

    switch (profile) {
      case 'teleprompter': {
        const radius = Math.max(1, Math.floor(windowSize / 2));
        opacity = distance <= radius ? Math.max(0.28, 1 - distance * 0.28) : 0.12;
        translateY = safeActive == null ? 0 : (index - safeActive) * 2.5;
        emphasis = isActive ? 1 : Math.max(0, 1 - distance * 0.4);
        break;
      }
      case 'reveal':
        opacity = safeActive == null || index <= safeActive ? 1 : 0.22;
        emphasis = isActive ? 1 : 0;
        break;
      case 'fade':
        opacity = safeActive == null ? 1 : (isActive ? 1 : index < safeActive ? 0.58 : 0.22);
        emphasis = isActive ? 1 : index < (safeActive ?? -1) ? 0.25 : 0;
        break;
      case 'spotlight':
        opacity = safeActive == null ? 0.82 : (isActive ? 1 : 0.24);
        emphasis = isActive ? 1 : 0;
        break;
      case 'isolate':
        opacity = safeActive == null ? 0.18 : (isActive ? 1 : 0);
        emphasis = isActive ? 1 : 0;
        break;
      case 'consume':
        opacity = safeActive == null || index >= safeActive ? (isActive ? 1 : 0.34) : 0;
        emphasis = isActive ? 1 : 0;
        break;
      case 'static':
        opacity = 1;
        emphasis = isActive ? 0.35 : 0;
        break;
      case 'karaoke':
      default:
        opacity = 1;
        emphasis = isActive ? 1 : 0;
        break;
    }

    if (isActive && profile !== 'static' && !reducedMotion) {
      const pulse = Math.sin(Math.PI * progress);
      scale = 1 + pulse * 0.025;
      if (profile === 'teleprompter') translateY -= pulse * 1.5;
    }

    return {
      index,
      occurrenceId: occurrenceIdFor(word, index),
      opacity: clamp(opacity),
      scale,
      translateY,
      emphasis: clamp(emphasis),
      isActive,
    };
  });
}

/** Returns the highest-resolution timing tier available for a word. */
export function getAvailableTimingGranularity(word: TimingWord): 'word' | 'letter' | 'phoneme' {
  if (word.phonemes && word.phonemes.length > 0) return 'phoneme';
  if (word.letters && word.letters.length > 0) return 'letter';
  return 'word';
}

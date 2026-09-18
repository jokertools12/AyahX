/**
 * ============================================================================
 * WORD TIMING ENGINE FOR QURANIC RECITATIONS (TRACK E REDESIGN)
 * ============================================================================
 * Production-grade word-by-word exact audio alignment and highlight engine.
 *
 * Core architecture:
 * 1. Centered on the immutable, versioned TimingMap contract (src/lib/timingMap.ts).
 * 2. Binary-search resolver (O(log N)) with exact boundary semantics.
 * 3. Inter-word pause holding: holds previous word during waqf, never illuminates next early.
 * 4. 100% mathematical parity between live preview and exported video frames.
 * 5. Legacy duration-based phonetic weighting is isolated for diagnostics only.
 * ============================================================================
 */

import {
  TimingMap,
  TimingWord,
  TimingGap,
  TimingMapValidationResult,
  TimingMapCacheKeyParams,
  normalizeQuranicToken,
  computeAudioContentHash,
  createTimingMapCacheKey,
  validateTimingMap,
  normalizeQuranFoundationSegmentsToTimingMap,
  buildAudioAlignedTimingMap,
  timingMapRegistry,
} from './timingMap';

// Re-export all TimingMap contract types and functions for unified consumption
export type {
  TimingMap,
  TimingWord,
  TimingGap,
  TimingMapValidationResult,
  TimingMapCacheKeyParams,
};
export {
  normalizeQuranicToken,
  computeAudioContentHash,
  createTimingMapCacheKey,
  validateTimingMap,
  normalizeQuranFoundationSegmentsToTimingMap,
  buildAudioAlignedTimingMap,
  timingMapRegistry,
};

// ============================================================================
// RESOLVER INTERFACE & EXACT-AUDIO RESOLVER
// ============================================================================

export interface ExactWordHighlightResult {
  /** 0-based word index in the rendered verse or null if before speech / after ending */
  activeWordIndex: number | null;
  /** Reference to the active TimingWord object or null */
  activeWord: TimingWord | null;
  /** Normalized progress through the word (0.0 to 1.0) */
  wordProgress: number;
  /** True if currently in an inter-word pause or waqf (holding previous word) */
  isGap: boolean;
  /** Validation status of the underlying map */
  validationStatus: 'approved' | 'low_confidence' | 'needs_review' | 'rejected' | 'unavailable';
  /** Ayah number of the active word (from canonicalWordKey), or null */
  ayahNumber?: number | null;
  /** 0-based word index within its ayah (from canonicalWordKey), or null */
  wordIndexInAyah?: number | null;
}

function extractWordLocation(word: TimingWord | null): { ayahNumber: number | null; wordIndexInAyah: number | null } {
  if (!word) return { ayahNumber: null, wordIndexInAyah: null };
  if (word.canonicalWordKey) {
    const parts = word.canonicalWordKey.split(':');
    if (parts.length >= 3) {
      const aNum = parseInt(parts[1], 10);
      const wIdx1 = parseInt(parts[2], 10);
      if (!isNaN(wIdx1)) {
        return {
          ayahNumber: !isNaN(aNum) ? aNum : null,
          wordIndexInAyah: wIdx1 - 1,
        };
      }
    }
  }
  return { ayahNumber: null, wordIndexInAyah: word.displayWordIndex };
}

/**
 * Resolves the active word and highlight progress at an exact timestamp in milliseconds.
 *
 * Boundary semantics:
 * - Before speech onset: activeWordIndex is null, wordProgress is 0.
 * - During word articulation [startMs, endMs): activeWordIndex matches word, progress is normalized.
 * - During inter-word pause/waqf [endMs_i, startMs_{i+1}): HOLDS word_i at 1.0 progress.
 *   The next word (word_{i+1}) is strictly prohibited from illuminating before its exact startMs.
 * - After final word: holds final word during acoustic decay, then clears to null.
 *
 * Performance: Binary search over sorted words array - O(log N).
 */
export function resolveActiveWordAtTime(
  timingMap: TimingMap | null | undefined,
  timeMs: number
): ExactWordHighlightResult {
  if (!timingMap || !timingMap.words || timingMap.words.length === 0) {
    return {
      activeWordIndex: null,
      activeWord: null,
      wordProgress: 0,
      isGap: false,
      validationStatus: timingMap?.validationStatus || 'unavailable',
      ayahNumber: null,
      wordIndexInAyah: null,
    };
  }

  // If map is not approved (e.g. needs_review, rejected, or unavailable), reject production highlight
  if (timingMap.validationStatus !== 'approved') {
    return {
      activeWordIndex: null,
      activeWord: null,
      wordProgress: 0,
      isGap: false,
      validationStatus: timingMap.validationStatus,
      ayahNumber: null,
      wordIndexInAyah: null,
    };
  }

  const words = timingMap.words;
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  // 1. Before speech starts (intro silence)
  if (timeMs < firstWord.startMs) {
    return {
      activeWordIndex: null,
      activeWord: null,
      wordProgress: 0,
      isGap: false,
      validationStatus: timingMap.validationStatus,
      ayahNumber: null,
      wordIndexInAyah: null,
    };
  }

  // 2. Binary search to locate active word or surrounding gap
  let low = 0;
  let high = words.length - 1;
  let candidateIdx = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const w = words[mid];

    if (timeMs >= w.startMs && timeMs < w.endMs) {
      // Direct hit inside word interval
      const dur = Math.max(w.endMs - w.startMs, 1);
      const progress = Math.min(Math.max((timeMs - w.startMs) / dur, 0), 1);
      const loc = extractWordLocation(w);
      return {
        activeWordIndex: loc.wordIndexInAyah ?? w.displayWordIndex,
        activeWord: w,
        wordProgress: progress,
        isGap: false,
        validationStatus: timingMap.validationStatus,
        ayahNumber: loc.ayahNumber,
        wordIndexInAyah: loc.wordIndexInAyah,
      };
    } else if (timeMs < w.startMs) {
      high = mid - 1;
    } else {
      candidateIdx = mid; // w.endMs <= timeMs
      low = mid + 1;
    }
  }

  // 3. If candidateIdx is valid, we are between candidateIdx and candidateIdx + 1 (an inter-word gap)
  if (candidateIdx >= 0 && candidateIdx < words.length - 1) {
    const prevWord = words[candidateIdx];
    const nextWord = words[candidateIdx + 1];

    if (timeMs >= prevWord.endMs && timeMs < nextWord.startMs) {
      // Hold the previous word during inter-word pause/waqf
      const loc = extractWordLocation(prevWord);
      return {
        activeWordIndex: loc.wordIndexInAyah ?? prevWord.displayWordIndex,
        activeWord: prevWord,
        wordProgress: 1.0,
        isGap: true,
        validationStatus: timingMap.validationStatus,
        ayahNumber: loc.ayahNumber,
        wordIndexInAyah: loc.wordIndexInAyah,
      };
    }
  }

  // 4. After the final word: hold during outro waqf decay, then clear
  if (timeMs >= lastWord.endMs) {
    // Hold final word for up to 800ms or until decoded duration
    const outroHoldEndMs = Math.max(
      lastWord.endMs + 600,
      timingMap.decodedDurationMs > 0 ? timingMap.decodedDurationMs : lastWord.endMs + 600
    );

    if (timeMs <= outroHoldEndMs) {
      const loc = extractWordLocation(lastWord);
      return {
        activeWordIndex: loc.wordIndexInAyah ?? lastWord.displayWordIndex,
        activeWord: lastWord,
        wordProgress: 1.0,
        isGap: true,
        validationStatus: timingMap.validationStatus,
        ayahNumber: loc.ayahNumber,
        wordIndexInAyah: loc.wordIndexInAyah,
      };
    }
  }

  // Beyond all speech and decay
  return {
    activeWordIndex: null,
    activeWord: null,
    wordProgress: 0,
    isGap: false,
    validationStatus: timingMap.validationStatus,
  };
}

/**
 * Resolves active word at an exact export video frame index and frame rate.
 * Guarantees 100% mathematical parity between preview and export frames.
 */
export function resolveActiveWordAtFrame(
  timingMap: TimingMap | null | undefined,
  frameIndex: number,
  fps: number
): ExactWordHighlightResult {
  const safeFps = Math.max(fps, 1);
  const timeMs = (frameIndex * 1000) / safeFps;
  return resolveActiveWordAtTime(timingMap, timeMs);
}

// ============================================================================
// LEGACY COMPATIBILITY & DIAGNOSTIC PHONETIC WEIGHTING (NON-PRODUCTION)
// ============================================================================

export interface WordSegment {
  wordIndex: number;
  wordText: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface AyahTimingMap {
  surahNumber: number;
  ayahNumber: number;
  totalDurationMs: number;
  speechStartMs: number;
  speechEndMs: number;
  segments: WordSegment[];
}

// Diagnostic-only cache for legacy tests
const timingCache = new Map<string, AyahTimingMap>();

/** Clear the in-memory timing cache */
export function clearTimingCache(): void {
  timingCache.clear();
  timingMapRegistry.clear();
}

/**
 * Strips tashkeel diacritics for clean phonetic analysis
 */
export function stripTashkeel(text: string): string {
  return normalizeQuranicToken(text);
}

/**
 * Computes phonetic Tajweed weight for an Arabic word.
 * Retained for diagnostic analysis and acoustic reference modeling.
 */
export function computeWordPhoneticWeight(word: string, isFinalWordOfAyah: boolean = false): number {
  if (!word) return 1.0;

  let weight = 0;
  const cleanWord = stripTashkeel(word);

  // Base weight from consonant/letter count
  weight += Math.max(cleanWord.length, 1) * 1.0;

  // Harakat (short vowels) count
  const shortVowels = (word.match(/[\u064E\u064F\u0650]/g) || []).length;
  weight += shortVowels * 0.45;

  // Shaddah (gemination doubles consonant articulation time)
  const shaddahCount = (word.match(/\u0651/g) || []).length;
  weight += shaddahCount * 1.2;

  // Madd letters (alef, waw, yaa) - elongation in Tajweed
  const maddLetters = (cleanWord.match(/[اويىآ]/g) || []).length;
  weight += maddLetters * 1.5;

  // Explicit Quranic Madd sign (ـٓ U+0653)
  if (word.includes('\u0653') || word.includes('~')) {
    weight += 3.0;
  }

  // Final word of Ayah receives Madd Aridh li-sSukoon
  if (isFinalWordOfAyah) {
    weight += 3.5;
  }

  return Math.max(weight, 1.2);
}

/**
 * @deprecated Diagnostic only - Do NOT use as ground truth for production export or glow!
 * Duration-based phonetic estimation for test environments without real audio files.
 */
export function generateAyahWordTimings(
  surahNumber: number,
  ayahNumber: number,
  ayahText: string,
  totalDurationSec: number,
  reciterId: string = 'default'
): AyahTimingMap {
  const cacheKey = `${reciterId}_${surahNumber}_${ayahNumber}_${totalDurationSec.toFixed(2)}`;
  const cached = timingCache.get(cacheKey);
  if (cached) return cached;

  const words = (ayahText || '').split(' ').filter(Boolean);
  const totalMs = Math.max(totalDurationSec * 1000, 1000);

  if (words.length === 0) {
    const emptyMap: AyahTimingMap = {
      surahNumber,
      ayahNumber,
      totalDurationMs: totalMs,
      speechStartMs: 0,
      speechEndMs: totalMs,
      segments: [],
    };
    timingCache.set(cacheKey, emptyMap);
    return emptyMap;
  }

  const introSilenceMs = Math.min(Math.max(totalMs * 0.03, 80), 280);
  const outroSilenceMs = Math.min(Math.max(totalMs * 0.12, 400), 1200);
  const activeSpeechMs = Math.max(totalMs - introSilenceMs - outroSilenceMs, words.length * 200);

  const weights = words.map((w, i) => computeWordPhoneticWeight(w, i === words.length - 1));
  const sumWeights = weights.reduce((acc, w) => acc + w, 0);

  const segments: WordSegment[] = [];
  let currentStart = introSilenceMs;
  const interWordGapMs = words.length > 1 ? Math.min((activeSpeechMs * 0.04) / (words.length - 1), 70) : 0;
  const netWordSpeechMs = Math.max(activeSpeechMs - (interWordGapMs * (words.length - 1)), words.length * 150);

  for (let i = 0; i < words.length; i++) {
    const wordShare = weights[i] / sumWeights;
    const duration = Math.round(netWordSpeechMs * wordShare);
    const start = Math.round(currentStart);
    const end = (i === words.length - 1)
      ? Math.round(start + duration + (outroSilenceMs * 0.4))
      : Math.round(start + duration);

    segments.push({
      wordIndex: i,
      wordText: words[i],
      startMs: start,
      endMs: end,
      durationMs: end - start,
    });

    currentStart = end + interWordGapMs;
  }

  const timingMap: AyahTimingMap = {
    surahNumber,
    ayahNumber,
    totalDurationMs: totalMs,
    speechStartMs: introSilenceMs,
    speechEndMs: segments[segments.length - 1]?.endMs ?? totalMs,
    segments,
  };

  timingCache.set(cacheKey, timingMap);
  return timingMap;
}

/**
 * @deprecated Diagnostic only. Legacy helper for AyahTimingMap.
 */
export function getWordHighlightAtTime(
  timingMap: AyahTimingMap,
  ayahPositionSec: number
): { wordIndex: number | null; wordProgress: number } {
  if (!timingMap || timingMap.segments.length === 0) {
    return { wordIndex: null, wordProgress: 0 };
  }

  const posMs = ayahPositionSec * 1000;
  const segments = timingMap.segments;

  if (posMs < segments[0].startMs) {
    return { wordIndex: null, wordProgress: 0 };
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (posMs >= seg.startMs && posMs <= seg.endMs) {
      const dur = Math.max(seg.durationMs, 1);
      const progress = Math.min(Math.max((posMs - seg.startMs) / dur, 0), 1);
      return { wordIndex: seg.wordIndex, wordProgress: progress };
    }

    if (i < segments.length - 1) {
      const nextSeg = segments[i + 1];
      if (posMs > seg.endMs && posMs < nextSeg.startMs) {
        return { wordIndex: seg.wordIndex, wordProgress: 1.0 };
      }
    }
  }

  const lastSeg = segments[segments.length - 1];
  if (posMs >= lastSeg.endMs && posMs <= timingMap.totalDurationMs + 250) {
    return { wordIndex: lastSeg.wordIndex, wordProgress: 1.0 };
  }

  return { wordIndex: null, wordProgress: 0 };
}

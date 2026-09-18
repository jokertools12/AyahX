import { describe, it, expect } from 'vitest';
import {
  computeWordPhoneticWeight,
  generateAyahWordTimings,
  getWordHighlightAtTime,
  clearTimingCache,
} from '../lib/wordTimingEngine';
import { QUALITY_PRESETS, getQualityDimensions } from '../hooks/useVideoRecorder';

describe('Tajweed Word Timing Engine', () => {
  it('computes higher phonetic weight for words with Madd and Shaddah than short particles', () => {
    const shortWord = 'مِن';
    const bismillah = 'بِسْمِ';
    const rahman = 'الرَّحْمَٰنِ';
    const raheem = 'الرَّحِيمِ';
    const maddLazim = 'الضَّالِّينَ';

    const wShort = computeWordPhoneticWeight(shortWord, false);
    const wBismillah = computeWordPhoneticWeight(bismillah, false);
    const wRahman = computeWordPhoneticWeight(rahman, false);
    const wRaheemFinal = computeWordPhoneticWeight(raheem, true); // final word in ayah -> Madd Aridh
    const wMaddLazim = computeWordPhoneticWeight(maddLazim, true);

    expect(wBismillah).toBeGreaterThan(wShort);
    expect(wRahman).toBeGreaterThan(wBismillah);
    // Final word with Madd Aridh li-sSukoon has extra duration
    expect(wRaheemFinal).toBeGreaterThan(wRahman);
    // Madd Lazim (6 harakat) + Shaddah is significantly heavier
    expect(wMaddLazim).toBeGreaterThan(wShort * 3);
  });

  it('generates strictly ascending and non-overlapping word timings for an ayah', () => {
    clearTimingCache();
    const ayahText = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
    const totalDurationSec = 5.2;

    const timingMap = generateAyahWordTimings(1, 1, ayahText, totalDurationSec, 'alafasy');
    const segments = timingMap.segments;

    expect(segments.length).toBe(4);

    for (let i = 0; i < segments.length; i++) {
      const t = segments[i];
      expect(t.startMs).toBeLessThan(t.endMs);
      expect(t.durationMs).toBeGreaterThan(200); // Every word gets reasonable time
      if (i > 0) {
        expect(t.startMs).toBeGreaterThanOrEqual(segments[i - 1].endMs);
      }
    }

    // Last word should end before or at totalDurationSec * 1000
    expect(segments[segments.length - 1].endMs).toBeLessThanOrEqual(totalDurationSec * 1000 + 100);
  });

  it('adapts pacing appropriately for different ayah durations', () => {
    clearTimingCache();
    const ayahText = 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ';

    const fastDuration = 4.0;
    const slowDuration = 8.0;

    const fastMap = generateAyahWordTimings(1, 5, ayahText, fastDuration, 'shuraim');
    const slowMap = generateAyahWordTimings(1, 5, ayahText, slowDuration, 'husary');

    expect(fastMap.segments.length).toBe(slowMap.segments.length);

    const fastLastWord = fastMap.segments[fastMap.segments.length - 1];
    const slowLastWord = slowMap.segments[slowMap.segments.length - 1];

    expect(slowLastWord.durationMs).toBeGreaterThan(fastLastWord.durationMs);
  });

  it('holds word highlight during waqf (pauses) and clips correctly', () => {
    clearTimingCache();
    const ayahText = 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ';
    const totalDurationSec = 4.0;

    const timingMap = generateAyahWordTimings(1, 2, ayahText, totalDurationSec, 'default');
    const segments = timingMap.segments;

    // Before recitation starts (intro silence) -> null
    const beforeStart = getWordHighlightAtTime(timingMap, 0.01);
    expect(beforeStart.wordIndex).toBeNull();

    // In the middle of the first word
    const midWord0Sec = ((segments[0].startMs + segments[0].endMs) / 2) / 1000;
    const res0 = getWordHighlightAtTime(timingMap, midWord0Sec);
    expect(res0.wordIndex).toBe(0);
    expect(res0.wordProgress).toBeGreaterThan(0);
    expect(res0.wordProgress).toBeLessThan(1);

    // During inter-word pause: should HOLD the previous word (wordProgress = 1), not clear to null
    if (segments[1].startMs > segments[0].endMs) {
      const gapTimeSec = ((segments[0].endMs + segments[1].startMs) / 2) / 1000;
      const resGap = getWordHighlightAtTime(timingMap, gapTimeSec);
      expect(resGap.wordIndex).toBe(0);
      expect(resGap.wordProgress).toBe(1);
    }

    // After last word during outro silence: holds the final word
    const afterLastWordSec = (segments[segments.length - 1].endMs + 50) / 1000;
    const resAfter = getWordHighlightAtTime(timingMap, afterLastWordSec);
    expect(resAfter.wordIndex).toBe(segments.length - 1);
    expect(resAfter.wordProgress).toBe(1);
  });
});

describe('Video Recorder Quality Settings & Presets', () => {
  it('enforces high quality bitrates and true backing store dimensions', () => {
    // 1080p portrait (Reel / TikTok 9:16)
    const dimsHigh = getQualityDimensions('high', '9:16');
    expect(dimsHigh).toEqual({ width: 1080, height: 1920 });

    // 1080p landscape (16:9)
    const dimsHighLand = getQualityDimensions('high', '16:9');
    expect(dimsHighLand).toEqual({ width: 1920, height: 1080 });

    // 720p portrait
    const dimsMed = getQualityDimensions('medium', '9:16');
    expect(dimsMed).toEqual({ width: 720, height: 1280 });

    // 4K portrait
    const dimsUltra = getQualityDimensions('ultra', '9:16');
    expect(dimsUltra).toEqual({ width: 2160, height: 3840 });

    // Bitrate checks: must meet high-definition standards for Arabic diacritics
    expect(QUALITY_PRESETS['high'].bitrate).toBe(8_000_000);   // 8 Mbps
    expect(QUALITY_PRESETS['medium'].bitrate).toBe(4_000_000); // 4 Mbps
    expect(QUALITY_PRESETS['ultra'].bitrate).toBe(18_000_000); // 18 Mbps
  });
});

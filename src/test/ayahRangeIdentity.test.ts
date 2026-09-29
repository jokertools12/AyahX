import { describe, expect, it } from 'vitest';
import { createAyahRangeKey, isAyahRangeReady, isCompleteAyahRange } from '../lib/ayahRangeIdentity';

describe('ayah range identity', () => {
  it('accepts only the complete ordered verses for the active surah and range', () => {
    const requestedKey = createAyahRangeKey(26, 63, 65);
    expect(isAyahRangeReady({
      loadedKey: requestedKey,
      requestedKey,
      startAyah: 63,
      endAyah: 65,
      ayahs: [63, 64, 65].map((numberInSurah) => ({ numberInSurah, text: 'آية صحيحة' })),
    })).toBe(true);
  });

  it('rejects stale, partial, reordered, or empty text even when array length matches', () => {
    const requestedKey = createAyahRangeKey(26, 63, 65);
    const input = {
      requestedKey,
      startAyah: 63,
      endAyah: 65,
      ayahs: [63, 64, 65].map((numberInSurah) => ({ numberInSurah, text: 'آية صحيحة' })),
    };

    expect(isAyahRangeReady({ ...input, loadedKey: createAyahRangeKey(26, 60, 62) })).toBe(false);
    expect(isAyahRangeReady({ ...input, loadedKey: requestedKey, ayahs: input.ayahs.slice(0, 2) })).toBe(false);
    expect(isAyahRangeReady({
      ...input,
      loadedKey: requestedKey,
      ayahs: [input.ayahs[1], input.ayahs[0], input.ayahs[2]],
    })).toBe(false);
    expect(isAyahRangeReady({
      ...input,
      loadedKey: requestedKey,
      ayahs: input.ayahs.map((ayah, index) => index === 1 ? { ...ayah, text: '  ' } : ayah),
    })).toBe(false);
  });

  it('rejects partial provider payloads before they can suppress the complete-range fallback', () => {
    expect(isCompleteAyahRange(63, 65, [
      { numberInSurah: 63, text: 'آية 63' },
      { numberInSurah: 64, text: 'آية 64' },
    ])).toBe(false);
    expect(isCompleteAyahRange(63, 65, [
      { numberInSurah: 63, text: 'آية 63' },
      { numberInSurah: 64, text: 'آية 64' },
      { numberInSurah: 65, text: 'آية 65' },
    ])).toBe(true);
  });
});

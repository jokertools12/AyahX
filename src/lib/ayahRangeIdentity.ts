export interface AyahRangeReference {
  numberInSurah: number;
  text: string;
}

export function createAyahRangeKey(surahNumber: number, startAyah: number, endAyah: number): string {
  return `${surahNumber}:${startAyah}-${endAyah}`;
}

export function isCompleteAyahRange(
  startAyah: number,
  endAyah: number,
  ayahs: readonly AyahRangeReference[],
): boolean {
  if (!Number.isInteger(startAyah) || !Number.isInteger(endAyah) || endAyah < startAyah) return false;
  const expectedCount = endAyah - startAyah + 1;
  return ayahs.length === expectedCount && ayahs.every((ayah, index) => (
    ayah.numberInSurah === startAyah + index
    && typeof ayah.text === 'string'
    && ayah.text.trim().length > 0
  ));
}

/**
 * Prevents an out-of-order Quran API response from being paired with a newer
 * audio/range selection. The key alone is not enough: the payload must contain
 * every requested verse in order as well.
 */
export function isAyahRangeReady(input: {
  loadedKey: string | null;
  requestedKey: string;
  startAyah: number;
  endAyah: number;
  ayahs: readonly AyahRangeReference[];
}): boolean {
  const { loadedKey, requestedKey, startAyah, endAyah, ayahs } = input;
  return loadedKey === requestedKey && isCompleteAyahRange(startAyah, endAyah, ayahs);
}

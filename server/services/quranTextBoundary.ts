/** Quran references must never enter the generic AI subtitle-refinement path. */
export function containsQuranReference(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  if (Array.isArray(input)) return input.some(containsQuranReference);
  const value = input as Record<string, unknown>;
  const referenceKeys = ['quran_ayah_id', 'quranAyahId', 'ayah_id', 'ayahId', 'quran_word_id', 'text_version_id', 'canonicalAyahRange'];
  if (referenceKeys.some((key) => key in value)) return true;
  if (['contentType', 'source', 'table', 'kind', 'type'].some((key) => ['quran', 'quran_ayahs', 'quran_words'].includes(String(value[key] || '')))) return true;
  return Object.values(value).some(containsQuranReference);
}

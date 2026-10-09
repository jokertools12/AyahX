import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import reference from './fixtures/quran-text-reference.json';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';
import { checksumText } from '../../server/services/quranTextImport';

describe('D1 complete pinned corpus acceptance', () => {
  it.skipIf(!process.env.D1_QURAN_CORPUS)('matches the independent pinned chapter counts and text checksum', () => {
    const corpus = JSON.parse(readFileSync(process.env.D1_QURAN_CORPUS!, 'utf8')) as QuranTextCorpus;
    expect(Object.keys(corpus.surahs)).toHaveLength(reference.ayah_counts.length);
    expect(corpus.ayahs).toHaveLength(reference.ayah_counts.reduce((sum, count) => sum + count, 0));
    reference.ayah_counts.forEach((count, index) => {
      expect(corpus.ayahs.filter((row) => row.surah === index + 1)).toHaveLength(count);
    });
    expect(corpus.wordCount).toBe(reference.word_count);
    expect(corpus.checksum).toBe(reference.canonical_checksum);
    expect(checksumText(corpus.ayahs.map((row) => `${row.surah}:${row.ayah}\t${row.text}`).join('\n'))).toBe(reference.canonical_checksum);
  });
});

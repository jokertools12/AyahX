import { describe, expect, it } from 'vitest';
import { isUniversalReciter, QUA_RECITATIONS } from '../../server/services/quranUniversalAudioService';

describe('Quranic Universal Audio catalogue', () => {
  it('exposes the production direct-audio catalogue without model configuration', () => {
    expect(Object.keys(QUA_RECITATIONS).length).toBeGreaterThanOrEqual(20);
    expect(isUniversalReciter('mishary_rashid_al_afasy_mp3quran')).toBe(true);
    expect(isUniversalReciter('not-a-reciter')).toBe(false);
  });

  it('keeps each timing package paired with a chapter audio source', () => {
    for (const reciter of Object.values(QUA_RECITATIONS)) {
      expect(reciter.zip).toMatch(/\.zip$/);
      expect(reciter.chapterOneUrl).toMatch(/\/001\.mp3$/);
      expect(reciter.coverageAyahs).toBeGreaterThan(300);
    }
  });
});

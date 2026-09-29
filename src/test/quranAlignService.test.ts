import { describe, expect, it } from 'vitest';
import { resolveKnownQuranAlign } from '../../server/services/quranAlignService';

describe('pinned quran-align importer', () => {
  it('returns an approved word map for an exact EveryAyah source', () => {
    const map = resolveKnownQuranAlign({
      reciterId: 'mishary_alafasy',
      everyAyahSubfolder: 'Alafasy_128kbps',
      audio: { contentHash: 'sha256-test-audio', durationMs: 5000, sampleRate: 44100, channels: 2 },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ' }],
        quranTextVersion: 'uthmani_hafs_v1',
      },
      audioTimestamps: [{ from: 0, to: 5 }],
    });

    expect(map.sourceId).toBe('verified_dataset');
    expect(map.sourceMethod).toBe('verified_dataset');
    expect(map.validationStatus).toBe('approved');
    expect(map.words).toHaveLength(4);
    expect(map.alignment?.license).toBe('CC-BY-4.0');
  });

  it('fails closed for a recitation without an exact pinned source', () => {
    expect(() => resolveKnownQuranAlign({
      reciterId: 'unknown',
      everyAyahSubfolder: 'Not_A_Pinned_Folder',
      audio: { contentHash: 'sha256-test-audio', durationMs: 1000 },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ' }],
      },
      audioTimestamps: [{ from: 0, to: 1 }],
    })).toThrow('KNOWN_ALIGNMENT_RECITER_NOT_SUPPORTED');
  });
});

import { describe, expect, it } from 'vitest';
import { formatBytes, planAudioBatch } from './uploadPlan';

describe('licensed audio batch mapping', () => {
  it('maps explicit numeric chapter names while refusing ambiguous names and duplicates', () => {
    const plan = planAudioBatch([{ name: '001.mp3', size: 20 }, { name: '1.wav', size: 30 }, { name: 'reader_002.mp3', size: 30 }, { name: '114.FLAC', size: 40 }]);
    expect(plan.files.map(row => row.surah)).toEqual([114]);
    expect(plan.rejected.map(row => row.reason)).toEqual(['DUPLICATE_CHAPTER', 'INVALID_CHAPTER_NAME', 'DUPLICATE_CHAPTER']);
    expect(plan.missing).toHaveLength(113);
    expect(plan.missing).toContain(1);
  });

  it('refuses invalid ranges, video extensions, empty files, oversized files and oversized batches', () => {
    const plan = planAudioBatch([{ name: '000.mp3', size: 2 }, { name: '115.mp3', size: 2 }, { name: '002.mp4', size: 2 }, { name: '003.mp3', size: 0 }, { name: '004.mp3', size: 1_000_000_001 }]);
    expect(plan.files).toEqual([]);
    expect(plan.rejected.map(row => row.reason)).toEqual(['INVALID_CHAPTER_NAME', 'INVALID_CHAPTER_NAME', 'UNSUPPORTED_AUDIO', 'INVALID_SIZE', 'INVALID_SIZE']);
    const batch = planAudioBatch(Array.from({ length: 115 }, (_, index) => ({ name: `${index + 1}.mp3`, size: 1 })));
    expect(batch.files).toHaveLength(114);
    expect(batch.rejected[0].reason).toBe('BATCH_LIMIT');
  });

  it('does not label an unavailable byte measurement as zero', () => {
    expect(formatBytes(Number.NaN, 'ar')).toBe('غير متاح');
    expect(formatBytes(1_000_000, 'en')).toBe('1 MB');
  });
});

import { describe, it, expect } from 'vitest';
import { buildTimingPlan, verifyTimingRow, timingValues } from '../../server/services/qudTimingSql';
import { prepareTimingRows } from '../../server/services/qudTimingPackage';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';
const corpus = { version: 'test', checksum: 'hash', ayahs: [{ surah: 1, ayah: 1, words: ['قال'], text: 'قال' }] } as QuranTextCorpus;
const rows = prepareTimingRows({ rows: [['1:1', 10, 20, true, 0, [[1, 10, 20]], 'قال']], slug: 'test', sourceSha: 'hash', version: 'test', corpus, canonicalAvailable: true, chapters: [1] });
describe('D3 fixed SQL and actual value verification', () => {
  it('produces identical SQL, has checkpoints and respects the row limit', () => {
    const args: Parameters<typeof buildTimingPlan> = [[{ slug: 'test', rows }], 'manifest', 'hash', 1];
    expect(buildTimingPlan(...args)).toEqual(buildTimingPlan(...args));
    expect(buildTimingPlan(...args).plan.jobs[0].batches[0]).toMatchObject({ row_count: 1, checkpoint: 1 });
    expect(() => buildTimingPlan(args[0], 'm', 'h', 1001)).toThrow('BATCH_LIMIT');
    expect(() => buildTimingPlan([{ slug: 'test', rows: [...rows, ...rows] }], 'm', 'h')).toThrow('IDENTITY');
  });
  it('detects corruption even when version_hash is retained', () => {
    const actual = timingValues(rows[0]); expect(() => verifyTimingRow(rows[0], actual)).not.toThrow();
    actual.words = '[[1,0,10,19]]'; expect(() => verifyTimingRow(rows[0], actual)).toThrow('STORED_TIMING_MISMATCH');
  });
});

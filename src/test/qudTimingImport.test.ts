import { describe, expect, it } from 'vitest';
import { chapterCoverageSql, verifyImportedRows } from '../../server/services/qudTimingImport';
import { prepareTimingRows } from '../../server/services/qudTimingPackage';
import { timingValues } from '../../server/services/qudTimingSql';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';

const corpus = { version: 'unit', checksum: 'a'.repeat(64), ayahs: [{ surah: 1, ayah: 1, words: ['قال'] }] } as QuranTextCorpus;
const rows = prepareTimingRows({ rows: [['1:1', 0, 100, true, 0, [[1, 0, 100]], 'قال']], slug: 'unit', sourceSha: 'b'.repeat(64), version: 'v3.2.0', corpus, canonicalAvailable: true, chapters: [1] });
describe('D3 resume guard and chapter acceptance', () => {
  it('rejects missing checkpoint rows and actual value corruption despite unchanged hash', () => {
    expect(() => verifyImportedRows(rows, [], 1)).toThrow('CHECKPOINT_ROW_COUNT_MISMATCH');
    const stored = timingValues(rows[0]);
    expect(() => verifyImportedRows(rows, [stored])).not.toThrow();
    expect(() => verifyImportedRows(rows, [{ ...stored, end_ms: 200 }])).toThrow('STORED_TIMING_MISMATCH');
  });
  it('lets generated is_complete derive from existing ayahs_complete and timing_complete', () => {
    const sql = chapterCoverageSql(rows, [1], corpus);
    expect(sql).toContain('timing_complete=CASE surah WHEN 1 THEN 1');
    expect(sql).not.toContain('is_complete=');
    const bad = { ...rows[0], review_status: 'needs_review' as const, review_reasons: ['INVALID_WORD_INTERVAL'] };
    expect(chapterCoverageSql([bad], [1], corpus)).toContain('timing_complete=CASE surah WHEN 1 THEN 0');
  });
});

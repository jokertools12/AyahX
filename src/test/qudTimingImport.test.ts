import { describe, expect, it } from 'vitest';
import { chapterCoverageSql, importTimingRecitation, verifyImportedRows } from '../../server/services/qudTimingImport';
import { prepareTimingRows } from '../../server/services/qudTimingPackage';
import { timingValues } from '../../server/services/qudTimingSql';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';

const corpus = { version: 'unit', checksum: 'a'.repeat(64), ayahs: [{ surah: 1, ayah: 1, words: ['قال'] }] } as QuranTextCorpus;
const rows = prepareTimingRows({ rows: [['1:1', 0, 100, true, 0, [[1, 0, 100]], 'قال']], slug: 'unit', sourceSha: 'b'.repeat(64), version: 'v3.2.0', corpus, canonicalAvailable: true, chapters: [1] });
describe('D3 resume guard and chapter acceptance', () => {
  it('archives actual corruption and fails without silently replacing a timing', async () => {
    const writes: string[] = [];
    const manifest = { manifest_sha256: 'c'.repeat(64), canonical_checksum: corpus.checksum, results: [] };
    await expect(importTimingRecitation({
      read: async (sql) => sql.includes('FROM import_jobs') ? [{ checkpoint: 1, manifest_sha256: manifest.manifest_sha256, canonical_checksum: corpus.checksum, total_rows: 1 }] : [{ ...timingValues(rows[0]), end_ms: 200 }],
      execute: async (sql) => { writes.push(sql); },
    }, { rows, slug: 'unit', manifest, corpus, maxPacket: 67108864 })).rejects.toThrow('STORED_TIMING_MISMATCH');
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain('INSERT INTO ayah_timing_history');
    expect(writes[1]).toContain("status='failed'");
    expect(writes.join('\n')).not.toContain('INSERT INTO ayah_timings(');
  });
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
  it('accounts for unmapped spoken words as missing legal words without counting null as an ID', () => {
    const unmapped = prepareTimingRows({ rows: [['1:1', 0, 100, true, 0, [[1, 0, 100]], 'آخر']], slug: 'unit', sourceSha: 'b'.repeat(64), version: 'v3.2.0', corpus, canonicalAvailable: true, chapters: [1] });
    expect(unmapped[0].words[0][0]).toBeNull();
    expect(unmapped[0].missing_words).toEqual([[1, 'NO_VALID_MAPPED_SOURCE_INTERVAL']]);
    expect(() => verifyImportedRows(unmapped, unmapped.map(timingValues))).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { readTimingPackage, timingHash, prepareTimingRows } from '../../server/services/qudTimingPackage';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';
describe('D3 pinned release input', () => {
  const row = ['1:1', 10, 20, true, 0, [[1, 10, 20]]];
  const make = (alter = false) => zipSync(Object.fromEntries(['verse','word','letter'].map((tier) => [`${tier}_timestamps.json.gz`, gzipSync(JSON.stringify({
    _meta: { schema_version: 3, slug: 'actual', units: 'ms', tier, script_sha256: 'trusted', occurrence_count: 1 },
    rows: [tier === 'verse' ? row.slice(0, 5) : tier === 'letter' ? [...row, 'قال', []] : alter ? [...row.slice(0, 5), [[1, 10, 21]]] : row],
  }))])));
  it('requires archive identity and exact identity of the three tiers', () => {
    const b = make(); expect(readTimingPackage(b, timingHash(b), 'actual').rows[0][6]).toBe('قال');
    expect(() => readTimingPackage(b, 'bad', 'actual')).toThrow('PIN_MISMATCH');
    const changed = make(true); expect(() => readTimingPackage(changed, timingHash(changed), 'actual')).toThrow('OCCURRENCE_IDENTITY_MISMATCH');
  });
  it('creates documented missing ayah data without inventing timing', () => {
    const corpus = { version: 'fixture', checksum: 'checksum', ayahs: [{ surah: 1, ayah: 1, words: ['قال'], text: 'قال' }, { surah: 1, ayah: 2, words: ['الحق'], text: 'الحق' }] } as QuranTextCorpus;
    const args = { rows: readTimingPackage(make(), timingHash(make()), 'actual').rows, slug: 'actual', sourceSha: 'hash', version: 'fixture', corpus, canonicalAvailable: true, chapters: [1] };
    const first = prepareTimingRows(args); expect(prepareTimingRows(args)).toEqual(first);
    expect(first[1]).toMatchObject({ words: [], missing_words: [[1, 'NO_VALID_MAPPED_SOURCE_INTERVAL']], review_status: 'needs_review', start_ms: null });
    expect(prepareTimingRows({ ...args, canonicalAvailable: false })[0].ayah_id).toBeNull();
  });
  it('keeps word-only editions without borrowing canonical spoken text', () => {
    const files = Object.fromEntries(['verse','word'].map((tier) => [`${tier}_timestamps.json.gz`, gzipSync(JSON.stringify({
      _meta: { schema_version: 3, slug: 'actual', units: 'ms', tier, script_sha256: 'warsh', occurrence_count: 1 },
      rows: [tier === 'verse' ? row.slice(0, 5) : row],
    }))]));
    const bytes = zipSync(files);
    const source = readTimingPackage(bytes, timingHash(bytes), 'actual', ['verse','word']);
    expect(source.rows[0][6]).toBeNull();
    expect(() => readTimingPackage(bytes, timingHash(bytes), 'actual')).toThrow('TIER_MISSING:letter');
  });
});

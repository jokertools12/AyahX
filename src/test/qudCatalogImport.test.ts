import { describe, expect, it } from 'vitest';
import { QudReleaseAdapter, buildCatalogDataset, expandMissingVerses, expandRanges, sha, type ReleaseRecitation, type CatalogAdapter } from '../../server/services/qudCatalogImport';
import { generateCatalogSql } from '../../server/services/qudCatalogSql';

const record: ReleaseRecitation = { slug: 'fixture_source', reciter_id: 'person_1', name_ar: 'اسم مطابق', name_en: 'Same Name', riwayah: 'hafs_an_asim', style: 'murattal', channel: 'fixture', audio_category: 'surah', audio: { chapter_urls: { '1': 'https://example.org/1.mp3' } }, coverage: { ayahs: 2, surahs: 1 } };
const adapterFor = (records: ReleaseRecitation[]): QudReleaseAdapter => {
  const raw = JSON.stringify({ schema_version: 3, recitations: records });
  return new QudReleaseAdapter(raw, sha(raw));
};
const build = (adapter: CatalogAdapter, records: ReleaseRecitation[]) => buildCatalogDataset(adapter, { version: 'fixture', catalogSha: 'fixture', sourceUrl: 'https://example.org/catalog.json', legalCounts: { '1': 2 },
  annotations: records.map((row) => ({ config: row.slug, rows: 2, unique_ayahs: 2, basmala_mode: 'ayah_1_included', basmala_reason: '1:1 row exists', chapters: [{ surah: 1, available_ayahs: 2 }] })),
  openings: records.map((row) => ({ config: row.slug, basmala_mode: 'ayah_1_included', basmala_reason: '1:1 row exists', groups: { basmala_not_in_recited_text: [2] } })), reviews: [], offsets: {} });

describe('D2 catalog identity and coverage', () => {
  it('merges only by reciter_id and keeps identical names with distinct IDs separate', async () => {
    const records = [record, { ...record, slug: 'same_reader' }, { ...record, slug: 'another_reader', reciter_id: 'person_2' }];
    const data = await build(adapterFor(records), records);
    expect(data.reciters).toHaveLength(2);
    expect(data.recitations).toHaveLength(3);
  });
  it('isolates each missing ID and marks the reader needs_review', async () => {
    const records = [{ ...record, reciter_id: null }, { ...record, slug: 'isolated_2', reciter_id: null }];
    const data = await build(adapterFor(records), records);
    expect(data.reciters).toHaveLength(2);
    expect(data.reciters.every((row) => row.status === 'needs_review')).toBe(true);
  });
  it('keeps timing unknown, audio unverified, and rejects automatic publication', async () => {
    const data = await build(adapterFor([record]), [record]);
    expect(data.recitations[0]).toMatchObject({ status: 'imported', ayahs_complete: true, coverage_words: null, verification_status: 'pending', surah_start_basmala_audio_status: 'unverified' });
    expect(data.chapters[0].timing_complete).toBeNull();
    data.recitations[0].status = 'published';
    expect(() => generateCatalogSql(data)).toThrow('D2_PUBLICATION_OR_TIMING_IMPORT_PROHIBITED');
  });
  it('never borrows a Hafs reference for another riwayah', async () => {
    const records = [{ ...record, riwayah: 'warsh_an_nafi' }];
    const data = await build(adapterFor(records), records);
    expect(data.recitations[0]).toMatchObject({ canonical_text_available: false, ayahs_complete: false, status: 'imported' });
    expect(data.chapters[0].expected_ayahs).toBeNull();
    expect(data.riwayat[0].is_active).toBe(false);
  });
  it('marks missing verses and catalog/HF differences without claiming completeness', async () => {
    const records = [{ ...record, coverage: { ayahs: 1, surahs: 1, missing_verses: '1:1' } }];
    const data = await build(adapterFor(records), records);
    expect(data.recitations[0].ayahs_complete).toBe(false);
    expect(data.chapters[0].coverage_mismatch).toBe(true);
    expect(JSON.parse(String(data.chapters[0].missing_verses))).toEqual(['1:1']);
  });
  it('supports an injected mock source without changing the engine', async () => {
    const mock: CatalogAdapter = { id: 'mock', listRecitations: async () => [record], listChapters: async () => [{ surah: 1, audio_url: 'https://example.org/1.mp3', chapter_offset_ms: 12 }], resolveAudio: async () => ({ url: 'https://example.org/1.mp3', chapter_offset_ms: 12 }), healthCheck: async () => ({ ok: true }) };
    expect((await build(mock, [record])).chapters[0].chapter_offset_ms).toBe(12);
  });
  it('expands real abbreviated missing verse and surah ranges', () => {
    expect(expandMissingVerses('7:11,17-18, 43:31')).toEqual(['7:11', '7:17', '7:18', '43:31']);
    expect(expandMissingVerses('22:66-78')).toHaveLength(13);
    expect(expandRanges('9,14,16-17,23-24,33')).toEqual([9,14,16,17,23,24,33]);
    expect(() => expandMissingVerses('17-18')).toThrow();
  });
  it('rejects changed source bytes and duplicate slugs before importing', () => {
    expect(() => new QudReleaseAdapter('{}', 'wrong')).toThrow('CATALOG_PIN_MISMATCH');
    expect(() => adapterFor([record, record])).toThrow('CATALOG_DUPLICATE_OR_INVALID_SLUG');
  });
  it('generates deterministic additive SQL with bounded batches', async () => {
    const data = await build(adapterFor([record]), [record]);
    const first = generateCatalogSql(data, 1);
    expect(first.sha256).toBe(generateCatalogSql(data, 1).sha256);
    expect(first.sql).not.toMatch(/^(ALTER|DROP|DELETE|RENAME|UPDATE)\b/mu);
    expect(() => generateCatalogSql(data, 1001)).toThrow('SQL_BATCH_LIMIT_EXCEEDED');
  });
});

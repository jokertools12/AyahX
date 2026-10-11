// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildD4DurationAudit, type DurationMeasurement, type DurationEndpoint, type DurationLink, type RetainedDurationCheck } from '../../scripts/lib/d4DurationAudit';
const url = 'https://audio.example/001.mp3', sha = 'a'.repeat(64), urlSha = createHash('sha256').update(url).digest('hex');
const measurement: DurationMeasurement = { slug: 'reader_one', surah: 1, status: 'measured', scope: 'COMPLETE_ORIGINAL_CATALOG_SURAH_SOURCE', full_surah_comparison_eligible: true, duration_ms: 1000, source_sha256_matches: true, actual_source_sha256: sha, expected_source_sha256: sha, original_source_url: url, measured_at: '2026-10-10T10:00:00Z', format_size_bytes: 100 };
const endpoint: DurationEndpoint = { slug: 'reader_one', surah: 1, original_url_sha256: urlSha, source_end_ms: 1000, reason: null, timing_rows: 7, timing_complete: 1, coverage_mismatch: 0, expected_ayahs: 7, coverage_words: 29, expected_words: 29, offset_verified: 0, offset_basis: 'standalone_original_chapter_resource_origin', endpoint_scope: 'QUD_EXPECTED_LAST_STORED_WORD_NOT_ALIGNMENT_PROOF' };
const link: DurationLink = { recitation: 'reader_one', surah: 1, kind: 'chapter', original_url_sha256: urlSha, status: 'available', httpStatus: 200, checkedAt: '2026-10-10T12:00:00Z', contentLength: 100 };
const retained: RetainedDurationCheck = { slug: 'reader_one', surah: 1, status: 'verified', sourceSha256: sha, sizeBytes: 100 };
function run(m = measurement, e = endpoint, l = link, r = retained) { return buildD4DurationAudit([m], [e], [l], [r]); }
describe('offline duration evidence scope and arithmetic', () => {
  it('compares raw endpoints while preserving failed offset as unverified', () => { const r = run(); expect(r.counts.endpoint_comparisons).toBe(1); expect(r.measurements[0].offset_verified).toBe(false); expect(r.measurements[0].relative_duration_difference).toBe(0); expect(r.measurements[0].warning_over_5_percent).toBe(false); });
  it.each([[1050, false], [1050.000001, true], [950, false], [949.999999, true]])('uses raw >5 percent threshold at duration %s', (duration, warning) => { expect(run({ ...measurement, duration_ms: duration }).measurements[0].warning_over_5_percent).toBe(warning); });
  it('does not infer duration from HEAD content length or substitute a clip/HF duration', () => {
    const r = run({ ...measurement, scope: 'HF_AYAH_CLIP' }, endpoint, { ...link, contentLength: 1_000_000 });
    expect(r.counts.verified_full_source_durations).toBe(0); expect(r.measurements[0].verified_full_source_duration_ms).toBeNull(); expect(r.measurements[0].relative_duration_difference).toBeNull();
  });
  it('retains unavailable terminal timing rather than repairing null canonical word mappings', () => {
    const r = run(measurement, { ...endpoint, source_end_ms: null, reason: 'TIMELINE_WORD_INVALID' });
    expect(r.counts.verified_full_source_durations).toBe(1); expect(r.counts.endpoint_comparisons).toBe(0); expect(r.counts.endpoint_unavailable_reasons).toEqual({ TIMELINE_WORD_INVALID: 1 });
  });
  it('requires the current catalog and endpoint to name the actual measured original resource', () => {
    const r = run(measurement, endpoint, { ...link, original_url_sha256: 'b'.repeat(64) }); expect(r.counts.endpoint_comparisons).toBe(0); expect(r.measurements[0].unavailable_reason).toBe('CURRENT_CHAPTER_SOURCE_MISMATCH');
  });
  it('rejects a missing or changed retained source rather than promoting historical ffprobe to fresh acceptance', () => {
    for (const r of [{ ...retained, status: 'missing' as const }, { ...retained, sourceSha256: 'b'.repeat(64) }, { ...retained, sizeBytes: 101 }]) expect(run(measurement, endpoint, link, r).counts.verified_full_source_durations).toBe(0);
  });
  it('counts untouched catalog chapters as duration unavailable with no all-catalog claim', () => {
    const r = buildD4DurationAudit([measurement], [endpoint], [link, { ...link, surah: 2 }, { ...link, recitation: 'reader_two', surah: 1 }], [retained]);
    expect(r.counts.catalog_chapters).toBe(3); expect(r.counts.full_source_duration_unavailable).toBe(2); expect(r.per_recitation[1].full_source_duration_unavailable).toBe(1);
  });
  it('exports only metadata hashes, never original URLs, audio or private locators', () => {
    const output = JSON.stringify(run()); expect(output).not.toContain(url); expect(output).not.toMatch(/scratch_dir|audio_data|localPath/u); expect(output).toContain(urlSha);
  });
  it('rejects duplicate measured or inventory chapter pairs', () => {
    expect(() => buildD4DurationAudit([measurement, measurement], [endpoint], [link], [retained])).toThrow('DURATION_MEASUREMENT_DUPLICATE');
    expect(() => buildD4DurationAudit([measurement], [endpoint], [link, link], [retained])).toThrow('DURATION_INVENTORY_DUPLICATE');
    expect(() => buildD4DurationAudit([measurement], [endpoint, endpoint], [link], [retained])).toThrow('DURATION_ENDPOINT_DUPLICATE');
    expect(() => buildD4DurationAudit([measurement], [endpoint], [link], [retained, retained])).toThrow('DURATION_RETAINED_CHECK_DUPLICATE');
  });
});

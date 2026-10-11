import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export interface DurationMeasurement {
  slug: string; surah: number; status: string; scope: string; full_surah_comparison_eligible: boolean;
  duration_ms: number; source_sha256_matches: boolean; actual_source_sha256: string; expected_source_sha256: string;
  original_source_url: string; measured_at: string; format_size_bytes: number;
}
export interface DurationEndpoint {
  slug: string; surah: number; original_url_sha256: string; source_end_ms: number | null; reason: string | null;
  timing_rows: number; timing_complete: number; coverage_mismatch: number; expected_ayahs: number; coverage_words: number;
  expected_words: number; offset_verified: number; offset_basis: string; endpoint_scope: string;
}
export interface DurationLink { recitation: string; surah: number; kind: string; original_url_sha256: string; status: string; httpStatus: number | null; checkedAt: string; contentLength?: number }
export interface RetainedDurationCheck { slug: string; surah: number; status: 'verified' | 'missing' | 'hash_or_size_mismatch'; sourceSha256: string | null; sizeBytes: number | null }
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const pair = (slug: string, surah: number): string => `${slug}:${surah}`;
export function buildD4DurationAudit(measurements: readonly DurationMeasurement[], endpoints: readonly DurationEndpoint[], links: readonly DurationLink[], checks: readonly RetainedDurationCheck[]) {
  const inventory = links.filter(link => link.kind === 'chapter');
  const index = new Map(inventory.map(row => [pair(row.recitation, row.surah), row]));
  assert.equal(index.size, inventory.length, 'DURATION_INVENTORY_DUPLICATE');
  const ends = new Map(endpoints.map(row => [pair(row.slug, row.surah), row]));
  const files = new Map(checks.map(row => [pair(row.slug, row.surah), row]));
  assert.equal(ends.size, endpoints.length, 'DURATION_ENDPOINT_DUPLICATE');
  assert.equal(files.size, checks.length, 'DURATION_RETAINED_CHECK_DUPLICATE');
  const seen = new Set<string>();
  const rows = measurements.map(measurement => {
    assert.match(measurement.slug, /^[a-z0-9_-]+$/u); assert.ok(Number.isSafeInteger(measurement.surah) && measurement.surah > 0 && measurement.surah <= 114);
    const key = pair(measurement.slug, measurement.surah); assert.ok(!seen.has(key), 'DURATION_MEASUREMENT_DUPLICATE'); seen.add(key);
    const link = index.get(key), endpoint = ends.get(key), retained = files.get(key);
    assert.ok(link, 'DURATION_MEASURED_CHAPTER_NOT_IN_INVENTORY');
    const actualDuration = measurement.status === 'measured' && measurement.scope === 'COMPLETE_ORIGINAL_CATALOG_SURAH_SOURCE' && measurement.full_surah_comparison_eligible === true && measurement.source_sha256_matches === true && /^[a-f0-9]{64}$/u.test(measurement.actual_source_sha256) && measurement.actual_source_sha256 === measurement.expected_source_sha256 && Number.isFinite(measurement.duration_ms) && measurement.duration_ms > 0 && retained?.status === 'verified' && retained.sourceSha256 === measurement.actual_source_sha256 && retained.sizeBytes === measurement.format_size_bytes ? measurement.duration_ms : null;
    const originalSha = sha(measurement.original_source_url);
    const currentSourceMatches = Boolean(originalSha === link.original_url_sha256 && endpoint?.original_url_sha256 === originalSha);
    const endpointValid = endpoint?.endpoint_scope === 'QUD_EXPECTED_LAST_STORED_WORD_NOT_ALIGNMENT_PROOF' && ['standalone_original_chapter_resource_origin', 'catalog_chapter_offset'].includes(endpoint.offset_basis) && Number.isSafeInteger(endpoint.source_end_ms) && Number(endpoint.source_end_ms) > 0;
    const comparable = actualDuration !== null && currentSourceMatches && endpointValid;
    const endMs = endpointValid ? endpoint!.source_end_ms! : null;
    const relativeDifference = comparable ? Math.abs(actualDuration! - endMs!) / endMs! : null;
    const reason = actualDuration === null ? 'FULL_SOURCE_MEASUREMENT_OR_RETAINED_IDENTITY_UNAVAILABLE' : !currentSourceMatches ? 'CURRENT_CHAPTER_SOURCE_MISMATCH' : !endpointValid ? endpoint?.reason && /^TIMELINE_[A-Z_]+$/u.test(endpoint.reason) ? endpoint.reason : 'LAST_STORED_WORD_ENDPOINT_UNAVAILABLE' : null;
    return {
      recitation: measurement.slug, surah: measurement.surah, source_sha256: measurement.actual_source_sha256,
      original_url_sha256: originalSha, measured_at: measurement.measured_at, scope: measurement.scope,
      recorded_full_source_duration_ms: measurement.duration_ms, retained_source_status: retained?.status ?? 'missing',
      verified_full_source_duration_ms: actualDuration, last_stored_word_source_end_ms: endMs,
      endpoint_scope: 'QUD_EXPECTED_LAST_STORED_WORD_NOT_ALIGNMENT_PROOF', offset_basis: endpoint?.offset_basis ?? 'unavailable',
      offset_verified: Number(endpoint?.offset_verified) === 1, current_source_matches: currentSourceMatches,
      comparison_state: comparable ? 'compared_stored_endpoint_only' : 'unavailable', unavailable_reason: reason,
      delta_ms: comparable ? actualDuration! - endMs! : null, relative_duration_difference: relativeDifference,
      warning_over_5_percent: relativeDifference !== null && relativeDifference > .05,
      timing_complete: Number(endpoint?.timing_complete) === 1, timing_rows: endpoint?.timing_rows ?? null,
      expected_ayahs: endpoint?.expected_ayahs ?? null, coverage_words: endpoint?.coverage_words ?? null,
      expected_words: endpoint?.expected_words ?? null, coverage_mismatch: endpoint?.coverage_mismatch ?? null,
      link_check: { status: /^[A-Za-z0-9_]+$/u.test(link.status) ? link.status : 'UNAVAILABLE', http_status: link.httpStatus, checked_at: link.checkedAt, reported_content_length_bytes: Number.isSafeInteger(link.contentLength) && Number(link.contentLength) >= 0 ? link.contentLength : null, duration_evidence: 'HEAD_RANGE_METADATA_DOES_NOT_PROVE_DURATION' },
    };
  }).sort((a, b) => a.recitation.localeCompare(b.recitation) || a.surah - b.surah);
  const coverage = [...new Set(inventory.map(row => row.recitation))].sort().map(slug => {
    const measured = rows.filter(row => row.recitation === slug), total = inventory.filter(row => row.recitation === slug).length;
    const full = measured.filter(row => row.verified_full_source_duration_ms !== null).length;
    return { recitation: slug, catalog_chapters: total, retained_full_source_durations: full, endpoint_comparisons: measured.filter(row => row.comparison_state === 'compared_stored_endpoint_only').length, warnings_over_5_percent: measured.filter(row => row.warning_over_5_percent).length, measured_but_endpoint_unavailable: measured.filter(row => row.verified_full_source_duration_ms !== null && row.comparison_state === 'unavailable').length, full_source_duration_unavailable: total - full };
  });
  const reasons: Record<string, number> = {};
  for (const row of rows) if (row.unavailable_reason) reasons[row.unavailable_reason] = (reasons[row.unavailable_reason] ?? 0) + 1;
  return { schema_version: 1, measured_scope: 'Retained B full original chapter resources only; not all-catalog duration acceptance',
    formula: 'abs(ffprobe_full_source_duration_ms-last_stored_word_source_end_ms)/last_stored_word_source_end_ms > 0.05; raw values, no threshold rounding',
    counts: { catalog_chapters: inventory.length, recitations: coverage.length, retained_measurements: rows.length, verified_full_source_durations: rows.filter(row => row.verified_full_source_duration_ms !== null).length, endpoint_comparisons: rows.filter(row => row.comparison_state === 'compared_stored_endpoint_only').length, warnings_over_5_percent: rows.filter(row => row.warning_over_5_percent).length, full_source_duration_unavailable: inventory.length - rows.filter(row => row.verified_full_source_duration_ms !== null).length, endpoint_unavailable_reasons: reasons },
    per_recitation: coverage, measurements: rows, network_requests: 0, db_writes: 0, audio_mutations: 0, filesystem_deletions: 0,
    limitations: ['Historical ffprobe measurements are backed by fresh retained-source SHA/size verification, not new network probes.', 'HEAD/Range Content-Length is not duration. No CBR assumption, VBR extrapolation or clip duration substitution.', 'Source origin only supports comparison to the expected stored endpoint; it is not offset/NCC/VAD/alignment acceptance.', 'Null word mapping is not repaired; a failed toRenderTimeline endpoint stays unavailable.', 'Silence, basmala, introductions, outros, incomplete words and different recording identity may cause warnings; no status/publication changes are made.'],
  };
}

import { createHash } from 'node:crypto';
import { stableId } from './quranTextImport';

export interface ReleaseRecitation {
  slug: string; reciter_id?: string | null; name_ar: string; name_en: string; country?: string;
  riwayah: string; style: string; channel: string; audio_category: string; recording_context?: string;
  recording_year?: number | null; variant_label?: string;
  audio: { chapter_urls: Record<string, string>; chapter_offsets_ms?: Record<string, number>; [key: string]: unknown };
  coverage: { ayahs: number; surahs: number; missing_verses?: string; missing_surahs?: string };
  [key: string]: unknown;
}
export interface CatalogAdapter {
  id: string;
  listRecitations(): Promise<ReleaseRecitation[]>;
  listChapters(slug: string): Promise<Array<{ surah: number; audio_url: string; chapter_offset_ms: number | null }>>;
  resolveAudio(slug: string, surah: number): Promise<{ url: string; chapter_offset_ms: number | null }>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

/** Explicit source selection; no network, provider fallback or runtime hook. */
export class QudReleaseAdapter implements CatalogAdapter {
  readonly id = 'qud-release';
  readonly recitations: ReleaseRecitation[];
  constructor(readonly raw: string, readonly expectedSha256: string) {
    if (sha(raw) !== expectedSha256) throw new Error('CATALOG_PIN_MISMATCH');
    const catalog = JSON.parse(raw) as { schema_version: number; recitations: ReleaseRecitation[] };
    if (catalog.schema_version !== 3 || !Array.isArray(catalog.recitations)) throw new Error('CATALOG_SCHEMA_UNSUPPORTED');
    const slugs = new Set<string>();
    for (const row of catalog.recitations) {
      if (!/^[a-z0-9_]+$/u.test(row.slug) || slugs.has(row.slug)) throw new Error('CATALOG_DUPLICATE_OR_INVALID_SLUG');
      slugs.add(row.slug);
      if (!row.riwayah || !row.name_ar || !row.name_en || !row.channel || !row.audio_category || !row.style || !Number.isSafeInteger(row.coverage?.ayahs)) throw new Error('CATALOG_REQUIRED_METADATA_MISSING');
      // A declared missing surah may still have an original source URL. Keep
      // the actual URLs and report this mismatch; a URL is not coverage.
      if (!row.audio?.chapter_urls || !Number.isSafeInteger(row.coverage.surahs)) throw new Error('CATALOG_CHAPTER_METADATA_INVALID');
      for (const [surah, url] of Object.entries(row.audio.chapter_urls)) {
        if (!/^[1-9][0-9]*$/u.test(surah) || new URL(url).protocol !== 'https:') throw new Error('CATALOG_AUDIO_INVALID');
      }
      for (const offset of Object.values(row.audio.chapter_offsets_ms || {})) if (!Number.isSafeInteger(offset)) throw new Error('OFFSET_INTEGER_MS_REQUIRED');
    }
    this.recitations = catalog.recitations;
  }
  async listRecitations(): Promise<ReleaseRecitation[]> { return structuredClone(this.recitations); }
  async listChapters(slug: string): Promise<Array<{ surah: number; audio_url: string; chapter_offset_ms: number | null }>> {
    const row = this.recitations.find((item) => item.slug === slug);
    if (!row) throw new Error('CATALOG_RECITATION_UNKNOWN');
    return Object.entries(row.audio.chapter_urls).map(([surah, url]) => ({ surah: Number(surah), audio_url: url, chapter_offset_ms: row.audio.chapter_offsets_ms?.[surah] ?? null })).sort((a, b) => a.surah - b.surah);
  }
  async resolveAudio(slug: string, surah: number): Promise<{ url: string; chapter_offset_ms: number | null }> {
    const row = (await this.listChapters(slug)).find((chapter) => chapter.surah === surah);
    if (!row) throw new Error('CATALOG_CHAPTER_UNAVAILABLE');
    return { url: row.audio_url, chapter_offset_ms: row.chapter_offset_ms };
  }
  async healthCheck(): Promise<{ ok: boolean; detail: string }> { return { ok: true, detail: `Pinned catalog parsed: ${this.recitations.length} records` }; }
}

export const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
type Value = string | number | boolean | null;
export type CatalogRow = Record<string, Value>;
export interface AnnotationAudit {
  config: string; rows: number; unique_ayahs: number; basmala_mode: string; basmala_reason: string;
  chapters: Array<{ surah: number; available_ayahs: number }>; [key: string]: unknown;
}
export interface OpeningAudit {
  config: string; groups: Record<string, number[]>; basmala_mode: string; basmala_reason: string; [key: string]: unknown;
}
export interface OffsetEvidence {
  verification_status: 'pending' | 'passed' | 'failed' | 'source_unavailable'; offset_verified: boolean;
  offset_check_score: number | null; offset_correction_ms: number | null; [key: string]: unknown;
}

export function validateOffsetEvidence(offset: OffsetEvidence): void {
  if (!offset.offset_verified) return;
  type Sample = { surah: number; ayah: number; source_offset_hypothesis: { passed: boolean; score: number; duration_difference_ms: number; best_lag_ms: number } };
  const samples = offset.samples as Sample[] | undefined;
  if (offset.verification_status !== 'passed' || offset.offset_check_score === null || offset.offset_check_score < .95 || !Array.isArray(samples)) throw new Error('OFFSET_EVIDENCE_INCONSISTENT');
  const chapters = new Map<number, Set<number>>();
  for (const sample of samples) {
    const result = sample.source_offset_hypothesis;
    if (!Number.isSafeInteger(sample.surah) || !Number.isSafeInteger(sample.ayah) || !result?.passed || !Number.isFinite(result.score) || result.score < .95 || !Number.isFinite(result.duration_difference_ms) || result.duration_difference_ms < 0 || result.duration_difference_ms > 30 || !Number.isFinite(result.best_lag_ms) || Math.abs(result.best_lag_ms) > 30) throw new Error('OFFSET_SAMPLE_ACCEPTANCE_FAILED');
    const verses = chapters.get(sample.surah) || new Set<number>();
    if (verses.has(sample.ayah)) throw new Error('OFFSET_SAMPLE_DUPLICATE');
    verses.add(sample.ayah);
    chapters.set(sample.surah, verses);
  }
  if (chapters.size < 3 || [...chapters.values()].some((verses) => verses.size < 5)) throw new Error('OFFSET_DISTRIBUTED_SAMPLE_REQUIRED');
  if (Math.abs(Math.min(...samples.map((sample) => sample.source_offset_hypothesis.score)) - offset.offset_check_score) > 1e-8) throw new Error('OFFSET_AGGREGATE_SCORE_MISMATCH');
}
export interface CatalogDataset {
  qud_version: string; catalog_sha256: string; reciters: CatalogRow[]; providers: CatalogRow[];
  recitations: CatalogRow[]; chapters: CatalogRow[]; riwayat: CatalogRow[];
  unmapped_sources: Array<{ config: string; rows: number; reason: string }>;
}

export function expandRanges(raw: string): number[] {
  const values: number[] = [];
  for (const part of raw.split(/[,;\s]+/u).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/u.exec(part);
    if (!match) throw new Error('CATALOG_RANGE_INVALID');
    const from = Number(match[1]), to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to - from > 10000) throw new Error('CATALOG_RANGE_INVALID');
    for (let n = from; n <= to; n++) values.push(n);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Catalog uses abbreviated ranges: `7:11,17-18, 43:31`. */
export function expandMissingVerses(raw: string): string[] {
  let surah: string | undefined;
  const result: string[] = [];
  for (const token of raw.split(/[,;\s]+/u).filter(Boolean)) {
    const parts = token.split(':');
    if (parts.length === 2) surah = parts[0];
    else if (parts.length !== 1) throw new Error('CATALOG_VERSE_RANGE_INVALID');
    if (!surah || !/^[1-9][0-9]*$/u.test(surah)) throw new Error('CATALOG_VERSE_RANGE_INVALID');
    for (const ayah of expandRanges(parts.at(-1)!)) result.push(`${surah}:${ayah}`);
  }
  return [...new Set(result)];
}

/** Adapter is injected. A new adapter does not require editing this engine. */
export async function buildCatalogDataset(adapter: CatalogAdapter, input: {
  version: string; catalogSha: string; sourceUrl: string; legalCounts: Record<string, number>;
  annotations: AnnotationAudit[]; openings: OpeningAudit[]; reviews: Array<{ config: string; [key: string]: unknown }>;
  offsets: Record<string, OffsetEvidence>;
}): Promise<CatalogDataset> {
  const records = (await adapter.listRecitations()).sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
  const dataset: CatalogDataset = { qud_version: input.version, catalog_sha256: input.catalogSha, reciters: [], providers: [], recitations: [], chapters: [], riwayat: [], unmapped_sources: [] };
  const readers = new Map<string, CatalogRow>();
  const channels = new Map<string, Set<string>>([['everyayah', new Set(['everyayah.com'])], ['qdc', new Set(['verses.quran.com'])]]);
  const riwayat = new Set<string>();
  for (const row of records) {
    // Missing IDs are isolated per SOURCE RECORD. Names never merge readers.
    const sourceId = row.reciter_id || null;
    const readerKey = sourceId ? `source:${sourceId}` : `isolated:${row.slug}`;
    if (!readers.has(readerKey)) readers.set(readerKey, { id: stableId('reciter', readerKey), source_reciter_id: sourceId,
      slug: sourceId || `unmapped-${row.slug}`, name_ar: row.name_ar, name_en: row.name_en, country: row.country || null, status: sourceId ? 'imported' : 'needs_review' });
    riwayat.add(row.riwayah);
    const hosts = channels.get(row.channel) || new Set<string>();
    for (const url of Object.values(row.audio.chapter_urls)) hosts.add(new URL(url).hostname);
    channels.set(row.channel, hosts);
    const audit = input.annotations.find((item) => item.config === row.slug);
    const opening = input.openings.find((item) => item.config === row.slug);
    if (!audit || !opening) throw new Error(`ANNOTATION_AUDIT_REQUIRED:${row.slug}`);
    const offset: OffsetEvidence = input.offsets[row.slug] || { verification_status: 'pending', offset_verified: false, offset_check_score: null, offset_correction_ms: null, reason: 'verify-offset not yet run' };
    validateOffsetEvidence(offset);
    const textGroups = Object.entries(opening.groups).filter(([, surahs]) => surahs.length > 0).map(([status]) => status);
    const hafs = row.riwayah === 'hafs_an_asim';
    const id = stableId('recitation', row.slug);
    const recitationChapters: CatalogRow[] = [];
    const missing = expandMissingVerses(row.coverage.missing_verses || '');
    const missingSurahs = expandRanges(row.coverage.missing_surahs || '');
    for (const chapter of await adapter.listChapters(row.slug)) {
      const expected = hafs ? input.legalCounts[String(chapter.surah)] ?? null : null;
      const observed = audit.chapters.find((item) => item.surah === chapter.surah)?.available_ayahs ?? 0;
      const declaredMissing = missing.filter((key) => key.startsWith(`${chapter.surah}:`));
      const declaredAvailable = expected === null ? null : missingSurahs.includes(chapter.surah) ? 0 : expected - declaredMissing.length;
      const mismatch = declaredAvailable === null ? null : observed !== declaredAvailable;
      const complete = expected !== null && observed === expected && !declaredMissing.length && !missingSurahs.includes(chapter.surah) && !mismatch;
      recitationChapters.push({ id: stableId('recitation-chapter', `${id}:${chapter.surah}`), recitation_id: id, surah: chapter.surah,
        audio_url: chapter.audio_url, chapter_offset_ms: chapter.chapter_offset_ms, duration_ms: null, audio_status: 'unverified', last_verified_at: null,
        expected_ayahs: expected, available_ayahs: observed, missing_verses: JSON.stringify(declaredMissing), coverage_mismatch: mismatch,
        ayahs_complete: complete, timing_complete: null });
    }
    dataset.chapters.push(...recitationChapters);
    const sumExpected = Object.values(input.legalCounts).reduce((sum, count) => sum + count, 0);
    const complete = hafs && recitationChapters.length === Object.keys(input.legalCounts).length && recitationChapters.every((chapter) => chapter.ayahs_complete === true) && row.coverage.ayahs === sumExpected && audit.unique_ayahs === sumExpected;
    dataset.recitations.push({ id, slug: row.slug, reciter_id: readers.get(readerKey)!.id, provider_id: stableId('audio-provider', row.channel),
      riwayah_id: stableId('riwayah', row.riwayah), riwayah_code: row.riwayah, canonical_text_available: hafs, style: row.style, channel: row.channel,
      audio_category: row.audio_category, audio_mode: offset.offset_verified ? 'surah_slice' : 'unverified_source', recording_context: row.recording_context || null,
      recording_year: row.recording_year ?? null, variant_label: row.variant_label || null, timing_level: 'none', timing_quality: 'unimported',
      coverage_ayahs: row.coverage.ayahs, coverage_words: null, ayahs_complete: complete, basmala_mode: opening.basmala_mode, basmala_reason: opening.basmala_reason,
      surah_start_basmala_text_status: textGroups.length === 1 ? textGroups[0] : 'mixed_or_unavailable', surah_start_basmala_audio_status: 'unverified',
      offset_verified: offset.offset_verified, offset_check_score: offset.offset_check_score, offset_correction_ms: offset.offset_correction_ms,
      verification_status: offset.verification_status, verification_details: JSON.stringify(offset), license_text: null,
      attribution_text: `QUD ${input.version}; original audio: ${row.channel}; ${row.name_en}`, source_url: input.sourceUrl,
      qud_version: input.version, catalog_sha256: input.catalogSha, catalog_raw: JSON.stringify(row),
      audit_json: JSON.stringify({ annotation: audit, opening, review: input.reviews.find((item) => item.config === row.slug) || null,
        catalog_hf_ayah_difference: row.coverage.ayahs - audit.unique_ayahs, canonical_reference_scope: hafs ? 'hafs' : 'unavailable_for_this_riwayah',
        missing_surahs: missingSurahs, catalog_audio_chapters: recitationChapters.length, declared_available_surahs: row.coverage.surahs,
        license_status: 'not_verified; no license inferred from timing repository' }),
      status: hafs && !offset.offset_verified ? 'needs_review' : 'imported' });
  }
  dataset.reciters = [...readers.values()];
  dataset.providers = [...channels].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([code, hosts]) => ({ id: stableId('audio-provider', code), code, name: code,
    base_url: hosts.size === 1 ? `https://${[...hosts][0]}` : null, host_allowlist: JSON.stringify([...hosts].sort()), adapter_id: records.some((row) => row.channel === code) ? adapter.id : null,
    is_active: false, health_status: 'unchecked', license_text: null, attribution_text: `Documented source ${code}; existing runtime unchanged` }));
  const labels: Record<string, [string, string, string]> = { warsh_an_nafi: ['ورش عن نافع', 'Warsh an Nafi', 'warsh'], qalon_an_nafi: ['قالون عن نافع', 'Qalon an Nafi', 'qalun'], shubah_an_asim: ['شعبة عن عاصم', 'Shubah an Asim', 'shuba'] };
  for (const code of [...riwayat].sort()) {
    if (code === 'hafs_an_asim') continue;
    if (!labels[code]) throw new Error(`UNAPPROVED_RIWAYAH:${code}`);
    const [name_ar, name_en, aligner_code] = labels[code];
    dataset.riwayat.push({ id: stableId('riwayah', code), code, name_ar, name_en, aligner_code, is_active: false });
  }
  const mapped = new Set(records.map((row) => row.slug));
  dataset.unmapped_sources = input.annotations.filter((item) => item.config !== 'mushafs' && !mapped.has(item.config)).map((item) => ({ config: item.config, rows: item.rows, reason: 'HF config absent from pinned QUD Release; catalog import prohibited' }));
  return dataset;
}

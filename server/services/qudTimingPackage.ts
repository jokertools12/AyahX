import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { normalizeTiming, type ReleaseTimingRow, type NormalizedTiming } from './qudTimingNormalization';
import { stableId, type QuranTextCorpus } from './quranTextImport';

interface Tier { _meta: { schema_version: number; slug: string; units: string; tier: string; script_sha256: string; occurrence_count: number }; rows: unknown[][] }
export const TIMING_IMPORTER_VERSION = 'release-d3-no-healing-1';
export const timingHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export interface PreparedTiming extends Omit<NormalizedTiming, 'expected_words'> {
  expected_words: number | null;
  id: string; recitation_id: string; ayah_id: string | null; surah: number; ayah: number;
  source: 'qud'; quality: 'aligned'; qud_version: string; source_sha256: string;
  canonical_checksum: string | null; coordinate: 'source_ms'; source_offset_ms: null;
  repetition_display_mode: 'canonical'; version_hash: string; import_job_id: string;
}

export function readTimingPackage(bytes: Uint8Array, expectedSha: string, slug: string, tiers: string[] = ['verse', 'word', 'letter']): { rows: ReleaseTimingRow[]; scriptSha: string } {
  if (timingHash(bytes) !== expectedSha) throw new Error('TIMING_PACKAGE_PIN_MISMATCH');
  const files = unzipSync(bytes);
  const tier = (name: string): Tier => {
    if (!files[`${name}_timestamps.json.gz`]) throw new Error(`RELEASE_TIER_MISSING:${name}`);
    const data = JSON.parse(gunzipSync(files[`${name}_timestamps.json.gz`]).toString('utf8')) as Tier;
    if (data._meta.schema_version !== 3 || data._meta.slug !== slug || data._meta.units !== 'ms' || data._meta.tier !== name || !Array.isArray(data.rows) || data.rows.length !== data._meta.occurrence_count) throw new Error('RELEASE_TIER_SCHEMA_MISMATCH');
    return data;
  };
  const word = tier('word'), letter = tiers.includes('letter') ? tier('letter') : null, verse = tier('verse');
  if ((letter && (word.rows.length !== letter.rows.length || word._meta.script_sha256 !== letter._meta.script_sha256)) || word.rows.length !== verse.rows.length) throw new Error('RELEASE_TIERS_DISAGREE');
  const rows = word.rows.map((row, i) => {
    const letters = letter?.rows[i];
    if (row.length !== 6 || (letters && (letters.length !== 8 || JSON.stringify(row) !== JSON.stringify(letters.slice(0, 6)) || typeof letters[6] !== 'string')) || JSON.stringify(row.slice(0, 5)) !== JSON.stringify(verse.rows[i]) || !/^\d+:\d+$/u.test(String(row[0]))) throw new Error('RELEASE_OCCURRENCE_IDENTITY_MISMATCH');
    return [...row, letters?.[6] ?? null] as ReleaseTimingRow;
  });
  return { rows, scriptSha: word._meta.script_sha256 };
}

export function prepareTimingRows(input: {
  rows: ReleaseTimingRow[]; slug: string; sourceSha: string; version: string; corpus: QuranTextCorpus;
  canonicalAvailable: boolean; chapters: number[];
}): PreparedTiming[] {
  const recitationId = stableId('recitation', input.slug);
  const jobId = stableId('timing-import', `${input.slug}:${input.sourceSha}:${input.corpus.checksum}:${TIMING_IMPORTER_VERSION}`);
  const grouped = new Map<string, ReleaseTimingRow[]>();
  for (const row of input.rows) {
    const key = row[0]; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key)!.push(row);
  }
  const legal = new Map(input.corpus.ayahs.map((a) => [`${a.surah}:${a.ayah}`, a]));
  const textVersion = stableId('version', `${input.corpus.version}:${input.corpus.checksum}`);
  if (input.canonicalAvailable) for (const ayah of input.corpus.ayahs) {
    if (input.chapters.includes(ayah.surah) && !grouped.has(`${ayah.surah}:${ayah.ayah}`)) grouped.set(`${ayah.surah}:${ayah.ayah}`, []);
  }
  return [...grouped].map(([reference, rows]) => {
    const [surah, ayah] = reference.split(':').map(Number); const canonical = legal.get(reference);
    if (!Number.isSafeInteger(surah) || surah < 1 || !Number.isSafeInteger(ayah) || ayah < 1) throw new Error('RELEASE_REFERENCE_INVALID');
    const normalized = normalizeTiming(rows, input.canonicalAvailable && canonical ? canonical.words : null);
    const payload = { ...normalized, expected_words: input.canonicalAvailable && canonical ? canonical.words.length : null,
      id: stableId('ayah-timing', `${recitationId}:${reference}`), recitation_id: recitationId,
      ayah_id: input.canonicalAvailable && canonical ? stableId('ayah', `${textVersion}:${reference}`) : null, surah, ayah,
      source: 'qud' as const, quality: 'aligned' as const, qud_version: input.version, source_sha256: input.sourceSha,
      canonical_checksum: input.canonicalAvailable ? input.corpus.checksum : null, coordinate: 'source_ms' as const,
      source_offset_ms: null, repetition_display_mode: 'canonical' as const, import_job_id: jobId };
    return { ...payload, version_hash: timingHash(JSON.stringify(payload)) };
  });
}

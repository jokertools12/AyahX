import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { QudReleaseAdapter, buildCatalogDataset } from '../server/services/qudCatalogImport';
import { generateCatalogSql } from '../server/services/qudCatalogSql';

const argv = process.argv.slice(2);
const option = (name: string): string => {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`OPTION_REQUIRED:${name}`);
  return argv[index + 1];
};
if (!argv.includes('--dry-run')) throw new Error('DRY_RUN_REQUIRED; application uses separate guarded command');
const output = resolve(option('--sql-out'));
const datasetOutput = resolve(option('--dataset-out'));
for (const path of [output, datasetOutput]) {
  const location = relative(process.cwd(), path);
  if (!location.startsWith('..') && !isAbsolute(location)) throw new Error('RAW_SQL_AND_DATASET_MUST_BE_OUTSIDE_GIT');
}
const source = JSON.parse(await readFile('docs/data/d2-catalog-source.json', 'utf8'));
const raw = await readFile(option('--catalog'), 'utf8');
const adapter = new QudReleaseAdapter(raw, source.sha256);
const corpus = JSON.parse(await readFile(option('--corpus'), 'utf8'));
const annotations = JSON.parse(await readFile('docs/data/d1-config-audit.json', 'utf8'));
const followup = JSON.parse(await readFile('docs/data/d1-followup-audit.json', 'utf8'));
const offsets = JSON.parse(await readFile(option('--offset-report'), 'utf8'));
const dataset = await buildCatalogDataset(adapter, { version: source.qud_version, catalogSha: source.sha256, sourceUrl: source.url,
  legalCounts: Object.fromEntries(Object.entries(corpus.surahs).map(([key, info]) => [key, (info as { num_verses: number }).num_verses])),
  annotations: annotations.configs, openings: followup.opening_audits, reviews: followup.reviews_by_config, offsets: offsets.results });
const plan = generateCatalogSql(dataset);
await writeFile(output, plan.sql);
await writeFile(datasetOutput, JSON.stringify(dataset) + '\n');
await writeFile(argv.includes('--report-out') ? option('--report-out') : 'docs/data/d2-catalog-import.json', JSON.stringify({ qud_version: dataset.qud_version, catalog_sha256: dataset.catalog_sha256,
  sql_sha256: plan.sha256, sql_bytes: Buffer.byteLength(plan.sql), batch_size: plan.batchSize, counts: plan.counts,
  unmapped_sources: dataset.unmapped_sources, recitations: dataset.recitations.map((row) => ({ slug: row.slug, riwayah: row.riwayah_code, coverage_ayahs: row.coverage_ayahs,
    observed_hf_ayahs: JSON.parse(String(row.audit_json)).annotation.unique_ayahs, basmala_mode: row.basmala_mode,
    surah_start_basmala_text_status: row.surah_start_basmala_text_status, surah_start_basmala_audio_status: row.surah_start_basmala_audio_status,
    offset_verified: row.offset_verified, offset_check_score: row.offset_check_score, verification_status: row.verification_status,
    ayahs_complete: row.ayahs_complete, status: row.status, canonical_text_available: row.canonical_text_available,
    coverage_mismatch_chapters: dataset.chapters.filter((chapter) => chapter.recitation_id === row.id && chapter.coverage_mismatch).map((chapter) => chapter.surah) })) }, null, 2) + '\n');
console.log(JSON.stringify({ dry_run: true, sha256: plan.sha256, counts: plan.counts, unmapped_sources: dataset.unmapped_sources.length }));

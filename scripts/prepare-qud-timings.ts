import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readTimingPackage, prepareTimingRows, timingHash, TIMING_IMPORTER_VERSION } from '../server/services/qudTimingPackage';
import type { QuranTextCorpus } from '../server/services/quranTextImport';

const option = (name: string): string => {
  const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`REQUIRED_OPTION:${name}`); return process.argv[i + 1];
};
const root = resolve(option('--scratch'));
if (root.toLowerCase().startsWith(resolve('.').toLowerCase())) throw new Error('PRIVATE_SCRATCH_OUTSIDE_REPOSITORY_REQUIRED');
await mkdir(root, { recursive: true });
const manifestBytes = await readFile(option('--manifest'));
if (timingHash(manifestBytes) !== option('--manifest-sha')) throw new Error('MANIFEST_PIN_MISMATCH');
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { release_version: string; recitations: Record<string, { sha256: string; zip_url: string; bytes: number; tiers: string[] }> };
const catalog = JSON.parse(await readFile(option('--catalog'), 'utf8')) as { recitations: Array<{ slug: string; riwayah: string; audio: { chapter_urls: Record<string, string> } }> };
const corpus = JSON.parse(await readFile(option('--corpus'), 'utf8')) as QuranTextCorpus;
const slugs = catalog.recitations.map((r) => r.slug).sort();
if (JSON.stringify(slugs) !== JSON.stringify(Object.keys(manifest.recitations).sort()) || manifest.release_version !== 'v3.2.0') throw new Error('RELEASE_CATALOG_SET_MISMATCH');
const results: Array<Record<string, unknown>> = []; let nextRequest = 0;
for (const slug of slugs) {
  const pin = manifest.recitations[slug]; const url = new URL(pin.zip_url);
  if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/QUD-Technologies/quranic-universal-audio/releases/download/v3.2.0/')) throw new Error('RELEASE_DOWNLOAD_NOT_PINNED');
  const packagePath = join(root, `${slug}.zip`);
  let bytes: Buffer;
  const exists = await stat(packagePath).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) bytes = await readFile(packagePath);
  else {
    await new Promise((r) => setTimeout(r, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 2000;
    const response = await fetch(url, { headers: { 'User-Agent': 'AyahX-D3-pinned-data-import/1.0' }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`RELEASE_DOWNLOAD_HTTP_${response.status}:${slug}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== pin.bytes || timingHash(bytes) !== pin.sha256) throw new Error(`RELEASE_DOWNLOAD_PIN_MISMATCH:${slug}`);
    await writeFile(packagePath, bytes);
  }
  if (bytes.length !== pin.bytes) throw new Error('RELEASE_PACKAGE_SIZE_MISMATCH');
  const parsed = readTimingPackage(bytes, pin.sha256, slug, pin.tiers);
  const recitation = catalog.recitations.find((r) => r.slug === slug)!;
  const prepared = prepareTimingRows({ rows: parsed.rows, slug, sourceSha: pin.sha256, version: manifest.release_version, corpus,
    canonicalAvailable: recitation.riwayah === 'hafs_an_asim', chapters: Object.keys(recitation.audio.chapter_urls).map(Number) });
  const lines = prepared.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(join(root, `${slug}.timings.jsonl`), lines);
  const summary = { slug, source_sha256: pin.sha256, script_sha256: parsed.scriptSha, source_occurrences: parsed.rows.length,
    rows: prepared.length, prepared_sha256: timingHash(lines), prepared_bytes: Buffer.byteLength(lines),
    ready: prepared.filter((r) => r.review_status === 'ready').length, needs_review: prepared.filter((r) => r.review_status === 'needs_review').length,
    covered_words: prepared.reduce((n, r) => n + r.coverage_words, 0), expected_words: prepared.reduce((n, r) => n + (r.expected_words ?? 0), 0),
    reason_counts: prepared.reduce<Record<string, number>>((counts, r) => { for (const reason of r.review_reasons) counts[reason] = (counts[reason] ?? 0) + 1; return counts; }, {}) };
  results.push(summary);
  await writeFile(option('--out'), JSON.stringify({ checked_at: new Date().toISOString(), qud_version: manifest.release_version, importer_version: TIMING_IMPORTER_VERSION,
    manifest_sha256: timingHash(manifestBytes), canonical_checksum: corpus.checksum, source: 'qud-release-only', database_writes: false, results }, null, 2) + '\n');
  console.log(JSON.stringify({ prepared: results.length, total: slugs.length, ...summary }));
}

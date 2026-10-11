/** Root invokes this explicitly; baseline overrides repository code with the deployed Git revision. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { d7RunBundle } from './lib/d7RailwayOperator';

const baseline = process.argv.includes('--baseline');
const root = process.cwd();
const ref = baseline ? 'origin/main' : 'HEAD';
const revision = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
const entry = path.resolve(root, 'scripts/d7-legacy-render-proof.ts');
const blobs = new Map<string, string>();
const override: Plugin = { name: 'deployed-legacy-source', setup(context) {
  context.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/u }, async args => {
    const relative = path.relative(root, args.path).split(path.sep).join('/');
    if (args.path === entry || !/^(?:server|shared|src)\//u.test(relative) || relative.includes('/node_modules/')) return undefined;
    let contents = blobs.get(relative);
    if (contents === undefined) {
      // An absent baseline dependency is an error: never mix new code into the old proof.
      contents = execFileSync('git', ['show', `${revision}:${relative}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      blobs.set(relative, contents);
    }
    const extension = path.extname(args.path).slice(1);
    const loader = extension === 'json' ? 'json' : extension.endsWith('x') ? (extension.startsWith('t') ? 'tsx' : 'jsx') : extension.startsWith('t') ? 'ts' : 'js';
    return { contents, loader, resolveDir: path.dirname(args.path) };
  });
} };
const built = await build({ entryPoints: [entry], bundle: true, write: false, packages: 'external', platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent', plugins: baseline ? [override] : [] });
const bundle = Buffer.from(built.outputFiles[0].contents);
if (process.argv.includes('--compile-only')) {
  console.log(JSON.stringify({ compiled: true, baseline, revision, overridden_files: blobs.size, bundle_bytes: bundle.length }));
} else {
  const raw = await d7RunBundle('skia', bundle, ['--root-operated']);
  const line = raw.split(/\r?\n/u).findLast(value => value.startsWith('{'));
  assert.ok(line, 'LEGACY_PROOF_JSON_REQUIRED');
  const proof = JSON.parse(line);
  const png = Buffer.from(proof.png_base64, 'base64');
  delete proof.png_base64;
  assert.equal(proof.passed, true); assert.equal(proof.platform, 'linux'); assert.equal(proof.sql_writes, 0);
  const output = { ...proof, source_revision: revision, baseline, source_overrides: blobs.size, operator_bundle_sha256: createHash('sha256').update(bundle).digest('hex') };
  await mkdir('docs/data/render-qa', { recursive: true });
  const phase = baseline ? 'before' : 'after';
  await writeFile(`docs/data/render-qa/railway-v1-${phase}.png`, png);
  await writeFile(`docs/data/d7-railway-v1-${phase}.json`, JSON.stringify(output, null, 2) + '\n');
  if (!baseline) {
    const before = JSON.parse(await readFile('docs/data/d7-railway-v1-before.json', 'utf8'));
    assert.equal(output.manifest_sha256, before.manifest_sha256, 'LEGACY_MANIFEST_CHANGED');
    assert.equal(output.audio_pcm_sha256, before.audio_pcm_sha256, 'LEGACY_SOURCE_AUDIO_CHANGED');
    assert.deepEqual(output.frame_hashes, before.frame_hashes, 'LEGACY_DECODED_PIXELS_CHANGED');
    assert.equal(output.frame_count, before.frame_count, 'LEGACY_FRAME_COUNT_CHANGED');
    assert.equal(output.duration_seconds, before.duration_seconds, 'LEGACY_DURATION_CHANGED');
    await writeFile('docs/data/d7-railway-v1-comparison.json', JSON.stringify({ passed: true, before_revision: before.source_revision, after_revision: revision, identical_manifest: true, identical_source_pcm: true, identical_decoded_frame_hashes: true, identical_frame_count: true, identical_duration: true, checked_at: new Date().toISOString() }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: true, phase, revision, frame_count: output.frame_count, sync: output.sync }));
}

import { test, expect } from 'e2e';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const enabled = process.env.AYAHX_ADMIN_DISPLAY_REGRESSIONS === 'local-restored-only';

// Run from tooling/e2e after the root-operated restored server is ready:
// AYAHX_ADMIN_DISPLAY_REGRESSIONS=local-restored-only
// AYAHX_ADMIN_DISPLAY_MANIFEST=<absolute private prepared manifest>
// AYAHX_ADMIN_DISPLAY_OUTPUT=<absolute existing private directory>
// npx e2e run --config admin-display.e2e.config.ts
// The normal public config discovers this test but cannot select its platform.
test('S1: wrapped launch action, language AX names and readable admin toasts', {
  skip: enabled ? false : 'Explicit local restored display regression opt-in required',
  platforms: ['admin-display-native'],
  tags: ['admin', 'local-display-regression'],
  retries: 0,
  timeout: 120_000,
}, async () => {
  const manifestFile = await privateExistingPath(process.env.AYAHX_ADMIN_DISPLAY_MANIFEST);
  const outputParent = await privateExistingPath(process.env.AYAHX_ADMIN_DISPLAY_OUTPUT);
  const manifest = object(await privateJson(manifestFile));
  if (manifest.version !== 1 || manifest.fixtureTag !== 'BATCH5_HUMAN_QA'
      || manifest.mode !== 'local-mutations' || manifest.prepared !== true
      || manifest.cleaned !== false || typeof manifest.schema !== 'string'
      || !/^ayahx_d2_batch5_[a-z0-9_]*(?:restored|verified|rehearsal|local)[a-z0-9_]*$/u.test(manifest.schema)) {
    throw new Error('PREPARED_RESTORED_BATCH5_MANIFEST_REQUIRED');
  }
  const attestation = object(manifest.tagAttestation);
  if (attestation.localTargetsAreDisposable !== true || attestation.productionTargetsReadOnly !== false) {
    throw new Error('OWNED_DISPOSABLE_LOCAL_FIXTURES_REQUIRED');
  }
  if (typeof manifest.baseUrl !== 'string') throw new Error('LOCAL_ORIGIN_REQUIRED');
  let base: URL;
  try { base = new URL(manifest.baseUrl); }
  catch { throw new Error('LOCAL_ORIGIN_REQUIRED'); }
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)
      || base.origin !== manifest.baseUrl || base.username || base.password) {
    throw new Error('LOCAL_ORIGIN_REQUIRED');
  }
  await privateExistingPath(typeof manifest.authFile === 'string' ? manifest.authFile : undefined);
  const output = await mkdtemp(join(outputParent, 'admin-display-'));
  const started = Date.now();
  const exitCode = await nativeProof(manifestFile, output);
  const report = object(await privateJson(join(output, 'report.json')));

  expect(exitCode, 'Native Chromium regression process must complete successfully').toBe(0);
  expect(report.scope).toBe('three-local-display-regressions');
  expect(report.production).toBe(false);
  expect(report.applicationWrites).toBe(0);
  expect(report.blockedWrites).toEqual([]);
  expect(report.failure).toBeUndefined();
  expect(report.passed).toBe(true);
  const reportStart = Date.parse(String(report.startedAt));
  const reportEnd = Date.parse(String(report.finishedAt));
  expect(reportStart, 'Proof must originate from this fresh invocation').toBeGreaterThanOrEqual(started);
  expect(reportEnd).toBeGreaterThanOrEqual(reportStart);
  expect(reportEnd).toBeLessThanOrEqual(Date.now());
  if (!Array.isArray(report.cases)) throw new Error('DISPLAY_CASES_REQUIRED');
  const cases = report.cases.map(object);
  expect(cases.map(row => [row.name, row.lang ?? row.theme ?? ''].join(':')).sort()).toEqual([
    'admin-toast:dark', 'admin-toast:light', 'language-name-prefix:ar',
    'language-name-prefix:en', 'wrapped-launch-action:',
  ]);
  for (const row of cases) expect(row.passed).toBe(true);

  const wrapped = cases.find(row => row.name === 'wrapped-launch-action')!;
  expect(number(wrapped.dpr), '390px case must use actual native 150% zoom').toBeCloseTo(1.5, 1);
  expect(number(wrapped.height)).toBeGreaterThanOrEqual(44);
  if (!Array.isArray(wrapped.textRects)) throw new Error('WRAPPED_TEXT_RANGE_PROOF_REQUIRED');
  expect(wrapped.textRects.length, 'The action must actually wrap').toBeGreaterThan(1);
  for (const rect of wrapped.textRects.map(object)) {
    expect(number(rect.height)).toBeGreaterThan(0);
    expect(number(rect.top)).toBeGreaterThanOrEqual(number(wrapped.top) - 0.1);
    expect(number(rect.bottom)).toBeLessThanOrEqual(number(wrapped.bottom) + 0.1);
  }
  for (const row of cases.filter(row => row.name === 'language-name-prefix')) {
    expect(row.source).toBe('Chromium Accessibility.getPartialAXTree');
    expect(row.visible).toBe(row.lang === 'ar' ? 'EN' : 'ع');
    if (typeof row.accessibleName !== 'string') throw new Error('ACTUAL_AX_NAME_REQUIRED');
    expect(normalize(row.accessibleName).startsWith(normalize(String(row.visible))),
      'Real accessibility-tree name must begin with the rendered language label').toBe(true);
  }
  for (const row of cases.filter(row => row.name === 'admin-toast')) {
    expect(number(row.font)).toBeGreaterThanOrEqual(15);
    expect(number(row.lineRatio)).toBeGreaterThanOrEqual(1.7);
    expect(row.filter).toBe('none');
    expect(row.backdropFilter).toBe('none');
    expect(number(row.contrast)).toBeGreaterThanOrEqual(4.5);
    expect(Number(row.opacity)).toBe(1);
  }
});

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DISPLAY_PROOF_OBJECT_REQUIRED');
  return value as Row;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('FINITE_DISPLAY_MEASUREMENT_REQUIRED');
  return value;
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

async function privateJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('PRIVATE_DISPLAY_JSON_UNAVAILABLE'); }
}

async function privateExistingPath(value: string | undefined): Promise<string> {
  if (!value || !isAbsolute(value)) throw new Error('ABSOLUTE_PRIVATE_DISPLAY_PATH_REQUIRED');
  let path: string;
  try { path = await realpath(value); }
  catch { throw new Error('PRIVATE_DISPLAY_PATH_UNAVAILABLE'); }
  const location = relative(await realpath(repository), path);
  if (!location.startsWith('..') && !isAbsolute(location)) throw new Error('DISPLAY_PATH_OUTSIDE_GIT_REQUIRED');
  // Resolve symlinks and reject an ancestor .git in any checkout, not just this worktree.
  for (let parent = (await stat(path)).isDirectory() ? path : dirname(path); ; parent = dirname(parent)) {
    let gitExists = false;
    try { await access(join(parent, '.git')); gitExists = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('PRIVATE_PATH_BOUNDARY_UNVERIFIED');
    }
    if (gitExists) throw new Error('DISPLAY_PATH_OUTSIDE_GIT_REQUIRED');
    if (parent === dirname(parent)) break;
  }
  return path;
}

async function nativeProof(manifest: string, output: string): Promise<number> {
  const script = resolve(repository, 'scripts/test-admin-display-regressions.mjs');
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [script, '--manifest', manifest, '--output', output], {
      cwd: repository, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' },
    });
    // Never forward browser errors, private paths, auth data or raw child output.
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('NATIVE_DISPLAY_PROOF_TIMEOUT')); }, 90_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('NATIVE_DISPLAY_PROOF_PROCESS_UNAVAILABLE')); });
    child.once('exit', code => { clearTimeout(timer); resolveCode(code ?? -1); });
  });
}

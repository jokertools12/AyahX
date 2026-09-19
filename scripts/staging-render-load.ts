/**
 * Destructive-in-staging-only render admission and completion probe.
 *
 * It creates a disposable account pool, upgrades only those staging accounts
 * to a test yearly subscription, submits one job per account across the three
 * isolated engines, waits for the durable jobs to become terminal, and probes
 * a downloaded MP4 from every engine. It can never run against production.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mysql from 'mysql2/promise';
import { probeMediaFile } from '../server/services/mediaProbeService';

type Engine = 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud';
type Account = { id: string; token: string };
type SubmittedJob = Account & { engine: Engine; id: string };

const CONFIRMATION = 'CREATE_STAGING_RENDER_LOAD_ACCOUNTS';
const STAGING_HOST_MARKER = /(^|[.-])staging([.-]|$)/i;
const ENGINES: Engine[] = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'];

function envPositiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function percentile(samples: number[], percentileValue: number): number {
  if (!samples.length) return 0;
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentileValue) - 1)];
}

async function runPool<T>(items: readonly T[], concurrency: number, action: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await action(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function jsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 500) }; }
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal });
}

function loadManifest(engine: Engine, revision: string): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    rendererVersion: '1.0.0',
    revision,
    renderEngine: engine,
    backgroundAsync: false,
    aspectRatio: '9:16',
    outputDimensions: { width: 720, height: 1280 },
    fps: 30,
    qualityPreset: 'medium',
    audioBitrate: '192k',
    codecProfile: 'high-4.1',
    reciter: { id: 'staging-load', name: 'Staging Load Test', everyAyahSubfolder: 'Alafasy_128kbps' },
    canonicalAyahRange: {
      surahNumber: 1,
      surahName: 'الفاتحة',
      startAyah: 1,
      endAyah: 1,
      ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
    },
    timingMap: {
      mapId: `staging-load-${revision}`,
      audioContentHash: 'staging-load-audio-content-hash',
      validationStatus: 'approved',
      words: [{ canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 600, confidence: 1 }],
    },
    audio: {
      sourceMode: 'everyayah',
      audioUrl: 'https://everyayah.com/data/Alafasy_128kbps/001001.mp3',
      audioContentHash: 'staging-load-audio-content-hash',
      durationSeconds: 1,
    },
    background: { id: 'staging-load-color', type: 'color', url: '#07131c', overlayOpacity: 0.45, shadowIntensity: 0.5, motionSpeed: 1 },
    typography: { fontFamily: '"Amiri", serif', fontSize: 32, textColor: '#FFFFFF', shadowIntensity: 0.5, overlayOpacity: 0.45 },
    displaySettings: {
      showSurahName: true, showReciterName: true, showAyahText: true, showAyahNumber: true,
      highlightStyle: 'glow', frameStyle: 'ornate', screenBorderStyle: 'goldenTrim', screenBorderColor: 'gold',
      ayahNumberStyle: 'quran3d', ayahNumberColor: 'gold', verseDisplayMode: 'wordByWord',
      surahNamePosition: 'top', surahNameStyle: 'classic', reciterNameStyle: 'simple', textShadowStyle: 'soft',
      ayahTransition: 'fade', watermarkEnabled: false, glowStyle: 'golden', slideshowTransition: 'crossfade',
    },
    outputFormat: 'mp4',
  };
}

async function upgradeStagingAccounts(accounts: Account[]): Promise<void> {
  const connection = await mysql.createConnection({
    host: required('STAGING_LOAD_DB_HOST'),
    port: envPositiveInteger('STAGING_LOAD_DB_PORT', 3306, 65535),
    user: process.env.STAGING_LOAD_DB_USER || 'root',
    password: required('STAGING_LOAD_DB_PASSWORD'),
    database: required('STAGING_LOAD_DB_NAME'),
  });
  try {
    const chunks = Array.from({ length: Math.ceil(accounts.length / 200) }, (_, index) => accounts.slice(index * 200, index * 200 + 200));
    for (const chunk of chunks) {
      const marks = chunk.map(() => '?').join(',');
      await connection.execute(`UPDATE subscriptions SET plan = 'yearly', status = 'active' WHERE user_id IN (${marks})`, chunk.map((account) => account.id));
    }
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  const baseUrl = required('STAGING_LOAD_BASE_URL').replace(/\/$/, '');
  const hostname = new URL(baseUrl).hostname;
  if (process.env.STAGING_LOAD_CONFIRM !== CONFIRMATION || !STAGING_HOST_MARKER.test(hostname)) {
    throw new Error(`Refusing to create load accounts. Set STAGING_LOAD_CONFIRM=${CONFIRMATION} and use a hostname explicitly marked staging.`);
  }
  const count = envPositiveInteger('STAGING_LOAD_COUNT', 100, 1_000);
  const registrationConcurrency = envPositiveInteger('STAGING_LOAD_REGISTRATION_CONCURRENCY', 40, 200);
  const submissionConcurrency = envPositiveInteger('STAGING_LOAD_SUBMISSION_CONCURRENCY', count, 1_000);
  const pollingConcurrency = envPositiveInteger('STAGING_LOAD_POLL_CONCURRENCY', 80, 300);
  const deadlineSeconds = envPositiveInteger('STAGING_LOAD_DEADLINE_SECONDS', 300, 1_800);
  const fetchTimeoutMs = envPositiveInteger('STAGING_LOAD_FETCH_TIMEOUT_MS', 30_000, 120_000);
  const selectedEngines = (process.env.STAGING_LOAD_ENGINES || ENGINES.join(','))
    .split(',').map((value) => value.trim()).filter((value): value is Engine => (ENGINES as string[]).includes(value));
  if (!selectedEngines.length) throw new Error('STAGING_LOAD_ENGINES must include at least one supported engine');

  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const accounts: Account[] = [];
  const registrationErrors: Array<{ status: number; error: unknown }> = [];
  const registrationStarted = performance.now();
  await runPool(Array.from({ length: count }), registrationConcurrency, async (_value, index) => {
    const email = `render-load-${runId}-${index}@staging.ayahx.invalid`;
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: `Load-${runId}-${index}-A9!`, displayName: `Load ${index}` }),
      }, fetchTimeoutMs);
      const body = await jsonResponse(response);
      if (response.status !== 201 || !body?.token || !body?.user?.id) {
        registrationErrors.push({ status: response.status, error: body?.error || body?.raw || 'invalid registration response' });
        return;
      }
      accounts.push({ id: body.user.id, token: body.token });
    } catch (error) {
      registrationErrors.push({ status: 0, error: error instanceof Error ? error.message : String(error) });
    }
  });
  if (registrationErrors.length || accounts.length !== count) {
    throw new Error(`Account pool creation failed: created=${accounts.length}/${count}, firstError=${JSON.stringify(registrationErrors[0] || null)}`);
  }
  console.log(JSON.stringify({ phase: 'registered', runId, count: accounts.length }));
  await upgradeStagingAccounts(accounts);

  const jobs: SubmittedJob[] = [];
  const submissionErrors: Array<{ engine: Engine; status: number; error: unknown }> = [];
  const admissions: number[] = [];
  const perEngineAdmissions: Record<Engine, number> = { ffmpeg_ass: 0, skia_canvas: 0, browser_cloud: 0 };
  const submitStarted = performance.now();
  await runPool(accounts, submissionConcurrency, async (account, index) => {
    const engine = selectedEngines[index % selectedEngines.length];
    const started = performance.now();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/render-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ manifest: loadManifest(engine, `${runId}-${index}`), renderEngine: engine, idempotencyKey: `staging-load-${runId}-${index}` }),
      }, fetchTimeoutMs);
      admissions.push(performance.now() - started);
      const body = await jsonResponse(response);
      if (response.status !== 202 || !body?.job?.id) {
        submissionErrors.push({ engine, status: response.status, error: body?.error || body?.raw || 'invalid render response' });
        return;
      }
      perEngineAdmissions[engine]++;
      jobs.push({ ...account, engine, id: body.job.id });
    } catch (error) {
      admissions.push(performance.now() - started);
      submissionErrors.push({ engine, status: 0, error: error instanceof Error ? error.message : String(error) });
    }
  });
  if (submissionErrors.length || jobs.length !== count) {
    throw new Error(`Render admission failed: accepted=${jobs.length}/${count}, firstError=${JSON.stringify(submissionErrors[0] || null)}`);
  }
  console.log(JSON.stringify({ phase: 'admitted', runId, count: jobs.length }));
  const holdAfterAdmissionMs = Number.parseInt(process.env.STAGING_LOAD_HOLD_AFTER_ADMISSION_MS || '0', 10);
  if (Number.isFinite(holdAfterAdmissionMs) && holdAfterAdmissionMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(holdAfterAdmissionMs, 300_000)));
  }

  const terminal = new Map<string, { status: string; downloadUrl?: string }>();
  const deadline = Date.now() + deadlineSeconds * 1000;
  while (terminal.size < jobs.length && Date.now() < deadline) {
    const pending = jobs.filter((job) => !terminal.has(job.id));
    await runPool(pending, pollingConcurrency, async (job) => {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/api/render-jobs/${job.id}`, { headers: { authorization: `Bearer ${job.token}` } }, fetchTimeoutMs);
        const body = await jsonResponse(response);
        const status = body?.job?.status;
        if (response.ok && ['succeeded', 'failed', 'cancelled'].includes(status)) terminal.set(job.id, { status, downloadUrl: body?.job?.downloadUrl });
      } catch {
        // A temporary poll timeout must not turn a durable render into a
        // client-side failure. The next pass will retry the same job ID.
      }
    });
    if (terminal.size < jobs.length) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (terminal.size !== jobs.length) throw new Error(`Timed out waiting for durable jobs: terminal=${terminal.size}/${jobs.length}`);

  const resultByEngine: Record<Engine, { submitted: number; succeeded: number; failed: number; cancelled: number; sampleProbe?: unknown }> = {
    ffmpeg_ass: { submitted: 0, succeeded: 0, failed: 0, cancelled: 0 },
    skia_canvas: { submitted: 0, succeeded: 0, failed: 0, cancelled: 0 },
    browser_cloud: { submitted: 0, succeeded: 0, failed: 0, cancelled: 0 },
  };
  for (const job of jobs) {
    const result = resultByEngine[job.engine];
    result.submitted++;
    const status = terminal.get(job.id)?.status;
    if (status === 'succeeded') result.succeeded++;
    else if (status === 'cancelled') result.cancelled++;
    else result.failed++;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ayahx-staging-load-'));
  try {
    for (const engine of selectedEngines) {
      const sample = jobs.find((job) => job.engine === engine && terminal.get(job.id)?.status === 'succeeded');
      if (!sample) throw new Error(`${engine} has no successful job to download and inspect`);
      const download = await fetchWithTimeout(`${baseUrl}/api/render-jobs/${sample.id}/download`, { headers: { authorization: `Bearer ${sample.token}` } }, fetchTimeoutMs);
      if (!download.ok) throw new Error(`${engine} artifact download returned HTTP ${download.status}`);
      const filePath = path.join(tempDir, `${engine}.mp4`);
      fs.writeFileSync(filePath, Buffer.from(await download.arrayBuffer()));
      const probe = await probeMediaFile(filePath);
      if (probe.container !== 'mov,mp4,m4a,3gp,3g2,mj2' || probe.video?.codec !== 'h264' || probe.video.pixelFormat !== 'yuv420p' || probe.audio?.codec !== 'aac') {
        throw new Error(`${engine} artifact failed media validation`);
      }
      resultByEngine[engine].sampleProbe = {
        durationSeconds: probe.durationSeconds, sizeBytes: probe.sizeBytes,
        video: { codec: probe.video.codec, pixelFormat: probe.video.pixelFormat, width: probe.video.width, height: probe.video.height },
        audio: { codec: probe.audio.codec, channels: probe.audio.channels },
      };
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const result = {
    runId, count, selectedEngines,
    registrationSeconds: Number(((performance.now() - registrationStarted) / 1000).toFixed(3)),
    admissionEnvelopeSeconds: Number(((performance.now() - submitStarted) / 1000).toFixed(3)),
    admissionP95Ms: Number(percentile(admissions, 0.95).toFixed(1)),
    admissionP99Ms: Number(percentile(admissions, 0.99).toFixed(1)),
    perEngineAdmissions, resultByEngine,
  };
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(resultByEngine).some((engine) => engine.failed || engine.cancelled)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

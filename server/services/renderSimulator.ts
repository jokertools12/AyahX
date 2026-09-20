import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { RenderManifest } from '../models/renderManifest';
import { estimateRenderJobProfile, RenderWorkerEngine } from './renderCapacity';
import { getFfmpegBinary, getFfmpegResourceArgs } from './ffmpegBinary';
import { probeMediaFile, validateProbeAgainstSpec, MediaProbeResult } from './mediaProbeService';
import type { DeterministicRenderOptions, DeterministicRenderResult } from './deterministicVideoRenderer';
import { logger } from '../logger';

/**
 * A staging-only load backend. It exercises admission, child isolation,
 * progress, upload, ffprobe and durable state without running a real scene
 * renderer. Keep it behind an explicit flag; production never enables it.
 */
export function renderSimulationEnabled(): boolean {
  return process.env.RENDER_SIMULATE === '1';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function simulationEngine(manifest: RenderManifest): RenderWorkerEngine {
  const value = (manifest as any).renderEngine || manifest.displaySettings?.renderEngine;
  return value === 'skia_canvas' ? 'skia_canvas' : value === 'browser' || value === 'browser_cloud' ? 'browser_cloud' : 'ffmpeg_ass';
}

async function runFixtureFfmpeg(options: DeterministicRenderOptions, durationSeconds: number): Promise<void> {
  const manifest = options.manifest as any;
  const width = Math.max(360, Number(manifest.outputDimensions?.width || 720));
  const height = Math.max(360, Number(manifest.outputDimensions?.height || 1280));
  const fps = Math.max(1, Math.min(60, Number(manifest.fps || 30)));
  const color = String(manifest.background?.url || '#07131c').match(/^#[0-9a-f]{6}$/i)?.[0] || '#07131c';
  const args = [
    ...getFfmpegResourceArgs(), '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:r=${fps}:d=${durationSeconds}`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
    '-t', String(durationSeconds), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads:v', '1',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest',
    '-movflags', '+faststart', options.outputPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegBinary(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const abort = () => child.kill('SIGTERM');
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.once('error', (error) => reject(error));
    child.once('close', (code, signal) => {
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) return reject(new Error('Render simulation aborted'));
      if (code === 0) return resolve();
      reject(new Error(`Render simulation fixture failed [${signal || code}]: ${stderr}`));
    });
  });
}

export async function simulateRender(options: DeterministicRenderOptions): Promise<DeterministicRenderResult> {
  const manifest = options.manifest;
  const engine = simulationEngine(manifest);
  const profile = estimateRenderJobProfile(engine, {
    width: manifest.outputDimensions.width,
    height: manifest.outputDimensions.height,
    fps: manifest.fps,
    durationSeconds: manifest.audio.durationSeconds,
    backgroundType: manifest.background.type,
  });
  const durationSeconds = Math.max(0.3, Number(manifest.audio.durationSeconds || 1));
  const configuredDelayMs = process.env.RENDER_SIMULATE_MS || process.env.RENDER_SIMULATE_DELAY_MS;
  const parsedDelayMs = Number(configuredDelayMs);
  const simulatedMs = Math.max(0, Math.min(60_000, Number.isFinite(parsedDelayMs)
    ? parsedDelayMs
    : Math.round((Number(profile.estimatedSeconds) || durationSeconds) * 10)));
  const defaultMemoryMb = Number(profile.memoryPerJobMb);
  const parsedMemoryMb = Number(process.env.RENDER_SIMULATE_MEMORY_MB);
  const memoryMb = Math.max(0, Math.min(4096, Number.isFinite(parsedMemoryMb)
    ? parsedMemoryMb
    : (Number.isFinite(defaultMemoryMb) ? Math.min(64, defaultMemoryMb) : 64)));
  const memory = memoryMb > 0 ? Buffer.alloc(memoryMb * 1024 * 1024, 0) : null;
  logger.warn(`Render simulator enabled for staging: engine=${engine}, delayMs=${simulatedMs}, memoryMb=${memoryMb}`);
  const started = Date.now();
  const progressTimer = setInterval(() => {
    const progress = Math.min(95, Math.round(((Date.now() - started) / Math.max(1, simulatedMs)) * 95));
    void options.onProgress?.(progress, progress, 100, 'محاكاة سعة الإنتاج');
  }, 500);
  progressTimer.unref?.();
  try {
    const configuredCpuMs = process.env.RENDER_SIMULATE_CPU_MS
      || (process.env.RENDER_SIMULATE_CPU_SECONDS ? String(Number(process.env.RENDER_SIMULATE_CPU_SECONDS) * 1000) : undefined);
    const parsedCpuMs = Number(configuredCpuMs);
    const cpuMs = Math.max(0, Math.min(5_000, Number.isFinite(parsedCpuMs) ? parsedCpuMs : Math.min(250, simulatedMs / 4)));
    const cpuStarted = Date.now();
    while (Date.now() - cpuStarted < cpuMs) {
      Math.sqrt(Math.random() * 1_000_000);
    }
    await delay(Math.max(0, simulatedMs - cpuMs));
    if (options.signal?.aborted) throw new Error('Render simulation aborted');
    await fs.promises.mkdir(path.dirname(options.outputPath), { recursive: true });
    await runFixtureFfmpeg(options, durationSeconds);
    const probe: MediaProbeResult = await probeMediaFile(options.outputPath);
    const validation = validateProbeAgainstSpec(probe, manifest.fps, durationSeconds);
    if (!validation.valid) throw new Error(`Render simulation output invalid: ${validation.errors.join('; ')}`);
    await options.onProgress?.(100, 100, 100, 'اكتملت محاكاة الإنتاج');
    return {
      outputPath: options.outputPath,
      fileSizeBytes: fs.statSync(options.outputPath).size,
      durationSeconds: probe.durationSeconds,
      totalFrames: Math.ceil(probe.durationSeconds * manifest.fps),
      probe,
    };
  } finally {
    clearInterval(progressTimer);
    // Keep the allocation live for the duration of the simulated job.
    void memory;
  }
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { RenderManifest } from '../models/renderManifest';
import { DeterministicFrameRenderer } from '../renderer/frameRenderer';
import {
  prepareAudioTrack,
  prepareBackgroundAsset,
  DeterministicRenderOptions,
  DeterministicRenderResult,
} from './deterministicVideoRenderer';
import { getFfmpegBinary, getFfmpegPreset, getFfmpegResourceArgs, getFfmpegVideoEncoderArgs } from './ffmpegBinary';
import { probeMediaFile, validateProbeAgainstSpec } from './mediaProbeService';
import { logger } from '../logger';

/**
 * Idea 3: full-fidelity cloud browser renderer.
 *
 * The browser preview and this renderer share public/render-harness.html. The
 * harness produces the exact scene (background motion, Arabic typography,
 * word timing, borders, badges, headers and watermarks); FFmpeg is only the
 * final MP4 muxer. Idea 3 has its own dispatch and quota; the shared frame
 * contract is also used by the other independent encoders so every selection
 * remains visually identical to the preview.
 */

function cloneManifest(manifest: RenderManifest): RenderManifest {
  return JSON.parse(JSON.stringify(manifest)) as RenderManifest;
}

function writeFrame(stream: NodeJS.WritableStream, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.removeListener('error', onError);
      stream.removeListener('drain', onDrain);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error) => finish(error);
    const onDrain = () => finish();

    stream.once('error', onError);
    try {
      const accepted = (stream as any).write(frame);
      if (accepted) finish();
      else stream.once('drain', onDrain);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function killProcess(process: ChildProcessWithoutNullStreams | null): void {
  if (!process || process.killed) return;
  try {
    process.kill('SIGKILL');
  } catch {
    // The process may have exited between the state check and the kill.
  }
}

async function removeDirectory(directory: string): Promise<void> {
  await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

export async function renderBrowserCloudVideo(
  options: DeterministicRenderOptions,
): Promise<DeterministicRenderResult> {
  return renderFullFidelityVideo(options, { label: 'Engine 3 Browser Cloud', preset: 'fast' });
}

export async function renderFullFidelityVideo(
  options: DeterministicRenderOptions,
  config: { label: string; preset: string },
): Promise<DeterministicRenderResult> {
  const sourceManifest = options.manifest;
  const manifest = cloneManifest(sourceManifest);
  const { outputPath, signal, onProgress } = options;
  const ffmpegPath = getFfmpegBinary();
  if (!ffmpegPath || (path.isAbsolute(ffmpegPath) && !fs.existsSync(ffmpegPath))) {
    throw new Error('Native FFmpeg executable is missing on server.');
  }

  const randomId = crypto.randomBytes(8).toString('hex');
  const scratchDir = path.join(os.tmpdir(), `render_full_fidelity_${randomId}`);
  await fs.promises.mkdir(scratchDir, { recursive: true });

  let renderer: DeterministicFrameRenderer | null = null;
  let ffmpegProc: ChildProcessWithoutNullStreams | null = null;
  let ffmpegExit: Promise<void> | null = null;
  let abortHandler: (() => void) | null = null;

  try {
    onProgress?.(3, 0, 0, `تجهيز الصوت والخلفية لـ${config.label}...`);
    const audioTrackPath = options.audioFilePath || await prepareAudioTrack(manifest, scratchDir);
    await prepareBackgroundAsset(manifest, scratchDir);

    if (signal?.aborted) throw new Error('Render cancelled by user.');

    const { width, height } = manifest.outputDimensions;
    const fps = manifest.fps || 30;
    const totalFrames = Math.max(1, Math.ceil(manifest.audio.durationSeconds * fps));
    const audioBitrate = manifest.audioBitrate || '192k';

    renderer = new DeterministicFrameRenderer(manifest);
    await renderer.init();

    const ffmpegArgs = [
      '-y',
      ...getFfmpegResourceArgs(),
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(fps),
      '-i', '-',
      '-i', audioTrackPath,
      '-c:v', 'libx264',
      ...getFfmpegVideoEncoderArgs(),
      '-preset', getFfmpegPreset(config.preset),
      '-crf', manifest.qualityPreset === 'ultra' ? '15' : manifest.qualityPreset === 'medium' ? '20' : '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ];

    logger.info(`Starting ${config.label} render [${randomId}]: ${width}x${height} @ ${fps}fps (${totalFrames} frames)`);
    ffmpegProc = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });
    let stderr = '';
    let inputError: Error | null = null;
    ffmpegProc.stdin.on('error', (error) => {
      inputError = error;
    });
    ffmpegProc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpegExit = new Promise<void>((resolve, reject) => {
      ffmpegProc!.once('error', (error) => reject(new Error(`Failed to spawn ${config.label} FFmpeg: ${error.message}`)));
      ffmpegProc!.once('close', (code, exitSignal) => {
        if (code === 0) resolve();
        else {
          const termination = code === null ? `signal ${exitSignal || 'unknown'}` : `code ${code}`;
          reject(new Error(`${config.label} FFmpeg failed [${termination}]: ${stderr.slice(-1600)}`));
        }
      });
    });

    abortHandler = () => killProcess(ffmpegProc);
    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    }

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (signal?.aborted) throw new Error('Render cancelled by user.');
      if (inputError) throw new Error(`${config.label} FFmpeg input closed: ${inputError.message}`);

      const frame = await renderer.renderFrameBuffer(frameIndex, frameIndex / fps);
      await writeFrame(ffmpegProc.stdin, frame);
      const progress = Math.min(94, Math.round(8 + ((frameIndex + 1) / totalFrames) * 84));
      onProgress?.(progress, frameIndex + 1, totalFrames, `تكوين الإطارات طبقاً لمعاينة المتصفح (${config.label})...`);
    }

    ffmpegProc.stdin.end();
    await ffmpegExit;

    if (signal?.aborted) throw new Error('Render cancelled by user.');

    onProgress?.(98, totalFrames, totalFrames, `التحقق من سلامة فيديو ${config.label} النهائي...`);
    const probe = await probeMediaFile(outputPath);
    const validation = validateProbeAgainstSpec(probe, fps);
    if (!validation.valid) {
      throw new Error(`${config.label} video failed probe validation: ${validation.errors.join(', ')}`);
    }

    const stat = await fs.promises.stat(outputPath);
    logger.info(`✅ ${config.label} render [${randomId}] completed successfully: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    return {
      outputPath,
      fileSizeBytes: stat.size,
      durationSeconds: probe.durationSeconds,
      totalFrames,
      probe,
    };
  } catch (error) {
    killProcess(ffmpegProc);
    if (ffmpegExit) await ffmpegExit.catch(() => undefined);
    if (signal?.aborted || /cancel|abort|إلغاء/i.test(String((error as Error)?.message || error))) {
      await fs.promises.unlink(outputPath).catch(() => undefined);
    }
    throw error;
  } finally {
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
    await renderer?.close();
    await removeDirectory(scratchDir);
  }
}

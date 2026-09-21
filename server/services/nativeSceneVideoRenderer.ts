import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { NativeSceneRenderer } from '../renderer/nativeSceneRenderer';
import { RenderManifest } from '../models/renderManifest';
import {
  DeterministicRenderOptions,
  DeterministicRenderResult,
  prepareAudioTrack,
  prepareBackgroundAsset,
} from './deterministicVideoRenderer';
import { getFfmpegBinary, getFfmpegPreset, getFfmpegResourceArgs, getFfmpegVideoEncoderArgs } from './ffmpegBinary';
import { logger } from '../logger';
import { probeMediaFile, validateProbeAgainstSpec } from './mediaProbeService';

export interface NativeSceneVideoConfig {
  label: string;
  scratchPrefix: string;
  preset: string;
  qualityCrf: string;
}

function cloneManifest(manifest: RenderManifest): RenderManifest {
  return JSON.parse(JSON.stringify(manifest)) as RenderManifest;
}

function killProcess(process: ChildProcessWithoutNullStreams | null): void {
  if (!process || process.killed) return;
  try {
    process.kill('SIGKILL');
  } catch {
    // The process may have exited between checking and sending the signal.
  }
}

function writeFrame(stream: NodeJS.WritableStream, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      stream.removeListener('error', onError);
      stream.removeListener('drain', onDrain);
      stream.removeListener('close', onClose);
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
    const onClose = () => finish(new Error('FFmpeg input pipe closed before all frames were written.'));

    stream.once('error', onError);
    stream.once('close', onClose);
    try {
      const accepted = (stream as NodeJS.WritableStream & { write(chunk: Buffer): boolean }).write(frame);
      if (accepted) finish();
      else stream.once('drain', onDrain);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Streams native RGBA frames from the same scene source used by Browser Cloud
 * into FFmpeg. Each caller supplies its own identity, preset and worker queue;
 * this shared code only guarantees visual feature parity, never engine fallback.
 */
export async function renderNativeSceneVideo(
  options: DeterministicRenderOptions,
  config: NativeSceneVideoConfig,
): Promise<DeterministicRenderResult> {
  const manifest = cloneManifest(options.manifest);
  const { outputPath, signal, onProgress } = options;
  const ffmpegPath = getFfmpegBinary();
  if (!ffmpegPath || (path.isAbsolute(ffmpegPath) && !fs.existsSync(ffmpegPath))) {
    throw new Error('Native FFmpeg executable is missing on server.');
  }

  const renderId = crypto.randomBytes(8).toString('hex');
  const scratchDir = path.join(os.tmpdir(), `${config.scratchPrefix}_${renderId}`);
  await fs.promises.mkdir(scratchDir, { recursive: true });

  let scene: NativeSceneRenderer | null = null;
  let ffmpegProcess: ChildProcessWithoutNullStreams | null = null;
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

    scene = new NativeSceneRenderer(manifest);
    await scene.init();

    const ffmpegArgs = [
      '-y',
      ...getFfmpegResourceArgs(),
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', String(fps),
      '-i', '-',
      '-i', audioTrackPath,
      '-c:v', 'libx264',
      ...getFfmpegVideoEncoderArgs(),
      '-preset', getFfmpegPreset(config.preset),
      '-crf', config.qualityCrf,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ];

    logger.info(`Starting ${config.label} render [${renderId}]: ${width}x${height} @ ${fps}fps (${totalFrames} frames)`);
    ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });
    let stderr = '';
    let inputError: Error | null = null;
    ffmpegProcess.stdin.on('error', (error) => {
      inputError = error;
    });
    ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpegExit = new Promise<void>((resolve, reject) => {
      ffmpegProcess!.once('error', (error) => reject(new Error(`Failed to spawn ${config.label} FFmpeg: ${error.message}`)));
      ffmpegProcess!.once('close', (code, exitSignal) => {
        if (code === 0) resolve();
        else {
          const termination = code === null ? `signal ${exitSignal || 'unknown'}` : `code ${code}`;
          reject(new Error(`${config.label} FFmpeg failed [${termination}]: ${stderr.slice(-1600)}`));
        }
      });
    });

    abortHandler = () => killProcess(ffmpegProcess);
    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    }

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (signal?.aborted) throw new Error('Render cancelled by user.');
      if (inputError) throw new Error(`${config.label} FFmpeg input closed: ${inputError.message}`);
      const frame = await scene.renderFrameRgbaBuffer(frameIndex, frameIndex / fps);
      await writeFrame(ffmpegProcess.stdin, frame);
      const progress = Math.min(94, Math.round(8 + ((frameIndex + 1) / totalFrames) * 84));
      onProgress?.(progress, frameIndex + 1, totalFrames, `رسم المشهد الكامل عبر ${config.label}...`);
    }

    ffmpegProcess.stdin.end();
    await ffmpegExit;
    if (signal?.aborted) throw new Error('Render cancelled by user.');

    onProgress?.(98, totalFrames, totalFrames, `التحقق من سلامة فيديو ${config.label} النهائي...`);
    const probe = await probeMediaFile(outputPath);
    const validation = validateProbeAgainstSpec(probe, fps, manifest.audio.durationSeconds);
    if (!validation.valid) {
      throw new Error(`${config.label} video failed probe validation: ${validation.errors.join(', ')}`);
    }

    const stat = await fs.promises.stat(outputPath);
    logger.info(`✅ ${config.label} render [${renderId}] completed successfully: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    return { outputPath, fileSizeBytes: stat.size, durationSeconds: probe.durationSeconds, totalFrames, probe };
  } catch (error) {
    killProcess(ffmpegProcess);
    if (ffmpegExit) await ffmpegExit.catch(() => undefined);
    if (signal?.aborted || /cancel|abort|إلغاء/i.test(String((error as Error)?.message || error))) {
      await fs.promises.unlink(outputPath).catch(() => undefined);
    }
    throw error;
  } finally {
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
    await scene?.close();
    await fs.promises.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

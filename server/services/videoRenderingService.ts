import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { logger } from '../logger';
import { getFfmpegBinary as resolveFfmpegBinary, getFfmpegResourceArgs, getFfmpegVideoEncoderArgs } from './ffmpegBinary';

export interface RenderOptions {
  durationSeconds?: number;
  fps?: number;
  crf?: number;
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  audioBitrate?: string;
  filename?: string;
}

export function getFfmpegBinary(): string {
  return resolveFfmpegBinary();
}

export function isFfmpegAvailable(): boolean {
  const binary = resolveFfmpegBinary();
  return binary === 'ffmpeg' || fs.existsSync(binary);
}

/** Converts browser recordings to CFR H.264/AAC MP4; dropped frames cannot be recovered. */
export async function processVideoToSmoothMp4(
  inputBuffer: Buffer,
  options: RenderOptions = {}
): Promise<Buffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('حجم ملف الفيديو المدخل غير صالح (Buffer is empty)');
  }

  const binary = getFfmpegBinary();


  const randomId = crypto.randomBytes(8).toString('hex');
  const tempInPath = path.join(os.tmpdir(), `quran_in_${randomId}.webm`);
  const tempOutPath = path.join(os.tmpdir(), `quran_out_${randomId}.mp4`);

  const fps = options.fps || 30;
  const crf = options.crf !== undefined ? options.crf : 19;
  const preset = options.preset || 'fast';
  const audioBitrate = options.audioBitrate || '192k';
  // Native AAC has a per-frame bit cap at 44.1 kHz which can silently reduce
  // a requested 320 kbps stream. A 96 kHz AAC container stream preserves the
  // advertised premium 320 kbps master target; standard plans remain 44.1 kHz.
  const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';

  try {
    // 1. Write incoming video buffer to temp file
    await fs.promises.writeFile(tempInPath, inputBuffer);
    logger.info(`Starting FFmpeg render job [${randomId}] - Input size: ${(inputBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

    // 2. Configure professional broadcast arguments
    const args = [
      '-y',
      ...getFfmpegResourceArgs(),
      '-i', tempInPath,
      // Video Codec & Profile (Universal Hardware Acceleration)
      '-c:v', 'libx264',
      ...getFfmpegVideoEncoderArgs(),
      '-profile:v', 'high',
      // x264 derives the correct level from dimensions and FPS (4K requires 5.x).
      '-preset', preset,
      '-crf', crf.toString(),
      ...(options.durationSeconds && options.durationSeconds > 0 ? ['-vf', `setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${options.durationSeconds}`] : []),
      // Frame Rate & Timestamp Normalization (CFR eliminates micro-stutter & jitter)
      '-r', fps.toString(),
      '-vsync', 'cfr',
      // GOP & Keyframe Intervals (instantaneous seek & zero stutter)
      '-g', (fps * 2).toString(),
      '-keyint_min', fps.toString(),
      '-sc_threshold', '0',
      // Pixel format (100% compatible with Windows Media Player, QuickTime, iOS, Android)
      '-pix_fmt', 'yuv420p',
      // Audio Codec & Parameters
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      // Keep the paid master profile at its requested target even for a
      // simple/quiet source such as a short recitation pause.
      '-minrate:a', audioBitrate,
      '-maxrate:a', audioBitrate,
      '-bufsize:a', audioBitrate,
      '-ar', audioSampleRate,
      '-ac', '2',
      // Container optimization
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '2048',
      ...(options.durationSeconds && options.durationSeconds > 0 ? ['-t', String(options.durationSeconds)] : []),
      tempOutPath
    ];

    // 3. Execute FFmpeg process with timeout safety
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(binary, args, {
        windowsHide: true,
      });

      let stderrOutput = '';
      const timeoutMs = 90_000; // 90 seconds max execution time

      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(`استغرقت معالجة الفيديو وقتاً طويلاً وتوقفت تلقائياً (FFmpeg timed out after ${timeoutMs / 1000}s)`));
      }, timeoutMs);

      proc.stderr.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          logger.error(`FFmpeg process exited with code ${code}: ${stderrOutput.slice(-500)}`);
          reject(new Error(`فشلت معالجة الفيديو بواسطة FFmpeg (Code ${code}): ${stderrOutput.slice(-200)}`));
        }
      });
    });

    // 4. Read output MP4 file
    const outputBuffer = await fs.promises.readFile(tempOutPath);
    logger.info(`FFmpeg render job [${randomId}] completed successfully - Output size: ${(outputBuffer.length / (1024 * 1024)).toFixed(2)} MB`);
    return outputBuffer;

  } finally {
    // 5. Guaranteed cleanup of temp files
    try {
      if (fs.existsSync(tempInPath)) await fs.promises.unlink(tempInPath);
    } catch (e) {
      logger.warn(`Failed to clean up input temp file: ${tempInPath}`, e);
    }
    try {
      if (fs.existsSync(tempOutPath)) await fs.promises.unlink(tempOutPath);
    } catch (e) {
      logger.warn(`Failed to clean up output temp file: ${tempOutPath}`, e);
    }
  }
}

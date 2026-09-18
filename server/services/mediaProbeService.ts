import { spawn } from 'child_process';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import { logger } from '../logger';

export interface VideoStreamInfo {
  codec: string;
  profile?: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  bitrate?: number;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  bitrate?: number;
}

export interface MediaProbeResult {
  container: string;
  durationSeconds: number;
  sizeBytes: number;
  bitrate: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  rawStreams: any[];
}

/**
 * Executes ffprobe to inspect a produced media file and validate container and codec integrity
 */
export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file does not exist at path: ${filePath}`);
  }

  const ffprobePath = ffprobeStatic.path;
  if (!ffprobePath || !fs.existsSync(ffprobePath)) {
    throw new Error(`ffprobe executable not found at: ${ffprobePath}`);
  }

  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, args, { windowsHide: true });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.error(`ffprobe exited with code ${code}: ${stderrData}`);
        return reject(new Error(`ffprobe failed with exit code ${code}: ${stderrData}`));
      }

      try {
        const parsed = JSON.parse(stdoutData);
        const format = parsed.format || {};
        const streams = parsed.streams || [];

        let videoInfo: VideoStreamInfo | null = null;
        let audioInfo: AudioStreamInfo | null = null;

        for (const s of streams) {
          if (s.codec_type === 'video' && !videoInfo) {
            let calculatedFps = 30;
            if (s.r_frame_rate && s.r_frame_rate.includes('/')) {
              const [num, den] = s.r_frame_rate.split('/').map(Number);
              if (den > 0) calculatedFps = Math.round(num / den);
            }
            videoInfo = {
              codec: s.codec_name,
              profile: s.profile,
              pixelFormat: s.pix_fmt,
              width: s.width,
              height: s.height,
              fps: calculatedFps,
              durationSeconds: parseFloat(s.duration || format.duration || '0'),
              bitrate: s.bit_rate ? parseInt(s.bit_rate, 10) : undefined,
            };
          } else if (s.codec_type === 'audio' && !audioInfo) {
            audioInfo = {
              codec: s.codec_name,
              sampleRate: parseInt(s.sample_rate || '44100', 10),
              channels: parseInt(s.channels || '2', 10),
              durationSeconds: parseFloat(s.duration || format.duration || '0'),
              bitrate: s.bit_rate ? parseInt(s.bit_rate, 10) : undefined,
            };
          }
        }

        const result: MediaProbeResult = {
          container: format.format_name || 'unknown',
          durationSeconds: parseFloat(format.duration || '0'),
          sizeBytes: parseInt(format.size || '0', 10),
          bitrate: parseInt(format.bit_rate || '0', 10),
          video: videoInfo,
          audio: audioInfo,
          rawStreams: streams,
        };

        resolve(result);
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse ffprobe JSON output: ${parseErr.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/**
 * Validates that a rendered MP4 file satisfies the strict broadcast production specifications
 */
export function validateProbeAgainstSpec(probe: MediaProbeResult, expectedFps: number = 30): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Container must be MP4
  if (!probe.container.includes('mp4') && !probe.container.includes('mov')) {
    errors.push(`Invalid container format: expected MP4, got "${probe.container}"`);
  }

  // Video track validation
  if (!probe.video) {
    errors.push('No video stream found in media file');
  } else {
    if (probe.video.codec !== 'h264') {
      errors.push(`Invalid video codec: expected h264, got "${probe.video.codec}"`);
    }
    if (probe.video.pixelFormat !== 'yuv420p') {
      errors.push(`Invalid pixel format: expected yuv420p, got "${probe.video.pixelFormat}"`);
    }
    if (Math.abs(probe.video.fps - expectedFps) > 1) {
      errors.push(`FPS mismatch: expected ~${expectedFps} fps, got ${probe.video.fps}`);
    }
    if (probe.video.width < 360 || probe.video.height < 360) {
      errors.push(`Dimensions too small: ${probe.video.width}x${probe.video.height}`);
    }
  }

  // Audio track validation
  if (!probe.audio) {
    errors.push('No audio stream found in media file');
  } else {
    if (probe.audio.codec !== 'aac') {
      errors.push(`Invalid audio codec: expected aac, got "${probe.audio.codec}"`);
    }
    if (probe.audio.channels < 1) {
      errors.push(`Invalid audio channels: got ${probe.audio.channels}`);
    }
  }

  // Duration check
  if (probe.durationSeconds <= 0.2) {
    errors.push(`Media duration is invalid or zero: ${probe.durationSeconds}s`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

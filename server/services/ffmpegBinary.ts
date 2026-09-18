import fs from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const VALID_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
]);

function existingPath(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

/**
 * Prefer the binary explicitly installed by the deployment image. This keeps
 * Railway on its system ffmpeg instead of silently falling back to the
 * platform-specific ffmpeg-static package bundled in node_modules.
 */
export function getFfmpegBinary(): string {
  return existingPath(process.env.FFMPEG_PATH) || existingPath(ffmpegStatic || undefined) || 'ffmpeg';
}

export function getFfprobeBinary(): string {
  return existingPath(process.env.FFPROBE_PATH) || existingPath(ffprobeStatic.path) || 'ffprobe';
}

export function getFfmpegResourceArgs(): string[] {
  const rawThreads = Number.parseInt(process.env.RENDER_FFMPEG_THREADS || '', 10);
  if (!Number.isFinite(rawThreads) || rawThreads <= 0) return [];

  const threads = Math.max(1, Math.min(8, rawThreads));
  return ['-threads', String(threads), '-filter_threads', String(threads), '-filter_complex_threads', String(threads)];
}

export function getFfmpegPreset(fallback = 'veryfast'): string {
  const configured = process.env.RENDER_FFMPEG_PRESET?.trim().toLowerCase();
  return configured && VALID_PRESETS.has(configured) ? configured : fallback;
}

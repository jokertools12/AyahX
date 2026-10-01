import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;
let conversionQueue: Promise<unknown> = Promise.resolve();

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    try {
      const ffmpeg = new FFmpeg();

      // Lazy-load core from CDN to avoid bundling massive WASM into the app.
      // If one CDN is blocked, try another.
      const coreBases = [
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
      ];

      let lastErr: unknown = null;
      for (const coreBase of coreBases) {
        try {
          const urls: string[] = [];
          try {
            urls.push(await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'));
            urls.push(await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'));
            await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] }, { signal: AbortSignal.timeout(60000) });
          } finally {
            urls.forEach(url => URL.revokeObjectURL(url));
          }
          lastErr = null;
          break;
        } catch (e) {
          ffmpeg.terminate();
          lastErr = e;
        }
      }

      if (lastErr) throw lastErr;

      ffmpegSingleton = ffmpeg;
      return ffmpeg;
    } catch (err) {
      ffmpegLoading = null;
      throw err;
    }
  })();

  return ffmpegLoading;
}

/**
 * Broadcast-grade H.264 / AAC conversion arguments for social media (Reels, TikTok, Shorts)
 * and universal local media player hardware acceleration
 */
export function getH264BroadcastArgs(fps: number = 30, audioBitrate: string = '192k', durationSeconds?: number) {
  const safeFps = fps === 60 ? 60 : 30;
  const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';
  return [
  '-c:v', 'libx264',
  '-profile:v', 'high',
  // Let x264 select the level from the actual dimensions and frame rate, including 4K60.
  // Canvas MediaRecorder WebM is tagged full-range (pc). Convert levels
  // explicitly before marking the broadcast MP4 as video-range (tv); merely
  // changing the pixel format makes local exports visibly darker than the
  // shared Browser Cloud scene.
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p' + (durationSeconds && durationSeconds > 0 ? `,setpts=PTS-STARTPTS,fps=${safeFps},tpad=stop_mode=clone:stop_duration=${durationSeconds}` : ''),
  '-color_range', 'tv',
  '-pix_fmt', 'yuv420p',
  '-preset', 'veryfast',
  '-crf', '20',
  '-r', safeFps.toString(),
  '-vsync', 'cfr',
  '-g', (safeFps * 2).toString(),
  '-keyint_min', safeFps.toString(),
  '-max_muxing_queue_size', '1024',
  '-c:a', 'aac',
  '-b:a', audioBitrate,
  '-minrate:a', audioBitrate,
  '-maxrate:a', audioBitrate,
  '-bufsize:a', audioBitrate,
  '-ar', audioSampleRate,
  '-ac', '2',
  '-movflags', '+faststart',
  ] as const;
}

export const H264_BROADCAST_ARGS = getH264BroadcastArgs();

export function getMpeg4FallbackArgs(fps: number = 30, audioBitrate: string = '192k', durationSeconds?: number) {
  const safeFps = fps === 60 ? 60 : 30;
  const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';
  return [
  '-c:v', 'mpeg4',
  '-q:v', '4',
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p' + (durationSeconds && durationSeconds > 0 ? `,setpts=PTS-STARTPTS,fps=${safeFps},tpad=stop_mode=clone:stop_duration=${durationSeconds}` : ''),
  '-color_range', 'tv',
  '-pix_fmt', 'yuv420p',
  '-r', safeFps.toString(),
  '-max_muxing_queue_size', '1024',
  '-c:a', 'aac',
  '-b:a', audioBitrate,
  '-minrate:a', audioBitrate,
  '-maxrate:a', audioBitrate,
  '-bufsize:a', audioBitrate,
  '-ar', audioSampleRate,
  '-ac', '2',
  '-movflags', '+faststart',
  ] as const;
}

export const MPEG4_FALLBACK_ARGS = getMpeg4FallbackArgs();

/**
 * Render / convert recorded WebM video into a silky-smooth, hardware-accelerated H.264 MP4.
 * 
 * Browser Canvas exports are intentionally converted locally. Sending the video
 * back to the API would turn an on-device export into an unmetered cloud render
 * and could silently coerce a premium 60fps video to 30fps.
 */
export async function convertWebmToMp4(
  input: Blob,
  opts?: {
    onProgress?: (ratio: number) => void;
    filename?: string;
    fps?: 30 | 60;
    audioBitrate?: '128k' | '192k' | '320k';
    durationSeconds?: number;
  }
): Promise<Blob> {
  // A shared WASM filesystem cannot run two encodes concurrently.
  const conversion = conversionQueue.then(async () => {
    const fps = opts?.fps === 60 ? 60 : 30;
    const audioBitrate = opts?.audioBitrate || '192k';
    const durationArgs = opts?.durationSeconds && opts.durationSeconds > 0 ? ['-t', String(opts.durationSeconds)] : [];
    const ffmpeg = await getFFmpeg();
    const inName = input.type.includes('mp4') ? 'input.mp4' : 'input.webm';
    const outName = 'output.mp4';
    const progress = ({ progress: ratio }: { progress: number }) => {
      if (Number.isFinite(ratio)) opts?.onProgress?.(Math.min(0.99, Math.max(0, ratio)));
    };
    ffmpeg.on('progress', progress);
    try {
      await ffmpeg.writeFile(inName, await fetchFile(input));
      const status = await ffmpeg.exec(['-i', inName, ...getH264BroadcastArgs(fps, audioBitrate, opts?.durationSeconds), ...durationArgs, outName]);
      if (status !== 0) throw new Error('تعذّر تجهيز فيديو MP4 على جهازك. أعد المحاولة بدقة أقل.');
      const data = await ffmpeg.readFile(outName);
      if (typeof data === 'string' || data.byteLength < 1000) throw new Error('ملف الفيديو الناتج غير صالح للتنزيل');
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      opts?.onProgress?.(1);
      return new Blob([copy.buffer], { type: 'video/mp4' });
    } finally {
      ffmpeg.off('progress', progress);
      await Promise.allSettled([ffmpeg.deleteFile(inName), ffmpeg.deleteFile(outName)]);
    }
  });
  conversionQueue = conversion.catch(() => undefined);
  return conversion;
}

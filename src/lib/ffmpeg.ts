import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    try {
      const ffmpeg = new FFmpeg();
      if (onProgress) {
        ffmpeg.on('progress', ({ progress }) => onProgress(progress));
      }

      // Lazy-load core from CDN to avoid bundling massive WASM into the app.
      // If one CDN is blocked, try another.
      const coreBases = [
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
      ];

      let lastErr: unknown = null;
      for (const coreBase of coreBases) {
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          lastErr = null;
          break;
        } catch (e) {
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
export function getH264BroadcastArgs(fps: number = 30, audioBitrate: string = '192k') {
  const safeFps = fps === 60 ? 60 : 30;
  const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';
  return [
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-level:v', safeFps === 60 ? '4.2' : '4.1',
  // Canvas MediaRecorder WebM is tagged full-range (pc). Convert levels
  // explicitly before marking the broadcast MP4 as video-range (tv); merely
  // changing the pixel format makes local exports visibly darker than the
  // shared Browser Cloud scene.
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p',
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

export function getMpeg4FallbackArgs(fps: number = 30, audioBitrate: string = '192k') {
  const safeFps = fps === 60 ? 60 : 30;
  const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';
  return [
  '-c:v', 'mpeg4',
  '-q:v', '4',
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p',
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
  }
): Promise<Blob> {
  const fps = opts?.fps === 60 ? 60 : 30;
  const audioBitrate = opts?.audioBitrate || '192k';
  const ffmpeg = await getFFmpeg(opts?.onProgress);

  const inName = input.type.includes('mp4') ? 'input.mp4' : 'input.webm';
  const outName = 'output.mp4';

  await ffmpeg.writeFile(inName, await fetchFile(input));

  // Try H.264 + AAC with +faststart first; if not available in this build, fallback to MPEG-4.
  try {
    await ffmpeg.exec(['-i', inName, ...getH264BroadcastArgs(fps, audioBitrate), outName]);
  } catch {
    await ffmpeg.exec(['-i', inName, ...getMpeg4FallbackArgs(fps, audioBitrate), outName]);
  }

  const data = (await ffmpeg.readFile(outName)) as unknown as Uint8Array;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  // Cleanup (best-effort)
  try {
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
  } catch {
    // ignore
  }

  return new Blob([copy.buffer], { type: 'video/mp4' });
}

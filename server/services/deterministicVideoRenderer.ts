import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import url from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { RenderManifest } from '../models/renderManifest';
import { DeterministicFrameRenderer } from '../renderer/frameRenderer';
import { availableCpuCores } from './renderCapacity';
import { probeMediaFile, validateProbeAgainstSpec, MediaProbeResult } from './mediaProbeService';
import { logger } from '../logger';

export interface DeterministicRenderOptions {
  manifest: RenderManifest;
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (progressPercent: number, currentFrame: number, totalFrames: number, stage?: string) => void;
}

export interface DeterministicRenderResult {
  outputPath: string;
  fileSizeBytes: number;
  durationSeconds: number;
  totalFrames: number;
  probe: MediaProbeResult;
}

/**
 * Runs a standalone FFmpeg command asynchronously with proper error logging
 */
function runFfmpegCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg binary not found'));
    }
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg command failed [code ${code}]: ${stderr}`));
      }
    });
    proc.on('error', (err: any) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Converts a local filesystem path to a fully valid file URI (file:///C:/... on Windows)
 */
function toFileUri(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

/**
 * Preloads background images or video thumbnails into local scratch directory
 * and rewrites the manifest background URLs to local file:// paths for 100% deterministic,
 * ultra-fast, zero-CORS Chromium rendering.
 */
async function prepareBackgroundAsset(manifest: RenderManifest, scratchDir: string): Promise<void> {
  const bg = manifest.background;
  if (!bg) return;

  // 1. If slideshow, preload all slide images
  if (bg.type === 'slideshow' && bg.slideImages && bg.slideImages.length > 0) {
    const localSlidePaths: string[] = [];
    for (let i = 0; i < bg.slideImages.length; i++) {
      let imgUrl = bg.slideImages[i];
      if (imgUrl.includes('images.unsplash.com')) {
        imgUrl = imgUrl.replace(/w=\d+/, 'w=1920').replace(/q=\d+/, 'q=85');
        if (!imgUrl.includes('w=')) {
          imgUrl += (imgUrl.includes('?') ? '&' : '?') + 'w=1920&q=85';
        }
      }
      const localPath = path.join(scratchDir, `slide_${i}.jpg`);
      try {
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
          const res = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            await fs.promises.writeFile(localPath, Buffer.from(buf));
            localSlidePaths.push(toFileUri(localPath));
          }
        } else if (fs.existsSync(imgUrl)) {
          localSlidePaths.push(toFileUri(imgUrl));
        }
      } catch (err: any) {
        logger.warn(`Failed to preload slide image [${i}]: ${err.message}`);
      }
    }
    if (localSlidePaths.length > 0) {
      bg.slideImages = localSlidePaths;
    }
  }

  // 2. If video background: download MP4 and extract frame sequence matching recitation timeline
  if (bg.type === 'video' && bg.url) {
    const fps = manifest.fps || 30;
    const { width, height } = manifest.outputDimensions;
    const totalDuration = Math.max(manifest.audio.durationSeconds, 1.0);

    try {
      let localVideoPath = bg.url;
      if (bg.url.startsWith('file://')) {
        try {
          localVideoPath = url.fileURLToPath(bg.url);
        } catch {
          localVideoPath = bg.url.replace(/^file:\/\/\/?/, '');
        }
      } else if (bg.url.startsWith('http://') || bg.url.startsWith('https://')) {
        localVideoPath = path.join(scratchDir, 'bg_video_input.mp4');
        logger.info(`Downloading video background preset for local render: ${bg.url}`);
        const vRes = await fetch(bg.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (vRes.ok) {
          const vBuf = await vRes.arrayBuffer();
          await fs.promises.writeFile(localVideoPath, Buffer.from(vBuf));
          logger.info(`Video background downloaded (${(vBuf.byteLength / (1024 * 1024)).toFixed(2)} MB)`);
        }
      }

      if (fs.existsSync(localVideoPath)) {
        const bgFramesDir = path.join(scratchDir, 'bg_frames');
        await fs.promises.mkdir(bgFramesDir, { recursive: true });

        const framePatternFile = path.join(bgFramesDir, 'frame_%05d.jpg');
        logger.info(`Extracting video background frames (${totalDuration.toFixed(1)}s at ${fps} fps)...`);

        await runFfmpegCommand([
          '-y',
          '-stream_loop', '-1',
          '-i', localVideoPath,
          '-t', totalDuration.toFixed(3),
          '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
          '-r', fps.toString(),
          '-q:v', '2',
          framePatternFile,
        ]);

        const extractedCount = (await fs.promises.readdir(bgFramesDir)).length;
        if (extractedCount > 0) {
          const localPatternUrl = toFileUri(framePatternFile);
          (bg as any).framesPattern = localPatternUrl;
          const firstFramePath = path.join(bgFramesDir, 'frame_00001.jpg');
          if (fs.existsSync(firstFramePath)) {
            const firstFrameUrl = toFileUri(firstFramePath);
            bg.thumbnail = firstFrameUrl;
            bg.url = firstFrameUrl;
          }
          logger.info(`Successfully extracted ${extractedCount} video background frames to: ${bgFramesDir}`);
          return;
        }
      }
    } catch (vErr: any) {
      logger.warn(`Video frame extraction encountered issue, falling back to master image: ${vErr.message}`);
    }
  }

  // 3. Preload primary static image or video thumbnail fallback
  let targetUrl = bg.thumbnail || (bg.url && !bg.url.endsWith('.mp4') ? bg.url : null);
  if (!targetUrl && bg.url) {
    targetUrl = bg.url;
  }

  const localBgPath = path.join(scratchDir, 'bg_primary.jpg');

  if (targetUrl) {
    if (targetUrl.includes('images.unsplash.com')) {
      targetUrl = targetUrl.replace(/w=\d+/, 'w=1920').replace(/q=\d+/, 'q=85');
      if (!targetUrl.includes('w=')) {
        targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'w=1920&q=85';
      }
    }

    try {
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        logger.info(`Fetching background asset for local render: ${targetUrl}`);
        const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          await fs.promises.writeFile(localBgPath, Buffer.from(buf));
          const localFileUrl = toFileUri(localBgPath);
          bg.thumbnail = localFileUrl;
          bg.url = localFileUrl;
          logger.info(`Preloaded local background image (${(buf.byteLength / 1024).toFixed(1)} KB) to: ${localBgPath}`);
        }
      } else if (targetUrl.startsWith('data:image/')) {
        const base64Data = targetUrl.split(';base64,').pop();
        if (base64Data) {
          await fs.promises.writeFile(localBgPath, Buffer.from(base64Data, 'base64'));
          const localFileUrl = toFileUri(localBgPath);
          bg.thumbnail = localFileUrl;
          bg.url = localFileUrl;
        }
      } else if (fs.existsSync(targetUrl)) {
        const localFileUrl = toFileUri(targetUrl);
        bg.thumbnail = localFileUrl;
        bg.url = localFileUrl;
      }
    } catch (err: any) {
      logger.warn(`Could not preload primary background asset locally: ${err.message}`);
    }
  }
}
/**
 * Probes audio volume and channel metrics directly via native FFmpeg volumedetect
 */
export interface AudioMetricsResult {
  maxVolumeDb: number;
  meanVolumeDb: number;
  isMono: boolean;
}

export async function detectAudioMetrics(filePath: string): Promise<AudioMetricsResult> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      return resolve({ maxVolumeDb: -7, meanVolumeDb: -20, isMono: false });
    }
    const proc = spawn(ffmpegPath, ['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', () => {
      const maxMatch = stderr.match(/max_volume: ([-\d.]+) dB/);
      const meanMatch = stderr.match(/mean_volume: ([-\d.]+) dB/);
      const isMono = stderr.includes('Audio: ') && (stderr.includes(', mono') || stderr.includes('1 channels'));
      const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]) : -7;
      const meanVolumeDb = meanMatch ? parseFloat(meanMatch[1]) : -20;
      resolve({ maxVolumeDb, meanVolumeDb, isMono });
    });
    proc.on('error', () => {
      resolve({ maxVolumeDb: -7, meanVolumeDb: -20, isMono: false });
    });
  });
}

/**
 * Downloads or prepares the audio track into a pristine uncompressed PCM WAV scratch file.
 * Handles:
 * 1. Multiple EveryAyah CDN URLs concatenated natively via FFmpeg concat demuxer
 * 2. Quran Foundation recitations sliced with rangeMs via FFmpeg
 * 3. Single remote URL or local audio file
 */
async function prepareAudioTrack(manifest: RenderManifest, scratchDir: string): Promise<string> {
  const audioFilePath = path.join(scratchDir, 'audio_track.wav');

  // Case 1: Multiple EveryAyah URLs -> Download each and concatenate via native FFmpeg
  if (manifest.audio.everyAyahUrls && manifest.audio.everyAyahUrls.length > 1) {
    logger.info(`Concatenating ${manifest.audio.everyAyahUrls.length} EveryAyah audio parts on server...`);
    // These files are independent. Download/copy them in parallel so the
    // render does not pay one network round-trip per ayah before encoding.
    const partPaths = await Promise.all(manifest.audio.everyAyahUrls.map(async (url, i) => {
      const partPath = path.join(scratchDir, `ayah_part_${i}.mp3`);

      if (url.startsWith('http://') || url.startsWith('https://')) {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to download ayah part [${i + 1}] from ${url}: HTTP ${res.status}`);
        }
        const arrayBuf = await res.arrayBuffer();
        await fs.promises.writeFile(partPath, Buffer.from(arrayBuf));
      } else if (fs.existsSync(url)) {
        await fs.promises.copyFile(url, partPath);
      } else {
        throw new Error(`EveryAyah audio part not accessible: ${url}`);
      }

      logger.debug(`Downloaded EveryAyah part ${i + 1}/${manifest.audio.everyAyahUrls!.length}`);
      return partPath;
    }));

    // Write concat file list (forward slashes required for Windows FFmpeg concat demuxer)
    const concatListPath = path.join(scratchDir, 'concat_list.txt');
    const concatContent = partPaths
      .map((p) => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n');
    await fs.promises.writeFile(concatListPath, concatContent, 'utf-8');

    await runFfmpegCommand([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:a', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      audioFilePath,
    ]);

    // If rangeMs is also specified on top of concatenated audio
    if (manifest.audio.rangeMs && manifest.audio.rangeMs.to > manifest.audio.rangeMs.from) {
      const trimmedPath = path.join(scratchDir, 'audio_track_trimmed.wav');
      const fromSec = (manifest.audio.rangeMs.from / 1000).toFixed(3);
      const durationSec = ((manifest.audio.rangeMs.to - manifest.audio.rangeMs.from) / 1000).toFixed(3);

      await runFfmpegCommand([
        '-y',
        '-ss', fromSec,
        '-t', durationSec,
        '-i', audioFilePath,
        '-c:a', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '2',
        trimmedPath,
      ]);
      await fs.promises.rename(trimmedPath, audioFilePath);
    }

    return await applyAudioEffects(audioFilePath, scratchDir, manifest);
  }

  // Case 2 & 3: Single audio URL (with optional rangeMs slicing)
  const rawAudioPath = path.join(scratchDir, 'raw_audio_input.mp3');
  const audioObj = manifest.audio as Record<string, unknown>;
  const rawTarget = audioObj.audioUrl ?? audioObj.localAudioPath ?? audioObj.sourceUrl;
  let targetUrl = typeof rawTarget === 'string' ? rawTarget : '';

  // Final sanity check: if somehow targetUrl is blob but everyAyahUrls is present
  if (targetUrl && targetUrl.startsWith('blob:') && manifest.audio.everyAyahUrls?.[0]) {
    targetUrl = manifest.audio.everyAyahUrls[0];
  }

  if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
    logger.info(`Fetching recitation audio track from: ${targetUrl}`);
    const res = await fetch(targetUrl);
    if (!res.ok) {
      throw new Error(`Failed to download recitation audio: HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    await fs.promises.writeFile(rawAudioPath, Buffer.from(arrayBuf));
  } else if (fs.existsSync(targetUrl)) {
    await fs.promises.copyFile(targetUrl, rawAudioPath);
  } else {
    throw new Error(`Audio asset not accessible at: ${targetUrl}`);
  }

  // If rangeMs is specified and requires slicing (e.g. QF mode where full surah was fetched)
  if (manifest.audio.rangeMs && manifest.audio.rangeMs.to > manifest.audio.rangeMs.from) {
    const fromSec = (manifest.audio.rangeMs.from / 1000).toFixed(3);
    const durationSec = ((manifest.audio.rangeMs.to - manifest.audio.rangeMs.from) / 1000).toFixed(3);
    logger.info(`Trimming audio track with native FFmpeg: from ${fromSec}s, duration ${durationSec}s...`);

    await runFfmpegCommand([
      '-y',
      '-ss', fromSec,
      '-t', durationSec,
      '-i', rawAudioPath,
      '-c:a', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      audioFilePath,
    ]);

    return await applyAudioEffects(audioFilePath, scratchDir, manifest);
  }

  // Convert raw audio to uncompressed PCM WAV for studio-grade processing without compression loss
  await runFfmpegCommand([
    '-y',
    '-i', rawAudioPath,
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '2',
    audioFilePath,
  ]);

  return await applyAudioEffects(audioFilePath, scratchDir, manifest);
}

/**
 * Applies audio effects and studio mastering filtergraph using native FFmpeg.
 * Implements:
 * 1. Automatic peak headroom & volume detection to bring quiet recitations up to broadcast level
 * 2. Mono preservation (pan=stereo|c0=c0|c1=c0) preventing FFmpeg's -3dB downmix attenuation
 * 3. Multi-band EQ clarity & presence enhancement
 * 4. Copyright protection acoustic fingerprint alteration (EQ filter + subtle 2% tempo shift)
 * 5. Authentic Mosque acoustics reverberation (Early and late reflection matrix)
 * 6. Multi-tap geometric echo delay & feedback repetition
 * 7. Broadcast Brickwall Soft Limiter ensuring full rich volume without any clipping
 */
export async function applyAudioEffects(
  inputAudioPath: string,
  scratchDir: string,
  manifest: RenderManifest
): Promise<string> {
  const effects = manifest.audioEffects || {
    reverbEnabled: false,
    echoEnabled: false,
    eqEnabled: false,
    normalizeEnabled: false,
    volume: 1.25,
  };

  const preFilters: string[] = [];
  const postFilters: string[] = [];

  // Detect input audio volume metrics (peak, mean, channel count)
  const metrics = await detectAudioMetrics(inputAudioPath);
  logger.info(
    `Recitation audio metrics: peak=${metrics.maxVolumeDb.toFixed(1)}dB, mean=${metrics.meanVolumeDb.toFixed(1)}dB, mono=${metrics.isMono}`
  );

  // If source is mono, preserve full 0 dB gain on both stereo channels (prevent FFmpeg default -3 dB cut)
  if (metrics.isMono) {
    preFilters.push('pan=stereo|c0=c0|c1=c0');
  }

  // 1. EQ Enhancement (clarity, presence and warmth)
  if (effects.eqEnabled) {
    preFilters.push('bass=g=2:f=180', 'equalizer=f=1200:t=q:w=0.7:g=2.5', 'treble=g=-1:f=8000');
  }

  // 2. Copyright Protection (Acoustic fingerprint alteration matching useAudioEffects)
  if (effects.copyrightProtectionEnabled) {
    preFilters.push(
      'equalizer=f=1200:t=q:w=0.7:g=1.2',
      'treble=g=-0.8:f=8000',
      'bass=g=0.6:f=200',
      'atempo=1.02'
    );
    manifest.audio.durationSeconds = Math.max(manifest.audio.durationSeconds / 1.02, 0.5);
  } else if (typeof effects.speedAdjust === 'number' && effects.speedAdjust !== 1.0 && effects.speedAdjust > 0.5 && effects.speedAdjust < 2.0) {
    preFilters.push(`atempo=${effects.speedAdjust.toFixed(2)}`);
    manifest.audio.durationSeconds = Math.max(manifest.audio.durationSeconds / effects.speedAdjust, 0.5);
  }

  // 3. Mosque Acoustics Reverb (Dense early and late reflection matrix with preserved dry voice)
  let reverbFilter = '';
  if (effects.reverbEnabled) {
    const level = typeof effects.reverbLevel === 'number' ? effects.reverbLevel : 0.5;
    const clampedLevel = Math.max(0.1, Math.min(1.0, level));
    const r1 = (0.35 * clampedLevel).toFixed(3);
    const r2 = (0.28 * clampedLevel).toFixed(3);
    const r3 = (0.20 * clampedLevel).toFixed(3);
    const r4 = (0.14 * clampedLevel).toFixed(3);
    const r5 = (0.09 * clampedLevel).toFixed(3);
    reverbFilter = `aecho=1.0:1.0:40|85|140|210|320:${r1}|${r2}|${r3}|${r4}|${r5}`;
  }

  // 4. Multi-tap Feedback Echo (Exact Web Audio delay loop emulation)
  let echoFilter = '';
  if (effects.echoEnabled) {
    const delaySec = typeof effects.echoDelay === 'number' ? effects.echoDelay : 0.3;
    const delayMs = Math.round(Math.max(50, Math.min(1000, delaySec * 1000)));
    const feedback = Math.max(0.05, Math.min(0.85, typeof effects.echoFeedback === 'number' ? effects.echoFeedback : 0.4));

    const delays: number[] = [];
    const decays: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const tapDelay = delayMs * i;
      if (tapDelay > 5000) break;
      delays.push(tapDelay);
      const tapGain = 0.6 * Math.pow(feedback, i - 1);
      decays.push(tapGain.toFixed(4));
    }
    echoFilter = `aecho=1.0:1.0:${delays.join('|')}:${decays.join('|')}`;
  }

  // 5. Intelligent Loudness Mastering (Parity with Modern Social Video & Media Player Volume):
  // User volume preference multiplier (default 1.25x / 125%)
  const userVolume = typeof effects.volume === 'number' ? effects.volume : 1.25;
  const userGainDb = 20 * Math.log10(Math.max(0.2, Math.min(3.0, userVolume)));
  
  // Bring the recitation peak to standard -0.5 dB True Peak ceiling
  // (e.g. if original max is -7.7 dB, peakHeadroomDb provides +7.2 dB clean boost)
  const peakHeadroomDb = Math.max(0, -0.5 - metrics.maxVolumeDb);
  const totalGainDb = peakHeadroomDb + userGainDb;

  if (effects.normalizeEnabled) {
    // Dynamic EBU R128 normalization for multi-verse recitations + volume boost + limiter
    postFilters.push(
      'loudnorm=I=-13:TP=-0.5:LRA=9',
      `volume=${Math.max(1.0, userVolume).toFixed(2)}`,
      'alimiter=level_in=1:level_out=1:limit=0.96:attack=5:release=50'
    );
  } else {
    // Studio-grade peak headroom amplification + user volume boost + transparent brickwall limiter
    postFilters.push(
      `volume=${totalGainDb.toFixed(2)}dB`,
      'alimiter=level_in=1:level_out=1:limit=0.96:attack=5:release=50'
    );
  }

  const allFilters = [
    ...preFilters,
    ...(reverbFilter ? [reverbFilter] : []),
    ...(echoFilter ? [echoFilter] : []),
    ...postFilters,
  ];

  const processedAudioPath = path.join(scratchDir, 'audio_track_effects.wav');

  logger.info(`Applying server-side audio mastering filtergraph: ${allFilters.join(', ')}`);

  await runFfmpegCommand([
    '-y',
    '-i', inputAudioPath,
    '-af', allFilters.join(','),
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '2',
    processedAudioPath,
  ]);

  if (fs.existsSync(processedAudioPath)) {
    return processedAudioPath;
  }

  return inputAudioPath;
}

export interface QualityEncodingProfile {
  crf: string;
  preset: string;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  profile: string;
  level: string;
}

export const QUALITY_ENCODING_PROFILES: Record<string, QualityEncodingProfile> = {
  low: {
    crf: '23',
    preset: 'faster',
    maxrate: '2.5M',
    bufsize: '5M',
    audioBitrate: '128k',
    profile: 'main',
    level: '3.1',
  },
  medium: {
    crf: '20',
    preset: 'fast',
    maxrate: '5.5M',
    bufsize: '11M',
    audioBitrate: '192k',
    profile: 'high',
    level: '4.1',
  },
  high: {
    crf: '18',
    preset: 'medium',
    maxrate: '12M',
    bufsize: '24M',
    audioBitrate: '256k',
    profile: 'high',
    level: '4.2',
  },
  ultra: {
    crf: '15',
    preset: 'slow',
    maxrate: '28M',
    bufsize: '56M',
    audioBitrate: '320k',
    profile: 'high',
    level: '5.2',
  },
};

/**
 * Executes full deterministic server-side video rendering:
 * 1. Mathematically renders visual frames at t = frameIndex / fps via headless Chromium
 * 2. Streams frames directly into native FFmpeg pipe
 * 3. Muxes with authentic audio track into broadcast-grade CFR H.264/AAC MP4 with +faststart
 * 4. Probes and validates container and stream integrity
 */
export async function renderDeterministicVideo(
  options: DeterministicRenderOptions
): Promise<DeterministicRenderResult> {
  const { manifest, outputPath, signal, onProgress } = options;

  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('Native FFmpeg executable is missing on server.');
  }

  const randomId = crypto.randomBytes(8).toString('hex');
  const scratchDir = path.join(os.tmpdir(), `render_${randomId}`);
  await fs.promises.mkdir(scratchDir, { recursive: true });

  let frameRenderer: DeterministicFrameRenderer | null = null;
  let ffmpegProc: any = null;

  try {
    // 1. Prepare Audio Track & Background Media
    onProgress?.(1, 0, 0, 'تجهيز المقطع الصوتي والخلفية...');
    const audioTrackPath = await prepareAudioTrack(manifest, scratchDir);
    await prepareBackgroundAsset(manifest, scratchDir);

    if (signal?.aborted) {
      throw new Error('Render cancelled by user.');
    }

    // Measure duration if not specified in manifest
    if (!manifest.audio.durationSeconds || manifest.audio.durationSeconds <= 0) {
      const audioProbe = await probeMediaFile(audioTrackPath);
      if (audioProbe.durationSeconds > 0) {
        manifest.audio.durationSeconds = audioProbe.durationSeconds;
      }
    }

    const fps = manifest.fps || 30;
    const totalFrames = Math.max(1, Math.ceil(manifest.audio.durationSeconds * fps));
    const { width, height } = manifest.outputDimensions;
    const qualityPreset = manifest.qualityPreset || 'high';
    const qualityProfile = QUALITY_ENCODING_PROFILES[qualityPreset] || QUALITY_ENCODING_PROFILES.high;
    const requestedPreset = process.env.RENDER_FFMPEG_PRESET;
    const ffmpegPreset = requestedPreset && /^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|placebo)$/.test(requestedPreset)
      ? requestedPreset
      : qualityProfile.preset;
    const audioBitrate = manifest.audioBitrate || qualityProfile.audioBitrate;
    // See the browser encoder profile: 96 kHz avoids the native AAC
    // per-frame cap that otherwise reduces a requested 320 kbps stream.
    const audioSampleRate = audioBitrate === '320k' ? '96000' : '44100';

    logger.info(
      `Starting deterministic render [${randomId}]: ${totalFrames} frames (${manifest.audio.durationSeconds.toFixed(1)}s at ${fps} fps), resolution: ${width}x${height}, preset: ${qualityPreset} (crf: ${qualityProfile.crf}, encoder: ${ffmpegPreset})`
    );

    onProgress?.(3, 0, totalFrames, 'تهيئة محرك الريندر والترميز...');

    // 2. Configure FFmpeg subprocess with direct frame pipe and quality-specific profile
    const ffmpegArgs = [
      '-y',
      // Video input from image2pipe
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', fps.toString(),
      '-i', 'pipe:0',
      // Audio input
      '-i', audioTrackPath,
      // Explicit stream mapping (video from stream 0, audio from stream 1)
      '-map', '0:v:0',
      '-map', '1:a:0',
      // Video Codec & Profile
      '-c:v', 'libx264',
      '-profile:v', qualityProfile.profile,
      '-level:v', qualityProfile.level,
      '-preset', ffmpegPreset,
      // `0` makes x264 inspect the host CPU count and can spawn dozens of
      // threads inside a small Railway container. Auto-select the cgroup CPU
      // capacity instead so FFmpeg cannot starve Chromium or other jobs.
      '-threads', (() => {
        const configuredThreads = Number.parseInt(process.env.RENDER_FFMPEG_THREADS || '', 10);
        return String(Number.isFinite(configuredThreads) && configuredThreads > 0 ? configuredThreads : availableCpuCores());
      })(),
      '-crf', qualityProfile.crf,
      '-maxrate', qualityProfile.maxrate,
      '-bufsize', qualityProfile.bufsize,
      // Constant Frame Rate
      '-r', fps.toString(),
      '-fps_mode', 'cfr',
      // Keyframe GOP (every 2 seconds)
      '-g', (fps * 2).toString(),
      '-keyint_min', fps.toString(),
      '-sc_threshold', '0',
      // Pixel format
      '-pix_fmt', 'yuv420p',
      // Audio Codec & Quality
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', audioSampleRate,
      '-ac', '2',
      // Faststart for immediate playback & streaming
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '2048',
      '-shortest',
      outputPath,
    ];

    ffmpegProc = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });

    let ffmpegStderr = '';
    ffmpegProc.stderr.on('data', (chunk: Buffer) => {
      ffmpegStderr += chunk.toString();
    });

    let ffmpegRejected = false;
    const ffmpegPromise = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          ffmpegRejected = true;
          logger.error(`FFmpeg render process failed with code ${code}: ${ffmpegStderr}`);
          reject(new Error(`FFmpeg process failed with exit code ${code}`));
        }
      });
      ffmpegProc.on('error', (err: any) => {
        ffmpegRejected = true;
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
      });
    });
    // Prevent unhandled rejection if the loop aborts before ffmpeg completes
    ffmpegPromise.catch(() => {});

    // 3. Initialize Headless Chromium Frame Renderer
    onProgress?.(5, 0, totalFrames, 'بدء محرك الرسم وتجهيز المشهد...');
    frameRenderer = new DeterministicFrameRenderer(manifest);
    await frameRenderer.init();

    // 4. Render and Stream Each Frame Sequentially
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (signal?.aborted) {
        throw new Error('Render cancelled by user.');
      }

      const frameTimeSeconds = frameIndex / fps;
      const frameBuffer = await frameRenderer.renderFrameBuffer(frameIndex, frameTimeSeconds);

      // Write frame into FFmpeg stdin with backpressure support
      const canWriteMore = ffmpegProc.stdin.write(frameBuffer);
      if (!canWriteMore) {
        await new Promise((res) => ffmpegProc.stdin.once('drain', res));
      }

      // Progress reporting (5 - 96%)
      const progressPercent = Math.min(96, Math.max(5, Math.round(5 + ((frameIndex + 1) / totalFrames) * 91)));
      onProgress?.(progressPercent, frameIndex + 1, totalFrames, `توليد الإطارات (${frameIndex + 1}/${totalFrames})`);
    }

    // End stdin pipe to signal FFmpeg to finish encoding
    onProgress?.(97, totalFrames, totalFrames, 'ضغط وترميز الفيديو النهائي (H.264/AAC)...');
    ffmpegProc.stdin.end();

    // 5. Await FFmpeg encoding completion
    await ffmpegPromise;

    // 6. Close frame renderer
    await frameRenderer.close();
    frameRenderer = null;

    // 7. Verify Output with ffprobe
    const probe = await probeMediaFile(outputPath);
    const validation = validateProbeAgainstSpec(probe, fps);
    if (!validation.valid) {
      throw new Error(`Rendered video failed probe validation: ${validation.errors.join(', ')}`);
    }

    const stat = await fs.promises.stat(outputPath);

    logger.info(`✅ Render job [${randomId}] completed successfully: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

    return {
      outputPath,
      fileSizeBytes: stat.size,
      durationSeconds: probe.durationSeconds,
      totalFrames,
      probe,
    };
  } catch (error: any) {
    if (ffmpegProc && ffmpegProc.kill) {
      try {
        ffmpegProc.kill('SIGKILL');
      } catch {
        /* Ignore kill errors during failure unwind */
      }
    }
    if (frameRenderer) {
      await frameRenderer.close().catch(() => {});
    }
    // Remove output file on failure
    if (fs.existsSync(outputPath)) {
      try {
        await fs.promises.unlink(outputPath);
      } catch {
        /* Ignore unlink errors on failure */
      }
    }
    throw error;
  } finally {
    // Guaranteed cleanup of scratch directory
    try {
      if (fs.existsSync(scratchDir)) {
        await fs.promises.rm(scratchDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      logger.warn('Failed to clean scratch directory:', cleanupErr);
    }
  }
}

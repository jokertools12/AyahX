import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createCanvas, loadImage, GlobalFonts, Image } from '@napi-rs/canvas';
import { RenderManifest } from '../models/renderManifest';
import { logger } from '../logger';
import { probeMediaFile, validateProbeAgainstSpec } from './mediaProbeService';
import { prepareAudioTrack, prepareBackgroundAsset, DeterministicRenderOptions, DeterministicRenderResult, extractAyahsAndWords } from './deterministicVideoRenderer';
import { toArabicDigits } from './ffmpegAssRenderer';
import { getFfmpegBinary, getFfmpegPreset, getFfmpegResourceArgs, getFfmpegVideoEncoderArgs } from './ffmpegBinary';

// Ensure standard Arabic fonts are registered into Skia
let fontsRegistered = false;
function ensureSkiaFonts() {
  if (fontsRegistered) return;
  const amiriPath = path.resolve(process.cwd(), 'server/assets/fonts/Amiri-Regular.ttf');
  const notoPath = path.resolve(process.cwd(), 'server/assets/fonts/NotoNaskhArabic-Regular.ttf');

  if (fs.existsSync(amiriPath)) {
    try {
      GlobalFonts.registerFromPath(amiriPath, 'Amiri');
    } catch {
      /* font already registered or platform variant */
    }
  }
  if (fs.existsSync(notoPath)) {
    try {
      GlobalFonts.registerFromPath(notoPath, 'Noto Naskh Arabic');
    } catch {
      /* font already registered or platform variant */
    }
  }
  fontsRegistered = true;
}

/**
 * Draws an Ayah Rosette badge with multiple style options (quran3d, star, diamond, octagon, flower)
 */
function drawAyahBadge(
  ctx: any,
  x: number,
  y: number,
  ayahNum: number | string,
  size: number,
  shape: string = 'quran3d',
  colorScheme: string = 'gold'
) {
  ctx.save();
  ctx.translate(x, y);

  const colors = {
    gold: { primary: '#D4AF37', secondary: '#F5E050', text: '#FFFFFF', border: '#AA820A' },
    emerald: { primary: '#10B981', secondary: '#34D399', text: '#FFFFFF', border: '#059669' },
    silver: { primary: '#9CA3AF', secondary: '#D1D5DB', text: '#FFFFFF', border: '#6B7280' },
  }[colorScheme] || { primary: '#D4AF37', secondary: '#F5E050', text: '#FFFFFF', border: '#AA820A' };

  if (shape === 'quran3d') {
    // 3D Gilded Quranic Bracket / Medallion Style ﴿...﴾
    const metalGrad = ctx.createLinearGradient(-size, -size, size, size);
    metalGrad.addColorStop(0, '#FFE082');
    metalGrad.addColorStop(0.3, '#D4AF37');
    metalGrad.addColorStop(0.6, '#FFF8E1');
    metalGrad.addColorStop(0.85, '#B78727');
    metalGrad.addColorStop(1, '#8C6B1B');

    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = size * 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 12, 5, 0.85)';
    ctx.fill();

    ctx.strokeStyle = metalGrad;
    ctx.lineWidth = size * 0.1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 235, 150, 0.65)';
    ctx.lineWidth = size * 0.04;
    ctx.stroke();

    const arabic = toArabicDigits(ayahNum);
    ctx.font = `bold ${Math.round(size * 1.15)}px "Amiri", "Noto Naskh Arabic", serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(arabic, 0, 1);
    ctx.restore();
    return;
  }

  // Star / Rosette shapes
  ctx.shadowColor = colors.primary;
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = colors.primary;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = size * 0.08;

  ctx.beginPath();
  if (shape === 'star') {
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 === 0 ? size : size * 0.65;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 1.1, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 1.1, 0);
    ctx.closePath();
  } else {
    // Circle fallback
    ctx.arc(0, 0, size, 0, Math.PI * 2);
  }

  ctx.fillStyle = 'rgba(20, 15, 5, 0.85)';
  ctx.fill();
  ctx.stroke();

  const arabic = toArabicDigits(ayahNum);
  ctx.font = `bold ${Math.round(size * 1.05)}px "Amiri", "Noto Naskh Arabic", serif`;
  ctx.fillStyle = colors.secondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 3;
  ctx.fillText(arabic, 0, 1);

  ctx.restore();
}

/**
 * Executes Idea 2: Native Skia/Rust Canvas Engine.
 * Renders pixel-perfect Quran reels frame-by-frame directly in C++ memory
 * streaming uncompressed RGBA frames straight to FFmpeg stdin pipe.
 * NO Chromium, NO Puppeteer, 0 dropped frames, and 100% deterministic!
 */
export async function renderSkiaCanvasVideo(
  options: DeterministicRenderOptions
): Promise<DeterministicRenderResult> {
  const { manifest, outputPath, signal, onProgress } = options;

  const ffmpegPath = getFfmpegBinary();
  if (!ffmpegPath || (path.isAbsolute(ffmpegPath) && !fs.existsSync(ffmpegPath))) {
    throw new Error('Native FFmpeg executable is missing on server.');
  }

  ensureSkiaFonts();

  const randomId = crypto.randomBytes(8).toString('hex');
  const scratchDir = path.join(os.tmpdir(), `render_skia_${randomId}`);
  await fs.promises.mkdir(scratchDir, { recursive: true });

  let ffmpegProc: any = null;

  try {
    onProgress?.(2, 0, 0, 'تجهيز المقطع الصوتي والخلفية...');
    const audioTrackPath = await prepareAudioTrack(manifest, scratchDir);
    await prepareBackgroundAsset(manifest, scratchDir);

    if (signal?.aborted) {
      throw new Error('Render cancelled by user.');
    }

    if (!manifest.audio.durationSeconds || manifest.audio.durationSeconds <= 0) {
      const audioProbe = await probeMediaFile(audioTrackPath);
      if (audioProbe.durationSeconds > 0) {
        manifest.audio.durationSeconds = audioProbe.durationSeconds;
      }
    }

    const { width, height } = manifest.outputDimensions;
    const fps = manifest.fps || 30;
    const totalFrames = Math.max(1, Math.ceil(manifest.audio.durationSeconds * fps));
    const audioBitrate = manifest.audioBitrate || '192k';

    // Load background image if available
    let bgImage: Image | null = null;
    let bgSourcePath = manifest.background.url;
    const matchedPrepared = fs.readdirSync(scratchDir).find((f) => f.startsWith('bg_source'));
    if (matchedPrepared) {
      bgSourcePath = path.join(scratchDir, matchedPrepared);
    }
    if (fs.existsSync(bgSourcePath) && !manifest.background.url.endsWith('.mp4')) {
      try {
        bgImage = await loadImage(bgSourcePath);
      } catch (err: any) {
        logger.warn('Could not load background image into Skia, will use gradient:', err.message);
      }
    }

    // Spawn FFmpeg in rawvideo pipe mode
    const ffmpegArgs = [
      '-y',
      ...getFfmpegResourceArgs(),
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`,
      '-r', fps.toString(),
      '-i', '-',
      '-i', audioTrackPath,
      '-c:v', 'libx264',
      ...getFfmpegVideoEncoderArgs(),
      '-preset', getFfmpegPreset('fast'),
      '-crf', '19',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ];

    logger.info(`Starting Skia Canvas render [${randomId}]: ${width}x${height} @ ${fps}fps (${totalFrames} frames)`);

    ffmpegProc = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true });
    let ffmpegStderr = '';
    let ffmpegInputError: Error | null = null;
    const onFfmpegInputError = (error: Error) => {
      ffmpegInputError = error;
    };
    // A renderer failure closes stdin while the canvas loop may still be
    // writing. Always consume the stream error so EPIPE cannot crash worker.
    ffmpegProc.stdin.on('error', onFfmpegInputError);
    ffmpegProc.stderr.on('data', (d: Buffer) => {
      ffmpegStderr += d.toString();
    });

    const ffmpegExitPromise = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('close', (code: number | null, exitSignal: NodeJS.Signals | null) => {
        if (code === 0) resolve();
        else {
          const termination = code === null ? `signal ${exitSignal || 'unknown'}` : `code ${code}`;
          reject(new Error(`FFmpeg pipe closed with ${termination}: ${ffmpegStderr.slice(-1000)}`));
        }
      });
      ffmpegProc.on('error', (err: any) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
    });

    const onAbort = () => {
      if (ffmpegProc && !ffmpegProc.killed) {
        try { ffmpegProc.kill('SIGKILL'); } catch { /* process may already be closed */ }
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Pre-calculate ayahs & word timelines
    const { ayahs, words } = extractAyahsAndWords(manifest);
    const totalDuration = manifest.audio.durationSeconds;

    const ayahWordGroups = new Map<number, typeof words>();
    for (const w of words) {
      const match = w.canonicalWordKey?.match(/^(\d+):(\d+):/);
      const ayahNum = match ? parseInt(match[2], 10) : ayahs[0]?.numberInSurah;
      if (!ayahWordGroups.has(ayahNum)) {
        ayahWordGroups.set(ayahNum, []);
      }
      ayahWordGroups.get(ayahNum)!.push(w);
    }

    const ayahTimelines: Array<{
      ayah: (typeof ayahs)[0];
      startSec: number;
      endSec: number;
      words: typeof words;
    }> = [];

    let prevEnd = 0;
    for (let i = 0; i < ayahs.length; i++) {
      const ayah = ayahs[i];
      const ayahWords = ayahWordGroups.get(ayah.numberInSurah) || [];
      let startSec = prevEnd;
      let endSec = totalDuration;

      if (ayahWords.length > 0) {
        startSec = Math.max(0, ayahWords[0].startMs / 1000);
        endSec = Math.min(totalDuration, (ayahWords[ayahWords.length - 1].endMs ?? ayahWords[ayahWords.length - 1].startMs + 600) / 1000 + 0.8);
        if (i < ayahs.length - 1) {
          const nextWords = ayahWordGroups.get(ayahs[i + 1].numberInSurah);
          if (nextWords && nextWords.length > 0) {
            endSec = Math.min(endSec, nextWords[0].startMs / 1000);
          }
        }
      } else {
        const dur = totalDuration / ayahs.length;
        startSec = i * dur;
        endSec = (i + 1) * dur;
      }
      prevEnd = endSec;
      ayahTimelines.push({ ayah, startSec, endSec, words: ayahWords });
    }

    const isPortrait = height >= width;
    const fontScale = (manifest.typography?.fontSize && manifest.typography.fontSize > 0)
      ? manifest.typography.fontSize / 28
      : 1.0;
    const baseFontSize = Math.round((isPortrait ? height * 0.038 : height * 0.052) * fontScale);
    const badgeSize = Math.round(baseFontSize * 0.85);
    const fontName = (manifest.typography?.fontFamily && manifest.typography.fontFamily.toLowerCase().includes('noto'))
      ? '"Noto Naskh Arabic", "Amiri", serif'
      : '"Amiri", "Noto Naskh Arabic", serif';
    const defaultTextColor = manifest.typography?.textColor || '#FFFFFF';

    const resolveSkiaGlow = (glowStyle?: string) => {
      switch (glowStyle) {
        case 'emerald': return { activeText: '#34D399', glowColor: '#10B981' };
        case 'neon':
        case 'cyan': return { activeText: '#38BDF8', glowColor: '#0284C7' };
        case 'pure_white':
        case 'white': return { activeText: '#FFFFFF', glowColor: '#CBD5E1' };
        case 'ruby': return { activeText: '#F87171', glowColor: '#DC2626' };
        case 'golden':
        default: return { activeText: '#F5D061', glowColor: '#D4AF37' };
      }
    };
    const skiaGlow = resolveSkiaGlow(manifest.displaySettings?.glowStyle);
    const showAyahText = manifest.displaySettings?.showAyahText !== false;
    const showAyahNumber = manifest.displaySettings?.showAyahNumber !== false;
    const doWordHighlight = manifest.displaySettings?.highlightStyle !== 'none';

    // Frame rendering loop with backpressure control
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (signal?.aborted) {
        ffmpegProc.stdin.destroy();
        throw new Error('Render cancelled by user.');
      }

      const t = frameIndex / fps;

      // 1. Draw Background
      if (bgImage) {
        // Subtle Ken Burns slow zoom
        const zoom = 1.0 + 0.06 * (frameIndex / totalFrames);
        const drawW = width * zoom;
        const drawH = height * zoom;
        const offsetX = (width - drawW) / 2;
        const offsetY = (height - drawH) / 2;
        ctx.drawImage(bgImage, offsetX, offsetY, drawW, drawH);
      } else {
        // Deep elegant Islamic emerald/midnight gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#040E14');
        bgGrad.addColorStop(0.5, '#081C24');
        bgGrad.addColorStop(1, '#02090D');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Dark readability overlay (respects user overlayOpacity slider)
      const overlayAlpha = typeof manifest.background?.overlayOpacity === 'number'
        ? Math.max(0.0, Math.min(0.95, manifest.background.overlayOpacity))
        : 0.42;
      ctx.fillStyle = `rgba(0, 0, 0, ${overlayAlpha.toFixed(2)})`;
      ctx.fillRect(0, 0, width, height);

      // 2. Top Header (Surah name pill & reciter)
      if (manifest.displaySettings?.showSurahName) {
        const surahTitle = `سُورَةُ ${manifest.canonicalAyahRange.surahName.replace(/^سورة\s+/, '')}`;
        ctx.save();
        ctx.font = `bold ${Math.round(baseFontSize * 0.68)}px "Noto Naskh Arabic", "Amiri", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const headerY = Math.round(height * 0.08);

        // Header pill background
        ctx.fillStyle = 'rgba(15, 25, 30, 0.75)';
        ctx.strokeStyle = '#D4AF37';
        ctx.lineWidth = 1.5;
        const metrics = ctx.measureText(surahTitle);
        const pillW = metrics.width + 50;
        const pillH = Math.round(baseFontSize * 1.1);
        ctx.beginPath();
        ctx.roundRect(width / 2 - pillW / 2, headerY - pillH / 2, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#FFE082';
        ctx.shadowColor = '#D4AF37';
        ctx.shadowBlur = 8;
        ctx.fillText(surahTitle, width / 2, headerY);
        ctx.restore();
      }

      if (manifest.displaySettings?.showReciterName) {
        const reciterTitle = `تلاوة: ${manifest.reciter.name}`;
        ctx.save();
        ctx.font = `${Math.round(baseFontSize * 0.48)}px "Noto Naskh Arabic", "Amiri", serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#E0E6ED';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(reciterTitle, width / 2, Math.round(height * 0.135));
        ctx.restore();
      }

      // 3. Find current active Ayah and render if enabled
      const activeTimeline = ayahTimelines.find((at) => t >= at.startSec && t <= at.endSec) || ayahTimelines[0];

      if (showAyahText && activeTimeline) {
        const { ayah, words: ayahWords } = activeTimeline;
        const tokens = ayahWords.length > 0 ? ayahWords.map((w) => w.displayToken) : ayah.text.split(/\s+/);

        // Find active word index at time t
        let activeWordIdx = -1;
        for (let wi = 0; wi < ayahWords.length; wi++) {
          const w = ayahWords[wi];
          const wStart = w.startMs / 1000;
          const nextW = ayahWords[wi + 1];
          const wEnd = nextW ? nextW.startMs / 1000 : (w.endMs ? w.endMs / 1000 : wStart + 0.6);
          if (t >= wStart && t < wEnd) {
            activeWordIdx = wi;
            break;
          }
        }

        // Draw Quran text card with responsive padding
        ctx.save();
        const cardMarginX = Math.round(width * (isPortrait ? 0.08 : 0.16));
        const cardW = width - cardMarginX * 2;
        const cardY = Math.round(height * (isPortrait ? 0.28 : 0.20));
        const cardH = Math.round(height * (isPortrait ? 0.42 : 0.56));

        // Glassmorphic backdrop
        ctx.fillStyle = 'rgba(8, 16, 22, 0.55)';
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cardMarginX, cardY, cardW, cardH, 24);
        ctx.fill();
        ctx.stroke();

        // Measure and wrap lines
        ctx.font = `bold ${baseFontSize}px ${fontName}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const maxLineW = cardW - 60;
        const wordsArr = tokens;
        const linesArr: Array<Array<{ token: string; idx: number }>> = [];
        let currentLine: Array<{ token: string; idx: number }> = [];
        let currentLineW = 0;

        for (let wi = 0; wi < wordsArr.length; wi++) {
          const token = wordsArr[wi];
          const wordW = ctx.measureText(token + ' ').width;
          if (currentLineW + wordW > maxLineW && currentLine.length > 0) {
            linesArr.push(currentLine);
            currentLine = [{ token, idx: wi }];
            currentLineW = wordW;
          } else {
            currentLine.push({ token, idx: wi });
            currentLineW += wordW;
          }
        }
        if (currentLine.length > 0) linesArr.push(currentLine);

        const lineHeight = baseFontSize * 1.7;
        const totalTextH = linesArr.length * lineHeight;
        const startY = cardY + (cardH - totalTextH) / 2 + lineHeight / 2 - (showAyahNumber ? badgeSize * 0.5 : 0);

        // Draw each line RTL
        for (let li = 0; li < linesArr.length; li++) {
          const line = linesArr[li];
          const lineY = startY + li * lineHeight;

          // Compute total line width to center it
          let totalLW = 0;
          for (const item of line) {
            totalLW += ctx.measureText(item.token + ' ').width;
          }

          let curX = width / 2 + totalLW / 2; // Start from right for Arabic RTL
          for (const item of line) {
            const tokenWithSpace = item.token + ' ';
            const tokenW = ctx.measureText(tokenWithSpace).width;
            const itemX = curX - tokenW / 2;

            if (doWordHighlight && item.idx === activeWordIdx) {
              // Active highlight word with customized glow
              ctx.save();
              ctx.fillStyle = skiaGlow.activeText;
              ctx.shadowColor = skiaGlow.glowColor;
              ctx.shadowBlur = 18;
              ctx.fillText(item.token, itemX, lineY);
              ctx.restore();
            } else {
              // Inactive word with user chosen textColor
              ctx.save();
              ctx.fillStyle = defaultTextColor;
              ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
              ctx.shadowBlur = 4;
              ctx.fillText(item.token, itemX, lineY);
              ctx.restore();
            }

            curX -= tokenW;
          }
        }

        // Draw Ayah Rosette Badge at bottom center of card (if enabled)
        if (showAyahNumber) {
          drawAyahBadge(
            ctx,
            width / 2,
            cardY + cardH - badgeSize * 1.15,
            ayah.numberInSurah,
            badgeSize,
            manifest.displaySettings?.ayahNumberStyle || 'quran3d',
            manifest.displaySettings?.ayahNumberColor || 'gold'
          );
        }

        ctx.restore();
      }

      // 4. Bottom Audio Progress Bar
      ctx.save();
      const progressW = width * 0.84;
      const progressH = 5;
      const progressX = (width - progressW) / 2;
      const progressY = height - Math.round(height * 0.08);

      // Track background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.roundRect(progressX, progressY, progressW, progressH, 3);
      ctx.fill();

      // Filled progress
      const progressRatio = Math.min(1, t / totalDuration);
      ctx.fillStyle = '#D4AF37';
      ctx.shadowColor = '#D4AF37';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.roundRect(progressX, progressY, progressW * progressRatio, progressH, 3);
      ctx.fill();
      ctx.restore();

      // Extract raw RGBA buffer from Skia canvas
      const imgData = ctx.getImageData(0, 0, width, height);
      const rawBuffer = Buffer.from(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength);

      // Write to FFmpeg pipe with backpressure handling
      if (ffmpegInputError) {
        throw new Error(`FFmpeg input pipe failed: ${ffmpegInputError.message}`);
      }

      let canWrite = false;
      try {
        canWrite = ffmpegProc.stdin.write(rawBuffer);
      } catch (error: any) {
        throw new Error(`FFmpeg input pipe failed: ${error?.message || String(error)}`);
      }
      if (!canWrite) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            ffmpegProc.stdin.removeListener('drain', onDrain);
            ffmpegProc.stdin.removeListener('error', onError);
            ffmpegProc.stdin.removeListener('close', onClose);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(new Error(`FFmpeg input pipe failed: ${error.message}`));
          };
          const onClose = () => {
            cleanup();
            reject(new Error('FFmpeg input pipe closed before all frames were written.'));
          };
          ffmpegProc.stdin.once('drain', onDrain);
          ffmpegProc.stdin.once('error', onError);
          ffmpegProc.stdin.once('close', onClose);
        });
      }

      if (frameIndex % 30 === 0 || frameIndex === totalFrames - 1) {
        const pct = Math.round((frameIndex / totalFrames) * 94);
        onProgress?.(pct, frameIndex, totalFrames, 'رسم وبث إطارات الفيديو عبر Skia Canvas...');
      }
    }

    // Finish stdin pipe and wait for FFmpeg to finish multiplexing
    onProgress?.(96, totalFrames, totalFrames, 'إنهاء ترميز ملف الفيديو MP4...');
    ffmpegProc.stdin.end();

    await ffmpegExitPromise;

    signal?.removeEventListener('abort', onAbort);

    onProgress?.(99, totalFrames, totalFrames, 'التحقق من سلامة الفيديو...');
    const probe = await probeMediaFile(outputPath);
    const validation = validateProbeAgainstSpec(probe, fps);
    if (!validation.valid) {
      throw new Error(`Rendered Skia video failed probe validation: ${validation.errors.join(', ')}`);
    }

    const stat = await fs.promises.stat(outputPath);
    logger.info(`✅ Skia Canvas Render [${randomId}] completed successfully: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

    return {
      outputPath,
      fileSizeBytes: stat.size,
      durationSeconds: probe.durationSeconds,
      totalFrames,
      probe,
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && /cancel|abort|الغاء/i.test(err.message))) {
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch {
          // The failed FFmpeg process may still hold the output handle.
        }
      }
    }
    throw err;
  } finally {
    if (ffmpegProc && ffmpegProc.kill && !ffmpegProc.killed) {
      try {
        ffmpegProc.kill('SIGKILL');
      } catch {
        /* ignore kill error */
      }
    }
    try {
      if (fs.existsSync(scratchDir)) {
        await fs.promises.rm(scratchDir, { recursive: true, force: true });
      }
    } catch (e: any) {
      logger.warn('Failed cleaning scratchDir for Skia render:', e.message);
    }
  }
}

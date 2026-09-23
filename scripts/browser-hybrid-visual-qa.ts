import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import ffmpegPath from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';
import { resolveChromiumExecutablePath } from '../server/renderer/frameRenderer';
import { probeMediaFile } from '../server/services/mediaProbeService';
import { renderDeterministicVideo } from '../server/services/deterministicVideoRenderer';

/**
 * End-to-end Browser Hybrid proof:
 *
 *  1. Render a scene with the same public/render-harness.html controller used
 *     by Browser Cloud.
 *  2. Capture the controller's full-resolution canvas with a real MediaRecorder
 *     and a real audio MediaStream track.
 *  3. Transcode the captured WebM to the production MP4 contract.
 *  4. Render the same manifest with Browser Cloud and compare the pixels.
 *
 * This deliberately exercises the browser capture path instead of merely
 * asserting that React mounted or that a server renderer returned SUCCESS.
 */

const outputDir = path.resolve(process.cwd(), 'qa-output/browser-hybrid');
const harnessPath = path.resolve(process.cwd(), 'public/render-harness.html');
const audioPath = path.join(os.tmpdir(), `ayahx-browser-hybrid-qa-${process.pid}.m4a`);
const fps = 30;
const durationSeconds = 1.6;
const width = 720;
const height = 1280;

const manifest: any = {
  schemaVersion: '1.0.0',
  rendererVersion: '1.0.0',
  revision: 'browser-hybrid-visual-qa',
  aspectRatio: '9:16',
  outputDimensions: { width, height },
  fps,
  qualityPreset: 'medium',
  audioBitrate: '192k',
  codecProfile: 'high-4.1',
  reciter: { id: 'qa', name: 'مشاري راشد العفاسي' },
  canonicalAyahRange: {
    surahNumber: 1,
    surahName: 'الفاتحة',
    startAyah: 1,
    endAyah: 1,
    ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ' }],
  },
  timingMap: {
    mapId: 'browser-hybrid-visual-qa-map',
    sourceId: 'quran_foundation',
    sourceMethod: 'quran_foundation_segments',
    audioContentHash: 'browser-hybrid-visual-qa-audio',
    validationStatus: 'approved',
    words: [
      { canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 450, confidence: 1 },
      { canonicalWordKey: '1:1:2', displayWordIndex: 1, displayToken: 'اللَّهِ', startMs: 450, endMs: 950, confidence: 1 },
      { canonicalWordKey: '1:1:3', displayWordIndex: 2, displayToken: 'الرَّحْمَٰنِ', startMs: 950, endMs: 1450, confidence: 1 },
    ],
    gaps: [],
  },
  audio: {
    sourceMode: 'single_url',
    audioUrl: audioPath,
    audioContentHash: 'browser-hybrid-visual-qa-audio',
    durationSeconds,
  },
  background: {
    id: 'qa-color',
    type: 'color',
    url: '#162B3A',
    overlayOpacity: 0.25,
    shadowIntensity: 0.5,
    motionSpeed: 3,
  },
  typography: {
    fontFamily: 'Amiri',
    fontSize: 32,
    textColor: '#FFF7E6',
    shadowIntensity: 0.35,
    overlayOpacity: 0.42,
  },
  displaySettings: {
    visualDesign: 'moonlit',
    showSurahName: true,
    showReciterName: true,
    showAyahText: true,
    showAyahNumber: true,
    highlightStyle: 'glow',
    frameStyle: 'ornate',
    screenBorderStyle: 'goldenTrim',
    screenBorderColor: 'gold',
    ayahNumberStyle: 'quran3d',
    ayahNumberColor: 'gold',
    verseDisplayMode: 'full',
    surahNamePosition: 'top',
    surahNameStyle: 'ornate',
    reciterNameStyle: 'pill',
    textShadowStyle: 'glow',
    ayahTransition: 'cinematic',
    watermarkEnabled: true,
    watermarkText: '@AyaX',
    watermarkPosition: 'bottomRight',
    socialWatermarkEnabled: true,
    socialPlatform: 'youtube',
    socialHandle: '@AyaX',
    socialWatermarkPosition: 'bottomCenter',
    socialWatermarkSize: 18,
    socialWatermarkOpacity: 0.9,
    glowStyle: 'golden',
    slideshowTransition: 'crossfade',
    logoWatermarkEnabled: false,
  },
  outputFormat: 'mp4',
};

function runFfmpeg(args: string[], label: string): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not provide a binary');
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function captureHybridWebm(
  sceneManifest: any = manifest,
  outputStem = 'hybrid',
): Promise<{
  path: string;
  sourceFramePath: string;
  mimeType: string;
  frameCount: number;
  audioTracks: number;
  videoBackgroundStatus: string | null;
}> {
  const executablePath = resolveChromiumExecutablePath();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 120_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(harnessPath).href, { waitUntil: 'load' });
    const captureInput = JSON.stringify({ sceneManifest, sceneDuration: durationSeconds, sceneFps: fps });
    // Pass a plain JavaScript expression to Chromium. tsx annotates nested
    // callbacks with its __name helper; serializing the browser program avoids
    // leaking that Node-only helper into the page context.
    const captureSource = `(async () => {
      const { sceneManifest, sceneDuration, sceneFps } = ${captureInput};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const canvas = document.createElement('canvas');
      canvas.width = sceneManifest.outputDimensions.width;
      canvas.height = sceneManifest.outputDimensions.height;
      document.body.appendChild(canvas);

      const factory = window.__CREATE_RENDER_CONTROLLER__;
      if (typeof factory !== 'function') throw new Error('Hybrid harness factory was not exposed');
      const controller = factory(canvas);
      await controller.initScene(sceneManifest);
      const videoBackgroundStatus = typeof controller.getVideoBackgroundStatus === 'function'
        ? controller.getVideoBackgroundStatus()
        : null;

      const canvasStream = canvas.captureStream(0);
      const videoTrack = canvasStream.getVideoTracks()[0];
      const audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(destination);
      oscillator.start();

      const combinedStream = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
      const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || 'video/webm';
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4000000, audioBitsPerSecond: 192000 });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = () => resolve(); });

      recorder.start(250);
      const frameCount = Math.ceil(sceneDuration * sceneFps);
      let sourceFramePng = '';
      for (let frame = 0; frame < frameCount; frame += 1) {
        const frameTime = frame / sceneFps;
        await controller.renderFrame(frame, frameTime);
        videoTrack.requestFrame();
        if (frame === Math.floor(0.8 * sceneFps)) sourceFramePng = canvas.toDataURL('image/png');
        await sleep(1000 / sceneFps);
      }
      await sleep(180);
      oscillator.stop();
      recorder.stop();
      await stopped;
      await audioContext.close();

      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      }
      return {
        base64: btoa(binary),
        sourceFramePng,
        mimeType,
        frameCount,
        audioTracks: combinedStream.getAudioTracks().length,
        videoBackgroundStatus,
      };
    })()`;
    const capture = await page.evaluate(captureSource);

    const webmPath = path.join(outputDir, `${outputStem}.webm`);
    fs.writeFileSync(webmPath, Buffer.from(capture.base64, 'base64'));
    const sourceFramePath = path.join(outputDir, `${outputStem}-source-frame.png`);
    fs.writeFileSync(sourceFramePath, Buffer.from(capture.sourceFramePng.split(',')[1], 'base64'));
    return {
      path: webmPath,
      sourceFramePath,
      mimeType: capture.mimeType,
      frameCount: capture.frameCount,
      audioTracks: capture.audioTracks,
      videoBackgroundStatus: capture.videoBackgroundStatus,
    };
  } finally {
    await browser.close();
  }
}

function extractFrame(inputPath: string, outputPath: string): void {
  runFfmpeg(['-y', '-ss', '0.8', '-i', inputPath, '-frames:v', '1', '-vf', `scale=${width}:${height}`, outputPath], `frame extraction for ${inputPath}`);
}

try {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSeconds}`, '-c:a', 'aac', '-ar', '44100', audioPath], 'QA audio generation');

  const hybrid = await captureHybridWebm();
  const hybridMp4Path = path.join(outputDir, 'hybrid.mp4');
  runFfmpeg([
    '-y', '-i', hybrid.path,
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.1', '-preset', 'veryfast',
    '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv', '-r', String(fps), '-vsync', 'cfr',
    '-g', String(fps * 2), '-keyint_min', String(fps), '-crf', '20',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', hybridMp4Path,
  ], 'Browser Hybrid MP4 transcode');

  const cloudPath = path.join(outputDir, 'browser-cloud.mp4');
  await renderDeterministicVideo({
    manifest: { ...manifest, renderEngine: 'browser_cloud' },
    audioFilePath: audioPath,
    outputPath: cloudPath,
  });

  const hybridFramePath = path.join(outputDir, 'hybrid-frame.png');
  const cloudFramePath = path.join(outputDir, 'browser-cloud-frame.png');
  const comparisonPath = path.join(outputDir, 'comparison.png');
  extractFrame(hybridMp4Path, hybridFramePath);
  extractFrame(cloudPath, cloudFramePath);
  runFfmpeg(['-y', '-i', hybrid.sourceFramePath, '-i', cloudFramePath, '-i', hybridFramePath, '-filter_complex', 'hstack=inputs=3', comparisonPath], 'hybrid/cloud comparison sheet');

  const measureSsim = (leftPath: string, rightPath: string): number | null => {
    const result = spawnSync(ffmpegPath!, [
      '-i', leftPath, '-i', rightPath, '-lavfi', 'ssim', '-f', 'null', '-',
    ], { encoding: 'utf8', windowsHide: true });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/All:([0-9.]+)/);
    return match ? Number(match[1]) : null;
  };
  // Source-vs-cloud is the fidelity gate; recorded-vs-source is a codec sanity
  // signal and is reported separately because color-range conversion can vary
  // by browser/ffmpeg build without changing scene geometry or typography.
  const sourceCloudSsim = measureSsim(hybrid.sourceFramePath, cloudFramePath);
  const recordedSourceSsim = measureSsim(hybridFramePath, hybrid.sourceFramePath);

  const hybridProbe = await probeMediaFile(hybrid.path);
  const hybridMp4Probe = await probeMediaFile(hybridMp4Path);
  const cloudProbe = await probeMediaFile(cloudPath);
  if (hybrid.frameCount < Math.ceil(durationSeconds * fps * 0.9)) throw new Error(`Hybrid rendered too few frames: ${hybrid.frameCount}`);
  if (hybrid.audioTracks !== 1) throw new Error(`Hybrid capture did not contain one audio track: ${hybrid.audioTracks}`);
  if (!hybridMp4Probe.video || hybridMp4Probe.video.width !== width || hybridMp4Probe.video.height !== height) {
    throw new Error(`Hybrid MP4 dimensions are wrong: ${JSON.stringify(hybridMp4Probe.video)}`);
  }
  if (!hybridMp4Probe.audio || hybridMp4Probe.audio.durationSeconds < 1) throw new Error('Hybrid MP4 has no usable audio track');
  if (!cloudProbe.video || cloudProbe.video.width !== width || cloudProbe.video.height !== height) throw new Error('Browser Cloud dimensions are wrong');
  if (sourceCloudSsim === null || sourceCloudSsim < 0.95) throw new Error(`Hybrid/cloud scene similarity is too low or unavailable: ${sourceCloudSsim}`);

  // Exercise the browser-only direct-media branch as well. Production workers
  // receive an extracted framesPattern, while the live preview/recorder gets
  // the original video URL and must keep decoding it on the same frame clock.
  const videoFixturePath = path.join(os.tmpdir(), `ayahx-browser-hybrid-video-${process.pid}.mp4`);
  try {
    runFfmpeg([
      '-y', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSeconds}`,
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFixturePath,
    ], 'direct video fixture generation');
    const directVideoManifest = {
      ...manifest,
      revision: 'browser-hybrid-direct-video-qa',
      background: {
        ...manifest.background,
        type: 'video',
        url: pathToFileURL(videoFixturePath).href,
        thumbnail: '',
        framesPattern: undefined,
      },
    };
    const directVideoCapture = await captureHybridWebm(directVideoManifest, 'hybrid-direct-video');
    if (directVideoCapture.videoBackgroundStatus !== 'direct') {
      throw new Error(`Direct browser video did not load through the media path: ${directVideoCapture.videoBackgroundStatus}`);
    }
    if (directVideoCapture.frameCount < Math.ceil(durationSeconds * fps * 0.9)) {
      throw new Error(`Direct video capture rendered too few frames: ${directVideoCapture.frameCount}`);
    }
    console.log(JSON.stringify({
      directVideo: {
        status: directVideoCapture.videoBackgroundStatus,
        frameCount: directVideoCapture.frameCount,
        webm: directVideoCapture.path,
      },
    }));
  } finally {
    fs.rmSync(videoFixturePath, { force: true });
  }

  console.log(JSON.stringify({
    hybrid: { ...hybrid, webm: hybrid.path, probe: hybridProbe },
    hybridMp4: { path: hybridMp4Path, probe: hybridMp4Probe },
    browserCloud: { path: cloudPath, probe: cloudProbe },
    comparison: { frame: 0.8, sourceCloudSsim, recordedSourceSsim, image: comparisonPath },
  }, null, 2));
} finally {
  fs.rmSync(audioPath, { force: true });
}

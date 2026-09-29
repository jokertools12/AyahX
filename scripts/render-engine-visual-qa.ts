import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { renderFfmpegAssVideo } from '../server/services/ffmpegAssRenderer';
import { renderSkiaCanvasVideo } from '../server/services/skiaCanvasRenderer';
import { renderDeterministicVideo } from '../server/services/deterministicVideoRenderer';
import { probeMediaFile } from '../server/services/mediaProbeService';

const defaultRunId = new Date().toISOString().replace(/[:.]/g, '-');
const configuredOutputDir = process.env.AYAHX_RENDER_QA_OUTPUT_DIR?.trim();
const outputDir = path.resolve(
  configuredOutputDir || path.join('qa-output', `render-engines-${defaultRunId}`),
);
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
  throw new Error(`Refusing to overwrite non-empty render QA output directory: ${outputDir}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const audioPath = path.join(os.tmpdir(), `ayahx-engine-qa-${process.pid}.m4a`);
spawnSync(ffmpegPath!, [
  '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.6',
  '-c:a', 'aac', '-ar', '44100', audioPath,
], { stdio: 'inherit' });

const baseManifest: any = {
  schemaVersion: '1.0.0', rendererVersion: '1.0.0', revision: 'visual-qa',
  aspectRatio: '9:16', outputDimensions: { width: 720, height: 1280 }, fps: 30,
  qualityPreset: 'high', audioBitrate: '192k', codecProfile: 'high-4.1',
  reciter: { id: 'qa', name: 'مشاري راشد العفاسي' },
  canonicalAyahRange: {
    surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 1,
    ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ' }],
  },
  timingMap: {
    mapId: 'visual-qa-map', audioContentHash: 'visual-qa-audio', validationStatus: 'approved',
    sourceId: 'quran_foundation', createdAt: new Date().toISOString(),
    alignment: { provider: 'quran_foundation', providerVersion: 'visual-qa-only' },
    words: [
      { canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 450, confidence: 1 },
      { canonicalWordKey: '1:1:2', displayWordIndex: 1, displayToken: 'اللَّهِ', startMs: 450, endMs: 950, confidence: 1 },
      { canonicalWordKey: '1:1:3', displayWordIndex: 2, displayToken: 'الرَّحْمَٰنِ', startMs: 950, endMs: 1450, confidence: 1 },
    ],
    gaps: [],
  },
  audio: { sourceMode: 'single_url', audioUrl: audioPath, audioContentHash: 'visual-qa-audio', durationSeconds: 1.6 },
  background: { id: 'qa-color', type: 'color', url: '#162B3A', overlayOpacity: 0.25, shadowIntensity: 0.5, motionSpeed: 3 },
  typography: { fontFamily: 'Amiri', fontSize: 32, textColor: '#FFF7E6', shadowIntensity: 0.35, overlayOpacity: 0.42 },
  displaySettings: {
    visualDesign: 'moonlit', showSurahName: true, showReciterName: true, showAyahText: true, showAyahNumber: true,
    highlightStyle: 'glow', frameStyle: 'ornate', screenBorderStyle: 'goldenTrim', screenBorderColor: 'gold',
    ayahNumberStyle: 'quran3d', ayahNumberColor: 'gold', verseDisplayMode: 'full', surahNamePosition: 'top',
    surahNameStyle: 'ornate', reciterNameStyle: 'pill', textShadowStyle: 'glow', ayahTransition: 'cinematic',
    watermarkEnabled: true, watermarkText: '@AyaX', watermarkPosition: 'bottomRight', socialWatermarkEnabled: true,
    socialPlatform: 'youtube', socialHandle: '@AyaX', socialWatermarkPosition: 'bottomCenter', socialWatermarkSize: 18,
    socialWatermarkOpacity: 0.9, glowStyle: 'golden', slideshowTransition: 'crossfade', logoWatermarkEnabled: false,
  },
  outputFormat: 'mp4',
};

const engines = [
  ['ffmpeg', 'ffmpeg_ass', renderFfmpegAssVideo],
  ['skia', 'skia_canvas', renderSkiaCanvasVideo],
  ['browser', 'browser_cloud', renderDeterministicVideo],
] as const;

const rendered: { name: string; videoPath: string; framePath: string }[] = [];

function measureSsim(leftPath: string, rightPath: string): number | null {
  const result = spawnSync(ffmpegPath!, [
    '-i', leftPath, '-i', rightPath, '-lavfi', 'ssim', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/All:([0-9.]+)/);
  return match ? Number(match[1]) : null;
}

try {
  for (const [name, renderEngine, render] of engines) {
    const outputPath = path.join(outputDir, `${name}.mp4`);
    await render({ manifest: { ...baseManifest, renderEngine }, audioFilePath: audioPath, outputPath });
    const framePath = path.join(outputDir, `${name}-frame.jpg`);
    const extraction = spawnSync(ffmpegPath!, [
      '-y', '-ss', '0.8', '-i', outputPath, '-frames:v', '1', '-q:v', '2', framePath,
    ], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`Could not extract ${name} QA frame: ${extraction.stderr}`);
    rendered.push({ name, videoPath: outputPath, framePath });
    console.log(JSON.stringify({ engine: name, video: outputPath, frame: framePath }));
  }

  // Keep one visual artifact and objective pairwise parity metrics alongside
  // the three independently encoded MP4s.
  const comparisonPath = path.join(outputDir, 'comparison.jpg');
  const sheet = spawnSync(ffmpegPath!, [
    '-y', '-i', rendered[0].framePath, '-i', rendered[1].framePath, '-i', rendered[2].framePath,
    '-filter_complex', 'hstack=inputs=3', '-frames:v', '1', comparisonPath,
  ], { encoding: 'utf8' });
  if (sheet.status !== 0) throw new Error(`Could not create engine comparison sheet: ${sheet.stderr}`);

  const metrics: Record<string, number | null> = {};
  for (let i = 0; i < rendered.length; i += 1) {
    const probe = await probeMediaFile(rendered[i].videoPath);
    if (!probe.video || probe.video.width !== 720 || probe.video.height !== 1280 || probe.video.codec !== 'h264') {
      throw new Error(`Invalid ${rendered[i].name} QA output: ${JSON.stringify(probe.video)}`);
    }
    for (let j = i + 1; j < rendered.length; j += 1) {
      metrics[`${rendered[i].name}_vs_${rendered[j].name}`] = measureSsim(rendered[i].framePath, rendered[j].framePath);
    }
  }
  if (Object.values(metrics).some((value) => value === null || value < 0.95)) {
    throw new Error(`Engine visual parity is below threshold: ${JSON.stringify(metrics)}`);
  }
  console.log(JSON.stringify({ comparison: comparisonPath, ssim: metrics }));

  // Ibtahalat uses the same scene shell and output clock, but replaces Quran
  // word spans with timed lyric lines. Keep it in this three-engine gate so a
  // browser-preview-only overlay cannot drift from FFmpeg or Skia output.
  const lyricsManifest: any = {
    ...baseManifest,
    revision: 'visual-qa-lyrics',
    contentKind: 'lyrics',
    lyrics: [
      { text: 'يا رب صل على النبي', start: 0, end: 0.5 },
      { text: 'خير الأنام محمد', start: 0.5, end: 1.0 },
      { text: 'واجعل لنا في القلب نورا', start: 1.0, end: 1.6 },
    ],
    displaySettings: {
      ...baseManifest.displaySettings,
      lyricsDisplayStyle: 'scroll',
      showAyahText: true,
    },
  };
  const renderedLyrics: { name: string; videoPath: string; framePath: string }[] = [];
  for (const [name, renderEngine, render] of engines) {
    const outputPath = path.join(outputDir, `lyrics-${name}.mp4`);
    await render({ manifest: { ...lyricsManifest, renderEngine }, audioFilePath: audioPath, outputPath });
    const framePath = path.join(outputDir, `lyrics-${name}-frame.jpg`);
    const extraction = spawnSync(ffmpegPath!, [
      '-y', '-ss', '0.8', '-i', outputPath, '-frames:v', '1', '-q:v', '2', framePath,
    ], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`Could not extract lyrics ${name} QA frame: ${extraction.stderr}`);
    renderedLyrics.push({ name, videoPath: outputPath, framePath });
  }
  const lyricsComparisonPath = path.join(outputDir, 'lyrics-comparison.jpg');
  const lyricsSheet = spawnSync(ffmpegPath!, [
    '-y', '-i', renderedLyrics[0].framePath, '-i', renderedLyrics[1].framePath, '-i', renderedLyrics[2].framePath,
    '-filter_complex', 'hstack=inputs=3', '-frames:v', '1', lyricsComparisonPath,
  ], { encoding: 'utf8' });
  if (lyricsSheet.status !== 0) throw new Error(`Could not create lyrics comparison sheet: ${lyricsSheet.stderr}`);
  const lyricsMetrics: Record<string, number | null> = {};
  for (let i = 0; i < renderedLyrics.length; i += 1) {
    const probe = await probeMediaFile(renderedLyrics[i].videoPath);
    if (!probe.video || probe.video.width !== 720 || probe.video.height !== 1280 || probe.video.codec !== 'h264') {
      throw new Error(`Invalid lyrics ${renderedLyrics[i].name} QA output: ${JSON.stringify(probe.video)}`);
    }
    for (let j = i + 1; j < renderedLyrics.length; j += 1) {
      lyricsMetrics[`${renderedLyrics[i].name}_vs_${renderedLyrics[j].name}`] = measureSsim(renderedLyrics[i].framePath, renderedLyrics[j].framePath);
    }
  }
  if (Object.values(lyricsMetrics).some((value) => value === null || value < 0.95)) {
    throw new Error(`Lyrics engine visual parity is below threshold: ${JSON.stringify(lyricsMetrics)}`);
  }
  console.log(JSON.stringify({ lyricsComparison: lyricsComparisonPath, lyricsSsim: lyricsMetrics }));
} finally {
  fs.rmSync(audioPath, { force: true });
}

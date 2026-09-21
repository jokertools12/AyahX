import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { renderFfmpegAssVideo } from '../server/services/ffmpegAssRenderer';
import { renderSkiaCanvasVideo } from '../server/services/skiaCanvasRenderer';
import { renderDeterministicVideo } from '../server/services/deterministicVideoRenderer';

const outputDir = path.resolve(process.cwd(), 'qa-output/render-engines');
fs.rmSync(outputDir, { recursive: true, force: true });
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

try {
  for (const [name, renderEngine, render] of engines) {
    const outputPath = path.join(outputDir, `${name}.mp4`);
    await render({ manifest: { ...baseManifest, renderEngine }, audioFilePath: audioPath, outputPath });
    const framePath = path.join(outputDir, `${name}-frame.jpg`);
    const extraction = spawnSync(ffmpegPath!, [
      '-y', '-ss', '0.8', '-i', outputPath, '-frames:v', '1', '-q:v', '2', framePath,
    ], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(`Could not extract ${name} QA frame: ${extraction.stderr}`);
    console.log(JSON.stringify({ engine: name, video: outputPath, frame: framePath }));
  }
} finally {
  fs.rmSync(audioPath, { force: true });
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { renderFfmpegAssVideo } from '../../server/services/ffmpegAssRenderer';
import { renderSkiaCanvasVideo } from '../../server/services/skiaCanvasRenderer';
import { renderDeterministicVideo } from '../../server/services/deterministicVideoRenderer';
import { probeMediaFile } from '../../server/services/mediaProbeService';
import type { RenderManifest } from '../../server/models/renderManifest';

describe('Multi-Engine Settings Matrix & Verification Test', () => {
  let tempDir: string;
  let sampleAudioPath: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine_matrix_test_'));
    // Generate a quick 1-second sine wave audio test file
    sampleAudioPath = path.join(tempDir, 'tone.m4a');
    spawnSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1.2',
      '-c:a', 'aac',
      '-ar', '44100',
      sampleAudioPath,
    ]);
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on windows
    }
  });

  const getBaseManifest = (): RenderManifest => ({
    outputDimensions: { width: 720, height: 1280 },
    fps: 30,
    aspectRatio: '9:16',
    canonicalAyahRange: {
      surahNumber: 1,
      surahName: 'الفاتحة',
      startAyah: 1,
      endAyah: 1,
    },
    audio: {
      sourceMode: 'single_url',
      audioUrl: sampleAudioPath,
      audioContentHash: 'hash_test_mishari_1',
      durationSeconds: 1.0,
    },
    reciter: {
      id: 'mishari',
      name: 'مشاري راشد العفاسي',
    },
    ayahTimings: [
      {
        surahNumber: 1,
        ayahNumber: 1,
        startMs: 0,
        endMs: 1000,
        words: [
          { text: 'بِسْمِ', displayToken: 'بِسْمِ', startMs: 0, endMs: 300 },
          { text: 'اللَّهِ', displayToken: 'اللَّهِ', startMs: 300, endMs: 650 },
          { text: 'الرَّحْمَٰنِ', displayToken: 'الرَّحْمَٰنِ', startMs: 650, endMs: 1000 },
        ],
      },
    ],
    typography: {
      fontFamily: 'Amiri',
      fontSize: 32,
      textColor: '#FFFFFF',
      shadowIntensity: 0.5,
      overlayOpacity: 0.4,
    },
    background: {
      id: 'bg_dark',
      type: 'color',
      url: '#09151E',
      overlayOpacity: 0.5,
      shadowIntensity: 0.5,
      motionSpeed: 3,
    },
    displaySettings: {
      glowStyle: 'golden',
      highlightStyle: 'glow',
      showSurahName: true,
      showReciterName: true,
      showAyahText: true,
      showAyahNumber: true,
      ayahNumberStyle: 'quran3d',
      ayahNumberColor: 'gold',
    },
  });

  it('Engine 1 (FFmpeg ASS): Renders 9:16 Portrait with custom font scale, golden glow, and full headers', async () => {
    const outputPath = path.join(tempDir, 'engine1_portrait_golden.mp4');
    const manifest: RenderManifest = {
      ...getBaseManifest(),
      outputDimensions: { width: 720, height: 1280 },
      typography: {
        fontFamily: 'Amiri',
        fontSize: 36, // Scaled font
        textColor: '#FFF9E6',
        shadowIntensity: 0.6,
        overlayOpacity: 0.4,
      },
      displaySettings: {
        ...getBaseManifest().displaySettings,
        glowStyle: 'golden',
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
      },
    };

    const result = await renderFfmpegAssVideo({
      manifest,
      audioFilePath: sampleAudioPath,
      outputPath,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(1000);

    const probe = await probeMediaFile(outputPath);
    expect(probe.video?.width).toBe(720);
    expect(probe.video?.height).toBe(1280);
    expect(probe.video?.codec).toBe('h264');
    expect(probe.audio?.codec).toBe('aac');
  }, 30000);

  it('Engine 1 (FFmpeg ASS): Renders 16:9 Landscape with Noto font, emerald glow, and solid background', async () => {
    const outputPath = path.join(tempDir, 'engine1_landscape_emerald.mp4');
    const manifest: RenderManifest = {
      ...getBaseManifest(),
      outputDimensions: { width: 1280, height: 720 },
      aspectRatio: '16:9',
      typography: {
        fontFamily: 'Noto Naskh Arabic',
        fontSize: 28,
        textColor: '#E6FFF5',
        shadowIntensity: 0.5,
        overlayOpacity: 0.4,
      },
      background: {
        id: 'bg_emerald',
        type: 'color',
        url: '#062016',
        overlayOpacity: 0.65,
        shadowIntensity: 0.5,
        motionSpeed: 3,
      },
      displaySettings: {
        ...getBaseManifest().displaySettings,
        glowStyle: 'emerald',
        showSurahName: true,
        showReciterName: false,
        showAyahNumber: false, // Clean text without bracket
        highlightStyle: 'none', // Full verse display without word jumps
      },
    };

    const result = await renderFfmpegAssVideo({
      manifest,
      audioFilePath: sampleAudioPath,
      outputPath,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const probe = await probeMediaFile(outputPath);
    expect(probe.video?.width).toBe(1280);
    expect(probe.video?.height).toBe(720);
  }, 30000);

  it('Engine 2 (Skia Canvas): Renders 9:16 Portrait with rosette medal, cyan glow, and word highlighting', async () => {
    const outputPath = path.join(tempDir, 'engine2_portrait_cyan.mp4');
    const manifest: RenderManifest = {
      ...getBaseManifest(),
      outputDimensions: { width: 720, height: 1280 },
      displaySettings: {
        ...getBaseManifest().displaySettings,
        glowStyle: 'neon',
        highlightStyle: 'glow',
        ayahNumberStyle: 'quran3d',
        ayahNumberColor: 'royal',
      },
    };

    const result = await renderSkiaCanvasVideo({
      manifest,
      audioFilePath: sampleAudioPath,
      outputPath,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(1000);

    const probe = await probeMediaFile(outputPath);
    expect(probe.video?.width).toBe(720);
    expect(probe.video?.height).toBe(1280);
    expect(probe.video?.codec).toBe('h264');
  }, 30000);

  it('Engine 2 (Skia Canvas): Renders 16:9 Landscape with ruby glow, custom card padding, and dark overlay', async () => {
    const outputPath = path.join(tempDir, 'engine2_landscape_ruby.mp4');
    const manifest: RenderManifest = {
      ...getBaseManifest(),
      outputDimensions: { width: 1280, height: 720 },
      aspectRatio: '16:9',
      typography: {
        fontFamily: 'Noto Naskh Arabic',
        fontSize: 30,
        textColor: '#FFFFFF',
        shadowIntensity: 0.5,
        overlayOpacity: 0.4,
      },
      background: {
        id: 'bg_ruby',
        type: 'color',
        url: '#1F0B0B',
        overlayOpacity: 0.7,
        shadowIntensity: 0.5,
        motionSpeed: 3,
      },
      displaySettings: {
        ...getBaseManifest().displaySettings,
        glowStyle: 'pulse',
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
      },
    };

    const result = await renderSkiaCanvasVideo({
      manifest,
      audioFilePath: sampleAudioPath,
      outputPath,
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const probe = await probeMediaFile(outputPath);
    expect(probe.video?.width).toBe(1280);
    expect(probe.video?.height).toBe(720);
  }, 30000);

  it('Dispatcher: Correctly routes between Engine 1 and Engine 2 based on manifest.renderEngine', async () => {
    const assOutputPath = path.join(tempDir, 'dispatcher_ass.mp4');
    const skiaOutputPath = path.join(tempDir, 'dispatcher_skia.mp4');

    const assManifest = {
      ...getBaseManifest(),
      renderEngine: 'ffmpeg_ass' as const,
    };

    const skiaManifest = {
      ...getBaseManifest(),
      renderEngine: 'skia_canvas' as const,
    };

    const assResult = await renderDeterministicVideo({
      manifest: assManifest,
      audioFilePath: sampleAudioPath,
      outputPath: assOutputPath,
    });

    const skiaResult = await renderDeterministicVideo({
      manifest: skiaManifest,
      audioFilePath: sampleAudioPath,
      outputPath: skiaOutputPath,
    });

    expect(fs.existsSync(assResult.outputPath)).toBe(true);
    expect(fs.existsSync(skiaResult.outputPath)).toBe(true);
    expect(assResult.fileSizeBytes).toBeGreaterThan(1000);
    expect(skiaResult.fileSizeBytes).toBeGreaterThan(1000);
  }, 30000);
});

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
  let sampleImagePath: string;

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
    sampleImagePath = path.join(tempDir, 'background.png');
    fs.writeFileSync(sampleImagePath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9JQAAAABJRU5ErkJggg==',
      'base64',
    ));
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
      ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ' }],
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
    timingMap: {
      mapId: 'engine-matrix-map',
      sourceId: 'verified_dataset',
      sourceMethod: 'verified_dataset',
      audioContentHash: 'hash_test_mishari_1',
      validationStatus: 'approved',
      alignment: {
        provider: 'verified_dataset',
        requestedGranularity: 'word',
        availableGranularities: ['word'],
        inputAudioSha256: 'hash_test_mishari_1',
      },
      words: [
        { canonicalWordKey: '1:1:1', occurrenceId: '1:1:1:occurrence:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 300, confidence: 1 },
        { canonicalWordKey: '1:1:2', occurrenceId: '1:1:2:occurrence:1', displayWordIndex: 1, displayToken: 'اللَّهِ', startMs: 300, endMs: 650, confidence: 1 },
        { canonicalWordKey: '1:1:3', occurrenceId: '1:1:3:occurrence:1', displayWordIndex: 2, displayToken: 'الرَّحْمَٰنِ', startMs: 650, endMs: 1000, confidence: 1 },
      ],
    },
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

  it('Engine 3 (Browser Cloud): Renders the full browser scene independently with solid color, headers, badges and word timing', async () => {
    const outputPath = path.join(tempDir, 'engine3_browser_cloud_full_fidelity.mp4');
    const manifest: RenderManifest = {
      ...getBaseManifest(),
      renderEngine: 'browser_cloud',
      outputDimensions: { width: 720, height: 1280 },
      background: {
        ...getBaseManifest().background,
        type: 'color',
        url: '#162B3A',
        overlayOpacity: 0.25,
      },
      displaySettings: {
        ...getBaseManifest().displaySettings,
        visualDesign: 'moonlit',
        frameStyle: 'ornate',
        screenBorderStyle: 'goldenTrim',
        screenBorderColor: 'gold',
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        highlightStyle: 'glow',
      },
    };

    const result = await renderDeterministicVideo({
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
  }, 60000);

  it('All engines: Preserve the full preview scene settings independently', async () => {
    const richSettings = {
      ...getBaseManifest().displaySettings,
      visualDesign: 'moonlit' as const,
      frameStyle: 'ornate' as const,
      screenBorderStyle: 'goldenTrim' as const,
      screenBorderColor: 'gold' as const,
      surahNamePosition: 'top' as const,
      surahNameStyle: 'ornate' as const,
      reciterNameStyle: 'pill' as const,
      verseDisplayMode: 'full' as const,
      ayahTransition: 'cinematic' as const,
      textShadowStyle: 'glow' as const,
      watermarkEnabled: true,
      watermarkText: '@AyaX',
      watermarkPosition: 'bottomRight' as const,
      socialWatermarkEnabled: true,
      socialPlatform: 'youtube' as const,
      socialHandle: '@AyaX',
      socialWatermarkPosition: 'bottomCenter' as const,
      socialWatermarkSize: 18,
      socialWatermarkOpacity: 0.9,
    };
    const engines = [
      { name: 'ffmpeg', renderEngine: 'ffmpeg_ass' as const, render: renderFfmpegAssVideo },
      { name: 'skia', renderEngine: 'skia_canvas' as const, render: renderSkiaCanvasVideo },
      { name: 'browser', renderEngine: 'browser_cloud' as const, render: renderDeterministicVideo },
    ];

    for (const engine of engines) {
      const outputPath = path.join(tempDir, `full_scene_${engine.name}.mp4`);
      const result = await engine.render({
        manifest: {
          ...getBaseManifest(),
          renderEngine: engine.renderEngine,
          displaySettings: richSettings,
        } as RenderManifest,
        audioFilePath: sampleAudioPath,
        outputPath,
      });
      const probe = await probeMediaFile(outputPath);
      expect(result.fileSizeBytes).toBeGreaterThan(1000);
      expect(probe.video?.width).toBe(720);
      expect(probe.video?.height).toBe(1280);
      expect(probe.video?.codec).toBe('h264');
      expect(probe.audio?.codec).toBe('aac');
      expect(probe.durationSeconds).toBeGreaterThanOrEqual(0.9);
    }
  }, 90000);

  it('All engines: Render local image and slideshow backgrounds without blank frames', async () => {
    const engines = [
      { name: 'ffmpeg', renderEngine: 'ffmpeg_ass' as const, render: renderFfmpegAssVideo },
      { name: 'skia', renderEngine: 'skia_canvas' as const, render: renderSkiaCanvasVideo },
      { name: 'browser', renderEngine: 'browser_cloud' as const, render: renderDeterministicVideo },
    ];
    const backgrounds = [
      { type: 'image' as const, url: sampleImagePath, thumbnail: sampleImagePath },
      { type: 'slideshow' as const, url: sampleImagePath, thumbnail: sampleImagePath, slideImages: [sampleImagePath, sampleImagePath] },
    ];

    for (const engine of engines) {
      for (const [backgroundIndex, background] of backgrounds.entries()) {
        const outputPath = path.join(tempDir, `background_${engine.name}_${backgroundIndex}.mp4`);
        const result = await engine.render({
          manifest: {
            ...getBaseManifest(),
            renderEngine: engine.renderEngine,
            background: {
              ...getBaseManifest().background,
              ...background,
            },
          } as RenderManifest,
          audioFilePath: sampleAudioPath,
          outputPath,
        });
        expect(result.fileSizeBytes).toBeGreaterThan(1000);
        expect((await probeMediaFile(outputPath)).durationSeconds).toBeGreaterThanOrEqual(0.9);
      }
    }
  }, 120000);

  it('Dispatcher: Correctly routes each independent engine based on manifest.renderEngine', async () => {
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

    const browserCloudManifest = {
      ...getBaseManifest(),
      renderEngine: 'browser_cloud' as const,
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

    const browserCloudOutputPath = path.join(tempDir, 'dispatcher_browser_cloud.mp4');
    const browserCloudResult = await renderDeterministicVideo({
      manifest: browserCloudManifest,
      audioFilePath: sampleAudioPath,
      outputPath: browserCloudOutputPath,
    });

    expect(fs.existsSync(assResult.outputPath)).toBe(true);
    expect(fs.existsSync(skiaResult.outputPath)).toBe(true);
    expect(assResult.fileSizeBytes).toBeGreaterThan(1000);
    expect(skiaResult.fileSizeBytes).toBeGreaterThan(1000);
    expect(fs.existsSync(browserCloudResult.outputPath)).toBe(true);
    expect(browserCloudResult.fileSizeBytes).toBeGreaterThan(1000);
  }, 30000);
});

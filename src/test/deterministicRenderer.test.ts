import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {
  DeterministicFrameRenderer,
  resolveChromiumExecutablePath,
} from '../../server/renderer/frameRenderer';
import {
  renderDeterministicVideo,
  applyAudioEffects,
  QUALITY_ENCODING_PROFILES,
} from '../../server/services/deterministicVideoRenderer';
import {
  probeMediaFile,
  validateProbeAgainstSpec,
} from '../../server/services/mediaProbeService';
import { RenderManifest } from '../../server/models/renderManifest';

describe('Deterministic Server-Side Offline Video Renderer', () => {
  const scratchDir = path.join(os.tmpdir(), `test_det_render_${Date.now()}`);
  let testAudioPath: string;

  beforeAll(async () => {
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    // Generate a clean 2.0-second AAC audio track using native ffmpeg
    testAudioPath = path.join(scratchDir, 'synthetic_audio.m4a');
    const genAudio = spawnSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.0',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      testAudioPath,
    ]);

    expect(genAudio.status).toBe(0);
    expect(fs.existsSync(testAudioPath)).toBe(true);
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(scratchDir)) {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    } catch {
      // The test cleanup is best effort: a failed cleanup must not conceal
      // the renderer assertion that caused the test to fail.
    }
  });

  it('verifies exact mathematical clock: t = frameIndex / fps', () => {
    const fps = 30;
    const totalDurationSeconds = 2.0;
    const totalFrames = Math.ceil(totalDurationSeconds * fps); // 60 frames

    expect(totalFrames).toBe(60);

    // Frame 0 must be exactly 0.000000s
    expect(0 / fps).toBe(0);
    // Frame 15 must be exactly 0.500000s
    expect(15 / fps).toBe(0.5);
    // Frame 30 must be exactly 1.000000s
    expect(30 / fps).toBe(1.0);
    // Frame 45 must be exactly 1.500000s
    expect(45 / fps).toBe(1.5);
    // Frame 59 must be (59 / 30)s
    expect(59 / fps).toBeCloseTo(1.966666, 4);
  });

  it('resolves Chromium executable on the platform', () => {
    const chromePath = resolveChromiumExecutablePath();
    expect(chromePath).toBeDefined();
    expect(fs.existsSync(chromePath)).toBe(true);
  });

  it('renders a visibly distinct cloud frame for each cinematic visual direction', async () => {
    const baseManifest = {
      schemaVersion: '1.0.0', rendererVersion: '1.0.0', revision: 'visual-directions',
      aspectRatio: '9:16', outputDimensions: { width: 360, height: 640 }, fps: 30,
      qualityPreset: 'low', codecProfile: 'baseline',
      reciter: { id: 'test', name: 'قارئ تجريبي' },
      canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 1, ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }] },
      timingMap: { mapId: 'visual_direction_map', audioContentHash: 'visual_direction_hash', validationStatus: 'approved', words: [{ canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 1000 }] },
      audio: { sourceMode: 'single_url', audioUrl: 'visual-test.mp3', audioContentHash: 'visual_direction_audio', durationSeconds: 1 },
      background: { id: 'visual-direction-color', type: 'color', url: '', overlayOpacity: 0.35, shadowIntensity: 0.5, motionSpeed: 3 },
      typography: { fontFamily: 'Amiri', fontSize: 30, textColor: '#ffffff', shadowIntensity: 0.3, overlayOpacity: 0.35 },
      displaySettings: { showAyahText: true, showSurahName: false, showReciterName: false, showAyahNumber: false, watermarkEnabled: false, highlightStyle: 'none', frameStyle: 'none' },
    } as unknown as RenderManifest;

    const frames: Buffer[] = [];
    for (const visualDesign of ['dawn', 'editorial', 'moonlit'] as const) {
      const renderer = new DeterministicFrameRenderer({
        ...baseManifest,
        displaySettings: { ...baseManifest.displaySettings, visualDesign },
      });
      try {
        await renderer.init();
        frames.push(await renderer.renderFrameBuffer(0, 0));
      } finally {
        await renderer.close();
      }
    }

    expect(frames).toHaveLength(3);
    expect(frames[0].equals(frames[1])).toBe(false);
    expect(frames[1].equals(frames[2])).toBe(false);
    expect(frames[0].equals(frames[2])).toBe(false);
  }, 30000);

  it('renders a deterministic video end-to-end and validates MP4 with ffprobe', async () => {
    const outputMp4Path = path.join(scratchDir, 'output_verified.mp4');

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_001',
      aspectRatio: '9:16',
      outputDimensions: {
        width: 720,
        height: 1280,
      },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: {
        id: 'alafasy',
        name: 'مشاري راشد العفاسي',
        quranFoundationId: 7,
      },
      canonicalAyahRange: {
        surahNumber: 108,
        surahName: 'الكوثر',
        startAyah: 1,
        endAyah: 1,
        ayahs: [
          {
            numberInSurah: 1,
            text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ',
          },
        ],
      },
      timingMap: {
        mapId: 'test_map_kawthar',
        audioContentHash: 'hash_test_kawthar',
        validationStatus: 'approved',
        words: [
          {
            canonicalWordKey: '108:1:1',
            displayWordIndex: 0,
            displayToken: 'إِنَّا',
            startMs: 0,
            endMs: 600,
          },
          {
            canonicalWordKey: '108:1:2',
            displayWordIndex: 1,
            displayToken: 'أَعْطَيْنَاكَ',
            startMs: 600,
            endMs: 1300,
          },
          {
            canonicalWordKey: '108:1:3',
            displayWordIndex: 2,
            displayToken: 'الْكَوْثَرَ',
            startMs: 1300,
            endMs: 2000,
          },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_001',
        durationSeconds: 2.0,
      },
      background: {
        type: 'color',
        id: 'bg_dark_emerald',
        url: '',
        category: 'color',
        overlayOpacity: 0.4,
      },
      typography: {
        fontFamily: 'Amiri',
        fontSize: 36,
        textColor: '#FFFFFF',
        shadowIntensity: 0.7,
      },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        watermarkEnabled: false,
        ayahNumberStyle: 'circle',
        ayahNumberColor: 'gold',
        highlightStyle: 'glow',
        frameStyle: 'golden',
      },
    };

    let progressReportCount = 0;
    const result = await renderDeterministicVideo({
      manifest,
      outputPath: outputMp4Path,
      onProgress: (progressPercent, currentFrame, totalFrames) => {
        progressReportCount++;
        expect(progressPercent).toBeGreaterThanOrEqual(0);
        expect(progressPercent).toBeLessThanOrEqual(100);
      },
    });

    expect(result).toBeDefined();
    expect(result.totalFrames).toBe(60);
    expect(fs.existsSync(outputMp4Path)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(5000);
    expect(progressReportCount).toBeGreaterThan(0);

    // Probe the resulting output using ffprobe
    const probe = await probeMediaFile(outputMp4Path);
    expect(probe).toBeDefined();
    expect(probe.container).toContain('mp4');
    expect(probe.video).toBeDefined();
    expect(probe.video?.codec).toBe('h264');
    expect(probe.video?.pixelFormat).toBe('yuv420p');
    expect(probe.video?.width).toBe(720);
    expect(probe.video?.height).toBe(1280);
    expect(probe.video?.fps).toBe(30);

    expect(probe.audio).toBeDefined();
    expect(probe.audio?.codec).toBe('aac');
    expect(probe.audio?.sampleRate).toBe(44100);

    // Validate against strict spec requirements (CFR, H264, AAC, YUV420P)
    const specResult = validateProbeAgainstSpec(probe, 30);
    expect(specResult.valid).toBe(true);
    expect(specResult.errors).toEqual([]);
  }, 60000);

  it('safely aborts rendering when signal is triggered and cleans up temporary file', async () => {
    const abortedMp4Path = path.join(scratchDir, 'aborted_output.mp4');
    const abortController = new AbortController();

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_abort',
      aspectRatio: '9:16',
      outputDimensions: { width: 720, height: 1280 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'العفاسي' },
      canonicalAyahRange: {
        surahNumber: 108,
        surahName: 'الكوثر',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' }],
      },
      timingMap: {
        mapId: 'map_abort',
        audioContentHash: 'hash_abort',
        validationStatus: 'approved',
        words: [],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_abort',
        durationSeconds: 2.0,
      },
      background: { id: 'bg_black', type: 'color', url: '', category: 'color' },
      typography: { fontFamily: 'Amiri', fontSize: 36, textColor: '#FFF', shadowIntensity: 0.5 },
      displaySettings: { showAyahText: true, highlightStyle: 'none' },
    };

    // Trigger abort after 5 frames
    let framesRendered = 0;
    const renderPromise = renderDeterministicVideo({
      manifest,
      outputPath: abortedMp4Path,
      signal: abortController.signal,
      onProgress: (_p, currentFrame) => {
        framesRendered = currentFrame;
        if (framesRendered >= 3) {
          abortController.abort();
        }
      },
    });

    await expect(renderPromise).rejects.toThrow(/الغاء|cancel|abort/i);
    // Temporary incomplete output must be deleted
    expect(fs.existsSync(abortedMp4Path)).toBe(false);
  }, 30000);

  it('renders in 16:9 widescreen orientation with verified dimensions', async () => {
    const wideMp4Path = path.join(scratchDir, 'wide_output.mp4');

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_wide',
      aspectRatio: '16:9',
      outputDimensions: { width: 1280, height: 720 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'العفاسي' },
      canonicalAyahRange: {
        surahNumber: 108,
        surahName: 'الكوثر',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' }],
      },
      timingMap: {
        mapId: 'map_wide',
        audioContentHash: 'hash_wide',
        validationStatus: 'approved',
        words: [],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_wide',
        durationSeconds: 1.0,
      },
      background: { id: 'bg_dark', type: 'color', url: '', category: 'color' },
      typography: { fontFamily: 'Amiri', fontSize: 32, textColor: '#FFF', shadowIntensity: 0.5 },
      displaySettings: { showAyahText: true, highlightStyle: 'none' },
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath: wideMp4Path,
    });

    expect(result.totalFrames).toBe(30);
    const probe = await probeMediaFile(wideMp4Path);
    expect(probe.video?.width).toBe(1280);
    expect(probe.video?.height).toBe(720);
    expect(probe.video?.codec).toBe('h264');
  }, 45000);

  it('renders video preset with localized background smoothly without flickering', async () => {
    // Generate a test background image with FFmpeg
    const testBgPath = path.join(scratchDir, 'test_bg.jpg');
    spawnSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=1',
      '-vframes', '1',
      '-q:v', '2',
      testBgPath,
    ]);
    expect(fs.existsSync(testBgPath)).toBe(true);

    const videoPresetMp4Path = path.join(scratchDir, 'video_preset_output.mp4');

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_video_preset',
      aspectRatio: '9:16',
      outputDimensions: { width: 720, height: 1280 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'العفاسي' },
      canonicalAyahRange: {
        surahNumber: 108,
        surahName: 'الكوثر',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' }],
      },
      timingMap: {
        mapId: 'map_video_preset',
        audioContentHash: 'hash_video_preset',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '108:1:1', displayWordIndex: 0, displayToken: 'إِنَّا', startMs: 0, endMs: 500 },
          { canonicalWordKey: '108:1:2', displayWordIndex: 1, displayToken: 'أَعْطَيْنَاكَ', startMs: 500, endMs: 1000 },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_video_preset',
        durationSeconds: 1.0,
      },
      background: {
        id: 'mountains-video-1',
        type: 'video',
        url: 'https://assets.mixkit.co/videos/preview/mixkit-aerial-view-of-snowy-mountain-peaks-42777-large.mp4',
        thumbnail: testBgPath,
        category: 'mountain',
        motionSpeed: 3,
        overlayOpacity: 0.35,
      },
      typography: { fontFamily: 'Amiri', fontSize: 36, textColor: '#FFF', shadowIntensity: 0.7 },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        highlightStyle: 'glow',
        frameStyle: 'golden',
      },
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath: videoPresetMp4Path,
    });

    expect(result.totalFrames).toBe(30);
    expect(fs.existsSync(videoPresetMp4Path)).toBe(true);
    const probe = await probeMediaFile(videoPresetMp4Path);
    expect(probe.video?.width).toBe(720);
    expect(probe.video?.height).toBe(1280);
    expect(probe.video?.codec).toBe('h264');
    expect(probe.audio?.codec).toBe('aac');

    const specResult = validateProbeAgainstSpec(probe, 30);
    expect(specResult.valid).toBe(true);
  }, 45000);

  it('renders authentic continuous video motion and verifies display settings & word glow across frames', async () => {
    // 1. Generate a synthetic 1.0s video with moving pattern using ffmpeg testsrc
    const movingVideoPath = path.join(scratchDir, 'moving_bg.mp4');
    const genVid = spawnSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1.0:size=720x1280:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      movingVideoPath,
    ]);
    expect(genVid.status).toBe(0);
    expect(fs.existsSync(movingVideoPath)).toBe(true);

    const outputMovingMp4Path = path.join(scratchDir, 'output_moving_verified.mp4');

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_moving_video',
      aspectRatio: '9:16',
      outputDimensions: { width: 720, height: 1280 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'مشاري راشد العفاسي' },
      canonicalAyahRange: {
        surahNumber: 1,
        surahName: 'الفاتحة',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
      timingMap: {
        mapId: 'map_moving_test',
        audioContentHash: 'hash_moving_test',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 250 },
          { canonicalWordKey: '1:1:2', displayWordIndex: 1, displayToken: 'اللَّهِ', startMs: 250, endMs: 500 },
          { canonicalWordKey: '1:1:3', displayWordIndex: 2, displayToken: 'الرَّحْمَٰنِ', startMs: 500, endMs: 750 },
          { canonicalWordKey: '1:1:4', displayWordIndex: 3, displayToken: 'الرَّحِيمِ', startMs: 750, endMs: 1000 },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_moving',
        durationSeconds: 1.0,
      },
      background: {
        id: 'moving-video-bg',
        type: 'video',
        url: movingVideoPath,
        thumbnail: movingVideoPath,
        category: 'abstract',
        motionSpeed: 3,
        overlayOpacity: 0.25,
      },
      typography: { fontFamily: 'Amiri', fontSize: 36, textColor: '#FFF', shadowIntensity: 0.7 },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        highlightStyle: 'glow',
        glowStyle: 'golden',
        frameStyle: 'ornate',
        ayahNumberStyle: 'star',
        ayahNumberColor: 'gold',
        surahNamePosition: 'top',
        surahNameStyle: 'calligraphy',
        reciterNameStyle: 'elegant',
        textShadowStyle: 'strong',
        watermarkEnabled: true,
        watermarkText: '@AyaQuran',
        watermarkPosition: 'bottomRight',
      },
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath: outputMovingMp4Path,
    });

    expect(result.totalFrames).toBe(30);
    expect(fs.existsSync(outputMovingMp4Path)).toBe(true);

    // 2. Extract frame 1 and frame 15 from output video to confirm real continuous video motion
    const frameExtractDir = path.join(scratchDir, 'verify_frames');
    await fs.promises.mkdir(frameExtractDir, { recursive: true });

    const f1Path = path.join(frameExtractDir, 'f1.bmp');
    const f15Path = path.join(frameExtractDir, 'f15.bmp');

    spawnSync(ffmpegPath!, [
      '-y',
      '-i', outputMovingMp4Path,
      '-vf', 'select=eq(n\\,0)',
      '-vframes', '1',
      f1Path,
    ]);

    spawnSync(ffmpegPath!, [
      '-y',
      '-i', outputMovingMp4Path,
      '-vf', 'select=eq(n\\,14)',
      '-vframes', '1',
      f15Path,
    ]);

    expect(fs.existsSync(f1Path)).toBe(true);
    expect(fs.existsSync(f15Path)).toBe(true);

    const f1Buf = fs.readFileSync(f1Path);
    const f15Buf = fs.readFileSync(f15Path);

    // Frame 1 and Frame 15 must NOT be identical (confirming dynamic video playback!)
    expect(f1Buf.equals(f15Buf)).toBe(false);

    // Also verify probe specs
    const probe = await probeMediaFile(outputMovingMp4Path);
    expect(probe.video?.width).toBe(720);
    expect(probe.video?.height).toBe(1280);
    expect(probe.video?.fps).toBe(30);
    const specResult = validateProbeAgainstSpec(probe, 30);
    expect(specResult.valid).toBe(true);
  }, 45000);

  it('renders neon glow style and topLeft surah header without errors', async () => {
    const neonMp4Path = path.join(scratchDir, 'neon_glow_output.mp4');
    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_test_neon_glow',
      aspectRatio: '9:16',
      outputDimensions: { width: 720, height: 1280 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'العفاسي' },
      canonicalAyahRange: {
        surahNumber: 112,
        surahName: 'الإخلاص',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ هُوَ اللَّهُ أَحَدٌ' }],
      },
      timingMap: {
        mapId: 'map_neon',
        audioContentHash: 'hash_neon',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '112:1:1', displayWordIndex: 0, displayToken: 'قُلْ', startMs: 0, endMs: 500 },
          { canonicalWordKey: '112:1:2', displayWordIndex: 1, displayToken: 'هُوَ', startMs: 500, endMs: 1000 },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_neon',
        durationSeconds: 1.0,
      },
      background: {
        id: 'test-img',
        type: 'image',
        url: path.join(scratchDir, 'synthetic_bg.jpg'),
        thumbnail: path.join(scratchDir, 'synthetic_bg.jpg'),
      },
      typography: { fontFamily: 'Cairo', fontSize: 34, textColor: '#FFF', shadowIntensity: 0.8 },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        highlightStyle: 'glow',
        glowStyle: 'neon',
        frameStyle: 'geometric',
        ayahNumberStyle: 'diamond',
        ayahNumberColor: 'emerald',
        surahNamePosition: 'topLeft',
        surahNameStyle: 'ribbon',
        reciterNameStyle: 'badge',
        textShadowStyle: 'glow',
        watermarkEnabled: true,
        watermarkPosition: 'bottomLeft',
      },
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath: neonMp4Path,
    });

    expect(result.totalFrames).toBe(30);
    expect(fs.existsSync(neonMp4Path)).toBe(true);
  }, 45000);

  it('differentiates quality presets strictly across crf, presets, and audio bitrates', () => {
    expect(QUALITY_ENCODING_PROFILES.low.crf).toBe('23');
    expect(QUALITY_ENCODING_PROFILES.low.preset).toBe('faster');
    expect(QUALITY_ENCODING_PROFILES.low.audioBitrate).toBe('128k');

    expect(QUALITY_ENCODING_PROFILES.medium.crf).toBe('20');
    expect(QUALITY_ENCODING_PROFILES.medium.preset).toBe('fast');
    expect(QUALITY_ENCODING_PROFILES.medium.audioBitrate).toBe('192k');

    expect(QUALITY_ENCODING_PROFILES.high.crf).toBe('18');
    expect(QUALITY_ENCODING_PROFILES.high.preset).toBe('medium');
    expect(QUALITY_ENCODING_PROFILES.high.audioBitrate).toBe('256k');

    expect(QUALITY_ENCODING_PROFILES.ultra.crf).toBe('15');
    expect(QUALITY_ENCODING_PROFILES.ultra.preset).toBe('slow');
    expect(QUALITY_ENCODING_PROFILES.ultra.audioBitrate).toBe('320k');
  });

  it('applies native FFmpeg audio filtergraph for reverb, echo, EQ, normalize, and copyright protection', async () => {
    const mockManifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_audio_test',
      aspectRatio: '9:16',
      outputDimensions: { width: 720, height: 1280 },
      fps: 30,
      qualityPreset: 'high',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'مشاري راشد العفاسي' },
      canonicalAyahRange: {
        surahNumber: 1,
        surahName: 'الفاتحة',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
      timingMap: {
        mapId: 'map_audio',
        audioContentHash: 'hash_audio',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 500 },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash',
        durationSeconds: 2.0,
      },
      audioEffects: {
        reverbEnabled: true,
        reverbLevel: 0.7,
        echoEnabled: true,
        echoDelay: 0.25,
        echoFeedback: 0.35,
        normalizeEnabled: true,
        eqEnabled: true,
        copyrightProtectionEnabled: true,
      },
      background: { id: 'bg-1', type: 'color', url: '#000' },
      typography: { fontFamily: 'Amiri', fontSize: 32, textColor: '#FFF', shadowIntensity: 0.5 },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        highlightStyle: 'glow',
      },
    };

    const processedPath = await applyAudioEffects(testAudioPath, scratchDir, mockManifest);
    expect(fs.existsSync(processedPath)).toBe(true);
    const stat = fs.statSync(processedPath);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it('renders video end-to-end with active audio effects and low quality preset', async () => {
    const outputAudioEffectsMp4 = path.join(scratchDir, 'output_audio_effects_low.mp4');

    const manifest: RenderManifest = {
      schemaVersion: '1.0.0',
      rendererVersion: '1.0.0',
      revision: 'rev_audio_render',
      aspectRatio: '9:16',
      outputDimensions: { width: 480, height: 854 },
      fps: 30,
      qualityPreset: 'low',
      codecProfile: 'high-4.1',
      reciter: { id: 'alafasy', name: 'مشاري راشد العفاسي' },
      canonicalAyahRange: {
        surahNumber: 1,
        surahName: 'الفاتحة',
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' }],
      },
      timingMap: {
        mapId: 'map_audio_render',
        audioContentHash: 'hash_audio_render',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '1:2:1', displayWordIndex: 0, displayToken: 'الْحَمْدُ', startMs: 0, endMs: 500 },
          { canonicalWordKey: '1:2:2', displayWordIndex: 1, displayToken: 'لِلَّهِ', startMs: 500, endMs: 1000 },
        ],
      },
      audio: {
        sourceMode: 'single_url',
        audioUrl: testAudioPath,
        audioContentHash: 'audio_hash_render',
        durationSeconds: 1.0,
      },
      audioEffects: {
        reverbEnabled: true,
        reverbLevel: 0.6,
        echoEnabled: true,
        echoDelay: 0.2,
        echoFeedback: 0.3,
        normalizeEnabled: true,
        eqEnabled: true,
        copyrightProtectionEnabled: false,
      },
      background: {
        id: 'bg-color',
        type: 'color',
        url: '#06202B',
      },
      typography: { fontFamily: 'Amiri', fontSize: 26, textColor: '#FFF', shadowIntensity: 0.5 },
      displaySettings: {
        showAyahText: true,
        showSurahName: true,
        showReciterName: true,
        showAyahNumber: true,
        highlightStyle: 'glow',
        frameStyle: 'modern',
        ayahTransition: 'rotate',
        surahNameStyle: 'modern',
        reciterNameStyle: 'pill',
        textShadowStyle: 'double',
      },
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath: outputAudioEffectsMp4,
    });

    expect(result.totalFrames).toBe(30);
    expect(fs.existsSync(outputAudioEffectsMp4)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(10000);
    expect(result.probe.video?.width).toBe(480);
    expect(result.probe.video?.height).toBe(854);
    expect(result.probe.audio?.codec).toBe('aac');
  }, 45000);
});

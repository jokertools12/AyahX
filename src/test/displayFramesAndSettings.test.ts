import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { renderDeterministicVideo } from '../../server/services/deterministicVideoRenderer';
import { RenderManifest } from '../../server/models/renderManifest';

describe('Display Settings, Surah & Reciter Frames Rendering Test', () => {
  let tmpDir = '';
  let audioFile = '';

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ayahx-display-frames-'));
    audioFile = path.join(tmpDir, 'synth_test_audio.m4a');
    const generatedAudio = spawnSync(ffmpegPath!, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.0',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      audioFile,
    ]);
    expect(generatedAudio.status, generatedAudio.stderr.toString()).toBe(0);
    expect(fs.existsSync(audioFile)).toBe(true);
  });

  afterAll(() => {
    if (!tmpDir) return;
    const resolvedTempRoot = path.resolve(os.tmpdir());
    const resolvedTarget = path.resolve(tmpDir);
    const relativeTarget = path.relative(resolvedTempRoot, resolvedTarget);
    if (
      !relativeTarget
      || relativeTarget.startsWith('..')
      || path.isAbsolute(relativeTarget)
      || !path.basename(resolvedTarget).startsWith('ayahx-display-frames-')
    ) {
      throw new Error('Refusing to remove a display-render test directory outside its unique OS temp folder.');
    }
    fs.rmSync(resolvedTarget, { recursive: true, force: true });
  });

  it('renders correctly with classic surah badge, elegant reciter, and golden frame', async () => {
    const outputPath = path.join(tmpDir, 'test_classic_golden.mp4');
    const manifest: RenderManifest = {
      aspectRatio: '9:16',
      outputDimensions: { width: 540, height: 960 },
      fps: 30,
      qualityPreset: 'medium',
      codecProfile: 'high-4.1',
      audio: {
        sourceMode: 'single_url',
        audioUrl: audioFile,
        audioContentHash: 'audio_hash_test_1',
        durationSeconds: 1.0,
      },
      audioEffects: {
        reverbEnabled: true,
        reverbLevel: 0.3,
        echoEnabled: true,
        echoDelay: 0.25,
        echoFeedback: 0.2,
      },
      reciter: {
        id: 'alafasy',
        name: 'مشاري راشد العفاسي',
      },
      canonicalAyahRange: {
        surahNumber: 108,
        surahName: 'سورة الكوثر',
        startAyah: 1,
        endAyah: 1,
        ayahs: [
          { numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' },
        ],
      },
      timingMap: {
        mapId: 'map_1',
        audioContentHash: 'audio_hash_test_1',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '108:1:1', startMs: 0, endMs: 300, displayToken: 'إِنَّا', displayWordIndex: 0 },
          { canonicalWordKey: '108:1:2', startMs: 300, endMs: 650, displayToken: 'أَعْطَيْنَاكَ', displayWordIndex: 1 },
          { canonicalWordKey: '108:1:3', startMs: 650, endMs: 1000, displayToken: 'الْكَوْثَرَ', displayWordIndex: 2 },
        ],
      },
      background: {
        id: 'bg-image-test',
        type: 'image',
        url: '',
        motionSpeed: 3,
        overlayOpacity: 0.3,
      },
      typography: {
        fontFamily: 'Amiri',
        fontSize: 28,
        textColor: '#FFFFFF',
      },
      displaySettings: {
        showSurahName: true,
        showReciterName: true,
        showAyahText: true,
        showAyahNumber: true,
        surahNameStyle: 'classic',
        surahNamePosition: 'top',
        reciterNameStyle: 'badge',
        frameStyle: 'golden',
        ayahNumberStyle: 'star',
        ayahNumberColor: 'gold',
        verseDisplayMode: 'full',
        highlightStyle: 'glow',
        glowStyle: 'golden',
        textShadowStyle: 'strong',
        ayahTransition: 'fade',
        watermarkEnabled: true,
        watermarkText: '@AyahClip',
        watermarkPosition: 'bottomRight',
      },
      outputFormat: 'mp4',
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath,
    });

    expect(result).toBeDefined();
    expect(result.totalFrames).toBe(30);
    expect(result.fileSizeBytes).toBeGreaterThan(10000);
    expect(fs.existsSync(outputPath)).toBe(true);
  }, 45000);

  it('renders reciter name independently when showSurahName is false', async () => {
    const outputPath = path.join(tmpDir, 'test_reciter_only.mp4');
    const manifest: RenderManifest = {
      aspectRatio: '9:16',
      outputDimensions: { width: 540, height: 960 },
      fps: 30,
      qualityPreset: 'medium',
      codecProfile: 'high-4.1',
      audio: {
        sourceMode: 'single_url',
        audioUrl: audioFile,
        audioContentHash: 'audio_hash_test_2',
        durationSeconds: 1.0,
      },
      reciter: {
        id: 'ghamadi',
        name: 'سعد الغامدي',
      },
      canonicalAyahRange: {
        surahNumber: 112,
        surahName: 'الإخلاص',
        startAyah: 1,
        endAyah: 1,
        ayahs: [
          { numberInSurah: 1, text: 'قُلْ هُوَ اللَّهُ أَحَدٌ' },
        ],
      },
      timingMap: {
        mapId: 'map_2',
        audioContentHash: 'audio_hash_test_2',
        validationStatus: 'approved',
        words: [
          { canonicalWordKey: '112:1:1', startMs: 0, endMs: 250, displayToken: 'قُلْ', displayWordIndex: 0 },
          { canonicalWordKey: '112:1:2', startMs: 250, endMs: 500, displayToken: 'هُوَ', displayWordIndex: 1 },
          { canonicalWordKey: '112:1:3', startMs: 500, endMs: 750, displayToken: 'اللَّهُ', displayWordIndex: 2 },
          { canonicalWordKey: '112:1:4', startMs: 750, endMs: 1000, displayToken: 'أَحَدٌ', displayWordIndex: 3 },
        ],
      },
      background: {
        id: 'bg-image-test-2',
        type: 'image',
        url: '',
        motionSpeed: 3,
        overlayOpacity: 0.35,
      },
      typography: {
        fontFamily: 'Amiri',
        fontSize: 28,
        textColor: '#FFFFFF',
      },
      displaySettings: {
        showSurahName: false, // Surah name hidden
        showReciterName: true, // Reciter name must still be rendered!
        showAyahText: true,
        showAyahNumber: true,
        surahNameStyle: 'classic',
        surahNamePosition: 'top',
        reciterNameStyle: 'pill',
        frameStyle: 'ornate',
        ayahNumberStyle: 'diamond',
        ayahNumberColor: 'emerald',
        verseDisplayMode: 'full',
        highlightStyle: 'glow',
        glowStyle: 'golden',
        textShadowStyle: 'soft',
        ayahTransition: 'slide',
        watermarkEnabled: false,
      },
      outputFormat: 'mp4',
    };

    const result = await renderDeterministicVideo({
      manifest,
      outputPath,
    });

    expect(result).toBeDefined();
    expect(result.totalFrames).toBe(30);
    expect(result.fileSizeBytes).toBeGreaterThan(10000);
    expect(fs.existsSync(outputPath)).toBe(true);
  }, 45000);
});

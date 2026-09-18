import { describe, it, expect } from 'vitest';
import { validateRenderManifest } from '../../server/models/renderManifest';

describe('RenderManifest Specification & Validation', () => {
  const sampleValidManifest = {
    schemaVersion: '1.0.0',
    rendererVersion: '1.0.0',
    revision: 'rev_test_123',
    aspectRatio: '9:16' as const,
    outputDimensions: { width: 1080, height: 1920 },
    fps: 30,
    qualityPreset: 'high' as const,
    codecProfile: 'high-4.1' as const,
    reciter: {
      id: 'mishary_alafasy',
      name: 'مشاري راشد العفاسي',
      quranFoundationId: 7,
    },
    canonicalAyahRange: {
      surahNumber: 108,
      surahName: 'الكوثر',
      startAyah: 1,
      endAyah: 3,
      ayahs: [
        { numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' },
        { numberInSurah: 2, text: 'فَصَلِّ لِرَبِّكَ وَانْحَرْ' },
        { numberInSurah: 3, text: 'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ' },
      ],
    },
    timingMap: {
      mapId: 'map_108_1_3',
      audioContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      validationStatus: 'approved' as const,
      words: [
        { canonicalWordKey: '108:1:1', displayWordIndex: 0, displayToken: 'إِنَّا', startMs: 200, endMs: 800 },
        { canonicalWordKey: '108:1:2', displayWordIndex: 1, displayToken: 'أَعْطَيْنَاكَ', startMs: 820, endMs: 1600 },
        { canonicalWordKey: '108:1:3', displayWordIndex: 2, displayToken: 'الْكَوْثَرَ', startMs: 1620, endMs: 2500 },
      ],
    },
    audio: {
      sourceMode: 'qf' as const,
      audioUrl: 'https://audio.qurancdn.com/Alafasy/108.mp3',
      audioContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      durationSeconds: 12.5,
    },
    background: {
      id: 'nature_stream',
      type: 'image' as const,
      url: 'https://images.unsplash.com/photo-nature-test',
      overlayOpacity: 0.4,
      shadowIntensity: 0.5,
      motionSpeed: 3,
    },
    typography: {
      fontSize: 28,
      fontFamily: '"Noto Naskh Arabic", serif',
      textColor: '#ffffff',
      shadowIntensity: 0.5,
      overlayOpacity: 0.4,
    },
    displaySettings: {
      showSurahName: true,
      showReciterName: true,
      showAyahText: true,
      showAyahNumber: true,
      highlightStyle: 'glow' as const,
      frameStyle: 'golden' as const,
      ayahNumberStyle: 'circle' as const,
      ayahNumberColor: 'gold' as const,
      verseDisplayMode: 'full' as const,
      surahNamePosition: 'top' as const,
      surahNameStyle: 'banner' as const,
      reciterNameStyle: 'simple' as const,
      textShadowStyle: 'soft' as const,
      ayahTransition: 'fade' as const,
      watermarkEnabled: false,
      watermarkText: '@AyaQuran',
      watermarkPosition: 'bottomRight' as const,
      glowStyle: 'golden' as const,
      slideshowTransition: 'crossfade' as const,
    },
    outputFormat: 'mp4' as const,
    idempotencyKey: 'idem_test_key_001',
  };

  it('accepts a fully compliant RenderManifest', () => {
    const res = validateRenderManifest(sampleValidManifest);
    expect(res.valid).toBe(true);
    expect(res.manifest).toBeDefined();
    expect(res.errors).toBeUndefined();
  });

  it('preserves the selected cinematic visual direction for cloud rendering', () => {
    const res = validateRenderManifest({
      ...sampleValidManifest,
      displaySettings: {
        ...sampleValidManifest.displaySettings,
        visualDesign: 'moonlit',
      },
    });
    expect(res.valid).toBe(true);
    expect(res.manifest?.displaySettings.visualDesign).toBe('moonlit');
  });

  it('rejects manifest with missing required fields', () => {
    const invalid = { ...sampleValidManifest, audio: undefined };
    const res = validateRenderManifest(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('audio'))).toBe(true);
  });

  it('allows glow highlight with unapproved timingMap using approximate word pacing fallback', () => {
    const unapproved = {
      ...sampleValidManifest,
      timingMap: {
        ...sampleValidManifest.timingMap,
        validationStatus: 'needs_review' as const,
      },
    };
    const res = validateRenderManifest(unapproved);
    expect(res.valid).toBe(true);
  });

  it('enforces aspect ratio dimensions match (portrait for 9:16, landscape for 16:9)', () => {
    const invalidDimensions = {
      ...sampleValidManifest,
      aspectRatio: '9:16' as const,
      outputDimensions: { width: 1920, height: 1080 }, // Inverted!
    };
    const res = validateRenderManifest(invalidDimensions);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('portrait dimensions'))).toBe(true);
  });

  it('rejects startAyah greater than endAyah', () => {
    const invalidRange = {
      ...sampleValidManifest,
      canonicalAyahRange: {
        ...sampleValidManifest.canonicalAyahRange,
        startAyah: 10,
        endAyah: 2,
      },
    };
    const res = validateRenderManifest(invalidRange);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('startAyah cannot be greater'))).toBe(true);
  });

  it('accepts timingMap with valid gap types such as waqf, silence, breath, intro, outro', () => {
    const manifestWithGaps = {
      ...sampleValidManifest,
      timingMap: {
        ...sampleValidManifest.timingMap,
        gaps: [
          { startMs: 0, endMs: 200, type: 'intro' as const },
          { startMs: 800, endMs: 820, type: 'waqf' as const },
          { startMs: 1600, endMs: 1620, type: 'breath' as const },
          { startMs: 2500, endMs: 3000, type: 'outro' as const },
        ],
      },
    };
    const res = validateRenderManifest(manifestWithGaps);
    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();
  });

  it('auto-heals client blob audioUrl to canonical everyAyahUrls when present', () => {
    const manifestWithBlob = {
      ...sampleValidManifest,
      reciter: {
        id: 'alafasy',
        name: 'العفاسي',
        everyAyahSubfolder: 'Alafasy_128kbps',
      },
      audio: {
        ...sampleValidManifest.audio,
        sourceMode: 'everyayah' as const,
        audioUrl: 'blob:http://localhost:5173/12345-abcdef',
        everyAyahUrls: [
          'https://everyayah.com/data/Alafasy_128kbps/108001.mp3',
          'https://everyayah.com/data/Alafasy_128kbps/108002.mp3',
        ],
      },
    };
    const res = validateRenderManifest(manifestWithBlob);
    expect(res.valid).toBe(true);
    expect(res.manifest?.audio.audioUrl).toBe('https://everyayah.com/data/Alafasy_128kbps/108001.mp3');
  });
});

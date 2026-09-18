import { TimingMap } from './timingMap';
import { ExportQuality, getQualityDimensions } from '@/hooks/useVideoRecorder';
import { AudioEffects } from '@/hooks/useAudioEffects';

export interface ClientManifestParams {
  aspectRatio: '9:16' | '16:9';
  quality: ExportQuality;
  fps?: 30 | 60;
  audioBitrate?: '128k' | '192k' | '320k';
  motionSpeed?: number;
  surah: { number: number; name: string };
  ayahRange: { start: number; end: number };
  ayahs: { numberInSurah: number; text: string }[];
  reciter: { id: string; name: string; quranFoundationId?: number; everyAyahSubfolder?: string };
  timingMap: TimingMap;
  audio: {
    sourceMode: 'qf' | 'everyayah' | 'single_url';
    audioUrl: string;
    audioContentHash: string;
    durationSeconds: number;
    rangeMs?: { from: number; to: number } | null;
    everyAyahUrls?: string[];
    everyAyahTimestamps?: { from: number; to: number }[];
  };
  audioEffects?: AudioEffects;
  background: {
    id: string;
    type: 'video' | 'image' | 'slideshow' | 'color';
    url: string;
    thumbnail?: string;
    category?: string;
    slideImages?: string[];
    motionSpeed?: number;
  };
  textSettings: {
    fontSize: number;
    fontFamily: string;
    textColor: string;
    shadowIntensity: number;
    overlayOpacity: number;
  };
  displaySettings: any;
  userId?: string;
  idempotencyKey?: string;
  renderEngine?: 'ffmpeg_ass' | 'skia_canvas' | 'browser_hybrid';
}

/**
 * Builds a validated, versioned RenderManifest payload for server-side deterministic rendering
 */
export function buildClientRenderManifest(params: ClientManifestParams): any {
  const dimensions = getQualityDimensions(params.quality, params.aspectRatio);
  const revision = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    schemaVersion: '1.0.0',
    rendererVersion: '1.0.0',
    renderEngine: params.renderEngine || 'ffmpeg_ass',
    revision,
    aspectRatio: params.aspectRatio,
    outputDimensions: dimensions,
    fps: params.fps || 30,
    qualityPreset: params.quality,
    audioBitrate: params.audioBitrate || '192k',
    codecProfile: 'high-4.1',

    reciter: {
      id: params.reciter.id,
      name: params.reciter.name,
      quranFoundationId: params.reciter.quranFoundationId,
      everyAyahSubfolder: params.reciter.everyAyahSubfolder,
    },

    canonicalAyahRange: {
      surahNumber: params.surah.number,
      surahName: params.surah.name,
      startAyah: params.ayahRange.start,
      endAyah: params.ayahRange.end,
      ayahs: params.ayahs.map((a) => ({
        numberInSurah: a.numberInSurah,
        text: a.text,
      })),
    },

    timingMap: {
      mapId: params.timingMap.mapId,
      audioContentHash: params.timingMap.audioContentHash,
      validationStatus: params.timingMap.validationStatus,
      words: (params.timingMap?.words || []).map((w, idx, arr) => {
        const nextStart = arr[idx + 1]?.startMs;
        const fallbackEnd = typeof nextStart === 'number' && nextStart > (w.startMs || 0)
          ? nextStart
          : ((w.startMs || 0) + 600);
        const resolvedEnd = (typeof w.endMs === 'number' && !isNaN(w.endMs) && w.endMs > 0)
          ? w.endMs
          : fallbackEnd;

        return {
          canonicalWordKey: w.canonicalWordKey || `word_${idx}`,
          displayWordIndex: typeof w.displayWordIndex === 'number' ? w.displayWordIndex : idx,
          displayToken: w.displayToken || '',
          startMs: typeof w.startMs === 'number' ? Math.max(0, w.startMs) : 0,
          endMs: Math.max(resolvedEnd, (typeof w.startMs === 'number' ? w.startMs : 0) + 50),
          confidence: w.confidence,
        };
      }),
      gaps: params.timingMap.gaps,
    },

    audio: {
      sourceMode: params.audio.sourceMode,
      audioUrl:
        params.audio.audioUrl.startsWith('blob:') && params.audio.everyAyahUrls?.[0]
          ? params.audio.everyAyahUrls[0]
          : params.audio.audioUrl,
      audioContentHash: params.audio.audioContentHash,
      durationSeconds: Math.max(params.audio.durationSeconds, 0.5),
      rangeMs: params.audio.rangeMs,
      everyAyahUrls: params.audio.everyAyahUrls,
      everyAyahTimestamps: params.audio.everyAyahTimestamps,
    },

    audioEffects: params.audioEffects ? {
      reverbEnabled: params.audioEffects.reverbEnabled ?? false,
      reverbLevel: params.audioEffects.reverbLevel ?? 0.5,
      echoEnabled: params.audioEffects.echoEnabled ?? false,
      echoDelay: params.audioEffects.echoDelay ?? 0.3,
      echoFeedback: params.audioEffects.echoFeedback ?? 0.4,
      pitchShift: params.audioEffects.pitchShift,
      speedAdjust: params.audioEffects.speedAdjust,
      copyrightProtectionEnabled: params.audioEffects.copyrightProtectionEnabled ?? false,
      normalizeEnabled: params.audioEffects.normalizeEnabled ?? false,
      eqEnabled: params.audioEffects.eqEnabled ?? false,
      volume: params.audioEffects.volume ?? 1.25,
    } : undefined,

    background: {
      id: params.background.id,
      type: params.background.type,
      url: params.background.url,
      thumbnail: params.background.thumbnail,
      category: params.background.category,
      slideImages: params.background.slideImages,
      overlayOpacity: params.textSettings.overlayOpacity,
      shadowIntensity: params.textSettings.shadowIntensity,
      motionSpeed: params.motionSpeed ?? params.background.motionSpeed ?? 3,
    },

    typography: {
      fontSize: params.textSettings.fontSize,
      fontFamily: params.textSettings.fontFamily,
      textColor: params.textSettings.textColor,
      shadowIntensity: params.textSettings.shadowIntensity,
      overlayOpacity: params.textSettings.overlayOpacity,
    },

    displaySettings: {
      ...params.displaySettings,
      showSurahName: params.displaySettings.showSurahName ?? false,
      showReciterName: params.displaySettings.showReciterName ?? false,
      showAyahText: params.displaySettings.showAyahText ?? true,
      showAyahNumber: params.displaySettings.showAyahNumber ?? false,
      highlightStyle: params.displaySettings.highlightStyle ?? 'glow',
      frameStyle: params.displaySettings.frameStyle ?? 'none',
      screenBorderStyle: params.displaySettings.screenBorderStyle ?? 'none',
      screenBorderColor: params.displaySettings.screenBorderColor ?? 'gold',
      ayahNumberStyle: params.displaySettings.ayahNumberStyle ?? 'quran3d',
      ayahNumberColor: params.displaySettings.ayahNumberColor ?? 'gold',
      verseDisplayMode: params.displaySettings.verseDisplayMode ?? 'full',
      surahNamePosition: params.displaySettings.surahNamePosition ?? 'top',
      surahNameStyle: params.displaySettings.surahNameStyle ?? 'classic',
      reciterNameStyle: params.displaySettings.reciterNameStyle ?? 'simple',
      textShadowStyle: params.displaySettings.textShadowStyle ?? 'none',
      ayahTransition: params.displaySettings.ayahTransition ?? 'fade',
      glowStyle: params.displaySettings.glowStyle ?? 'golden',
      slideshowTransition: params.displaySettings.slideshowTransition ?? 'crossfade',
    },

    outputFormat: 'mp4',
    idempotencyKey: params.idempotencyKey,
  };
}

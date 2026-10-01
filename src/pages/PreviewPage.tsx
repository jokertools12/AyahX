import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { getTrackById, ibtahalatTracks } from '@/data/ibtahalat';
import { transcribeFullAudio } from '@/lib/chunkedTranscribe';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { FullFidelityVideoPreview as VideoPreview, FullFidelityVideoPreviewRef as VideoPreviewRef } from '@/components/FullFidelityVideoPreview';
import { AudioEffectsPanel } from '@/components/AudioEffectsPanel';
import { DisplaySettingsPanel, DisplaySettings } from '@/components/DisplaySettingsPanel';
import { CustomBackgroundUploader } from '@/components/CustomBackgroundUploader';
import { AudioTrimControl } from '@/components/AudioTrimControl';
import { ExportFormatSelector, ExportSettings, ExportFormat } from '@/components/ExportFormatSelector';
import { MotionSpeedControl } from '@/components/MotionSpeedControl';
import { PresetSelector } from '@/components/PresetSelector';
import { SocialShareButtons } from '@/components/SocialShareButtons';
import { VIDEO_PRESETS, VideoPreset } from '@/data/videoPresets';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsSection } from '@/components/SettingsSection';
import { Badge } from '@/components/ui/badge';
import { surahs } from '@/data/surahs';
import { reciters, getAudioUrl, getEveryAyahUrl } from '@/data/reciters';
import { backgroundVideos, backgroundImages, slideshowBackgrounds, BackgroundItem, resolveBackgroundAssetUrl } from '@/data/backgrounds';
import { useQuranApi } from '@/hooks/useQuranApi';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { validateCloudRenderLimits } from '../../shared/cloudRenderPolicy';
import { useAudioEffects } from '@/hooks/useAudioEffects';
import { useVideoRecorder, ExportQuality, getQualityDimensions } from '@/hooks/useVideoRecorder';
import {
  fetchChapterRecitationAudioById,
  QuranFoundationTimestamp,
} from '@/lib/quranFoundationApi';
import { concatenateAudioUrls } from '@/lib/audioConcat';
import {
  TimingMap,
  normalizeQuranFoundationSegmentsToTimingMap,
  buildAudioAlignedTimingMap,
  timingMapRegistry,
  resolveActiveWordAtTime,
  validateTimingMap,
} from '@/lib/wordTimingEngine';

import { api } from '@/lib/api';
import { TextSettings } from '@/components/TextSettingsPanel';
import { TimingEditor } from '@/components/TimingEditor';
import { AlignmentReviewPanel } from '@/components/AlignmentReviewPanel';
import { createAyahRangeKey, isAyahRangeReady } from '@/lib/ayahRangeIdentity';
import { tokenizeQuranicText } from '@/lib/timingMap';
import {
  Download,
  RotateCcw,
  Share2,
  Loader2,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Save,
  Check,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
  SkipBack,
  SkipForward,
  Video,
  Settings,
  Music,
  Eye,
  Upload,
  Palette,
  Gauge,
  Scissors,
  Trash2,
  RefreshCw,
  Pencil,
  X,
  Clock,
  Sparkles,
  Cpu,
  BookOpen,
  Lock,
} from 'lucide-react';
import { useServerRenderJob } from '@/hooks/useServerRenderJob';
import { buildClientRenderManifest } from '@/lib/renderManifest';
import { toast } from 'sonner';
import { isBasicBackground, isFreeBackgroundAsset } from '../../shared/planEntitlements';
import { getVisualDirection, type VisualDirectionId } from '@/data/visualDirections';

// Kept as a non-configurable feature gate so legacy timing code cannot be
// re-enabled accidentally by a provider or browser response.
const legacyQuranFoundationEnabled = (): boolean => false;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How we play the ayahs */
type PlaybackMode =
  | 'qf'          // Legacy enum for paired chapter audio with catalog timing offsets
  | 'everyayah'   // EveryAyah.com – one MP3 per ayah (perfect verse clipping, no word highlight)
  | 'fallback';   // Full-surah source without attested word alignment

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  visualDesign: 'dawn',
  showSurahName: false,
  showReciterName: false,
  showAyahText: true,
  showAyahNumber: false,
  highlightStyle: 'glow',
  frameStyle: 'none',
  screenBorderStyle: 'none',
  screenBorderColor: 'gold',
  ayahNumberStyle: 'quran3d',
  ayahNumberColor: 'gold',
  verseDisplayMode: 'full',
  animationProfile: 'karaoke',
  animationReducedMotion: false,
  surahNamePosition: 'top',
  surahNameStyle: 'classic',
  reciterNameStyle: 'simple',
  textShadowStyle: 'none',
  ayahTransition: 'fade',
  watermarkEnabled: false,
  watermarkText: '',
  watermarkPosition: 'bottomCenter',
  logoWatermarkEnabled: false,
  logoWatermarkPreset: 'goldCalligraphy',
  logoBrandName: 'آيات قرآنية',
  logoSubtitle: 'تلاوات خاشعة',
  logoWatermarkPosition: 'topRight',
  logoWatermarkSize: 85,
  logoWatermarkOpacity: 0.95,
  socialWatermarkEnabled: false,
  socialPlatform: 'facebook',
  socialHandle: '',
  socialWatermarkPosition: 'bottomCenter',
  glowStyle: 'golden',
  lyricsDisplayStyle: 'scroll',
  slideshowTransition: 'crossfade',
};

// Note: frameStyle defaults to 'none' — user must explicitly select a frame

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  quality: 'high',
  fps: 30,
  audioBitrate: '192k',
  motionSpeed: 1.5,
  recordingMethod: 'auto',
  renderEngine: 'browser',
};

function parseDurationToSeconds(durStr?: string): number {
  if (!durStr) return 60;
  const parts = durStr.split(':').map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 60;
}

function getAudioCacheKey(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `transcription_cache_${Math.abs(hash).toString(36)}`;
}

function renderEngineLabel(engine: string | null | undefined): string {
  if (engine === 'ffmpeg_ass') return 'الإنتاج السحابي — FFmpeg';
  if (engine === 'skia_canvas') return 'الإنتاج السحابي';
  if (engine === 'browser_cloud') return 'الإنتاج السحابي — المتصفح';
  return 'محرك الإنتاج المحدد';
}

export default function PreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { fetchAyahs, fetchSurah } = useQuranApi();
  const { incrementUsage, loading: subscriptionLoading, isPremium, canUseFeature, isFreeFont, refetchUsage, plan, cloudPolicy } = useSubscription();
  const audioEffects = useAudioEffects();
  const videoRecorder = useVideoRecorder();
  const serverRenderJob = useServerRenderJob();

  // ── URL params ──────────────────────────────────────────────────────────────
  const pageMode = searchParams.get('mode') || 'quran'; // 'quran' | 'ibtahalat'
  const isIbtahalatMode = pageMode === 'ibtahalat';

  // Quran params
  const surahNumber = parseInt(searchParams.get('surah') || '1');
  const reciterId = searchParams.get('reciter') || 'mishary_alafasy';
  const startAyah = parseInt(searchParams.get('start') || '1');
  const endAyah = parseInt(searchParams.get('end') || '5');
  const requestedAyahRangeKey = createAyahRangeKey(surahNumber, startAyah, endAyah);

  // Ibtahalat params
  const ibtTrackId = searchParams.get('trackId') || '';
  const ibtTrackTitle = searchParams.get('trackTitle') || '';
  const ibtPerformerName = searchParams.get('performerName') || '';
  const ibtAudioUrl = searchParams.get('audioUrl') || '';

  const currentIbtTrack = useMemo(() => {
    if (!isIbtahalatMode) return null;
    return (
      (ibtTrackId ? getTrackById(ibtTrackId) : null) ||
      ibtahalatTracks.find(
        (t) =>
          (ibtTrackId && t.id === ibtTrackId) ||
          (ibtAudioUrl && t.audioUrl === ibtAudioUrl) ||
          (ibtTrackTitle && t.title === ibtTrackTitle)
      ) ||
      null
    );
  }, [isIbtahalatMode, ibtTrackId, ibtAudioUrl, ibtTrackTitle]);

  const predefinedLyricsLines = useMemo(() => {
    if (!currentIbtTrack?.lyrics) return [];
    return currentIbtTrack.lyrics
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }, [currentIbtTrack]);

  // Shared params
  const backgroundId = searchParams.get('background') || '';
  const backgroundType = searchParams.get('backgroundType') || 'video';
  const backgroundUrlParam = searchParams.get('backgroundUrl') || '';
  const backgroundThumbParam = searchParams.get('backgroundThumb') || '';
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>((searchParams.get('ratio') || '9:16') as '9:16' | '16:9');
  const visualDesignParam = searchParams.get('visualDesign') as VisualDirectionId | null;
  const customBgUrlParam = searchParams.get('customBgUrl') || '';
  const customBgTypeParam = (searchParams.get('customBgType') || 'image') as 'image' | 'video';

  const [textSettings, setTextSettings] = useState<TextSettings>(() => ({
    fontSize: parseInt(searchParams.get('fontSize') || '28'),
    fontFamily: searchParams.get('fontFamily') || '"Noto Naskh Arabic", serif',
    textColor: searchParams.get('textColor') || '#ffffff',
    shadowIntensity: parseFloat(searchParams.get('shadowIntensity') || '0.5'),
    overlayOpacity: parseFloat(searchParams.get('overlayOpacity') || '0.4'),
  }));

  // ── Static derived data ─────────────────────────────────────────────────────
  const surah = surahs.find((s) => s.number === surahNumber);
  const reciter = reciters.find((r) => r.id === reciterId);
  const fallbackBackground = useMemo(
    () => [...backgroundVideos, ...backgroundImages, ...slideshowBackgrounds].find((bg) => bg.id === backgroundId) || backgroundImages[0],
    [backgroundId]
  );
  const background: BackgroundItem | null = useMemo(() => {
    const candidate: BackgroundItem = !backgroundUrlParam ? fallbackBackground : {
      id: backgroundId || `external-bg-${backgroundUrlParam}`,
      type: (backgroundType as BackgroundItem['type']) || 'video',
      url: resolveBackgroundAssetUrl(backgroundUrlParam),
      thumbnail: resolveBackgroundAssetUrl(backgroundThumbParam || backgroundUrlParam),
      name: 'خلفية مختارة',
      category: fallbackBackground.category,
      slideImages: fallbackBackground.slideImages,
    };

    // Query parameters are user-controlled. A free member can use only an
    // exact catalogue entry (including its approved URL), never an arbitrary
    // URL injected into the query string.  Real catalogue URLs are passed in
    // the normal creation flow, so retain the member's chosen basic image.
    return !isPremium && (!isBasicBackground(candidate.category, candidate.type) || !isFreeBackgroundAsset(candidate))
      ? backgroundImages[0]
      : candidate;
  }, [backgroundUrlParam, fallbackBackground, backgroundId, backgroundType, backgroundThumbParam, isPremium]);
  const totalAyahsInSurah = surah?.numberOfAyahs ?? endAyah;

  // ── Settings state ──────────────────────────────────────────────────────────
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() => {
    const base = {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...getVisualDirection(visualDesignParam).displaySettings,
    };
    const verseDisplayMode = searchParams.get('verseDisplayMode') as DisplaySettings['verseDisplayMode'] | null;
    const animationProfile = searchParams.get('animationProfile') as DisplaySettings['animationProfile'] | null;
    const highlightStyle = searchParams.get('highlightStyle') as DisplaySettings['highlightStyle'] | null;
    const glowStyle = searchParams.get('glowStyle') as DisplaySettings['glowStyle'] | null;
    const textShadowStyle = searchParams.get('textShadowStyle') as DisplaySettings['textShadowStyle'] | null;
    const ayahTransition = searchParams.get('ayahTransition') as DisplaySettings['ayahTransition'] | null;

    return {
      ...base,
      ...(verseDisplayMode ? { verseDisplayMode } : {}),
      ...(animationProfile ? { animationProfile } : {}),
      ...(highlightStyle ? { highlightStyle } : {}),
      ...(glowStyle ? { glowStyle } : {}),
      ...(textShadowStyle ? { textShadowStyle } : {}),
      ...(ayahTransition ? { ayahTransition } : {}),
    };
  });
  const [customBackgroundType, setCustomBackgroundType] = useState<'image' | 'video'>(customBgTypeParam);

  // Resolve custom background: data URLs work directly, video keys need blob resolution
  const [customBackground, setCustomBackground] = useState<string | null>(() => {
    if (!customBgUrlParam) return null;
    // Data, remote and object URLs are already directly usable within this
    // SPA session. Legacy video keys are resolved below for compatibility.
    if (customBgUrlParam.startsWith('data:') || customBgUrlParam.startsWith('http') || customBgUrlParam.startsWith('blob:')) return customBgUrlParam;
    // If it's a video key, resolve from window global
    const blob = (window as any).__customBgBlobs?.[customBgUrlParam];
    if (blob) return URL.createObjectURL(blob);
    // Try sessionStorage fallback
    const storedBlobUrl = sessionStorage.getItem('customBgVideoBlobUrl');
    if (storedBlobUrl) return storedBlobUrl;
    return customBgUrlParam;
  });
  // A deep-linked custom URL stays inert on the free plan, including during
  // the first render before the subscription request finishes.
  const permittedCustomBackground = isPremium ? customBackground : null;

  // Memory cleanup: revoke generated blob URLs when component unmounts or background changes
  useEffect(() => {
    return () => {
      if (customBackground && customBackground.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(customBackground);
        } catch (_err) {
          // Ignore revoke errors on already-released or invalid blob URLs
        }
      }
    };
  }, [customBackground]);

  const [backgroundLoadMethod, setBackgroundLoadMethod] = useState<'direct' | 'proxy' | 'fallback' | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);

  // ── Audio trimming state ────────────────────────────────────────────────────
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  // Sanitize stale presets, deep links, and state restored after a downgrade.
  // Cloud rendering also validates this server-side; this keeps Browser Canvas
  // honest and avoids displaying controls a free plan cannot use.
  useEffect(() => {
    if (subscriptionLoading || isPremium) return;

    setExportSettings((previous) => ({
      ...previous,
      quality: previous.quality === 'ultra' ? 'high' : previous.quality,
      fps: 30,
      audioBitrate: '192k',
      motionSpeed: 1,
    }));
    setTextSettings((previous) => isFreeFont(previous.fontFamily)
      ? previous
      : { ...previous, fontFamily: '"Noto Naskh Arabic", serif' });
    setDisplaySettings((previous) => ({
      ...previous,
      logoWatermarkEnabled: false,
      logoWatermarkUrl: '',
      socialWatermarkEnabled: false,
      watermarkEnabled: false,
      watermarkText: '',
    }));
    audioEffects.setEffects((previous) => ({
      ...previous,
      reverbEnabled: false,
      echoEnabled: false,
      normalizeEnabled: false,
      eqEnabled: false,
      copyrightProtectionEnabled: false,
      pitchShift: 0,
      speedAdjust: 1,
    }));
    if (!canUseFeature('customBackgrounds')) setCustomBackground(null);
  }, [subscriptionLoading, isPremium, canUseFeature, isFreeFont, audioEffects.setEffects]);

  const applyPreset = useCallback((preset: VideoPreset) => {
    if (!canUseFeature('premiumTemplates')) {
      toast.error('القوالب الفاخرة متاحة للعضوية المميزة فقط');
      return;
    }
    setSelectedPresetId(preset.id);
    setDisplaySettings((prev) => ({ ...DEFAULT_DISPLAY_SETTINGS, ...preset.displaySettings, watermarkEnabled: prev.watermarkEnabled, watermarkText: prev.watermarkText, watermarkPosition: prev.watermarkPosition, socialWatermarkEnabled: prev.socialWatermarkEnabled, socialHandle: prev.socialHandle, socialPlatform: prev.socialPlatform, socialWatermarkPosition: prev.socialWatermarkPosition, socialWatermarkSize: prev.socialWatermarkSize, socialWatermarkOpacity: prev.socialWatermarkOpacity, logoWatermarkUrl: prev.logoWatermarkUrl, logoWatermarkEnabled: prev.logoWatermarkEnabled, logoBrandName: prev.logoBrandName, logoSubtitle: prev.logoSubtitle, logoWatermarkPosition: prev.logoWatermarkPosition, logoWatermarkSize: prev.logoWatermarkSize, logoWatermarkOpacity: prev.logoWatermarkOpacity, logoWatermarkPreset: prev.logoWatermarkPreset }));
    if (preset.textSettings) {
      setTextSettings((prev) => ({ ...prev, ...preset.textSettings }));
    }

    setAspectRatio(preset.recommendedAspectRatio);
    const recommended = [...backgroundVideos, ...backgroundImages, ...slideshowBackgrounds].find((item) => item.id === preset.recommendedBackground);
    if (recommended && (isPremium || isFreeBackgroundAsset(recommended))) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('background', recommended.id);
        next.set('backgroundType', recommended.type);
        next.set('backgroundUrl', recommended.url);
        next.set('backgroundThumb', recommended.thumbnail);
        next.set('ratio', preset.recommendedAspectRatio);
        if (preset.displaySettings.visualDesign) next.set('visualDesign', preset.displaySettings.visualDesign);
        return next;
      });
    }
    toast.success(`تم تطبيق قالب "${preset.name}"`);
  }, [canUseFeature, isPremium, setSearchParams]);

  const handleExportSettingsChange = useCallback((newSettings: ExportSettings) => {
    setExportSettings({ ...newSettings, format: (!newSettings.renderEngine || newSettings.renderEngine === 'browser') && newSettings.format === 'webm' ? 'webm' : 'mp4' });
  }, []);

  // ── Ayah data ───────────────────────────────────────────────────────────────
  const [ayahs, setAyahs] = useState<{ numberInSurah: number; text: string }[]>([]);
  const [loadedAyahRangeKey, setLoadedAyahRangeKey] = useState<string | null>(null);
  const [ayahLoadError, setAyahLoadError] = useState(false);
  const [currentAyahIndex, setCurrentAyahIndex] = useState(0);
  const [highlightWordIndex, setHighlightWordIndex] = useState<number | null>(null);
  const [highlightWordProgress, setHighlightWordProgress] = useState(0);

  // ── Transcription state (ibtahalat) ─────────────────────────────────────────
  const [transcribedLines, setTranscribedLines] = useState<{ text: string; start: number; end: number }[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<{ completed: number; total: number } | null>(null);
  const transcribedLinesRef = useRef<{ text: string; start: number; end: number }[]>([]);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);
  const [editingLyricsText, setEditingLyricsText] = useState('');
  const [retranscribeTrigger, setRetranscribeTrigger] = useState(0);
  const [isEditingTiming, setIsEditingTiming] = useState(false);
  const [isRefiningTiming, setIsRefiningTiming] = useState(false);
  const [isRefiningText, setIsRefiningText] = useState(false);

  // ── Playback state ──────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublicVideo, setIsPublicVideo] = useState(false);
  const [discoverTitle, setDiscoverTitle] = useState('');
  const [localSavedVideoId, setLocalSavedVideoId] = useState<string | null>(null);
  useEffect(() => { setIsPublicVideo(false); setDiscoverTitle(''); }, [serverRenderJob.jobId]);
  useEffect(() => { setLocalSavedVideoId(null); }, [videoRecorder.videoBlob]);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [activeTab, setActiveTab] = useState('controls');

  // ── Audio / timing data ─────────────────────────────────────────────────────
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('fallback');

  // QF mode
  const [ayahTimings, setAyahTimings] = useState<(QuranFoundationTimestamp | null)[]>([]);
  const [audioUrl, setAudioUrl] = useState('');
  const [rangeMs, setRangeMs] = useState<{ from: number; to: number } | null>(null);

  // EveryAyah mode – exact timestamps from concatenated audio
  const [everyAyahUrls, setEveryAyahUrls] = useState<string[]>([]);
  const everyAyahIndexRef = useRef(0);
  // Exact timestamps from concatenated audio buffer
  const [everyAyahTimestamps, setEveryAyahTimestamps] = useState<{from: number; to: number}[]>([]);

  // Fallback mode – silence-detected ayah segments
  const [fallbackSegments, setFallbackSegments] = useState<{from: number; to: number}[]>([]);
  const fallbackSegmentsRef = useRef<{from: number; to: number}[]>([]);

  // Exact audio word-timing map (production alignment contract)
  const [activeTimingMap, setActiveTimingMap] = useState<TimingMap | null>(null);
  const activeTimingMapRef = useRef<TimingMap | null>(null);
  const [letterTimingStatus, setLetterTimingStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable' | 'requires-auth' | 'unsupported'>('idle');
  const letterTimingRequestKeyRef = useRef<string | null>(null);

  // Approved word timings are tied to the source audio clock.  Normalize any
  // legacy saved tempo/fingerprint flags as soon as an approved map arrives;
  // the server validator applies the same invariant as a final guard.
  useEffect(() => {
    if (activeTimingMap?.validationStatus !== 'approved') return;
    if (audioEffects.effects.speedAdjust === 1 && !audioEffects.effects.copyrightProtectionEnabled) return;
    audioEffects.setEffects((previous) => ({
      ...previous,
      speedAdjust: 1,
      copyrightProtectionEnabled: false,
    }));
    toast.info('تم تثبيت سرعة الصوت للحفاظ على دقة تزامن الكلمات.');
  }, [activeTimingMap?.validationStatus, audioEffects.effects.speedAdjust, audioEffects.effects.copyrightProtectionEnabled, audioEffects.setEffects]);

  const [timingsLoading, setTimingsLoading] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoPreviewRef = useRef<VideoPreviewRef>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const currentAyahIndexRef = useRef(0);
  const ayahsRef = useRef<{ numberInSurah: number; text: string }[]>([]);
  const recordingUiLastUpdateRef = useRef(0);

  // Keep duration ref in sync without causing callback re-creation
  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  /**
   * One browser scene manifest drives both the visible preview and the local
   * Browser Hybrid recorder. It mirrors the manifest submitted to the three
   * server engines so visual settings cannot disappear only on the client.
   */
  const fullFidelitySceneManifest = useMemo(() => {
    const isTrimmed = trimEnabled && trimEnd > trimStart;
    const qfBaseOffsetMs = playbackMode === 'qf' && rangeMs ? rangeMs.from : 0;
    const effectiveRangeMs = isTrimmed
      ? { from: Math.round(qfBaseOffsetMs + trimStart * 1000), to: Math.round(qfBaseOffsetMs + trimEnd * 1000) }
      : rangeMs;
    const effectiveDuration = Math.max(
      isTrimmed
        ? trimEnd - trimStart
        : rangeMs
          ? (rangeMs.to - rangeMs.from) / 1000
          : duration > 0
            ? duration
            : currentIbtTrack?.duration
              ? parseDurationToSeconds(currentIbtTrack.duration)
              : 0.5,
      0.5,
    );
    const timingMap: TimingMap = activeTimingMap || {
      schemaVersion: '1.0.0',
      mapId: `preview_${surahNumber}_${startAyah}_${endAyah}`,
      reciterId: isIbtahalatMode ? 'ibtahalat' : (reciter?.id || 'reciter'),
      sourceId: 'preview-fallback',
      sourceUrlOrImmutableAssetId: audioUrl || ibtAudioUrl || '',
      audioContentHash: `preview_${isIbtahalatMode ? ibtTrackId || 'track' : reciter?.id || 'reciter'}_${surahNumber}_${startAyah}`,
      decodedDurationMs: effectiveDuration * 1000,
      sampleRate: 44100,
      channels: 2,
      audioProcessingVersion: 'v1',
      surahNumber: Math.max(1, surahNumber),
      ayahRange: { from: Math.max(1, startAyah), to: Math.max(startAyah, endAyah) },
      quranTextVersion: 'uthmani',
      segmentationVersion: 'v1',
      alignerVersion: 'v1',
      sourceMethod: 'forced_alignment',
      validationStatus: 'needs_review',
      createdAt: 'preview',
      words: [],
      gaps: [],
    };
    const resolvedEveryAyahUrls = everyAyahUrls.length > 0
      ? everyAyahUrls
      : playbackMode === 'everyayah' && reciter?.everyAyahSubfolder
        ? Array.from({ length: Math.max(1, endAyah - startAyah + 1) }, (_, index) => getEveryAyahUrl(reciter, surahNumber, startAyah + index))
        : undefined;
    const visibleBackgroundType = permittedCustomBackground
      ? customBackgroundType
      : background?.type === 'animated' || (background?.slideImages && background.slideImages.length > 1)
        ? 'slideshow'
        : background?.type === 'video'
          ? 'video'
          : 'image';
    const visibleBackgroundUrl = permittedCustomBackground || background?.url || '';
    const visibleBackgroundThumbnail = permittedCustomBackground && customBackgroundType === 'image'
      ? permittedCustomBackground
      : background?.thumbnail || (visibleBackgroundType === 'image' ? visibleBackgroundUrl : undefined);
    const sceneDisplaySettings = isIbtahalatMode
      ? { ...displaySettings, showAyahNumber: false }
      : displaySettings;

    return buildClientRenderManifest({
      aspectRatio,
      quality: exportSettings.quality,
      fps: exportSettings.fps ?? 30,
      audioBitrate: exportSettings.audioBitrate ?? '192k',
      motionSpeed: exportSettings.motionSpeed,
      renderEngine: 'browser',
      surah: {
        number: Math.max(1, surahNumber),
        name: isIbtahalatMode ? (ibtTrackTitle || 'ابتهال') : (surah?.name || 'الفاتحة'),
      },
      ayahRange: { start: Math.max(1, startAyah), end: Math.max(startAyah, endAyah) },
      ayahs: ayahs.length > 0 ? ayahs : [{ numberInSurah: 1, text: isIbtahalatMode ? (ibtTrackTitle || 'ابتهال') : 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      reciter: {
        id: isIbtahalatMode ? 'ibtahalat' : (reciter?.id || 'mishary_alafasy'),
        name: isIbtahalatMode ? (ibtPerformerName || 'منشد') : (reciter?.name || 'مشاري العفاسي'),
        quranFoundationId: reciter?.quranFoundationId,
        everyAyahSubfolder: reciter?.everyAyahSubfolder,
      },
      timingMap,
      contentKind: isIbtahalatMode ? 'lyrics' : 'quran',
      lyrics: isIbtahalatMode ? transcribedLines : undefined,
      audio: {
        // QUA uses the same chapter-clock playback path as the legacy QF
        // adapter, but it must remain a distinct source in the manifest so
        // the renderer never labels QUA output as Quran Foundation content.
        sourceMode: isIbtahalatMode || activeTimingMap?.sourceId === 'quranic_universal_audio'
          ? 'single_url'
          : playbackMode === 'qf' ? 'qf' : playbackMode === 'everyayah' ? 'everyayah' : 'single_url',
        audioUrl: audioUrl || ibtAudioUrl || resolvedEveryAyahUrls?.[0] || '',
        audioContentHash: timingMap.audioContentHash,
        durationSeconds: effectiveDuration,
        rangeMs: effectiveRangeMs,
        everyAyahUrls: resolvedEveryAyahUrls,
        everyAyahTimestamps,
      },
      audioEffects: audioEffects.effects,
      background: {
        id: permittedCustomBackground ? 'custom-background' : (background?.id || 'default_bg'),
        type: visibleBackgroundType as 'video' | 'image' | 'slideshow' | 'color',
        url: visibleBackgroundUrl,
        thumbnail: visibleBackgroundThumbnail,
        category: background?.category,
        slideImages: permittedCustomBackground ? undefined : background?.slideImages,
        motionSpeed: exportSettings.motionSpeed,
      },
      textSettings,
      displaySettings: sceneDisplaySettings,
      userId: user?.id,
      idempotencyKey: `preview-${isIbtahalatMode ? ibtTrackId || 'track' : `${surahNumber}-${startAyah}-${endAyah}`}`,
    });
  }, [
    activeTimingMap, aspectRatio, audioEffects.effects, audioUrl, ayahs, background, currentIbtTrack?.duration,
    customBackgroundType, displaySettings, duration, endAyah, everyAyahTimestamps, everyAyahUrls, exportSettings,
    ibtAudioUrl, ibtPerformerName, ibtTrackId, ibtTrackTitle, isIbtahalatMode, permittedCustomBackground,
    playbackMode, rangeMs, reciter, startAyah, surah?.name, surahNumber, textSettings, transcribedLines,
    trimEnabled, trimEnd, trimStart, user?.id,
  ]);

  const getFullFidelityFrameTime = useCallback(() => {
    const audioTime = audioRef.current?.currentTime || 0;
    if (trimEnabled && trimEnd > trimStart) {
      const qfBase = playbackMode === 'qf' && rangeMs ? rangeMs.from / 1000 : 0;
      return Math.max(0, audioTime - qfBase - trimStart);
    }
    if (rangeMs) return Math.max(0, audioTime - rangeMs.from / 1000);
    return Math.max(0, audioTime);
  }, [playbackMode, rangeMs, trimEnabled, trimEnd, trimStart]);

  const transcribingAudioUrlRef = useRef<string | null>(null);
  const transcriptionDoneUrlRef = useRef<string | null>(null);

  // Sync subscription render quotas upon completion
  useEffect(() => {
    if (serverRenderJob.isCompleted) {
      refetchUsage();
    }
  }, [serverRenderJob.isCompleted, refetchUsage]);

  // ── Reset transcription state when switching ibtahalat tracks ────────────────
  const prevIbtAudioUrlRef = useRef(ibtAudioUrl);
  useEffect(() => {
    if (isIbtahalatMode && ibtAudioUrl && ibtAudioUrl !== prevIbtAudioUrlRef.current) {
      prevIbtAudioUrlRef.current = ibtAudioUrl;
      transcriptionDoneUrlRef.current = null;
      transcribingAudioUrlRef.current = null;
      // Reset old transcription so new track gets transcribed
      setTranscribedLines([]);
      transcribedLinesRef.current = [];
      setTranscriptionError(false);
      setIsTranscribing(false);
      setTranscriptionProgress(null);
      setCurrentAyahIndex(0);
    }
  }, [ibtAudioUrl, isIbtahalatMode]);

  // Helper to apply predefined lyrics lines with proportional timestamps
  const applyPredefinedLyrics = useCallback((targetDuration?: number) => {
    if (!predefinedLyricsLines || predefinedLyricsLines.length === 0) {
      if (ibtTrackTitle) {
        setAyahs([{ numberInSurah: 1, text: ibtTrackTitle }]);
      }
      return false;
    }
    const totalSec = targetDuration || durationRef.current || (currentIbtTrack?.duration ? parseDurationToSeconds(currentIbtTrack.duration) : 60);
    const segDur = Math.max(totalSec / predefinedLyricsLines.length, 1);
    const baseline = predefinedLyricsLines.map((text, i) => ({
      text,
      start: Math.round(i * segDur * 100) / 100,
      end: Math.round((i + 1) * segDur * 100) / 100,
    }));
    setTranscribedLines(baseline);
    transcribedLinesRef.current = baseline;
    setAyahs(baseline.map((line, i) => ({ numberInSurah: i + 1, text: line.text })));
    return true;
  }, [predefinedLyricsLines, currentIbtTrack, ibtTrackTitle]);

  // ── Load ayah texts (Quran mode) / Transcribe audio (Ibtahalat mode) ───────
  useEffect(() => {
    if (isIbtahalatMode) {
      setLoadedAyahRangeKey(null);
      setAyahLoadError(false);
      // Check cache first
      const cacheKey = getAudioCacheKey(ibtAudioUrl);
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const data = JSON.parse(cached) as { lines: { text: string; start: number; end: number }[] };
          if (data?.lines?.length > 0) {
            setTranscribedLines(data.lines);
            transcribedLinesRef.current = data.lines;
            setAyahs(data.lines.map((line, i) => ({ numberInSurah: i + 1, text: line.text })));
            transcriptionDoneUrlRef.current = ibtAudioUrl;
            toast.success(`تم تحميل ${data.lines.length} سطر من الذاكرة المؤقتة`);
            return;
          }
        } catch { /* ignore bad cache */ }
      }

      // If no cache, initialize immediately with catalog lyrics so user never sees an empty preview
      const hasCatalogLyrics = applyPredefinedLyrics();

      // Transcribe audio using chunked client-side processing
      if (ibtAudioUrl && transcribingAudioUrlRef.current !== ibtAudioUrl && transcriptionDoneUrlRef.current !== ibtAudioUrl) {
        transcribingAudioUrlRef.current = ibtAudioUrl;
        setIsTranscribing(true);
        setTranscriptionProgress(null);

        transcribeFullAudio(ibtAudioUrl, (completed, total) => {
          setTranscriptionProgress({ completed, total });
          console.log(`📝 Transcription progress: ${completed}/${total} chunks`);
        })
          .then((data) => {
            if (data?.lines && data.lines.length > 0) {
              setTranscribedLines(data.lines);
              transcribedLinesRef.current = data.lines;
              const transcribedAyahs = data.lines.map((line, i) => ({
                numberInSurah: i + 1,
                text: line.text,
              }));
              setAyahs(transcribedAyahs);
              setTranscriptionError(false);
              transcriptionDoneUrlRef.current = ibtAudioUrl;
              // Save to cache
              try {
                localStorage.setItem(cacheKey, JSON.stringify({ lines: data.lines }));
              } catch {
                /* quota */
              }
              toast.success(`تم تفريغ ${data.lines.length} سطر من الابتهال ومزامنتها بنجاح`);
            } else {
              console.warn('No lines in transcription result, falling back to catalog lyrics');
              if (hasCatalogLyrics || predefinedLyricsLines.length > 0) {
                applyPredefinedLyrics();
                setTranscriptionError(false);
                toast.info('تم تفعيل الكلمات المعتمدة للابتهال وتنسيقها مع الصوت');
              } else {
                setTranscriptionError(true);
              }
            }
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.warn('Transcription AI fallback activated:', message);
            if (hasCatalogLyrics || predefinedLyricsLines.length > 0) {
              applyPredefinedLyrics();
              setTranscriptionError(false);
              toast.info('تم تفعيل الكلمات المعتمدة للابتهال وتنسيقها مع الصوت');
            } else {
              setTranscriptionError(true);
              toast.error('تعذر نسخ كلمات الابتهال تلقائياً');
            }
          })
          .finally(() => {
            transcribingAudioUrlRef.current = null;
            setIsTranscribing(false);
            setTranscriptionProgress(null);
          });
      }
      return;
    }
    let requestIsCurrent = true;
    // Invalidate both the old text and media while the selected reference is
    // loading. A late response from a previous same-length range must never be
    // accepted as this request's Quran text.
    setAyahs([]);
    setLoadedAyahRangeKey(null);
    setAyahLoadError(false);
    setTimingsLoading(true);
    setAudioLoaded(false);
    setAudioError(false);
    setIsPlaying(false);
    setAudioUrl('');
    setActiveTimingMap(null);
    activeTimingMapRef.current = null;
    const loadData = async () => {
      const data = await fetchAyahs(surahNumber, startAyah, endAyah);
      if (!requestIsCurrent) return;
      const isCompleteRange = Boolean(data)
        && data!.length === Math.max(0, endAyah - startAyah + 1)
        && data!.every((ayah, index) => ayah.numberInSurah === startAyah + index && Boolean(ayah.text?.trim()));
      if (!data || !isCompleteRange) {
        setAyahLoadError(true);
        setTimingsLoading(false);
        return;
      }
      // Keep canonical Quran text untouched; this exact ordered reference is
      // the one the approved timing provider receives.
      setAyahs(data);
      setLoadedAyahRangeKey(requestedAyahRangeKey);
    };
    void loadData();
    return () => { requestIsCurrent = false; };
  }, [isIbtahalatMode, ibtTrackTitle, ibtAudioUrl, surahNumber, startAyah, endAyah, requestedAyahRangeKey, fetchAyahs, retranscribeTrigger, applyPredefinedLyrics, predefinedLyricsLines]);

  useEffect(() => {
    currentAyahIndexRef.current = currentAyahIndex;
  }, [currentAyahIndex]);

  useEffect(() => {
    ayahsRef.current = ayahs;
  }, [ayahs]);

  const currentAyahWords = useMemo(() => {
    const text = ayahs[currentAyahIndex]?.text ?? '';
    return tokenizeQuranicText(text);
  }, [ayahs, currentAyahIndex]);

  // ── Load audio strategy ─────────────────────────────────────────────────────
  useEffect(() => {
    // Ibtahalat mode: simple direct audio URL, no complex sync
    if (isIbtahalatMode) {
      setAudioUrl(ibtAudioUrl);
      setPlaybackMode('fallback');
      setTimingsLoading(false);
      setAudioLoaded(false);
      setAyahTimings([]);
      setRangeMs(null);
      return;
    }

    if (!reciter) return;
    const expectedAyahCount = Math.max(0, endAyah - startAyah + 1);
    // Audio and alignment are a single transaction.  Waiting for the current
    // Quran reference prevents the first render from sending an empty/stale
    // ayah list and then silently falling back to verse-only timing.
    if (!isAyahRangeReady({
      loadedKey: loadedAyahRangeKey,
      requestedKey: requestedAyahRangeKey,
      startAyah,
      endAyah,
      ayahs,
    }) || ayahs.length !== expectedAyahCount) return;
    let cancelled = false;

    const load = async () => {
      setTimingsLoading(true);
      setAudioError(false);
      setAudioLoaded(false);
      setIsPlaying(false);
      setCurrentAyahIndex(0);
      setHighlightWordIndex(null);
      setHighlightWordProgress(0);
      setProgress(0);
      setCurrentTime(0);
      setDuration(0);
      setEveryAyahUrls([]);
      setEveryAyahTimestamps([]);
      everyAyahIndexRef.current = 0;
      setActiveTimingMap(null);
      activeTimingMapRef.current = null;

      // ── Strategy 1: QUA v3.2.0 – paired chapter audio + canonical word tier ──
      // The pinned timing release supplies the paired chapter URL via its
      // catalog, so no separately guessed reciter URL can drift.
      if (reciter.quranUniversalSlug && !cancelled) {
        try {
          const targetGranularity = displaySettings.verseDisplayMode === 'letterByLetter' ? 'letter' : 'word';
          const universal = await api.alignments.resolveUniversal({
            reciterId: String(reciter.id),
            reference: {
              surahNumber,
              startAyah,
              endAyah,
              ayahs,
              quranTextVersion: 'uthmani_hafs_v1',
            },
            providerInput: { reciterSlug: reciter.quranUniversalSlug },
            granularity: targetGranularity,
          });
          if (!cancelled && universal.timingMap?.validationStatus === 'approved') {
            const universalMap = universal.timingMap as TimingMap;
            const offsets = (universalMap.compositionOffsets || []).map((offset) => ({
              verse_key: `${surahNumber}:${offset.ayahNumber}`,
              timestamp_from: offset.startMs,
              timestamp_to: offset.endMs,
            }));
            const first = offsets[0];
            const last = offsets[offsets.length - 1];
            if (!first || !last || !(last.timestamp_to > first.timestamp_from)) throw new Error('UNIVERSAL_ALIGNMENT_RANGE_INVALID');
            setAudioUrl(universal.audioUrl);
            setAyahTimings(offsets);
            setRangeMs({ from: first.timestamp_from, to: last.timestamp_to });
            setDuration((last.timestamp_to - first.timestamp_from) / 1000);
            setPlaybackMode('qf');
            timingMapRegistry.register(universalMap);
            setActiveTimingMap(universalMap);
            activeTimingMapRef.current = universalMap;
            if (universalMap.alignment?.availableGranularities?.includes('letter') && universalMap.words.every((w) => Boolean(w.letters?.length))) {
              setLetterTimingStatus('available');
            }
            console.log(`✅ QUA word map loaded [${reciter.quranUniversalSlug}]`);
            setTimingsLoading(false);
            return;
          }
        } catch (universalError) {
          console.info('QUA alignment unavailable for this range; trying exact EveryAyah fallback', universalError);
        }
      }

      // Legacy Quran Foundation strategy is intentionally disabled. Production
      // audio uses the internal alignment pipeline or an explicitly unaligned
      // fallback; no external timing source is accepted here.
      if (legacyQuranFoundationEnabled() && reciter.quranFoundationId) {
        try {
          const audioFile = await fetchChapterRecitationAudioById(reciter.quranFoundationId, surahNumber, true);
          const all = audioFile.timestamps ?? [];

          const byIndex: (QuranFoundationTimestamp | null)[] = Array.from(
            { length: endAyah - startAyah + 1 },
            (_, i) => {
              const key = `${surahNumber}:${startAyah + i}`;
              return all.find((t) => t.verse_key === key) ?? null;
            }
          );

          const existing = byIndex.filter(Boolean) as QuranFoundationTimestamp[];

          if (existing.length > 0 && !cancelled) {
            const from = existing[0].timestamp_from;
            const to = existing[existing.length - 1].timestamp_to;
            setAudioUrl(audioFile.audio_url);
            setAyahTimings(byIndex);
            setRangeMs({ from, to });
            setDuration(Math.max((to - from) / 1000, 0));
            setPlaybackMode('qf');

            // Exact word timing is accepted only from the authenticated server
            // alignment route.  The browser response is retained solely as a
            // review draft when the server/provider is unavailable; it can
            // never silently become a renderable approved map.
            let timingMap: TimingMap | null = null;
            if (isAuthenticated) {
              try {
                const trusted = await api.alignments.resolve({
                  providerId: 'quran_foundation',
                  reciterId: String(reciter.id),
                  granularity: 'word',
                  reference: {
                    surahNumber,
                    startAyah,
                    endAyah,
                    ayahs,
                    quranTextVersion: 'uthmani_hafs_v1',
                  },
                  providerInput: { recitationId: reciter.quranFoundationId },
                });
                if (!cancelled && trusted.timingMap) {
                  timingMap = trusted.timingMap as TimingMap;
                  console.log(`✅ Server-attested QF TimingMap [status: ${timingMap.validationStatus}]`);
                }
              } catch (serverAlignmentError) {
                console.warn('Server QF alignment unavailable; keeping timing in review mode', serverAlignmentError);
              }
            }

            if (!timingMap && !cancelled) {
              const reviewTimestamps = existing.map((timestamp) => ({
                ...timestamp,
                // QF may include one-value marker rows. Keep only complete
                // triplets in this provisional draft; missing coverage stays
                // visibly unapproved and must be corrected/re-fetched.
                segments: (timestamp.segments || []).filter((segment) => (
                  Array.isArray(segment)
                  && segment.length === 3
                  && Number.isFinite(Number(segment[0]))
                  && Number.isFinite(Number(segment[1]))
                  && Number.isFinite(Number(segment[2]))
                  && Number(segment[2]) > Number(segment[1])
                )) as QuranFoundationTimestamp['segments'],
              }));
              timingMap = normalizeQuranFoundationSegmentsToTimingMap({
                reciterId: String(reciter.id),
                providerRecitationId: reciter.quranFoundationId,
                surahNumber,
                startAyah,
                endAyah,
                audioUrl: audioFile.audio_url,
                audioContentHash: `unverified-qf-source:${reciter.id}:${surahNumber}:${audioFile.audio_url.split('/').pop() || 'recitation'}`,
                decodedDurationMs: to,
                sampleRate: 44100,
                channels: 2,
                qfTimestamps: reviewTimestamps,
                ayahsText: ayahs.map((a) => ({ numberInSurah: a.numberInSurah, text: a.text })),
              });
              timingMap.review = {
                status: 'unreviewed',
                note: 'هذه مسودة من بيانات المتصفح؛ يلزم اعتماد الخادم وبصمة الصوت قبل التحريك أو النشر.',
              };
              const reviewValidation = validateTimingMap(timingMap);
              timingMap.validationStatus = reviewValidation.validationStatus;
              timingMap.diagnostics = {
                ...(timingMap.diagnostics || {}),
                validationMetrics: reviewValidation.metrics,
                errors: reviewValidation.errors,
                warnings: reviewValidation.warnings,
                audioFingerprint: 'unverified',
                serverAttestation: 'unavailable',
              };
            }

            if (timingMap && !cancelled) {
              timingMapRegistry.register(timingMap);
              setActiveTimingMap(timingMap);
              activeTimingMapRef.current = timingMap;
              console.log(`✅ QF TimingMap registered [status: ${timingMap.validationStatus}]`);
            }

            console.log(`✅ QF mode – word-level sync, range ${from}–${to}ms`);
            setTimingsLoading(false);
            return;
          }
        } catch (e) {
          console.warn('QF failed, trying EveryAyah…', e);
        }
      }

      // ── Strategy 2: EveryAyah – concatenate individual files into one seamless audio ──
      if (reciter.everyAyahSubfolder && !cancelled) {
        const urls: string[] = [];
        for (let n = startAyah; n <= endAyah; n++) {
          urls.push(getEveryAyahUrl(reciter, surahNumber, n));
        }
        try {
          console.log(`⏳ Concatenating ${urls.length} ayah files into seamless audio…`);
          const result = await concatenateAudioUrls(urls, (loaded, total) => {
            console.log(`  📥 Downloaded ${loaded}/${total} ayah files`);
          });
          if (cancelled) return;

          setEveryAyahUrls(urls);
          setEveryAyahTimestamps(result.timestamps);
          setAudioUrl(result.blobUrl);
          setRangeMs(null); // No range needed – the blob IS the exact range
          setDuration(result.totalDuration);
          setPlaybackMode('everyayah');
          everyAyahIndexRef.current = 0;

          // Start with verse boundaries so playback remains usable even when
          // the pinned word dataset has no exact row for this range.
          let eaTimingMap = buildAudioAlignedTimingMap({
            reciterId: String(reciter.id),
            surahNumber,
            startAyah,
            endAyah,
            audioUrl: urls[0] || result.blobUrl,
            audioContentHash: result.audioContentHash,
            decodedDurationMs: result.totalDuration * 1000,
            sampleRate: 44100,
            channels: 2,
            ayahs: result.timestamps.map((ts, idx) => ({
              numberInSurah: startAyah + idx,
              text: ayahs[idx]?.text || '',
              audioStartMs: ts.from * 1000,
              audioEndMs: ts.to * 1000,
            })),
          });

          // quran-align is a pinned CC-BY word dataset for the exact
          // EveryAyah folders it names. It is deliberately opt-in and
          // fail-closed: the server rejects multi-word source segments rather
          // than inventing proportional boundaries.
          if (reciter.everyAyahSubfolder) {
            try {
              const known = await api.alignments.resolveKnown({
                reciterId: String(reciter.id),
                audio: {
                  contentHash: result.audioContentHash,
                  durationMs: result.totalDuration * 1000,
                  sampleRate: 44100,
                  channels: 2,
                },
                reference: {
                  surahNumber,
                  startAyah,
                  endAyah,
                  ayahs,
                  quranTextVersion: 'uthmani_hafs_v1',
                },
                providerInput: {
                  everyAyahSubfolder: reciter.everyAyahSubfolder,
                  audioTimestamps: result.timestamps,
                },
              });
              if (!cancelled && known.timingMap?.validationStatus === 'approved') {
                eaTimingMap = known.timingMap as TimingMap;
                console.log(`✅ quran-align word map loaded [${reciter.everyAyahSubfolder}]`);
              }
            } catch (knownAlignmentError) {
              console.info('Pinned word map unavailable for this range; keeping verse-only timing', knownAlignmentError);
            }
          }
          timingMapRegistry.register(eaTimingMap);
          setActiveTimingMap(eaTimingMap);
          activeTimingMapRef.current = eaTimingMap;

          console.log(`✅ EveryAyah mode – seamless concatenated audio, ${urls.length} ayahs, total ${result.totalDuration.toFixed(1)}s [status: ${eaTimingMap.validationStatus}]`);
          setTimingsLoading(false);
          return;
        } catch (e) {
          console.warn('EveryAyah concatenation failed, falling back…', e);
        }
      }

      // ── Strategy 3: fallback audio without word alignment ───────────────────
      if (!cancelled) {
        const url = getAudioUrl(reciter, surahNumber);
        setAyahTimings([]);
        setRangeMs(null);
        setFallbackSegments([]);
        fallbackSegmentsRef.current = [];
        setAudioUrl(url);
        setPlaybackMode('fallback');
        setActiveTimingMap(null);
        activeTimingMapRef.current = null;
        console.log(`⚠️ Fallback mode – full surah audio, word animation disabled until alignment is reviewed`);
      }

      if (!cancelled) setTimingsLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [isIbtahalatMode, ibtAudioUrl, reciter, reciter?.id, reciter?.quranFoundationId, reciter?.everyAyahSubfolder, reciter?.quranUniversalSlug, surahNumber, startAyah, endAyah, totalAyahsInSurah, requestedAyahRangeKey, loadedAyahRangeKey, ayahs.length, ayahs, user?.id]);

  // Letter animation is an opt-in precision tier. Load QUA's pinned letter
  // paint annotations only when selected; word playback remains fast and does
  // not inflate every reciter package with the larger research tier.
  useEffect(() => {
    if (isIbtahalatMode || displaySettings.verseDisplayMode !== 'letterByLetter') {
      letterTimingRequestKeyRef.current = null;
      setLetterTimingStatus('idle');
      return;
    }
    if (activeTimingMap?.alignment?.availableGranularities?.includes('letter')
      && activeTimingMap.words.length > 0
      && activeTimingMap.words.every((word) => Boolean(word.letters?.length))) {
      setLetterTimingStatus('available');
      return;
    }
    if (!reciter?.quranUniversalSlug) {
      setLetterTimingStatus('unsupported');
      return;
    }
    if (timingsLoading || !isAyahRangeReady({
      loadedKey: loadedAyahRangeKey,
      requestedKey: requestedAyahRangeKey,
      startAyah,
      endAyah,
      ayahs,
    })) {
      setLetterTimingStatus('loading');
      return;
    }
    if (!activeTimingMap || activeTimingMap.sourceId !== 'quranic_universal_audio') {
      setLetterTimingStatus('unavailable');
      return;
    }

    const requestKey = `${reciter.id}:${requestedAyahRangeKey}:${activeTimingMap.mapId}`;
    if (letterTimingRequestKeyRef.current === requestKey) return;
    letterTimingRequestKeyRef.current = requestKey;
    let cancelled = false;
    setLetterTimingStatus('loading');
    api.alignments.resolveUniversal({
      reciterId: String(reciter.id),
      reference: {
        surahNumber,
        startAyah,
        endAyah,
        ayahs,
        quranTextVersion: 'uthmani_hafs_v1',
      },
      providerInput: { reciterSlug: reciter.quranUniversalSlug },
      granularity: 'letter',
    }).then((result) => {
      if (cancelled) return;
      const letterMap = result.timingMap as TimingMap;
      const hasCompleteLetterTier = result.accepted
        && letterMap?.validationStatus === 'approved'
        && letterMap.alignment?.availableGranularities?.includes('letter')
        && letterMap.words.length > 0
        && letterMap.words.every((word) => Boolean(word.letters?.length));
      if (!hasCompleteLetterTier) {
        setLetterTimingStatus('unavailable');
        return;
      }
      timingMapRegistry.register(letterMap);
      activeTimingMapRef.current = letterMap;
      setActiveTimingMap(letterMap);
      setLetterTimingStatus('available');
    }).catch((error) => {
      if (cancelled) return;
      console.info('QUA letter-paint tier unavailable for this reader/range', error);
      setLetterTimingStatus('unavailable');
    });

    return () => {
      cancelled = true;
      if (letterTimingRequestKeyRef.current === requestKey) letterTimingRequestKeyRef.current = null;
    };
  }, [isIbtahalatMode, displaySettings.verseDisplayMode, activeTimingMap, reciter, reciter?.id, reciter?.quranUniversalSlug, surahNumber, startAyah, endAyah, requestedAyahRangeKey, loadedAyahRangeKey, ayahs, timingsLoading]);

  // ── Audio effects init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current && audioLoaded && !audioError) {
      audioEffects.initializeAudio(audioRef.current);
    }
  }, [audioLoaded, audioError]);

  // ── Derived range helpers (QF / fallback only) ──────────────────────────────
  const rangeStartSec = rangeMs ? rangeMs.from / 1000 : 0;
  const rangeEndSec = rangeMs ? rangeMs.to / 1000 : 0;

  // ── Audio event handlers ────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // ── loadedmetadata ──────────────────────────────────────────────────────
    const handleLoadedMetadata = () => {
      if (playbackMode === 'qf' && rangeMs) {
        setDuration(Math.max((rangeMs.to - rangeMs.from) / 1000, 0));
        setAudioLoaded(true);
        setAudioError(false);
        return;
      }

      if (playbackMode === 'everyayah') {
        // Concatenated audio – duration is exact, no mapping needed
        setDuration(audio.duration);
        setAudioLoaded(true);
        setAudioError(false);
        return;
      }

      // Fallback audio has no authenticated range or word alignment.
      const totalDur = audio.duration;
      if (isIbtahalatMode) {
        // Ibtahalat: play entire file, no range estimation needed
        setDuration(totalDur);
        setRangeMs(null);
        console.log(`🎵 Ibtahalat mode – full audio ${totalDur.toFixed(1)}s`);
        if (predefinedLyricsLines.length > 0 && transcribedLinesRef.current.length === predefinedLyricsLines.length) {
          const segDur = Math.max(totalDur / predefinedLyricsLines.length, 1);
          const updated = predefinedLyricsLines.map((text, i) => ({
            text,
            start: Math.round(i * segDur * 100) / 100,
            end: Math.round((i + 1) * segDur * 100) / 100,
          }));
          setTranscribedLines(updated);
          transcribedLinesRef.current = updated;
        }
      } else if (totalAyahsInSurah > 0 && totalDur > 0) {
        const estFrom = ((startAyah - 1) / totalAyahsInSurah) * totalDur;
        const estTo = (endAyah / totalAyahsInSurah) * totalDur;
        setRangeMs({ from: estFrom * 1000, to: estTo * 1000 });
        setDuration(Math.max(estTo - estFrom, 1));
        console.log(`⚠️ Fallback audio range is a playback convenience only; no ayah or word timing is treated as exact.`);
      } else {
        setDuration(totalDur);
      }
      setAudioLoaded(true);
      setAudioError(false);
    };

    // ── timeupdate ───────────────────────────────────────────────────────────
    const handleTimeUpdate = () => {
      const nowSec = audio.currentTime;
      const nowMs = nowSec * 1000;
      const isRecordingNow = videoRecorder.isRecording;

      const updateTimeline = (timeSec: number, percent: number) => {
        if (isRecordingNow) {
          const ts = performance.now();
          if (ts - recordingUiLastUpdateRef.current < 250) return;
          recordingUiLastUpdateRef.current = ts;
        }
        setCurrentTime(timeSec);
        setProgress(percent);
      };

      // ── Audio trim mode (Quran & Ibtahalat) ─────────────────────────────
      if (trimEnabled && trimEnd > trimStart) {
        const qfBaseSec = (playbackMode === 'qf' && rangeMs) ? rangeMs.from / 1000 : 0;
        const actualStart = qfBaseSec + trimStart;
        const actualEnd = qfBaseSec + trimEnd;
        if (nowSec >= actualEnd) {
          audio.pause();
          audio.currentTime = actualStart;
          setIsPlaying(false);
          setCurrentTime(0);
          setProgress(0);
          return;
        }
        const relativeSec = Math.max(nowSec - actualStart, 0);
        const totalSec = Math.max(trimEnd - trimStart, 0.001);
        updateTimeline(relativeSec, Math.min((relativeSec / totalSec) * 100, 100));
        // Use transcribed timestamps if available
        const tLines = transcribedLinesRef.current;
        if (tLines.length > 0) {
          let foundIdx = 0;
          for (let i = tLines.length - 1; i >= 0; i--) {
            if (nowSec >= tLines[i].start) { foundIdx = i; break; }
          }
          if (foundIdx !== currentAyahIndexRef.current) setCurrentAyahIndex(foundIdx);
        } else {
          const lyricsCount = ayahsRef.current.length;
          if (lyricsCount > 0) {
            const lineIndex = Math.min(Math.floor((relativeSec / totalSec) * lyricsCount), lyricsCount - 1);
            if (lineIndex !== currentAyahIndexRef.current) setCurrentAyahIndex(lineIndex);
          }
        }
        return;
      }

      // ── Ibtahalat full mode (no trim) ───────────────────────────────────
      if (isIbtahalatMode && !trimEnabled) {
        const totalSec = Math.max(audio.duration, 0.001);
        updateTimeline(nowSec, Math.min((nowSec / totalSec) * 100, 100));
        // Use transcribed timestamps if available for accurate sync
        const tLines = transcribedLinesRef.current;
        if (tLines.length > 0) {
          let foundIdx = 0;
          for (let i = tLines.length - 1; i >= 0; i--) {
            if (nowSec >= tLines[i].start) { foundIdx = i; break; }
          }
          if (foundIdx !== currentAyahIndexRef.current) setCurrentAyahIndex(foundIdx);
        } else {
          const lyricsCount = ayahsRef.current.length;
          if (lyricsCount > 0) {
            const lineIndex = Math.min(Math.floor((nowSec / totalSec) * lyricsCount), lyricsCount - 1);
            if (lineIndex !== currentAyahIndexRef.current) setCurrentAyahIndex(lineIndex);
          }
        }
        return;
      }

      // ── QF mode ─────────────────────────────────────────────────────────
      if (playbackMode === 'qf' && rangeMs) {
        const totalSec = Math.max((rangeMs.to - rangeMs.from) / 1000, 0.001);

        if (nowSec >= rangeEndSec) {
          audio.pause();
          audio.currentTime = rangeStartSec;
          setIsPlaying(false);
          setCurrentAyahIndex(0);
          setHighlightWordIndex(null);
          setHighlightWordProgress(0);
          setCurrentTime(0);
          setProgress(0);
          return;
        }

        const relativeSec = Math.max(nowSec - rangeStartSec, 0);
        updateTimeline(relativeSec, Math.min((relativeSec / totalSec) * 100, 100));

        // Find current verse
        for (let i = ayahTimings.length - 1; i >= 0; i--) {
          const t = ayahTimings[i];
          if (!t) continue;
          if (nowMs >= t.timestamp_from) {
            if (i !== currentAyahIndexRef.current) setCurrentAyahIndex(i);

            const currentAyahObj = ayahsRef.current[i];
            const ayahWords = tokenizeQuranicText(currentAyahObj?.text ?? '');

            if (activeTimingMapRef.current && activeTimingMapRef.current.words && activeTimingMapRef.current.words.length > 0) {
              const res = resolveActiveWordAtTime(activeTimingMapRef.current, nowMs);
              let localWordIdx = res.wordIndexInAyah ?? res.activeWordIndex;
              if (res.ayahNumber != null && currentAyahObj) {
                if (res.ayahNumber === currentAyahObj.numberInSurah) {
                  localWordIdx = res.wordIndexInAyah ?? 0;
                } else if (res.ayahNumber > currentAyahObj.numberInSurah) {
                  const targetIdx = ayahsRef.current.findIndex((a) => a.numberInSurah === res.ayahNumber);
                  if (targetIdx !== -1 && targetIdx !== currentAyahIndexRef.current) {
                    setCurrentAyahIndex(targetIdx);
                  }
                  localWordIdx = res.wordIndexInAyah ?? 0;
                } else {
                  localWordIdx = 0;
                }
              }
              const boundedIdx = localWordIdx != null ? Math.min(Math.max(localWordIdx, 0), Math.max(ayahWords.length - 1, 0)) : 0;
              setHighlightWordIndex(boundedIdx);
              setHighlightWordProgress(res.wordProgress);
            } else {
              // Quran Foundation's verse boundary alone is not a word map.
              // Do not turn it into a fabricated word-by-word animation.
              setHighlightWordIndex(null);
              setHighlightWordProgress(0);
            }
            break;
          }
        }
        return;
      }

      // ── EveryAyah mode (concatenated seamless audio) ──────────────────────
      if (playbackMode === 'everyayah' && everyAyahTimestamps.length > 0) {
        const totalSec = Math.max(audio.duration, 0.001);

        if (nowSec >= totalSec - 0.05) {
          audio.pause();
          audio.currentTime = 0;
          setIsPlaying(false);
          setCurrentAyahIndex(0);
          setHighlightWordIndex(null);
          setHighlightWordProgress(0);
          setCurrentTime(0);
          setProgress(0);
          return;
        }

        updateTimeline(nowSec, Math.min((nowSec / totalSec) * 100, 100));

        // Find current ayah based on exact timestamps
        for (let i = everyAyahTimestamps.length - 1; i >= 0; i--) {
          if (nowSec >= everyAyahTimestamps[i].from) {
            if (i !== currentAyahIndexRef.current) {
              setCurrentAyahIndex(i);
            }

            const currentAyahObj = ayahsRef.current[i];
            const ayahWords = tokenizeQuranicText(currentAyahObj?.text ?? '');

            if (activeTimingMapRef.current && activeTimingMapRef.current.words && activeTimingMapRef.current.words.length > 0) {
              const res = resolveActiveWordAtTime(activeTimingMapRef.current, nowMs);
              let localWordIdx = res.wordIndexInAyah ?? res.activeWordIndex;
              if (res.ayahNumber != null && currentAyahObj) {
                if (res.ayahNumber === currentAyahObj.numberInSurah) {
                  localWordIdx = res.wordIndexInAyah ?? 0;
                } else if (res.ayahNumber > currentAyahObj.numberInSurah) {
                  const targetIdx = ayahsRef.current.findIndex((a) => a.numberInSurah === res.ayahNumber);
                  if (targetIdx !== -1 && targetIdx !== currentAyahIndexRef.current) {
                    setCurrentAyahIndex(targetIdx);
                  }
                  localWordIdx = res.wordIndexInAyah ?? 0;
                } else {
                  localWordIdx = 0;
                }
              }
              const boundedIdx = localWordIdx != null ? Math.min(Math.max(localWordIdx, 0), Math.max(ayahWords.length - 1, 0)) : 0;
              setHighlightWordIndex(boundedIdx);
              setHighlightWordProgress(res.wordProgress);
            } else {
              // EveryAyah supplies exact ayah boundaries, not exact words.
              setHighlightWordIndex(null);
              setHighlightWordProgress(0);
            }
            break;
          }
        }
        return;
      }

      // ── Fallback mode ────────────────────────────────────────────────────
      if (rangeMs) {
        const estStartSec = rangeMs.from / 1000;
        const estEndSec = rangeMs.to / 1000;
        const totalSec = Math.max(estEndSec - estStartSec, 0.001);

        if (nowSec >= estEndSec) {
          audio.pause();
          audio.currentTime = estStartSec;
          setIsPlaying(false);
          setCurrentAyahIndex(0);
          setHighlightWordIndex(null);
          setHighlightWordProgress(0);
          setCurrentTime(0);
          setProgress(0);
          return;
        }

        const relativeSec = Math.max(nowSec - estStartSec, 0);
        updateTimeline(relativeSec, Math.min((relativeSec / totalSec) * 100, 100));

        const ayahsCount = ayahsRef.current.length;
        const segs = fallbackSegmentsRef.current;

        if (ayahsCount > 0) {
          let estimatedIndex = 0;

          if (segs.length === ayahsCount) {
            // Use silence-detected segments for precise ayah tracking
            for (let i = 0; i < segs.length; i++) {
              if (nowSec >= segs[i].from && nowSec < segs[i].to) {
                estimatedIndex = i;
                break;
              }
              if (i === segs.length - 1) estimatedIndex = i;
            }
          } else {
            // Without attested ayah boundaries do not pretend that duration
            // slices locate recitation text. Keep the stable first ayah.
            estimatedIndex = 0;
          }

          if (estimatedIndex !== currentAyahIndexRef.current) setCurrentAyahIndex(estimatedIndex);

          // Silence is safer than a guessed word event. The shared harness
          // receives the same unreviewed map and therefore stays static too.
          setHighlightWordIndex(null);
          setHighlightWordProgress(0);
        }
      } else {
        updateTimeline(nowSec, audio.duration > 0 ? (nowSec / audio.duration) * 100 : 0);
      }
    };

    // ── ended ────────────────────────────────────────────────────────────────
    const handleEnded = () => {
      // EveryAyah now uses ranged single-file, so handled by timeupdate range check.
      // QF / fallback / everyayah all reset the same way.
      setIsPlaying(false);
      setCurrentAyahIndex(0);
      setHighlightWordIndex(null);
      setHighlightWordProgress(0);
      setCurrentTime(0);
      setProgress(0);
      if (rangeMs) audio.currentTime = rangeMs.from / 1000;
      else audio.currentTime = 0;
    };

    const handleError = () => {
      // Ignore initial state when audioUrl has not loaded yet or points to the page URL
      if (!audio.src || !audioUrl || audio.src === window.location.href || audio.src.endsWith('/preview')) {
        return;
      }
      console.error('Audio error for', audio.src);
      setAudioError(true);
      setAudioLoaded(true);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('error', handleError);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [
    playbackMode, rangeMs, ayahTimings,
    rangeStartSec, rangeEndSec,
    totalAyahsInSurah, startAyah, endAyah,
    everyAyahTimestamps,
    videoRecorder.isRecording,
    isIbtahalatMode, trimEnabled, trimStart, trimEnd,
  ]);

  // Format time helper
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Play / Pause ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    if (!audioRef.current) return;
    await audioEffects.resumeContext();

    const audio = audioRef.current;

    if (isPlaying) {
      audio.pause();
      return;
    }

    // If trim is enabled (ibtahalat mode), use trim range
    if (trimEnabled && isIbtahalatMode && trimStart >= 0 && trimEnd > trimStart) {
      if (audio.currentTime < trimStart || audio.currentTime >= trimEnd) {
        audio.currentTime = trimStart;
      }
      audio.play().catch((err) => {
        console.error('Audio play error:', err);
        toast.error('حدث خطأ في تشغيل الصوت');
      });
      return;
    }

    // EveryAyah: concatenated blob, play from start (no range)
    if (playbackMode === 'everyayah') {
      // If at end, restart
      if (audio.currentTime >= audio.duration - 0.1) {
        audio.currentTime = 0;
      }
    } else if (rangeMs) {
      if (audio.currentTime < rangeStartSec || audio.currentTime >= rangeEndSec) {
        audio.currentTime = rangeStartSec;
      }
    }
    audio.play().catch((err) => {
      console.error('Audio play error:', err);
      toast.error('حدث خطأ في تشغيل الصوت');
    });
  }, [isPlaying, audioEffects, rangeMs, rangeStartSec, rangeEndSec, playbackMode, trimEnabled, isIbtahalatMode, trimStart, trimEnd]);

  // ── Mute ───────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  // ── Skip ayah (QF + EveryAyah) ─────────────────────────────────────────────
  const skipAyah = (direction: 'forward' | 'backward') => {
    const audio = audioRef.current;
    if (!audio) return;

    // Ibtahalat mode: skip by proportional time
    if (isIbtahalatMode) {
      const totalDur = trimEnabled && trimEnd > trimStart ? trimEnd - trimStart : audio.duration;
      const baseTime = trimEnabled && trimEnd > trimStart ? trimStart : 0;
      const lyricsCount = ayahs.length;
      if (lyricsCount <= 0) return;
      const newIndex = direction === 'forward'
        ? Math.min(currentAyahIndex + 1, lyricsCount - 1)
        : Math.max(currentAyahIndex - 1, 0);
      const targetTime = baseTime + (newIndex / lyricsCount) * totalDur;
      audio.currentTime = targetTime;
      setCurrentAyahIndex(newIndex);
      return;
    }

    if (playbackMode === 'everyayah' && everyAyahTimestamps.length > 0) {
      const newIndex = direction === 'forward'
        ? Math.min(currentAyahIndex + 1, ayahs.length - 1)
        : Math.max(currentAyahIndex - 1, 0);
      const ts = everyAyahTimestamps[newIndex];
      if (ts) {
        audio.currentTime = ts.from;
        setCurrentAyahIndex(newIndex);
      }
      return;
    }

    if (playbackMode === 'qf' && ayahTimings.length > 0) {
      const newIndex = direction === 'forward'
        ? Math.min(currentAyahIndex + 1, ayahs.length - 1)
        : Math.max(currentAyahIndex - 1, 0);
      const timing = ayahTimings[newIndex];
      if (timing) {
        audio.currentTime = timing.timestamp_from / 1000;
        setCurrentAyahIndex(newIndex);
        setHighlightWordIndex(null);
        setHighlightWordProgress(0);
      }
    }
  };

  // ── Video recording ─────────────────────────────────────────────────────────
  const handleServerExport = async (options?: { backgroundAsync?: boolean }): Promise<boolean> => {
    if (!isAuthenticated || !user) {
      toast.error('سجّل الدخول أولاً لاستخدام الريندر السحابي وحفظ حصتك اليومية.');
      navigate('/auth');
      return false;
    }

    // Do not let a click race the subscription fetch. The free-plan
    // sanitising effect below must finish before either export path snapshots
    // settings, otherwise a stale deep link could briefly request a premium
    // visual setting in Browser Canvas.
    if (subscriptionLoading) {
      toast.info('جارٍ التحقق من مزايا خطتك، حاول مرة أخرى خلال لحظات.');
      return false;
    }

    if (!audioLoaded || audioError) {
      toast.error('يرجى الانتظار حتى اكتمال تحميل الصوت قبل بدء الريندر');
      return false;
    }

    const previewApi = videoPreviewRef.current;
    if (!previewApi) {
      toast.error('حدث خطأ في تجهيز المعاينة');
      return false;
    }

    if (permittedCustomBackground?.startsWith('blob:')) {
      toast.error('لتصدير الفيديو المرفوع، اختر التسجيل على جهازك. للإنتاج السحابي اختر فيديو Pexels أو خلفية صور مدعومة.');
      return false;
    }

    // Do not rely solely on the sanitising effect above: a member can click
    // export during the initial subscription load or immediately after a
    // downgrade.  The API independently enforces this too, while this local
    // snapshot keeps the requested render faithful to the visible free plan.
    const exportSettingsForPlan: ExportSettings = isPremium
      ? exportSettings
      : {
        ...exportSettings,
        quality: exportSettings.quality === 'ultra' ? 'high' : exportSettings.quality,
        fps: 30,
        audioBitrate: '192k',
        motionSpeed: 1,
      };

    try {
      const audio = audioRef.current;
      let effectiveDuration = duration;
      let effectiveRangeMs = rangeMs;

      // Audio trim mode handling (both Quran and Ibtahalat)
      if (trimEnabled && trimEnd > trimStart) {
        effectiveDuration = Math.max(trimEnd - trimStart, 0.5);
        const baseOffsetMs = (playbackMode === 'qf' && rangeMs) ? rangeMs.from : 0;
        effectiveRangeMs = {
          from: Math.round(baseOffsetMs + trimStart * 1000),
          to: Math.round(baseOffsetMs + trimEnd * 1000),
        };
      } else if (rangeMs) {
        effectiveDuration = Math.max((rangeMs.to - rangeMs.from) / 1000, 1);
      } else if (audio && audio.duration > 0) {
        effectiveDuration = audio.duration;
      }

      // Resolve canonical audio configuration for server-side deterministic rendering
      let resolvedAudioUrl = audioUrl;
      let resolvedEveryAyahUrls = (everyAyahUrls && everyAyahUrls.length > 0) ? [...everyAyahUrls] : [];

      if (
        playbackMode === 'everyayah' ||
        resolvedAudioUrl.startsWith('blob:') ||
        (!resolvedAudioUrl && reciter?.everyAyahSubfolder)
      ) {
        if (resolvedEveryAyahUrls.length === 0 && reciter?.everyAyahSubfolder) {
          resolvedEveryAyahUrls = Array.from(
            { length: endAyah - startAyah + 1 },
            (_, i) => getEveryAyahUrl(reciter, surahNumber, startAyah + i)
          );
        }
        if (resolvedEveryAyahUrls.length > 0) {
          resolvedAudioUrl = resolvedEveryAyahUrls[0];
        } else if (reciter) {
          resolvedAudioUrl = getEveryAyahUrl(reciter, surahNumber, startAyah);
        }
      }

      // Build fallback TimingMap if none present
      const resolvedTimingMap: TimingMap = activeTimingMap || {
        schemaVersion: '1.0.0',
        mapId: `map_${surahNumber}_${startAyah}_${endAyah}`,
        reciterId: reciter?.id || 'reciter',
        sourceId: 'fallback',
        sourceUrlOrImmutableAssetId: resolvedAudioUrl || '',
        audioContentHash: `hash_${reciter?.id || 'reciter'}_${surahNumber}_${startAyah}`,
        decodedDurationMs: effectiveDuration * 1000,
        sampleRate: 44100,
        channels: 2,
        audioProcessingVersion: 'v1',
        surahNumber,
        ayahRange: { from: startAyah, to: endAyah },
        quranTextVersion: 'uthmani',
        segmentationVersion: 'v1',
        alignerVersion: 'v1',
        sourceMethod: 'forced_alignment',
        validationStatus: 'needs_review',
        createdAt: new Date().toISOString(),
        words: [],
        gaps: [],
      };

      const resolvedBgType = (permittedCustomBackground
        ? (customBackgroundType || 'image')
        : (background?.type === 'animated' || (background?.type as string) === 'slideshow' || (background?.slideImages && background.slideImages.length > 1)
            ? 'slideshow'
            : background?.type === 'video'
            ? 'video'
            : (background?.type as string) === 'color'
            ? 'color'
            : 'image')) as 'video' | 'image' | 'slideshow' | 'color';

      const resolvedBgUrl = (permittedCustomBackground && !permittedCustomBackground.startsWith('blob:'))
        ? permittedCustomBackground
        : (background?.url || '');

      // An AI-generated or uploaded premium image is the selected source of
      // truth, not the thumbnail of the previously selected catalogue item.
      // This lets the cloud renderer preload the same image visible in the
      // browser preview.
      let resolvedBgThumb = permittedCustomBackground && customBackgroundType === 'image'
        ? permittedCustomBackground
        : (background?.thumbnail || (resolvedBgUrl.startsWith('http') && !resolvedBgUrl.endsWith('.mp4') ? resolvedBgUrl : undefined));
      if (resolvedBgThumb && resolvedBgThumb.includes('images.unsplash.com')) {
        resolvedBgThumb = resolvedBgThumb.replace(/w=\d+/, 'w=1920').replace(/q=\d+/, 'q=85');
        if (!resolvedBgThumb.includes('w=')) {
          resolvedBgThumb += (resolvedBgThumb.includes('?') ? '&' : '?') + 'w=1920&q=85';
        }
      }

      const manifest = buildClientRenderManifest({
        aspectRatio,
        quality: exportSettingsForPlan.quality,
        fps: exportSettingsForPlan.fps ?? 30,
        audioBitrate: exportSettingsForPlan.audioBitrate ?? '192k',
        motionSpeed: exportSettingsForPlan.motionSpeed,
        renderEngine: (exportSettings.renderEngine as any) || 'ffmpeg_ass',
        backgroundAsync: options?.backgroundAsync ?? false,
        surah: { number: surahNumber, name: surah?.name || 'الفاتحة' },
        ayahRange: { start: startAyah, end: endAyah },
        ayahs,
        reciter: {
          id: reciter?.id || 'mishary_alafasy',
          name: reciter?.name || 'مشاري العفاسي',
          quranFoundationId: reciter?.quranFoundationId,
          everyAyahSubfolder: reciter?.everyAyahSubfolder,
        },
        timingMap: resolvedTimingMap,
        contentKind: isIbtahalatMode ? 'lyrics' : 'quran',
        lyrics: isIbtahalatMode ? transcribedLines : undefined,
        audio: {
          // Keep QUA on the chapter-clock path while preserving its own
          // provenance in the manifest; qf is reserved for legacy QF maps.
          sourceMode: activeTimingMap?.sourceId === 'quranic_universal_audio'
            ? 'single_url'
            : playbackMode === 'qf' ? 'qf' : playbackMode === 'everyayah' ? 'everyayah' : 'single_url',
          audioUrl: resolvedAudioUrl || '',
          audioContentHash: resolvedTimingMap.audioContentHash,
          durationSeconds: effectiveDuration,
          rangeMs: effectiveRangeMs,
          everyAyahUrls: resolvedEveryAyahUrls.length > 0 ? resolvedEveryAyahUrls : undefined,
          everyAyahTimestamps,
        },
        audioEffects: audioEffects.effects,
        background: {
          id: background?.id || 'default_bg',
          type: resolvedBgType,
          url: resolvedBgUrl,
          thumbnail: resolvedBgThumb,
          category: background?.category,
          slideImages: background?.slideImages,
          motionSpeed: exportSettingsForPlan.motionSpeed,
        },
        textSettings,
        displaySettings: isIbtahalatMode ? { ...displaySettings, showAyahNumber: false } : displaySettings,
        userId: user?.id,
      });

      const violations = validateCloudRenderLimits(plan, manifest);
      if (violations.length) throw new Error(violations[0]);
      if (!cloudPolicy?.enabledEngines.includes(manifest.renderEngine as any)) {
        throw new Error('طريقة الإنتاج المختارة غير متاحة حاليًا. اختر طريقة متاحة من إعدادات التصدير.');
      }
      toast.info('جارٍ إرسال الفيديو إلى طابور الإنتاج السحابي...');
      // Keep an existing export alive. A second click must never cancel a
      // healthy render; the explicit cancel action is the user's choice.
      await serverRenderJob.startServerRender(manifest, undefined, {
        replaceActive: false,
        backgroundAsync: options?.backgroundAsync ?? false,
      });
      refetchUsage();
      return true;
    } catch (err: any) {
      console.error('Server render job failed to start:', err);
      toast.error(err.message || 'فشل بدء عملية الريندر على الخادم');
      refetchUsage();
      return false;
    }
  };

  const handleLegacyBrowserRecording = async () => {
    if (!isAuthenticated || !user) {
      toast.error('سجّل الدخول أولاً لبدء التسجيل على جهازك.');
      navigate('/auth');
      return;
    }

    if (subscriptionLoading) {
      toast.info('جارٍ التحقق من مزايا خطتك، حاول مرة أخرى خلال لحظات.');
      return;
    }

    // Do this before claiming a Browser Canvas quota slot. It avoids charging
    // a free member for a recording that cannot contain the selected audio.
    if (!audioLoaded || audioError) {
      toast.error('يرجى الانتظار حتى اكتمال تحميل الصوت قبل بدء التسجيل');
      return;
    }

    const previewApi = videoPreviewRef.current;
    if (!previewApi) {
      toast.error('حدث خطأ في تجهيز التسجيل');
      return;
    }

    if (!previewApi.isBackgroundReady()) {
      toast.error('يرجى الانتظار حتى اكتمال تحميل الخلفية قبل التسجيل');
      return;
    }

    // This endpoint is the atomic source of truth for the 5/day free allowance.
    const canCreate = await incrementUsage();
    if (!canCreate) {
      toast.error('استخدمت جميع عمليات التسجيل المتاحة اليوم. الخطة المجانية تشمل 5 عمليات يومياً؛ تتجدد الحصة غداً أو يمكنك الترقية.');
      return;
    }

    try {
      await audioEffects.resumeContext();
      await previewApi.ensureBackgroundPlayback();

      // The browser path is local, so it must apply the same plan snapshot as
      // the cloud request instead of trusting a delayed React state update.
      const exportSettingsForPlan: ExportSettings = isPremium
        ? exportSettings
        : {
          ...exportSettings,
          quality: exportSettings.quality === 'ultra' ? 'high' : exportSettings.quality,
          fps: 30,
          audioBitrate: '192k',
          motionSpeed: 1,
        };

      // Determine recording duration based on playback mode
      const audio = audioRef.current;
      let recordingDuration: number;
      let recordingStartAt = 0;

      // Any trimmed source (Quran or Ibtahalat) is represented by the same
      // local scene clock. Paired chapter audio remains absolute at the audio
      // element, while the harness receives a zero-based frame time.
      if (trimEnabled && trimEnd > trimStart) {
        recordingDuration = trimEnd - trimStart;
        recordingStartAt = (playbackMode === 'qf' && rangeMs ? rangeMs.from / 1000 : 0) + trimStart;
      } else if (playbackMode === 'everyayah') {
        recordingDuration = audio && audio.duration > 0 ? audio.duration : 60;
        recordingStartAt = 0;
      } else if (rangeMs) {
        recordingDuration = Math.max((rangeMs.to - rangeMs.from) / 1000, 1);
        recordingStartAt = rangeMs.from / 1000;
      } else {
        recordingDuration = audio && audio.duration > 0 ? audio.duration : 60;
        recordingStartAt = 0;
      }

      type RecordingAttemptKey = 'smooth' | 'compatibility' | 'quality';
      type RecordingAttempt = {
        id: RecordingAttemptKey;
        label: string;
        renderMode: 'recording' | 'recordingLite';
        fps: 30 | 60;
        quality: ExportQuality;
        recorderOptions: {
          strategy: 'smooth' | 'compatibility' | 'quality';
          bitrateMultiplier: number;
          timesliceMs: number;
          mimeTypeCandidates: string[];
          captureStreamFps: number;
          audioBitrate: '128k' | '192k' | '320k';
          forceMp4Transcode: boolean;
        };
      };

      const selectedQuality = exportSettingsForPlan.quality;
      const selectedFps = exportSettingsForPlan.fps ?? 30;
      const selectedAudioBitrate = exportSettingsForPlan.audioBitrate ?? '192k';
      // A native recorder may claim MP4 support while ignoring 60fps or AAC
      // bitrate requests. For those premium outputs we always post-process
      // locally into a constant-frame-rate MP4.
      // Native MediaRecorder MP4 is variable-rate too. Always normalize the
      // final output to the selected FPS and audio bitrate before sharing.
      const requiresDeterministicMp4 = exportSettingsForPlan.format === 'mp4';
      const preferredMimeCandidates = exportSettingsForPlan.format === 'webm'
        ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
        : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];

      const attemptsByMode: Record<RecordingAttemptKey, RecordingAttempt> = {
        quality: {
          id: 'quality',
          label: 'جودة قصوى (1080p/4K)',
          renderMode: 'recording',
          fps: selectedFps,
          quality: selectedQuality,
          recorderOptions: {
            strategy: 'quality',
            bitrateMultiplier: 1.0,
            timesliceMs: 1500,
            mimeTypeCandidates: preferredMimeCandidates,
            captureStreamFps: selectedFps,
            audioBitrate: selectedAudioBitrate,
            forceMp4Transcode: requiresDeterministicMp4,
          },
        },
        smooth: {
          id: 'smooth',
          label: 'سلس عالي الجودة',
          renderMode: 'recording',
          fps: selectedFps,
          quality: selectedQuality,
          recorderOptions: {
            strategy: 'smooth',
            bitrateMultiplier: 0.95,
            timesliceMs: 1800,
            mimeTypeCandidates: preferredMimeCandidates,
            captureStreamFps: selectedFps,
            audioBitrate: selectedAudioBitrate,
            forceMp4Transcode: requiresDeterministicMp4,
          },
        },
        compatibility: {
          id: 'compatibility',
          label: 'توافق قياسي',
          renderMode: 'recording',
          fps: selectedFps,
          quality: selectedQuality,
          recorderOptions: {
            strategy: 'compatibility',
            bitrateMultiplier: 0.9,
            timesliceMs: 2000,
            mimeTypeCandidates: preferredMimeCandidates,
            captureStreamFps: selectedFps,
            audioBitrate: selectedAudioBitrate,
            forceMp4Transcode: requiresDeterministicMp4,
          },
        },
      };

      // Auto mode prioritizes pristine quality first, falling back only on unrecoverable hardware failure
      const selectedMode: RecordingAttemptKey = exportSettingsForPlan.recordingMethod === 'auto' ? 'quality' : exportSettingsForPlan.recordingMethod;
      const attempts = exportSettingsForPlan.recordingMethod === 'auto'
        ? [attemptsByMode.quality, attemptsByMode.smooth, attemptsByMode.compatibility]
        : [attemptsByMode[selectedMode]];

      let lastError: unknown = null;

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        let stopIsolatedLoop: (() => void) | null = null;

        try {
          const recordingCanvas = document.createElement('canvas');
          // Preserve full backing-store resolution matching user target
          const recordingDimensions = getQualityDimensions(attempt.quality, aspectRatio);
          recordingCanvas.width = recordingDimensions.width;
          recordingCanvas.height = recordingDimensions.height;

          const frameInterval = Math.max(1000 / attempt.fps, 16);
          let rafId: number | null = null;
          let watchdogTimerId: number | null = null;
          let lastFrameTime = 0;
          let stopped = false;
          let isDrawing = false;

          const drawIsolatedFrame = async () => {
            if (isDrawing || stopped) return;
            isDrawing = true;
            try {
              const livePreviewApi = videoPreviewRef.current;
              const draw = livePreviewApi?.drawFrame ?? previewApi.drawFrame;
              // Ground-truth audio clock position for sub-frame synchronization.
              // The frame itself is now resolved by the shared render-harness,
              // exactly as it is for all three server engines.
              const currentAudioSec = audio ? audio.currentTime : recordingStartAt;
              const frameTimeSeconds = Math.max(0, Math.min(recordingDuration, currentAudioSec - recordingStartAt));
              await draw(recordingCanvas, attempt.renderMode, frameTimeSeconds);
              // Push frame to capture stream
              videoRecorder.requestFrame();

              // Mirror frame to on-screen preview so preview NEVER freezes during recording
              const previewCanvas = livePreviewApi?.getCanvas();
              if (previewCanvas && previewCanvas !== recordingCanvas) {
                const pCtx = previewCanvas.getContext('2d');
                if (pCtx) {
                  pCtx.drawImage(recordingCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
                }
              }
            } catch (e) {
              console.error('Frame draw error during recording:', e);
            } finally {
              isDrawing = false;
            }
          };

          const renderIsolatedFrame = (now: number) => {
            if (stopped) return;
            rafId = requestAnimationFrame(renderIsolatedFrame);
            if (now - lastFrameTime + 0.5 < frameInterval) return;
            lastFrameTime = now;
            void drawIsolatedFrame();
          };

          stopIsolatedLoop = () => {
            stopped = true;
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            if (watchdogTimerId !== null) {
              clearInterval(watchdogTimerId);
              watchdogTimerId = null;
            }
          };

          // Establish the exact source position before the first scene frame.
          // The render loop starts only after this warm-up, so a stale preview
          // clock can never become frame zero of the recording.
          if (audio) {
            audio.pause();
            audio.currentTime = recordingStartAt;
          }

          // Warm up isolated canvas before captureStream starts
          await new Promise((resolve) => setTimeout(resolve, 100));
          await drawIsolatedFrame();

          // Dual-clock watchdog heartbeat: ensures frames continue even if tab
          // is backgrounded. It intentionally begins after the warm-up frame.
          watchdogTimerId = window.setInterval(() => {
            if (stopped) return;
            const now = performance.now();
            if (now - lastFrameTime >= frameInterval * 1.35) {
              lastFrameTime = now;
              void drawIsolatedFrame();
            }
          }, Math.round(frameInterval / 2));

          lastFrameTime = 0;
          rafId = requestAnimationFrame(renderIsolatedFrame);

          toast.info(
            exportSettingsForPlan.recordingMethod === 'auto'
              ? `بدء التسجيل بجودة فائقة (${attempt.label})...`
              : 'بدء التسجيل...'
          );

          const blob = await videoRecorder.startRecording(
            recordingCanvas,
            audio,
            recordingDuration,
            audioEffects.getRecordingStream(),
            attempt.quality,
            attempt.fps,
            {
              ...attempt.recorderOptions,
              startAtSeconds: recordingStartAt,
            }
          );

          if (blob) {
            toast.success('تم إنشاء الفيديو بنجاح!');
            // Auto-trigger MP4 conversion if MP4 requested and blob is WebM
            if (exportSettingsForPlan.format === 'mp4' && (!blob.type.includes('mp4') || requiresDeterministicMp4)) {
              videoRecorder.convertToMp4().catch((err) => {
                console.warn('Auto MP4 conversion error:', err);
              });
            }
            return;
          }

          lastError = new Error('لم يتم إنشاء ملف فيديو');
        } catch (error) {
          lastError = error;

          if (i < attempts.length - 1) {
            videoRecorder.reset();
            toast.warning(`فشل وضع "${attempt.label}"، سيتم تجربة وضع بديل...`);
            await previewApi.ensureBackgroundPlayback();
          }
        } finally {
          stopIsolatedLoop?.();
        }
      }

      throw lastError instanceof Error ? lastError : new Error('حدث خطأ في التسجيل');
    } catch (error) {
      console.error('Recording error:', error);
      toast.error('فشل التسجيل على هذا الوضع. جرّب طريقة توافق أعلى أو جودة أقل.');
    }
  };

  const handleStartExport = async () => {
    const engine = exportSettings.renderEngine || 'browser';
    if (engine === 'browser') {
      await handleLegacyBrowserRecording();
    } else {
      // Every non-local engine is submitted independently. Idea 3 is already
      // an asynchronous cloud engine; it must never silently switch to Idea 1
      // or Idea 2 through a background flag.
      await handleServerExport({ backgroundAsync: false });
    }
  };


  // ── Filename helpers ────────────────────────────────────────────────────────
  const toSafeFilename = useCallback((input: string) => {
    const s = input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return (s || 'quran-reel').slice(0, 80);
  }, []);

  const downloadFilename = useMemo(() => {
    const base = isIbtahalatMode
      ? `ibtahal-${ibtTrackTitle.slice(0, 30)}`
      : `${surah?.englishName || surah?.name || 'quran'}-${reciter?.id || 'reciter'}`;
    return `${toSafeFilename(base)}.${exportSettings.renderEngine === 'browser' && exportSettings.format === 'webm' ? 'webm' : 'mp4'}`;
  }, [isIbtahalatMode, ibtTrackTitle, surah?.englishName, surah?.name, reciter?.id, toSafeFilename, exportSettings.format, exportSettings.renderEngine]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = useCallback((format: ExportFormat) => {
    const baseFilename = toSafeFilename(
      isIbtahalatMode
        ? `ibtahal-${ibtTrackTitle.slice(0, 30)}`
        : `${surah?.englishName || surah?.name || 'quran'}-${reciter?.id || 'reciter'}`
    );
    switch (format) {
      case 'webm':
        videoRecorder.downloadWebm(`${baseFilename}.webm`);
        break;
      case 'mp4':
        if (videoRecorder.mp4Blob) videoRecorder.downloadMp4(`${baseFilename}.mp4`);
        else toast.error('ملف MP4 غير جاهز بعد');
        break;

    }
  }, [surah, reciter, toSafeFilename, videoRecorder, isIbtahalatMode, ibtTrackTitle]);

  // ── Save to library ─────────────────────────────────────────────────────────
  const handlePublishCloud = async () => {
    if (!serverRenderJob.jobId || isSaving) return;
    setIsSaving(true);
    try {
      await api.videos.update(serverRenderJob.jobId, { is_public: !isPublicVideo, ...(discoverTitle.trim() ? { surah_name: discoverTitle.trim() } : {}) });
      setIsPublicVideo(!isPublicVideo);
      toast.success(isPublicVideo ? 'أصبح الفيديو خاصاً' : 'تمت مشاركة الفيديو في اكتشف');
    } catch (error: any) { toast.error(error?.message || 'تعذر تحديث المشاركة'); }
    finally { setIsSaving(false); }
  };
  const handleSave = async () => {
    if (!isAuthenticated || !user) {
      toast.error('الرجاء تسجيل الدخول لحفظ الفيديو');
      navigate('/auth');
      return;
    }
    setIsSaving(true);
    try {
      if (localSavedVideoId) {
        await api.videos.update(localSavedVideoId, { is_public: false });
        toast.success('المشروع محفوظ بالفعل في مكتبتك');
        return;
      }
      const saved = await api.videos.create({
        surah_number: isIbtahalatMode ? 0 : surahNumber,
        surah_name: isIbtahalatMode ? `ابتهال: ${ibtTrackTitle}` : (surah?.name || ''),
        reciter_id: isIbtahalatMode ? 'ibtahalat' : reciterId,
        reciter_name: isIbtahalatMode ? ibtPerformerName : (reciter?.name || ''),
        start_ayah: isIbtahalatMode ? 0 : startAyah,
        end_ayah: isIbtahalatMode ? 0 : endAyah,
        background_type: backgroundType,
        aspect_ratio: aspectRatio,
        is_public: false,
      });
      setLocalSavedVideoId(saved.id);
      toast.success('تم حفظ بيانات المشروع في مكتبتك. احتفظ بملف MP4 على جهازك.');
    } catch (err) {
      console.error('Error saving video:', err);
      toast.error('حدث خطأ في حفظ الفيديو');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Mode label & Timing status ─────────────────────────────────────────────
  const modeLabel = (() => {
    if (isIbtahalatMode) return null; // Ibtahalat uses direct URL, no sync warning needed
    if (playbackMode === 'qf') return null; // QF mode has full word-level sync
    if (playbackMode === 'everyayah') return 'تلاوة الآيات المحددة';
    return 'توقيت الآيات تقريبي لهذه التلاوة';
  })();

  const timingStatusBadge = (() => {
    if (isIbtahalatMode) {
      return (
        <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary bg-primary/10">
          <Sparkles className="w-3.5 h-3.5" />
          عرض الكلمات مع الصوت
        </Badge>
      );
    }
    if (activeTimingMap?.validationStatus === 'approved') {
      return (
        <Badge variant="outline" className="text-xs gap-1.5 border-emerald-500/40 text-emerald-400 bg-emerald-500/10 py-0.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          تظليل الكلمات مع التلاوة
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs gap-1.5 border-amber-500/40 text-amber-400 bg-amber-500/10 py-0.5">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
        التزامن الدقيق للكلمات غير متاح لهذه التلاوة
      </Badge>
    );
  })();

  const canSkip = playbackMode === 'qf' || playbackMode === 'everyayah' || isIbtahalatMode;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-sm text-muted-foreground mb-6"
        >
          <Link to={isIbtahalatMode ? "/ibtahalat" : "/create"} className="hover:text-primary transition-colors">
            {isIbtahalatMode ? 'ابتهالات وتواشيح' : 'إنشاء فيديو'}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span>المعاينة</span>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Video Preview */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="preview-scroll-rail w-full lg:flex-1 flex justify-center"
            ref={previewContainerRef}
          >
            <VideoPreview
              ref={videoPreviewRef}
              background={background}
              customBackground={permittedCustomBackground}
              customBackgroundType={customBackgroundType}
              surahName={isIbtahalatMode ? ibtTrackTitle : (surah?.name || '')}
              reciterName={isIbtahalatMode ? ibtPerformerName : (reciter?.name || '')}
              currentAyah={ayahs[currentAyahIndex] || null}
              currentAyahWords={currentAyahWords}
              highlightedWordIndex={highlightWordIndex}
              highlightWordProgress={highlightWordProgress}
              aspectRatio={aspectRatio}
              textSettings={textSettings}
              displaySettings={isIbtahalatMode ? { ...displaySettings, showAyahNumber: false } : displaySettings}
              isPlaying={isPlaying}
              isRecording={videoRecorder.isRecording}
              motionSpeed={exportSettings.motionSpeed}
              onBackgroundLoadMethod={setBackgroundLoadMethod}
              ibtahalatLyricsMode={isIbtahalatMode && transcribedLines.length > 1}
              allLyricsLines={isIbtahalatMode && transcribedLines.length > 1 ? transcribedLines.map(l => l.text) : []}
              currentLyricsIndex={currentAyahIndex}
              audioProgress={duration > 0 ? currentTime / duration : 0}
              isPremium={isPremium}
              sceneManifest={fullFidelitySceneManifest}
              getFrameTimeSeconds={getFullFidelityFrameTime}
            />


            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              preload={audioUrl ? "auto" : "none"}
              crossOrigin="anonymous"
            />

          </motion.div>

          {/* Controls */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-md mx-auto lg:mx-0 space-y-4"
          >
            {/* Info Card */}
            <Card>
              <CardContent className="p-4">
                <h3 className="text-xl font-bold">{isIbtahalatMode ? ibtTrackTitle : surah?.name}</h3>
                <p className="text-muted-foreground text-sm">
                  {isIbtahalatMode
                    ? ibtPerformerName
                    : `الآيات ${startAyah} - ${endAyah} | ${reciter?.name}`}
                </p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {timingStatusBadge}
                </div>
                {modeLabel && (
                  <p className={`text-xs mt-1.5 ${playbackMode === 'everyayah' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                    {modeLabel}
                  </p>
                )}
                {isIbtahalatMode && isTranscribing && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1 text-xs text-amber-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {transcriptionProgress
                        ? `جارٍ نسخ الجزء ${transcriptionProgress.completed} من ${transcriptionProgress.total}...`
                        : 'جارٍ تحميل الصوت وتحضيره للنسخ...'}
                    </div>
                    {transcriptionProgress && transcriptionProgress.total > 0 && (
                      <Progress
                        value={(transcriptionProgress.completed / transcriptionProgress.total) * 100}
                        className="h-2"
                      />
                    )}
                  </div>
                )}
                {isIbtahalatMode && !isEditingLyrics && !isEditingTiming && (
                  <div className="mt-2 space-y-2">
                    {transcribedLines.length > 0 ? (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ✅ تم نسخ وضبط {transcribedLines.length} سطر — مزامنة مع الصوت
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        ℹ️ جاري معالجة الكلمات وتزامنها مع الصوت
                      </p>
                    )}
                    <SettingsSection title="أدوات الكلمات والتوقيت">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setIsEditingLyrics(true);
                          const currentLyrics = transcribedLines.length > 0
                            ? transcribedLines.map(l => l.text).join('\n')
                            : (predefinedLyricsLines.length > 0 ? predefinedLyricsLines.join('\n') : ayahs.map(a => a.text).join('\n'));
                          setEditingLyricsText(currentLyrics);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        تعديل الكلمات
                      </Button>
                      {predefinedLyricsLines.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => {
                            applyPredefinedLyrics();
                            toast.success('تم استعادة الكلمات المعتمدة للابتهال وتنسيقها');
                          }}
                        >
                          <BookOpen className="h-3 w-3" />
                          استعادة الكلمات المعتمدة
                        </Button>
                      )}
                      {transcribedLines.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => setIsEditingTiming(true)}
                        >
                          <Clock className="h-3 w-3" />
                          تعديل التوقيت
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={isTranscribing}
                        onClick={() => {
                          const cacheKey = getAudioCacheKey(ibtAudioUrl);
                          localStorage.removeItem(cacheKey);
                          transcriptionDoneUrlRef.current = null;
                          transcribingAudioUrlRef.current = null;
                          setTranscribedLines([]);
                          transcribedLinesRef.current = [];
                          setTranscriptionError(false);
                          setRetranscribeTrigger(prev => prev + 1);
                          toast.info('جارٍ إعادة تفريغ ونسخ الكلمات...');
                        }}
                      >
                        <RefreshCw className={`h-3 w-3 ${isTranscribing ? 'animate-spin' : ''}`} />
                        إعادة النسخ بالذكاء الاصطناعي
                      </Button>
                      {transcribedLines.length > 0 && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={isRefiningTiming}
                            onClick={async () => {
                              setIsRefiningTiming(true);
                              toast.info('جارٍ تحسين التوقيت بالذكاء الاصطناعي...');
                              try {
                                const data = await api.services.refineTiming(transcribedLines, duration);
                                if (data?.refinedLines) {
                                  setTranscribedLines(data.refinedLines);
                                  transcribedLinesRef.current = data.refinedLines;
                                  setAyahs(data.refinedLines.map((l: { text: string }, i: number) => ({ numberInSurah: i + 1, text: l.text })));
                                  const cacheKey = getAudioCacheKey(ibtAudioUrl);
                                  try { localStorage.setItem(cacheKey, JSON.stringify({ lines: data.refinedLines })); } catch { /* ignore storage error */ }
                                  toast.success('تم تحسين التوقيت بنجاح!');
                                }
                              } catch (err: unknown) {
                                console.error('Refine timing error:', err);
                                const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
                                toast.error('فشل تحسين التوقيت: ' + msg);
                              } finally {
                                setIsRefiningTiming(false);
                              }
                            }}
                          >
                            {isRefiningTiming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                            تحسين التوقيت
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={isRefiningText}
                            onClick={async () => {
                              setIsRefiningText(true);
                              toast.info('جارٍ تحسين الكلمات بالذكاء الاصطناعي...');
                              try {
                                const data = await api.services.refineText(transcribedLines);
                                if (data?.refinedLines) {
                                  setTranscribedLines(data.refinedLines);
                                  transcribedLinesRef.current = data.refinedLines;
                                  setAyahs(data.refinedLines.map((l: { text: string }, i: number) => ({ numberInSurah: i + 1, text: l.text })));
                                  const cacheKey = getAudioCacheKey(ibtAudioUrl);
                                  try { localStorage.setItem(cacheKey, JSON.stringify({ lines: data.refinedLines })); } catch { /* ignore storage error */ }
                                  toast.success('تم تحسين الكلمات بنجاح! ✨');
                                }
                              } catch (err: unknown) {
                                console.error('Refine text error:', err);
                                const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
                                toast.error('فشل تحسين الكلمات: ' + msg);
                              } finally {
                                setIsRefiningText(false);
                              }
                            }}
                          >
                            {isRefiningText ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            تحسين الكلمات ✨
                          </Button>
                        </>
                      )}
                    </div>
                    </SettingsSection>
                  </div>
                )}
                {isIbtahalatMode && isEditingTiming && transcribedLines.length > 0 && (
                  <div className="mt-2">
                    <TimingEditor
                      lines={transcribedLines}
                      onSave={(updated) => {
                        setTranscribedLines(updated);
                        transcribedLinesRef.current = updated;
                        setAyahs(updated.map((l, i) => ({ numberInSurah: i + 1, text: l.text })));
                        const cacheKey = getAudioCacheKey(ibtAudioUrl);
                        try { localStorage.setItem(cacheKey, JSON.stringify({ lines: updated })); } catch { /* ignore storage error */ }
                        setIsEditingTiming(false);
                      }}
                      onCancel={() => setIsEditingTiming(false)}
                    />
                  </div>
                )}
                {isIbtahalatMode && isEditingLyrics && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium">تعديل الكلمات يدوياً (سطر لكل جملة):</p>
                    <textarea
                      className="w-full min-h-[120px] text-sm rounded-md border border-input bg-background px-3 py-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      dir="rtl"
                      value={editingLyricsText}
                      onChange={(e) => setEditingLyricsText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          const newLines = editingLyricsText.split('\n').filter(l => l.trim());
                          if (newLines.length === 0) {
                            toast.error('لا يمكن حفظ كلمات فارغة');
                            return;
                          }
                          // Redistribute timings evenly across new lines
                          const totalDur = transcribedLines.length > 0
                            ? transcribedLines[transcribedLines.length - 1].end
                            : duration || 60;
                          const segDur = totalDur / newLines.length;
                          const updated = newLines.map((text, i) => ({
                            text: text.trim(),
                            start: i * segDur,
                            end: (i + 1) * segDur,
                          }));
                          setTranscribedLines(updated);
                          transcribedLinesRef.current = updated;
                          setAyahs(updated.map((l, i) => ({ numberInSurah: i + 1, text: l.text })));
                          // Update cache
                          const cacheKey = getAudioCacheKey(ibtAudioUrl);
                          try { localStorage.setItem(cacheKey, JSON.stringify({ lines: updated })); } catch { /* ignore storage error */ }
                          setIsEditingLyrics(false);
                          toast.success(`تم حفظ ${updated.length} سطر`);
                        }}
                      >
                        <Check className="h-3 w-3" />
                        حفظ
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setIsEditingLyrics(false)}
                      >
                        <X className="h-3 w-3" />
                        إلغاء
                      </Button>
                    </div>
                  </div>
                )}
                {isIbtahalatMode && transcriptionError && (
                  <p className="text-xs mt-1 text-muted-foreground">
                    ⚠️ يتم عرض عنوان الابتهال فقط
                  </p>
                )}
              </CardContent>
            </Card>

            {!isIbtahalatMode && activeTimingMap && (
              <AlignmentReviewPanel
                timingMap={activeTimingMap}
                isAuthenticated={isAuthenticated}
                reciterId={String(reciter?.id || reciterId)}
                surahNumber={surahNumber}
                startAyah={startAyah}
                endAyah={endAyah}
                ayahs={ayahs}
                audioUrl={audioUrl}
                quranFoundationRecitationId={reciter?.quranFoundationId}
                onTimingMapChange={(map) => {
                  timingMapRegistry.register(map);
                  activeTimingMapRef.current = map;
                  setActiveTimingMap(map);
                }}
              />
            )}

            <Card>
              <CardContent className="p-4 space-y-4">
                {(audioError || ayahLoadError) && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">{ayahLoadError ? 'تعذر تحميل الآيات المحددة' : 'تعذر تحميل الصوت'}</p>
                      <p className="text-xs text-muted-foreground">{ayahLoadError ? 'لم تصل الآيات المطلوبة كاملة وبالترتيب؛ أعد المحاولة أو غيّر النطاق.' : 'قد يكون الملف غير متوفر لهذه السورة'}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-3">
                    <Button variant="ghost" size="icon" aria-label="الآية السابقة"
                      onClick={() => skipAyah('backward')}
                      disabled={currentAyahIndex === 0 || audioError || (!canSkip && !isIbtahalatMode)}>
                      <SkipForward className="h-5 w-5" />
                    </Button>
                    <Button variant="outline" size="icon" aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل المعاينة'}
                      onClick={togglePlay} disabled={!audioLoaded || audioError} className="h-14 w-14">
                      {!audioLoaded ? <Loader2 className="h-6 w-6 animate-spin" /> : isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="الآية التالية"
                      onClick={() => skipAyah('forward')}
                      disabled={currentAyahIndex === ayahs.length - 1 || audioError || (!canSkip && !isIbtahalatMode)}>
                      <SkipBack className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={toggleMute} aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}>
                      {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Progress value={progress} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">
                      {isIbtahalatMode ? 'السطر' : 'الآية'}{' '}
                      <span className="font-bold text-foreground">{isIbtahalatMode ? currentAyahIndex + 1 : (ayahs[currentAyahIndex]?.numberInSurah || startAyah)}</span>{' '}
                      من {ayahs.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <SettingsSection title="إعدادات الفيديو" description="القوالب والعرض والصوت والخلفية والجودة وقص المقطع">
            {/* Existing tab state and settings stay mounted when closed. */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full grid grid-cols-3 gap-0.5 h-auto p-1">
                <TabsTrigger value="presets" className="gap-1 text-xs px-2 py-2">
                  <Palette className="h-3.5 w-3.5" />
                  قوالب
                </TabsTrigger>
                <TabsTrigger value="controls" className="gap-1 text-xs px-2 py-2">
                  <Settings className="h-3.5 w-3.5" />
                  قص المقطع
                </TabsTrigger>
                <TabsTrigger value="display" className="gap-1 text-xs px-2 py-2">
                  <Eye className="h-3.5 w-3.5" />
                  العرض
                </TabsTrigger>
                <TabsTrigger value="effects" className="gap-1 text-xs px-2 py-2">
                  <Music className="h-3.5 w-3.5" />
                  الصوت
                </TabsTrigger>
                <TabsTrigger value="background" className="gap-1 text-xs px-2 py-2">
                  <Upload className="h-3.5 w-3.5" />
                  خلفية
                </TabsTrigger>
                <TabsTrigger value="quality" className="gap-1 text-xs px-2 py-2">
                  <Video className="h-3.5 w-3.5" />
                  جودة
                </TabsTrigger>
              </TabsList>

              <TabsContent value="presets" className="mt-4">
                <PresetSelector selectedPresetId={selectedPresetId} onSelectPreset={applyPreset} />
              </TabsContent>

              <TabsContent value="controls" className="mt-4">
                {/* Audio Trim Control */}
                {(isIbtahalatMode || duration > 0) && (
                  <AudioTrimControl
                    totalDuration={duration}
                    onTrimChange={(start, end) => {
                      setTrimStart(start);
                      setTrimEnd(end);
                    }}
                    trimEnabled={trimEnabled}
                    onTrimEnabledChange={setTrimEnabled}
                    disabled={!audioLoaded || audioError}
                  />
                )}
              </TabsContent>

              <TabsContent value="display" className="mt-4">
                <DisplaySettingsPanel
                  settings={displaySettings}
                  onChange={setDisplaySettings}
                  textSettings={textSettings}
                  onTextSettingsChange={setTextSettings}
                  templateConfiguration={{ exportSettings, audioEffects: audioEffects.effects, aspectRatio,
                    background: background ? { id: background.id, type: background.type, url: background.url, thumbnail: background.thumbnail } : undefined,
                    customBackground: permittedCustomBackground, customBackgroundType }}
                  onTemplateConfigurationChange={(configuration) => {
                    setSelectedPresetId(undefined);
                    if (configuration.exportSettings) {
                      const restored = { ...DEFAULT_EXPORT_SETTINGS, ...configuration.exportSettings };
                      if (restored.renderEngine && restored.renderEngine !== 'browser' &&
                          !cloudPolicy?.enabledEngines.includes(restored.renderEngine)) {
                        restored.renderEngine = 'browser';
                        toast.info('محرك القالب غير متاح حاليًا؛ تم اختيار الإنتاج على جهازك.');
                      }
                      handleExportSettingsChange(restored);
                    }
                    if (configuration.audioEffects) audioEffects.setEffects((current) => ({ ...current, ...configuration.audioEffects, pitchShift: 0, speedAdjust: 1 }));
                    if (configuration.aspectRatio) setAspectRatio(configuration.aspectRatio);
                    if (configuration.customBackground !== undefined) setCustomBackground(configuration.customBackground);
                    if (configuration.customBackgroundType) setCustomBackgroundType(configuration.customBackgroundType);
                    if (configuration.background) setSearchParams((previous) => {
                      const next = new URLSearchParams(previous);
                      next.set('background', configuration.background!.id);
                      next.set('backgroundType', configuration.background!.type);
                      next.set('backgroundUrl', configuration.background!.url);
                      next.set('backgroundThumb', configuration.background!.thumbnail);
                      return next;
                    });
                  }}
                  letterTimingStatus={letterTimingStatus}
                />
              </TabsContent>

              <TabsContent value="effects" className="mt-4">
                <AudioEffectsPanel
                  effects={audioEffects.effects}
                  onChange={audioEffects.setEffects}
                  disabled={!audioLoaded || audioError}
                />
              </TabsContent>

              <TabsContent value="background" className="mt-4">
                {canUseFeature('customBackgrounds') ? (
                  <CustomBackgroundUploader
                    currentBackground={customBackground}
                    currentBackgroundType={customBackgroundType}
                    onUpload={(url, type) => {
                      setCustomBackground(url || null);
                      if (type) setCustomBackgroundType(type);
                    }}
                  />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-10 text-center space-y-2">
                      <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">رفع الخلفيات المخصصة متاح للعضوية المميزة فقط.</p>
                      <Button variant="outline" size="sm" onClick={() => navigate('/pricing')}>عرض العضوية المميزة</Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="quality" className="mt-4">
                <div className="space-y-4">
                  <ExportFormatSelector
                    settings={exportSettings}
                    onChange={handleExportSettingsChange}
                    onExport={handleExport}
                    videoBlob={videoRecorder.videoBlob}
                    mp4Blob={videoRecorder.mp4Blob}
                    isConverting={videoRecorder.isConverting}
                    isRecording={videoRecorder.isRecording}
                  />
                  <MotionSpeedControl
                    speed={exportSettings.motionSpeed}
                    onChange={(speed) => setExportSettings((prev) => ({ ...prev, motionSpeed: speed }))}
                  />

                </div>
              </TabsContent>
            </Tabs>
            </SettingsSection>

            {/* Recording / Actions */}
            <Card>
              <CardContent className="p-4 space-y-3">
                {/* 1. Server Render Job Progress State */}
                {serverRenderJob.isRendering ? (
                  <div className="space-y-3 p-3.5 rounded-xl bg-card border border-border/80 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-primary font-medium text-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                        <span className="line-clamp-1">{serverRenderJob.stage}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {serverRenderJob.status === 'queued' ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="text-xs h-7 px-2.5 gap-1 shadow-sm"
                            onClick={serverRenderJob.cancelActiveRender}
                          >
                            <X className="h-3.5 w-3.5" />
                            إلغاء وبدء من جديد
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-destructive hover:bg-destructive/10 h-7"
                            onClick={serverRenderJob.cancelRender}
                          >
                            إلغاء
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="secondary">{renderEngineLabel(serverRenderJob.engine)}</Badge>
                      {serverRenderJob.status === 'queued' && serverRenderJob.queuePosition > 0 && (
                        <span>
                          الموضع {serverRenderJob.queuePosition}
                          {serverRenderJob.etaSeconds > 0 ? ` · تقدير البدء ${serverRenderJob.etaSeconds}ث` : ''}
                        </span>
                      )}
                    </div>

                    <Progress value={serverRenderJob.progress} className="h-2.5 transition-all duration-300" />

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{Math.round(serverRenderJob.progress)}% مكتمل</span>
                      <span>
                        {serverRenderJob.status === 'queued' ? (
                          <span className="text-amber-500 font-medium">بانتظار بدء إنتاج الفيديو</span>
                        ) : (
                          `${renderEngineLabel(serverRenderJob.engine)} · إنتاج MP4`
                        )}
                      </span>
                    </div>
                  </div>
                ) : serverRenderJob.error ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <span className="text-sm font-medium">{serverRenderJob.error}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={serverRenderJob.retryRender} className="w-full gap-2" size="sm">
                        <RefreshCw className="h-4 w-4" />
                        إعادة المحاولة
                      </Button>
                      <Button onClick={serverRenderJob.cancelActiveRender} variant="ghost" size="sm">
                        إلغاء وبدء من جديد
                      </Button>
                    </div>
                  </div>
                ) : serverRenderJob.isCompleted ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-emerald-500 p-3 rounded-lg bg-emerald-500/10">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium text-sm">الفيديو جاهز للتحميل — {renderEngineLabel(serverRenderJob.engine)} (MP4)</span>
                    </div>

                    <Button
                      onClick={() => {
                        void serverRenderJob.downloadRenderedMp4(downloadFilename).catch((error: any) => {
                          toast.error(error?.message || 'تعذر تحميل ملف الفيديو، يرجى المحاولة مرة أخرى.');
                        });
                      }}
                      className="w-full gap-2"
                      size="lg"
                    >
                      <Download className="h-5 w-5" />
                      تحميل الفيديو (MP4 عالي الجودة)
                    </Button>

                    {serverRenderJob.videoBlob && (
                      <SocialShareButtons
                        videoBlob={serverRenderJob.videoBlob}
                        mp4Blob={serverRenderJob.videoBlob}
                        title={`${surah?.name || 'سورة'} - قرآن ريلز`}
                        text={`استمع لتلاوة ${surah?.name || ''} بصوت ${reciter?.name || ''}`}
                        filename={downloadFilename}
                      />
                    )}

                    <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">حُفظ الفيديو تلقائياً في مكتبتك. التحميل متاح لمدة 48 ساعة.</p>
                    <label className="block space-y-2 text-sm">
                      عنوان العرض في اكتشف
                      <input className="w-full rounded-lg border bg-background p-2" maxLength={100} value={discoverTitle} onChange={e => setDiscoverTitle(e.target.value)} placeholder={surah?.name || 'عنوان الفيديو'} />
                    </label>
                    <Button onClick={handlePublishCloud} disabled={isSaving} variant="secondary" className="w-full gap-2">
                      <Share2 className="h-4 w-4" />{isPublicVideo ? 'إلغاء المشاركة في اكتشف' : 'مشاركة الفيديو في اكتشف'}
                    </Button>
                    <p className="text-xs text-muted-foreground">يظهر الفيديو باسم حسابك مع اسم القارئ. يمكنك إلغاء المشاركة هنا أو من المكتبة.</p>

                    <Button onClick={serverRenderJob.reset} variant="ghost" className="w-full gap-2">
                      <RotateCcw className="h-4 w-4" />
                      إنشاء فيديو جديد
                    </Button>
                  </div>
                ) : videoRecorder.isRecording ? (
                  /* 2. Legacy Browser Recording Progress State */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-primary">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="font-medium">{videoRecorder.stage}</span>
                    </div>
                    <Progress value={videoRecorder.progress} className="h-2" />
                    <p className="text-xs text-muted-foreground text-center">
                      {Math.round(videoRecorder.progress)}% من التسجيل مكتمل
                    </p>
                  </div>
                ) : videoRecorder.videoBlob ? (
                  /* 2b. Video Recording Completed State */
                  <div className="space-y-3">
                    {videoRecorder.isConverting ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="font-medium">{videoRecorder.stage || 'جاري تجهيز الفيديو للتحميل...'}</span>
                        </div>
                        <Progress value={videoRecorder.convertProgress} className="h-2" />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-center gap-2 text-primary p-3 rounded-lg bg-primary/10">
                          <Check className="h-5 w-5" />
                          <span className="font-medium">اكتمل التسجيل.</span>
                        </div>


                        <Button onClick={() => exportSettings.format === 'webm' ? videoRecorder.downloadWebm(downloadFilename) : videoRecorder.downloadMp4(downloadFilename)} disabled={videoRecorder.isConverting} className="w-full gap-2" size="lg">
                          <Download className="h-5 w-5" />تحميل الفيديو ({exportSettings.format === 'webm' ? 'WebM' : 'MP4'})
                        </Button>

                        <SocialShareButtons
                          format={exportSettings.format === 'webm' ? 'webm' : 'mp4'}
                          videoBlob={videoRecorder.videoBlob}
                          mp4Blob={videoRecorder.mp4Blob}
                          title={`${surah?.name || 'سورة'} - قرآن ريلز`}
                          text={`استمع لتلاوة ${surah?.name || ''} بصوت ${reciter?.name || ''}`}
                          filename={downloadFilename}
                        />

                        {/* Public toggle */}
                        <p className="text-xs text-muted-foreground leading-relaxed">حفظ المتصفح يحتفظ ببيانات المشروع فقط.</p>

                        <Button
                          onClick={handleSave}
                          disabled={isSaving}
                          variant="secondary"
                          className="w-full gap-2"
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          حفظ في المكتبة
                        </Button>

                        <Button onClick={videoRecorder.reset} variant="ghost" className="w-full gap-2">
                          <RotateCcw className="h-4 w-4" />
                          إنشاء فيديو جديد
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  /* 3. Default Idle State: Primary Export Trigger */
                  <Button
                    onClick={handleStartExport}
                    disabled={!audioLoaded || audioError || timingsLoading}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {timingsLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        جاري تحميل بيانات الصوت...
                      </>
                    ) : (
                      <>
                        <Video className="h-5 w-5" />
                        تصدير وإنتاج الفيديو

                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </Layout>
  );
}

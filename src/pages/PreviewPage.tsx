import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { getTrackById, ibtahalatTracks } from '@/data/ibtahalat';
import { transcribeFullAudio } from '@/lib/chunkedTranscribe';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { VideoPreview, VideoPreviewRef, FrameSyncOverride } from '@/components/VideoPreview';
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
import { Badge } from '@/components/ui/badge';
import { surahs } from '@/data/surahs';
import { reciters, getAudioUrl, getEveryAyahUrl } from '@/data/reciters';
import { backgroundVideos, backgroundImages, slideshowBackgrounds, BackgroundItem, resolveBackgroundAssetUrl } from '@/data/backgrounds';
import { useQuranApi } from '@/hooks/useQuranApi';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
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
} from '@/lib/wordTimingEngine';

import { api } from '@/lib/api';
import { TextSettings } from '@/components/TextSettingsPanel';
import { TimingEditor } from '@/components/TimingEditor';
import {
  Download,
  RotateCcw,
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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How we play the ayahs */
type PlaybackMode =
  | 'qf'          // Quran Foundation single-file + word timestamps (best)
  | 'everyayah'   // EveryAyah.com – one MP3 per ayah (perfect verse clipping, no word highlight)
  | 'fallback';   // Full-surah mp3quran file with proportional estimation (last resort)

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

export default function PreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { fetchAyahs, fetchSurah } = useQuranApi();
  const { incrementUsage, loading: subscriptionLoading, isPremium, canUseFeature, isFreeFont, refetchUsage } = useSubscription();
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
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() => ({
    ...DEFAULT_DISPLAY_SETTINGS,
    ...getVisualDirection(visualDesignParam).displaySettings,
  }));
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
    setDisplaySettings((prev) => ({ ...prev, ...preset.displaySettings }));
    if (preset.textSettings) {
      setTextSettings((prev) => ({ ...prev, ...preset.textSettings }));
    }
    setExportSettings((prev) => ({ ...prev, quality: preset.exportQuality }));
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
    setExportSettings(newSettings);
  }, []);

  // ── Ayah data ───────────────────────────────────────────────────────────────
  const [ayahs, setAyahs] = useState<{ numberInSurah: number; text: string }[]>([]);
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
    const loadData = async () => {
      const data = await fetchAyahs(surahNumber, startAyah, endAyah);
      if (data) {
        const processedAyahs = data.map((ayah, index) => {
          let text = ayah.text;
          if (index === 0 && startAyah <= 1 && surahNumber !== 1 && surahNumber !== 9) {
            const words = text.split(/\s+/).filter(Boolean);
            const normalize = (w: string) => w
              .replace(/[^\u0621-\u064A\u0671-\u06FF]/g, '')
              .replace(/[\u06E1\u06E4\u0640]/g, '')
              .replace(/\u0671/g, '\u0627')
              .replace(/\u06CC/g, '\u064A');
            let cutAfter = -1;
            for (let wi = 0; wi < Math.min(words.length, 8); wi++) {
              const clean = normalize(words[wi]);
              if (clean === 'الرحيم') { cutAfter = wi; break; }
            }
            if (cutAfter >= 0 && cutAfter < words.length - 1) {
              text = words.slice(cutAfter + 1).join(' ');
            }
          }
          return { ...ayah, text };
        });
        setAyahs(processedAyahs);
      }
    };
    loadData();
  }, [isIbtahalatMode, ibtTrackTitle, ibtAudioUrl, surahNumber, startAyah, endAyah, fetchAyahs, retranscribeTrigger, applyPredefinedLyrics, predefinedLyricsLines]);

  useEffect(() => {
    currentAyahIndexRef.current = currentAyahIndex;
  }, [currentAyahIndex]);

  useEffect(() => {
    ayahsRef.current = ayahs;
  }, [ayahs]);

  const currentAyahWords = useMemo(() => {
    const text = ayahs[currentAyahIndex]?.text ?? '';
    return text.split(' ').filter(Boolean);
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

      // ── Strategy 1: Quran Foundation (word-level sync) ──────────────────────
      if (reciter.quranFoundationId) {
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

            // Build authentic TimingMap for exact audio word alignment
            try {
              const timingMap = normalizeQuranFoundationSegmentsToTimingMap({
                reciterId: String(reciter.id),
                providerRecitationId: reciter.quranFoundationId,
                surahNumber,
                startAyah,
                endAyah,
                audioUrl: audioFile.audio_url,
                audioContentHash: `qf-${reciter.id}-${surahNumber}-${audioFile.audio_url.split('/').pop() || 'recitation'}`,
                decodedDurationMs: to,
                sampleRate: 44100,
                channels: 2,
                qfTimestamps: existing,
                ayahsText: ayahs.map((a) => ({ numberInSurah: a.numberInSurah, text: a.text })),
              });
              timingMapRegistry.register(timingMap);
              setActiveTimingMap(timingMap);
              activeTimingMapRef.current = timingMap;
              console.log(`✅ QF TimingMap validated & registered [status: ${timingMap.validationStatus}]`);
            } catch (err) {
              console.warn('Failed to build TimingMap for QF:', err);
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

          // EveryAyah has verse boundaries, but lacks verified word-level ground truth
          // Generate a TimingMap marked truthfully as 'needs_review'
          const eaTimingMap = buildAudioAlignedTimingMap({
            reciterId: String(reciter.id),
            surahNumber,
            startAyah,
            endAyah,
            audioUrl: urls[0] || result.blobUrl,
            audioContentHash: `ea-${reciter.id}-${surahNumber}-${startAyah}_${endAyah}`,
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

      // ── Strategy 3: Fallback – full surah mp3 with proportional estimation ───
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
        console.log(`⚠️ Fallback mode – full surah mp3 with proportional estimation`);
      }

      if (!cancelled) setTimingsLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [isIbtahalatMode, ibtAudioUrl, reciter?.id, reciter?.quranFoundationId, reciter?.everyAyahSubfolder, surahNumber, startAyah, endAyah, totalAyahsInSurah]);

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

      // Fallback: proportional estimation
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
        console.log(`📐 Fallback estimate: ${estFrom.toFixed(1)}s–${estTo.toFixed(1)}s of ${totalDur.toFixed(1)}s`);
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
            const ayahWords = (currentAyahObj?.text ?? '').split(' ').filter(Boolean);

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
              // الوضع القديم التقريبي للقراء الذين ليس لديهم تزامن دقيق
              const ayahStart = t.timestamp_from / 1000;
              const ayahEnd = t.timestamp_to / 1000;
              const ayahDur = Math.max(ayahEnd - ayahStart, 0.5);
              const elapsed = Math.max(nowSec - ayahStart, 0);
              const ratio = Math.min(elapsed / ayahDur, 1);
              if (ayahWords.length > 0) {
                const wIdx = Math.min(Math.floor(ratio * ayahWords.length), ayahWords.length - 1);
                setHighlightWordIndex(wIdx);
                const perWord = 1 / ayahWords.length;
                const localProgress = Math.min(Math.max((ratio - wIdx * perWord) / Math.max(perWord, 0.0001), 0), 1);
                setHighlightWordProgress(localProgress);
              } else {
                setHighlightWordIndex(null);
                setHighlightWordProgress(0);
              }
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
            const ayahWords = (currentAyahObj?.text ?? '').split(' ').filter(Boolean);

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
              // الوضع القديم التقريبي للقراء الذين ليس لديهم تزامن دقيق
              const ayahStart = everyAyahTimestamps[i].from;
              const ayahEnd = everyAyahTimestamps[i].to;
              const ayahDur = Math.max(ayahEnd - ayahStart, 0.5);
              const elapsed = Math.max(nowSec - ayahStart, 0);
              const ratio = Math.min(elapsed / ayahDur, 1);
              if (ayahWords.length > 0) {
                const wIdx = Math.min(Math.floor(ratio * ayahWords.length), ayahWords.length - 1);
                setHighlightWordIndex(wIdx);
                const perWord = 1 / ayahWords.length;
                const localProgress = Math.min(Math.max((ratio - wIdx * perWord) / Math.max(perWord, 0.0001), 0), 1);
                setHighlightWordProgress(localProgress);
              } else {
                setHighlightWordIndex(null);
                setHighlightWordProgress(0);
              }
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
            // Proportional fallback
            const ayahDuration = totalSec / ayahsCount;
            estimatedIndex = Math.min(Math.floor(relativeSec / ayahDuration), ayahsCount - 1);
          }

          if (estimatedIndex !== currentAyahIndexRef.current) setCurrentAyahIndex(estimatedIndex);

          // Word-level highlight
          const seg = segs.length === ayahsCount ? segs[estimatedIndex] : null;
          const ayahStart = seg ? seg.from : estStartSec + estimatedIndex * (totalSec / ayahsCount);
          const ayahEnd = seg ? seg.to : ayahStart + totalSec / ayahsCount;
          const ayahDur = Math.max(ayahEnd - ayahStart, 0.001);
          const posInAyah = Math.max(nowSec - ayahStart, 0);
          const ratio = Math.min(posInAyah / ayahDur, 1);

          const wordCount = (ayahsRef.current[estimatedIndex]?.text ?? '').split(' ').filter(Boolean).length;
          if (wordCount > 0) {
            const wordIdx = Math.min(Math.floor(ratio * wordCount), wordCount - 1);
            setHighlightWordIndex(wordIdx);
            const perWord = 1 / wordCount;
            const localProgress = Math.min(Math.max((ratio - wordIdx * perWord) / Math.max(perWord, 0.0001), 0), 1);
            setHighlightWordProgress(localProgress);
          } else {
            setHighlightWordIndex(null);
            setHighlightWordProgress(0);
          }
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
      toast.error('الفيديو المرفوع من جهازك يُصدّر عبر Browser Canvas. للريندر السحابي اختر فيديو Pexels أو خلفية صور مدعومة.');
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

    // Inform user if phonetic pacing will be used for glow
    if (displaySettings.highlightStyle === 'glow' && (!activeTimingMap || activeTimingMap.validationStatus !== 'approved')) {
      if (playbackMode !== 'everyayah' && !isIbtahalatMode) {
        console.log('Using phonetic Tajweed pacing for smooth golden glow render.');
      }
    }

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
        audio: {
          sourceMode: playbackMode === 'qf' ? 'qf' : playbackMode === 'everyayah' ? 'everyayah' : 'single_url',
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

      toast.info('بدأ تجهيز الفيديو تلقائياً وسيُوزّع على وحدة الإنتاج المتاحة...');
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
      toast.error('سجّل الدخول أولاً ليُحسب رصيد Browser Canvas اليومي بأمان.');
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
      toast.error('لقد استنفدت عمليات Browser Canvas المتاحة اليوم. الخطة المجانية تشمل 5 عمليات يومياً؛ تتجدد الحصة غداً أو يمكنك الترقية.');
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

      // Ibtahalat trim mode
      if (isIbtahalatMode && trimEnabled && trimEnd > trimStart) {
        recordingDuration = trimEnd - trimStart;
        recordingStartAt = trimStart;
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
      const requiresDeterministicMp4 = exportSettingsForPlan.format === 'mp4'
        && (selectedFps === 60 || selectedAudioBitrate === '320k');
      const preferredMimeCandidates = requiresDeterministicMp4
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
        : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

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

          const computeFrameSync = (nowSec: number): FrameSyncOverride => {
            const currentAyahsList = ayahsRef.current.length > 0 ? ayahsRef.current : ayahs;
            if (!currentAyahsList || currentAyahsList.length === 0) return {};

            // Helper to get local word index and progress for any active verse
            const resolveWordForAyah = (ayahObj: { numberInSurah: number; text: string }, startSec: number, endSec: number) => {
              const ayahWords = (ayahObj.text || '').split(' ').filter(Boolean);
              if (activeTimingMapRef.current && activeTimingMapRef.current.words && activeTimingMapRef.current.words.length > 0) {
                const res = resolveActiveWordAtTime(activeTimingMapRef.current, nowSec * 1000);
                if (res.ayahNumber != null) {
                  if (res.ayahNumber === ayahObj.numberInSurah) {
                    const idx = res.wordIndexInAyah ?? 0;
                    return { wordIndex: Math.min(Math.max(idx, 0), Math.max(ayahWords.length - 1, 0)), progress: res.wordProgress };
                  }
                } else if (res.activeWordIndex != null) {
                  return { wordIndex: Math.min(Math.max(res.activeWordIndex, 0), Math.max(ayahWords.length - 1, 0)), progress: res.wordProgress };
                }
              }
              // Approximate fallback
              if (ayahWords.length > 0) {
                const dur = Math.max(endSec - startSec, 0.5);
                const elapsed = Math.max(nowSec - startSec, 0);
                const ratio = Math.min(elapsed / dur, 1);
                const wIdx = Math.min(Math.floor(ratio * ayahWords.length), ayahWords.length - 1);
                const perWord = 1 / ayahWords.length;
                const prog = Math.min(Math.max((ratio - wIdx * perWord) / Math.max(perWord, 0.0001), 0), 1);
                return { wordIndex: wIdx, progress: prog };
              }
              return { wordIndex: 0, progress: 0 };
            };

            // 1. QF Mode (exact word timestamps in milliseconds with waqf-holding)
            if (playbackMode === 'qf' && ayahTimings.length > 0) {
              const nowMs = nowSec * 1000;
              for (let aIdx = ayahTimings.length - 1; aIdx >= 0; aIdx--) {
                const t = ayahTimings[aIdx];
                if (!t) continue;
                if (nowMs >= t.timestamp_from) {
                  const ayahObj = currentAyahsList[aIdx] || currentAyahsList[0];
                  const wordSync = resolveWordForAyah(ayahObj, t.timestamp_from / 1000, t.timestamp_to / 1000);
                  return {
                    currentAyah: ayahObj,
                    currentAyahWords: (ayahObj.text || '').split(' ').filter(Boolean),
                    highlightedWordIndex: wordSync.wordIndex,
                    highlightWordProgress: wordSync.progress,
                  };
                }
              }
            }

            // 2. EveryAyah Mode (authentic multi-ayah playback)
            if (playbackMode === 'everyayah' && everyAyahTimestamps.length > 0) {
              for (let aIdx = everyAyahTimestamps.length - 1; aIdx >= 0; aIdx--) {
                const ts = everyAyahTimestamps[aIdx];
                if (nowSec >= ts.from) {
                  const ayahObj = currentAyahsList[aIdx] || currentAyahsList[0];
                  const wordSync = resolveWordForAyah(ayahObj, ts.from, ts.to);
                  return {
                    currentAyah: ayahObj,
                    currentAyahWords: (ayahObj.text || '').split(' ').filter(Boolean),
                    highlightedWordIndex: wordSync.wordIndex,
                    highlightWordProgress: wordSync.progress,
                  };
                }
              }
            }

            // 3. Ibtahalat Mode (transcribed lines)
            if (isIbtahalatMode) {
              const tLines = transcribedLinesRef.current;
              if (tLines.length > 0) {
                let foundIdx = 0;
                for (let lIdx = tLines.length - 1; lIdx >= 0; lIdx--) {
                  if (nowSec >= tLines[lIdx].start) { foundIdx = lIdx; break; }
                }
                return { currentLyricsIndex: foundIdx };
              }
            }

            // 4. Fallback Mode (proportional estimation)
            if (rangeMs) {
              const estStartSec = rangeMs.from / 1000;
              const estEndSec = rangeMs.to / 1000;
              const totalSec = Math.max(estEndSec - estStartSec, 0.001);
              const relativeSec = Math.max(nowSec - estStartSec, 0);
              const ratio = Math.min(Math.max(relativeSec / totalSec, 0), 1);
              const ayahsCount = currentAyahsList.length;
              const idx = Math.min(Math.floor(ratio * ayahsCount), ayahsCount - 1);
              const ayahObj = currentAyahsList[idx] || currentAyahsList[0];
              return {
                currentAyah: ayahObj,
                currentAyahWords: (ayahObj.text || '').split(' ').filter(Boolean),
              };
            }

            return {};
          };

          const drawIsolatedFrame = () => {
            if (isDrawing || stopped) return;
            isDrawing = true;
            try {
              const livePreviewApi = videoPreviewRef.current;
              const draw = livePreviewApi?.drawFrame ?? previewApi.drawFrame;
              // Ground-truth audio clock position for sub-frame synchronization
              const currentAudioSec = audio ? audio.currentTime : recordingStartAt;
              const syncOverride = computeFrameSync(currentAudioSec);
              draw(recordingCanvas, attempt.renderMode, syncOverride);
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
            if (now - lastFrameTime < frameInterval) return;
            lastFrameTime = now;
            drawIsolatedFrame();
          };

          // Dual-clock watchdog heartbeat: ensures frames continue even if tab is backgrounded
          watchdogTimerId = window.setInterval(() => {
            if (stopped) return;
            const now = performance.now();
            if (now - lastFrameTime >= frameInterval * 1.35) {
              lastFrameTime = now;
              drawIsolatedFrame();
            }
          }, Math.round(frameInterval / 2));

          drawIsolatedFrame();
          rafId = requestAnimationFrame(renderIsolatedFrame);

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

          // Warm up isolated canvas before captureStream starts
          await new Promise((resolve) => setTimeout(resolve, 100));
          drawIsolatedFrame();

          if (audio) {
            audio.pause();
            audio.currentTime = recordingStartAt;
          }

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
      await handleServerExport();
    }
  };

  const handleTriggerBackgroundRender = async () => {
    try {
      const started = await handleServerExport({ backgroundAsync: true });
      if (started) {
        toast.success('تم إطلاق مهمة الريندر في الخلفية بنجاح! سيتم حفظ الفيديو تلقائياً في مكتبتك لمدة 48 ساعة ويمكنك مغادرة الصفحة الآن وسيصلك إشعار فور الجاهزية.');
      }
    } catch (err: any) {
      console.error('Failed background export trigger:', err);
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
    return `${toSafeFilename(base)}.mp4`;
  }, [isIbtahalatMode, ibtTrackTitle, surah?.englishName, surah?.name, reciter?.id, toSafeFilename]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = useCallback((format: ExportFormat) => {
    const baseFilename = toSafeFilename(
      isIbtahalatMode
        ? `ibtahal-${ibtTrackTitle.slice(0, 30)}`
        : `${surah?.englishName || surah?.name || 'quran'}-${reciter?.id || 'reciter'}`
    );
    switch (format) {
      case 'mp4':
        if (videoRecorder.mp4Blob) videoRecorder.downloadMp4(`${baseFilename}.mp4`);
        else toast.error('ملف MP4 غير جاهز بعد');
        break;
      case 'webm':
        if (videoRecorder.videoBlob) videoRecorder.downloadWebm(`${baseFilename}.webm`);
        else toast.error('لا يوجد فيديو للتحميل');
        break;
      case 'gif':
        toast.info('تحميل GIF غير متاح حالياً');
        break;
    }
  }, [surah, reciter, toSafeFilename, videoRecorder]);

  // ── Save to library ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isAuthenticated || !user) {
      toast.error('الرجاء تسجيل الدخول لحفظ الفيديو');
      navigate('/auth');
      return;
    }
    setIsSaving(true);
    try {
      await api.videos.create({
        surah_number: isIbtahalatMode ? 0 : surahNumber,
        surah_name: isIbtahalatMode ? `ابتهال: ${ibtTrackTitle}` : (surah?.name || ''),
        reciter_id: isIbtahalatMode ? 'ibtahalat' : reciterId,
        reciter_name: isIbtahalatMode ? ibtPerformerName : (reciter?.name || ''),
        start_ayah: isIbtahalatMode ? 0 : startAyah,
        end_ayah: isIbtahalatMode ? 0 : endAyah,
        background_type: backgroundType,
        aspect_ratio: aspectRatio,
        is_public: isPublicVideo,
      });
      toast.success('تم حفظ الفيديو في مكتبتك!');
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
    if (playbackMode === 'everyayah') return '✅ تشغيل متصل بدون تقطيع للآيات المحددة';
    return '⚠️ يتم استخدام الملف الصوتي الكامل (تحديد مواضع الآيات تقديري)';
  })();

  const timingStatusBadge = (() => {
    if (isIbtahalatMode) {
      return (
        <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary bg-primary/10">
          <Sparkles className="w-3.5 h-3.5" />
          نمط الابتهالات (تزامن الأسطر)
        </Badge>
      );
    }
    if (activeTimingMap?.validationStatus === 'approved') {
      return (
        <Badge variant="outline" className="text-xs gap-1.5 border-emerald-500/40 text-emerald-400 bg-emerald-500/10 py-0.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          تزامن صوتي دقيق معتمد بالكلمة
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs gap-1.5 border-amber-500/40 text-amber-400 bg-amber-500/10 py-0.5">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
        وضع مراجعة التوقيت (التزامن بالكلمة غير معتمد)
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
            className="flex-1 flex justify-center"
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

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 gap-0.5 h-auto p-1">
                <TabsTrigger value="presets" className="gap-1 text-xs px-2 py-2">
                  <Palette className="h-3.5 w-3.5" />
                  قوالب
                </TabsTrigger>
                <TabsTrigger value="controls" className="gap-1 text-xs px-2 py-2">
                  <Settings className="h-3.5 w-3.5" />
                  التحكم
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
                <Card>
                  <CardContent className="p-4 space-y-4">
                    {audioError && (
                      <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-destructive">تعذر تحميل الصوت</p>
                          <p className="text-xs text-muted-foreground">قد يكون الملف غير متوفر لهذه السورة</p>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        <Button
                          variant="ghost"
                          size="icon"
                         onClick={() => skipAyah('backward')}
                          disabled={currentAyahIndex === 0 || audioError || (!canSkip && !isIbtahalatMode)}
                        >
                          <SkipForward className="h-5 w-5" />
                        </Button>

                        <Button
                          variant="outline"
                          size="icon"
                          onClick={togglePlay}
                          disabled={!audioLoaded || audioError}
                          className="h-14 w-14"
                        >
                          {!audioLoaded ? (
                            <Loader2 className="h-6 w-6 animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="h-6 w-6" />
                          ) : (
                            <Play className="h-6 w-6" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => skipAyah('forward')}
                          disabled={currentAyahIndex === ayahs.length - 1 || audioError || (!canSkip && !isIbtahalatMode)}
                        >
                          <SkipBack className="h-5 w-5" />
                        </Button>

                        <Button variant="ghost" size="icon" onClick={toggleMute}>
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
                <DisplaySettingsPanel settings={displaySettings} onChange={setDisplaySettings} />
              </TabsContent>

              <TabsContent value="effects" className="mt-4">
                <AudioEffectsPanel
                  effects={audioEffects.effects}
                  onChange={audioEffects.setEffects}
                  disabled={!audioLoaded || audioError}
                  onToggleCopyrightProtection={audioEffects.toggleCopyrightProtection}
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
                    onTriggerBackgroundRender={handleTriggerBackgroundRender}
                    isBackgroundRendering={serverRenderJob.isRendering}
                  />
                  <MotionSpeedControl
                    speed={exportSettings.motionSpeed}
                    onChange={(speed) => setExportSettings((prev) => ({ ...prev, motionSpeed: speed }))}
                  />

                </div>
              </TabsContent>
            </Tabs>

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

                    <Progress value={serverRenderJob.progress} className="h-2.5 transition-all duration-300" />

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{Math.round(serverRenderJob.progress)}% مكتمل</span>
                      <span>
                        {serverRenderJob.status === 'queued' ? (
                          <span className="text-amber-500 font-medium">⏳ جاري تخصيص وحدة إنتاج تلقائياً</span>
                        ) : (
                          '⚡ ريندر سيرفر فائق الدقة (30fps CFR)'
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
                      <span className="font-medium text-sm">تم إنشاء وتدقيق الفيديو بنجاح (H.264 MP4)!</span>
                    </div>

                    <Button
                      onClick={() => serverRenderJob.downloadRenderedMp4(downloadFilename)}
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

                    {/* Public toggle */}
                    <label className="flex items-center gap-2 px-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isPublicVideo}
                        onChange={(e) => setIsPublicVideo(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm text-muted-foreground">مشاركة في صفحة اكتشف</span>
                    </label>

                    <Button
                      onClick={handleSave}
                      disabled={isSaving}
                      variant="secondary"
                      className="w-full gap-2"
                    >
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      حفظ في المكتبة
                    </Button>

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
                      {Math.round(videoRecorder.progress)}% مكتمل • ريندر فائق الدقة (30/60fps)
                    </p>
                  </div>
                ) : videoRecorder.videoBlob ? (
                  /* 2b. Video Recording Completed State */
                  <div className="space-y-3">
                    {videoRecorder.isConverting ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="font-medium">{videoRecorder.stage || 'جاري تجهيز وتلميع الفيديو...'}</span>
                        </div>
                        <Progress value={videoRecorder.convertProgress} className="h-2" />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-center gap-2 text-primary p-3 rounded-lg bg-primary/10">
                          <Check className="h-5 w-5" />
                          <span className="font-medium">تم إنشاء وتلميع الفيديو بنجاح (MP4)!</span>
                        </div>


                        {(() => {
                          const baseFilename = toSafeFilename(
                            isIbtahalatMode
                              ? `ibtahal-${ibtTrackTitle.slice(0, 30)}`
                              : `${surah?.englishName || surah?.name || 'quran'}-${reciter?.id || 'reciter'}`
                          );
                          const wantsMp4 = exportSettings.format === 'mp4';

                          return (
                            <div className="space-y-2">
                              {wantsMp4 ? (
                                <>
                                  <Button
                                    onClick={() => videoRecorder.downloadMp4(`${baseFilename}.mp4`)}
                                    disabled={videoRecorder.isConverting}
                                    className="w-full gap-2"
                                    size="lg"
                                  >
                                    {videoRecorder.isConverting ? (
                                      <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        جاري تجهيز MP4 ({Math.round(videoRecorder.convertProgress)}%)...
                                      </>
                                    ) : (
                                      <>
                                        <Download className="h-5 w-5" />
                                        تحميل الفيديو (MP4)
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    onClick={() => videoRecorder.downloadWebm(`${baseFilename}.webm`)}
                                    variant="outline"
                                    className="w-full gap-2 text-xs"
                                    size="sm"
                                  >
                                    <Download className="h-4 w-4" />
                                    تحميل بصيغة WebM (فوري)
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    onClick={() => videoRecorder.downloadWebm(`${baseFilename}.webm`)}
                                    className="w-full gap-2"
                                    size="lg"
                                  >
                                    <Download className="h-5 w-5" />
                                    تحميل الفيديو (WebM)
                                  </Button>
                                  <Button
                                    onClick={() => videoRecorder.downloadMp4(`${baseFilename}.mp4`)}
                                    disabled={videoRecorder.isConverting}
                                    variant="outline"
                                    className="w-full gap-2 text-xs"
                                    size="sm"
                                  >
                                    {videoRecorder.isConverting ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        جاري تجهيز MP4...
                                      </>
                                    ) : (
                                      <>
                                        <Download className="h-4 w-4" />
                                        تحويل وتحميل بصيغة MP4
                                      </>
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        <SocialShareButtons
                          videoBlob={videoRecorder.videoBlob}
                          mp4Blob={videoRecorder.mp4Blob}
                          title={`${surah?.name || 'سورة'} - قرآن ريلز`}
                          text={`استمع لتلاوة ${surah?.name || ''} بصوت ${reciter?.name || ''}`}
                          filename={downloadFilename}
                        />

                        {/* Public toggle */}
                        <label className="flex items-center gap-2 px-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isPublicVideo}
                            onChange={(e) => setIsPublicVideo(e.target.checked)}
                            className="rounded border-border"
                          />
                          <span className="text-sm text-muted-foreground">مشاركة في صفحة اكتشف</span>
                        </label>

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
                        تصدير وإنتاج الفيديو (MP4 عالي الدقة)

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

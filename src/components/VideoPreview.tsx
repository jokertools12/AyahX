import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useState } from 'react';
import { BackgroundItem, resolveBackgroundAssetUrl } from '@/data/backgrounds';
import { api } from '@/lib/api';

// Font family mapping for canvas
const FONT_MAP: Record<string, string> = {
  '"Noto Naskh Arabic", serif': 'Noto Naskh Arabic',
  '"Amiri", serif': 'Amiri',
  '"Amiri Quran", serif': 'Amiri Quran',
  '"Cairo", sans-serif': 'Cairo',
  '"Scheherazade New", serif': 'Scheherazade New',
  '"Aref Ruqaa", serif': 'Aref Ruqaa',
  '"Reem Kufi", sans-serif': 'Reem Kufi',
  '"Lateef", serif': 'Lateef',
  '"El Messiri", sans-serif': 'El Messiri',
  '"Tajawal", sans-serif': 'Tajawal',
  '"Mada", sans-serif': 'Mada',
  '"Mirza", serif': 'Mirza',
  '"Marhey", cursive': 'Marhey',
  '"Katibeh", serif': 'Katibeh',
  '"Rakkas", serif': 'Rakkas',
  '"Lalezar", cursive': 'Lalezar',
};

// Slideshow configuration
const SLIDESHOW_TRANSITION_DURATION = 1800; // 1.8s smooth transition
const SLIDESHOW_DISPLAY_DURATION = 5000; // 5 seconds per image
const SLIDESHOW_TRANSITIONS = ['crossfade', 'slideLeft', 'slideRight', 'slideUp', 'zoomThrough', 'wipe'] as const;
type SlideshowTransition = typeof SLIDESHOW_TRANSITIONS[number];
const DEFAULT_TARGET_FPS = 30;
const FRAME_INTERVAL_DEFAULT = 1000 / DEFAULT_TARGET_FPS;
const RANDOM_TRANSITIONS: Array<'fade' | 'slide' | 'zoom' | 'blur' | 'rise' | 'rotate' | 'cinematic' | 'elastic'> = ['fade', 'slide', 'zoom', 'blur', 'rise', 'rotate', 'cinematic', 'elastic'];

/**
 * Calculates a safe, responsive text-frame rectangle. The returned offset is
 * applied to the verse and its ayah badge so the three elements remain a
 * single visual unit at every aspect ratio and during every transition.
 */
function getResponsiveTextFrameLayout({
  canvasWidth,
  canvasHeight,
  contentTop,
  contentBottom,
  contentWidth,
  scale,
  minWidthRatio = 0.56,
  maxWidthRatio = 0.88,
  safeTopRatio = 0.14,
  safeBottomRatio = 0.92,
}: {
  canvasWidth: number;
  canvasHeight: number;
  contentTop: number;
  contentBottom: number;
  contentWidth: number;
  scale: number;
  minWidthRatio?: number;
  maxWidthRatio?: number;
  safeTopRatio?: number;
  safeBottomRatio?: number;
}) {
  const padding = Math.max(20 * scale, Math.min(65 * scale, canvasWidth * 0.045));
  const frameWidth = Math.min(
    canvasWidth * maxWidthRatio,
    Math.max(contentWidth + padding * 2, canvasWidth * minWidthRatio),
  );
  const frameX = (canvasWidth - frameWidth) / 2;
  const safeTop = Math.max(12 * scale, canvasHeight * safeTopRatio);
  const safeBottom = Math.min(canvasHeight - 12 * scale, canvasHeight * safeBottomRatio);

  const rawTop = contentTop - padding;
  const rawBottom = contentBottom + padding;
  let offsetY = 0;
  if (rawTop < safeTop) offsetY += safeTop - rawTop;
  if (rawBottom + offsetY > safeBottom) offsetY += safeBottom - (rawBottom + offsetY);

  const frameY = rawTop + offsetY;
  const frameHeight = Math.max(1, rawBottom + offsetY - frameY);
  return { frameX, frameY, frameWidth, frameHeight, offsetY, padding };
}

/**
 * Keeps the surah title, reciter label, and their ornament as one measured
 * header group.  The old proportional Y values happened to collide on wide
 * canvases because the title badge grows with canvas width while its Y value
 * grew only with canvas height.
 */
function getResponsiveHeaderLayout({
  canvasWidth,
  canvasHeight,
  scale,
  showSurahName,
  showReciterName,
  surahNamePosition,
  surahNameStyle,
  reciterNameStyle,
  textFontSize,
}: {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  showSurahName: boolean;
  showReciterName: boolean;
  surahNamePosition?: string;
  surahNameStyle?: string;
  reciterNameStyle?: string;
  textFontSize: number;
}) {
  const position = surahNamePosition || 'top';
  const isBottom = position === 'bottom';
  const titleShapeHalfHeight = {
    banner: 45,
    calligraphy: 42,
    circle: 75,
    diamond: 80,
    ribbon: 35,
    modern: 38,
    ornate: 41,
    minimal: 34,
    classic: 50,
  }[surahNameStyle || 'classic'] ?? 50;
  const titleHalfHeight = Math.max(
    titleShapeHalfHeight * scale,
    textFontSize * 2.5 * scale * 0.65 + 8 * scale,
  );
  const reciterShapeHalfHeight = ['badge', 'pill'].includes(reciterNameStyle || '') ? 22
    : reciterNameStyle === 'tag' ? 19
      : 17;
  const reciterHalfHeight = Math.max(reciterShapeHalfHeight * scale, textFontSize * scale * 0.65 + 3 * scale);
  const gap = Math.max(14 * scale, canvasHeight * 0.018);
  const edgeInset = Math.max(24 * scale, canvasHeight * 0.045);
  const titleX = position === 'topLeft'
    ? Math.min(260 * scale, canvasWidth * 0.28)
    : position === 'topRight'
      ? Math.max(canvasWidth - 260 * scale, canvasWidth * 0.72)
      : canvasWidth / 2;
  const titleY = isBottom
    ? canvasHeight - edgeInset - titleHalfHeight
    : position === 'center'
      ? canvasHeight * 0.25
      : edgeInset + titleHalfHeight;

  let reciterX = titleX;
  let reciterY = titleY;
  if (showReciterName) {
    if (!showSurahName) {
      reciterX = (position === 'topLeft' || position === 'topRight') ? titleX : canvasWidth / 2;
      reciterY = isBottom
        ? canvasHeight - edgeInset - reciterHalfHeight
        : edgeInset + reciterHalfHeight;
    } else {
      reciterY = isBottom
        ? titleY - titleHalfHeight - gap - reciterHalfHeight
        : titleY + titleHalfHeight + gap + reciterHalfHeight;
    }
  }

  const headerEdgeY = showReciterName
    ? (isBottom ? reciterY - reciterHalfHeight : reciterY + reciterHalfHeight)
    : (isBottom ? titleY - titleHalfHeight : titleY + titleHalfHeight);
  const separatorY = isBottom ? headerEdgeY - gap * 0.65 : headerEdgeY + gap * 0.65;

  return { titleX, titleY, reciterX, reciterY, separatorY };
}

function getResponsiveBrandingLayout({
  canvasWidth,
  canvasHeight,
  scale,
  logoPosition,
  logoSize,
  socialPosition,
  socialSize,
  headerActive,
  headerPosition,
  headerSeparatorY,
  frameActive,
}: {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  logoPosition: string;
  logoSize: number;
  socialPosition: string;
  socialSize: number;
  headerActive: boolean;
  headerPosition: string;
  headerSeparatorY: number;
  frameActive: boolean;
}) {
  const edge = Math.max(28 * scale, canvasWidth * 0.025) + (frameActive ? 18 * scale : 0);
  const gap = Math.max(18 * scale, canvasHeight * 0.022);
  const radius = logoSize * scale / 2;
  const socialHeight = Math.max(30 * scale, socialSize * scale + 14 * scale);
  let logoX = canvasWidth - edge - radius;
  let logoY = edge + radius;
  if (logoPosition === 'topLeft') logoX = edge + radius;
  if (logoPosition === 'bottomRight') { logoX = canvasWidth - edge - radius; logoY = canvasHeight - edge - radius; }
  if (logoPosition === 'bottomLeft') { logoX = edge + radius; logoY = canvasHeight - edge - radius; }
  // A centred header does not occupy a corner. Keep the logo anchored at the
  // user's selected corner; only swap corners when the header uses that exact
  // same corner, which prevents the old "drop into the middle" behaviour.
  const collidesWithTopCorner = headerActive && (
    (logoPosition === 'topRight' && headerPosition === 'topRight') ||
    (logoPosition === 'topLeft' && headerPosition === 'topLeft')
  );
  if (collidesWithTopCorner) {
    logoX = logoPosition === 'topRight' ? edge + radius : canvasWidth - edge - radius;
  }

  let socialX = canvasWidth / 2;
  let socialY = canvasHeight - edge;
  if (socialPosition === 'bottomLeft') socialX = edge;
  if (socialPosition === 'bottomRight') socialX = canvasWidth - edge;
  if (socialPosition === 'topCenter') {
    socialY = edge + socialHeight;
    if (headerActive) socialY = Math.max(socialY, headerSeparatorY + gap + socialHeight);
  }
  if ((socialPosition === 'bottomRight' && logoPosition === 'bottomRight') ||
      (socialPosition === 'bottomLeft' && logoPosition === 'bottomLeft')) {
    socialY = Math.min(socialY, logoY - radius - gap);
  }
  return { logoX, logoY, logoRadius: radius, socialX, socialY, socialHeight, edge };
}

import type { DisplaySettings } from '@/components/DisplaySettingsPanel';

interface VideoPreviewProps {
  background: BackgroundItem | null;
  customBackground?: string | null;
  customBackgroundType?: 'image' | 'video';
  surahName: string;
  reciterName: string;
  currentAyah: { numberInSurah: number; text: string } | null;
  currentAyahWords?: string[];
  highlightedWordIndex?: number | null;
  highlightWordProgress?: number;
  aspectRatio: '9:16' | '16:9';
  textSettings: {
    fontSize: number;
    fontFamily: string;
    textColor: string;
    shadowIntensity: number;
    overlayOpacity: number;
  };
  displaySettings?: DisplaySettings;
  isPlaying: boolean;
  isRecording?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onBackgroundLoadMethod?: (method: 'direct' | 'proxy' | 'fallback') => void;
  motionSpeed?: number; // 1-10, default 3
  /** Ibtahalat lyrics mode: show all lines with current line glowing */
  ibtahalatLyricsMode?: boolean;
  /** All lyrics lines for ibtahalat mode */
  allLyricsLines?: string[];
  /** Index of currently active lyrics line */
  currentLyricsIndex?: number;
  audioProgress?: number; // 0-1 progress for progress bar
  /** User subscription status for Spec 90 watermark enforcement */
  isPremium?: boolean;
}

export interface FrameSyncOverride {
  currentAyah?: { numberInSurah: number; text: string } | null;
  currentAyahWords?: string[];
  highlightedWordIndex?: number | null;
  highlightWordProgress?: number;
  currentLyricsIndex?: number;
}

export interface VideoPreviewRef {
  getContainer: () => HTMLDivElement | null;
  getCanvas: () => HTMLCanvasElement | null;
  isBackgroundReady: () => boolean;
  ensureBackgroundPlayback: () => Promise<void>;
  getRecordingDimensions: () => { width: number; height: number };
  getRecommendedRecordingFps: () => number;
  drawFrame: (
    targetCanvas?: HTMLCanvasElement,
    renderMode?: 'preview' | 'recording' | 'recordingLite',
    syncOverride?: FrameSyncOverride
  ) => void;
}

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

export const VideoPreview = forwardRef<VideoPreviewRef, VideoPreviewProps>(({
  background,
  customBackground,
  customBackgroundType,
  surahName,
  reciterName,
  currentAyah,
  currentAyahWords,
  highlightedWordIndex,
  highlightWordProgress = 0,
  aspectRatio,
  textSettings,
  displaySettings = DEFAULT_DISPLAY_SETTINGS,
  isPlaying,
  isRecording = false,
  onCanvasReady,
  onBackgroundLoadMethod,
  motionSpeed = 3,
  ibtahalatLyricsMode = false,
  allLyricsLines = [],
  currentLyricsIndex = 0,
  audioProgress = 0,
  isPremium = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const drawFrameRuntimeRef = useRef<
    (targetCanvas?: HTMLCanvasElement, renderMode?: 'preview' | 'recording' | 'recordingLite', syncOverride?: FrameSyncOverride) => void
  >(() => {});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Slideshow state
  const slideshowImagesRef = useRef<HTMLImageElement[]>([]);
  const [slideshowReady, setSlideshowReady] = useState(false);
  const slideshowStartTimeRef = useRef<number>(Date.now());

  // Per-image Ken Burns motion presets for smooth, varied transitions
  const kenBurnsPresetsRef = useRef<Array<{
    zoomStart: number; zoomEnd: number;
    panXStart: number; panXEnd: number;
    panYStart: number; panYEnd: number;
    transition: SlideshowTransition;
  }>>([]);

  // Smooth chunk cycling counter for non-full verse modes
  const chunkCounterRef = useRef<number>(0);
  const lastChunkTimeRef = useRef<number>(Date.now());
  // Fade transition between chunks
  const prevChunkIndexRef = useRef<number>(-1);
  const chunkFadeRef = useRef<number>(1);
  const chunkFadeStartRef = useRef<number>(0);
  const currentAyahIdRef = useRef<number>(-1);
  // Track chunk start word index for mapping global highlight → local
  const chunkStartWordIndexRef = useRef<number>(0);
  // Adaptive timing: track highlighted word changes to estimate reciter speed
  const lastHighlightedWordRef = useRef<number | null>(null);
  const highlightWordTimestampsRef = useRef<number[]>([]);
  const adaptiveChunkIntervalRef = useRef<number>(800);

  // ── Text layout cache ───────────────────────────────────────────────────
  const textLayoutCacheRef = useRef<{
    key: string;
    lines: string[][];
    spaceWidth: number;
    totalHeight: number;
    startY: number;
    lineHeight: number;
    fontSize: number;
    lineTotals: number[];
    wordWidths: number[][];
  } | null>(null);

  // ── Off-screen video scale canvas for performance ──────────────────────
  const videoScaleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Performance caches (avoid per-frame DOM/gradient recreation) ──────
  const primaryColorCacheRef = useRef<string | null>(null);
  const gradientCacheSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const topGradientCacheRef = useRef<CanvasGradient | null>(null);
  const bottomGradientCacheRef = useRef<CanvasGradient | null>(null);

  // Custom / AI logo watermark image cache
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  const loadedLogoUrlRef = useRef<string>('');

  useEffect(() => {
    const url = displaySettings.logoWatermarkUrl;
    if (!url) {
      logoImageRef.current = null;
      loadedLogoUrlRef.current = '';
      return;
    }
    if (url === loadedLogoUrlRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoImageRef.current = img;
      loadedLogoUrlRef.current = url;
      drawFrameRuntimeRef.current();
    };
    img.onerror = () => {
      console.warn('Failed to load logo watermark:', url);
      logoImageRef.current = null;
    };
    img.src = url;
  }, [displaySettings.logoWatermarkUrl]);

  // Verse transition state
  const prevAyahRef = useRef<{ numberInSurah: number; text: string } | null>(null);
  const transitionStartRef = useRef<number>(0);
  const isTransitioningRef = useRef(false);
  const VERSE_TRANSITION_DURATION = 800; // ms
  // For random transition: pick a random effect per verse change
  const currentRandomTransitionRef = useRef<string>('fade');

  // Base dimensions for final recording quality (used as reference for scaling)
  const getRecordingDimensions = useCallback(() => {
    if (aspectRatio === '9:16') {
      return { width: 1080, height: 1920 };
    }
    return { width: 1920, height: 1080 };
  }, [aspectRatio]);

  const getRecommendedRecordingFps = useCallback(() => {
    return 24; // Fixed cinematic FPS
  }, []);

  const activeBackgroundType = customBackground
    ? (customBackgroundType || 'image')
    : (background?.type || 'image');

  const ensureBackgroundPlayback = useCallback(async () => {
    if (activeBackgroundType !== 'video') return;

    const video = videoRef.current;
    if (!video) return;

    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        let timeoutId: number | null = null;

        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onDone);
          if (timeoutId !== null) window.clearTimeout(timeoutId);
        };

        const onDone = () => {
          cleanup();
          resolve();
        };

        const onReady = () => {
          cleanup();
          resolve();
        };

        video.addEventListener('loadeddata', onReady, { once: true });
        video.addEventListener('canplay', onReady, { once: true });
        video.addEventListener('error', onDone, { once: true });
        timeoutId = window.setTimeout(onDone, 1200);
      });
    }

    if (video.paused) {
      try {
        await video.play();
      } catch (err) {
        console.warn('Could not resume background video before recording:', err);
      }
    }

    // Ensure all web fonts are loaded so Arabic typography renders cleanly from frame 0
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Ignore font ready errors
      }
    }
  }, [activeBackgroundType]);

  // Get the actual font name for canvas
  const getCanvasFontFamily = useCallback((fontFamily: string): string => {
    return FONT_MAP[fontFamily] || 'Noto Naskh Arabic';
  }, []);

  // Load background (image or video)
  useEffect(() => {
    const bgUrl = resolveBackgroundAssetUrl(customBackground || background?.url || '');
    const bgType = customBackground ? (customBackgroundType || 'image') : (background?.type || 'image');
    const slideImages = background?.slideImages?.map(resolveBackgroundAssetUrl);
    const fallbackThumb = resolveBackgroundAssetUrl(background?.thumbnail || '');

    if (!bgUrl) return;

    setImageLoaded(false);
    setVideoReady(false);
    setSlideshowReady(false);
    slideshowImagesRef.current = [];

    let cancelled = false;
    let localBlobUrl: string | null = null;

    if (bgType === 'animated' && slideImages && slideImages.length > 1) {
      // Preload all slideshow images
      const loadedImages: HTMLImageElement[] = [];
      let loadedCount = 0;

      slideImages.forEach((url, index) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        img.onload = () => {
          if (cancelled) return;
          loadedImages[index] = img;
          loadedCount++;
          if (loadedCount === slideImages.length) {
            slideshowImagesRef.current = loadedImages;
            slideshowStartTimeRef.current = Date.now();
            // Generate unique Ken Burns presets per image for variety
            kenBurnsPresetsRef.current = loadedImages.map((_, i) => {
              const zoomIn = Math.random() > 0.5;
              const zoomStart = zoomIn ? 1.0 : 1.15;
              const zoomEnd = zoomIn ? 1.15 : 1.0;
              const angle = Math.random() * Math.PI * 2;
              const panRange = 25 + Math.random() * 15;
              // Pick transition based on user setting
              const userTransitionPref = displaySettings.slideshowTransition || 'crossfade';
              const transition: SlideshowTransition = userTransitionPref === 'mixed'
                ? SLIDESHOW_TRANSITIONS[Math.floor(Math.random() * SLIDESHOW_TRANSITIONS.length)]
                : (userTransitionPref as SlideshowTransition);
              return {
                zoomStart, zoomEnd,
                panXStart: Math.cos(angle) * panRange,
                panXEnd: -Math.cos(angle) * panRange,
                panYStart: Math.sin(angle) * panRange * 0.6,
                panYEnd: -Math.sin(angle) * panRange * 0.6,
                transition,
              };
            });
            setSlideshowReady(true);
          }
        };
        img.onerror = () => {
          loadedCount++;
          console.error('Failed to load slideshow image:', url);
        };
      });
    } else if (bgType === 'video') {
      // Strategy: Try direct CORS load first (Pexels supports CORS headers).
      // Only fall back to proxy if direct load taints canvas.
      const createVideoEl = (): HTMLVideoElement => {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.autoplay = true;
        video.setAttribute('playsinline', 'true');
        return video;
      };

      const activateVideo = (video: HTMLVideoElement, successLog: string, method: 'direct' | 'proxy' | 'fallback') => {
        if (cancelled) return;
        videoRef.current = video;
        setVideoReady(true);
        video.play().catch((err) => console.warn('Video play warning:', err));
        console.log(successLog);
        onBackgroundLoadMethod?.(method);
      };

      const loadViaProxy = async () => {
        try {
          // Use the authenticated API client. The protected endpoint expects
          // `videoUrl` (not the legacy `url` field) and is needed whenever a
          // direct Pexels load would taint the recording canvas.
          const blob = await api.services.videoProxy(bgUrl);
          if (cancelled || !blob.size) return;

          localBlobUrl = URL.createObjectURL(blob);
          const video = createVideoEl();
          video.src = localBlobUrl;
          video.onloadeddata = () => activateVideo(video, '✅ Video loaded via proxy blob', 'proxy');
          video.onerror = () => { onBackgroundLoadMethod?.('fallback'); loadImage(fallbackThumb || bgUrl); };
        } catch {
          loadImage(fallbackThumb || bgUrl);
        }
      };

      const loadDirectVideo = () => {
        const video = createVideoEl();
        video.crossOrigin = 'anonymous';
        video.src = bgUrl;

        video.onloadeddata = () => {
          if (cancelled) return;
          // Test if canvas stays clean
          try {
            const tc = document.createElement('canvas');
            tc.width = 2;
            tc.height = 2;
            const tctx = tc.getContext('2d');
            tctx?.drawImage(video, 0, 0, 2, 2);
            tc.toDataURL(); // Throws if tainted
            activateVideo(video, '✅ Video loaded directly with CORS', 'direct');
          } catch {
            console.warn('Direct video taints canvas, trying proxy…');
            video.pause();
            video.src = '';
            loadViaProxy();
          }
        };

        video.onerror = () => {
          console.warn('Direct video load failed, trying proxy…');
          loadViaProxy();
        };
      };

      loadDirectVideo();
    } else {
      loadImage(bgUrl);
    }

    function loadImage(url: string) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => {
        if (cancelled) return;
        imageRef.current = img;
        setImageLoaded(true);
      };
      img.onerror = () => {
        console.error('Failed to load image:', url);
        imageRef.current = null;
        setImageLoaded(false);
      };
    }

    return () => {
      cancelled = true;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current = null;
      }
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
      slideshowImagesRef.current = [];
      kenBurnsPresetsRef.current = [];
    };
  }, [customBackground, customBackgroundType, background?.url, background?.type, background?.thumbnail, background?.slideImages, displaySettings.slideshowTransition, onBackgroundLoadMethod]);

  const tokenHslCacheRef = useRef<Record<string, string>>({});
  const getTokenHsl = useCallback((token: string, fallback: string) => {
    if (tokenHslCacheRef.current[token]) return tokenHslCacheRef.current[token];
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      const result = v ? `hsl(${v})` : fallback;
      tokenHslCacheRef.current[token] = result;
      return result;
    } catch {
      return fallback;
    }
  }, []);

  // Convert Arabic number to Eastern Arabic numerals
  const toArabicNumber = (num: number): string => {
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return num.toString().split('').map(d => arabicNumerals[parseInt(d)] || d).join('');
  };

  // Draw decorative ayah number badge with different styles
  const drawAyahBadge = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, num: number, size: number, style: string, colorScheme?: string) => {
    const arabicNum = toArabicNumber(num);
    
    // Color map based on ayahNumberColor setting
    // Color map based on ayahNumberColor setting
    const colorMap: Record<string, { main: string; glow: string; fill: string }> = {
      gold: { main: 'rgba(212, 175, 55, 0.7)', glow: 'rgba(212, 175, 55, 0.4)', fill: '#D4AF37' },
      metallicGold3D: { main: 'rgba(255, 215, 0, 0.9)', glow: 'rgba(212, 175, 55, 0.6)', fill: '#FFD700' },
      white: { main: 'rgba(255, 255, 255, 0.7)', glow: 'rgba(255, 255, 255, 0.3)', fill: '#FFFFFF' },
      silver: { main: 'rgba(192, 192, 192, 0.7)', glow: 'rgba(192, 192, 192, 0.3)', fill: '#C0C0C0' },
      emerald: { main: 'rgba(80, 200, 120, 0.7)', glow: 'rgba(80, 200, 120, 0.3)', fill: '#50C878' },
      royal: { main: 'rgba(123, 104, 238, 0.7)', glow: 'rgba(123, 104, 238, 0.3)', fill: '#7B68EE' },
    };
    const colors = colorMap[colorScheme || 'gold'] || colorMap.gold;
    
    ctx.save();
    
    // 3D Gilded Quranic Bracket / Medallion Style ﴿...﴾ (As in user's reference image)
    if (style === 'quran3d') {
      const metalGrad = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
      metalGrad.addColorStop(0, '#FFE082');
      metalGrad.addColorStop(0.3, '#D4AF37');
      metalGrad.addColorStop(0.6, '#FFF8E1');
      metalGrad.addColorStop(0.85, '#B78727');
      metalGrad.addColorStop(1, '#8C6B1B');

      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;

      // Dark translucent backfill
      ctx.beginPath();
      ctx.arc(x, y, size * 1.05, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 12, 5, 0.75)';
      ctx.fill();

      // Outer 3D gilded ring
      ctx.strokeStyle = metalGrad;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Inner ornamental ring
      ctx.beginPath();
      ctx.arc(x, y, size * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 235, 150, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Four corner ornamental gold beads
      const beads = [
        [x, y - size * 1.05],
        [x + size * 1.05, y],
        [x, y + size * 1.05],
        [x - size * 1.05, y],
      ];
      ctx.fillStyle = '#FFE082';
      beads.forEach(([bx, by]) => {
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Number in crisp high-contrast bold typography
      ctx.font = `bold ${size * 1.15}px "Noto Naskh Arabic", "Amiri", serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(arabicNum, x, y + 1);
      ctx.restore();
      return;
    }

    // Draw shape based on style
    switch (style) {
      case 'star':
        drawStar(ctx, x, y, size, 8);
        break;
      case 'diamond':
        drawDiamond(ctx, x, y, size);
        break;
      case 'octagon':
        drawPolygon(ctx, x, y, size, 8);
        break;
      case 'flower':
        drawFlower(ctx, x, y, size);
        break;
      case 'hexagon':
        drawPolygon(ctx, x, y, size, 6);
        break;
      case 'square':
        ctx.beginPath();
        ctx.roundRect(x - size, y - size, size * 2, size * 2, size * 0.2);
        break;
      default: // circle
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
    }
    
    // Fill with gradient
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
    gradient.addColorStop(0, colors.glow);
    gradient.addColorStop(0.7, colors.glow.replace('0.4', '0.2').replace('0.3', '0.15'));
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Draw border
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Inner decoration
    if (style === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, size * 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = colors.main.replace('0.7', '0.4');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Draw number
    ctx.font = `bold ${size * 1.1}px "Noto Naskh Arabic", "Amiri", serif`;
    ctx.fillStyle = colors.fill;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(arabicNum, x, y + 2);
    ctx.restore();
  }, []);

  // Helper functions for shapes
  const drawStar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, points: number) => {
    const outerRadius = size;
    const innerRadius = size * 0.5;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      if (i === 0) {
        ctx.moveTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      } else {
        ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      }
    }
    ctx.closePath();
  };

  const drawDiamond = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size, cy);
    ctx.closePath();
  };

  const drawPolygon = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, sides: number) => {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  const drawFlower = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => {
    const petals = 8;
    ctx.beginPath();
    for (let i = 0; i < petals; i++) {
      const angle = (i * 2 * Math.PI) / petals;
      const nextAngle = ((i + 1) * 2 * Math.PI) / petals;
      const midAngle = (angle + nextAngle) / 2;
      
      const x1 = cx + size * Math.cos(angle);
      const y1 = cy + size * Math.sin(angle);
      const cpX = cx + size * 1.3 * Math.cos(midAngle);
      const cpY = cy + size * 1.3 * Math.sin(midAngle);
      const x2 = cx + size * Math.cos(nextAngle);
      const y2 = cy + size * Math.sin(nextAngle);
      
      if (i === 0) ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpX, cpY, x2, y2);
    }
    ctx.closePath();
  };

  // Draw Islamic decorative frame
  const drawIslamicFrame = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, style: string) => {
    if (style === 'none') return;
    
    ctx.save();
    // Keep stroke weights and ornaments optically consistent from the small
    // preview canvas to 4K recording canvases.
    const F = Math.max(0.5, Math.min(2.4, width / 1080));
    const cornerSize = Math.min(width, height) * 0.1;
    const goldColor = 'rgba(212, 175, 55, 0.6)';
    const goldLight = 'rgba(212, 175, 55, 0.3)';
    
    switch (style) {
      case 'simple':
        // Simple elegant border
        ctx.strokeStyle = goldColor;
        ctx.lineWidth = 2 * F;
        ctx.strokeRect(x, y, width, height);
        
        // Inner border
        ctx.strokeStyle = goldLight;
        ctx.lineWidth = 1 * F;
        ctx.strokeRect(x + 6 * F, y + 6 * F, width - 12 * F, height - 12 * F);
        break;
        
      case 'ornate':
        // Ornate Islamic frame with corner decorations
        ctx.strokeStyle = goldColor;
        ctx.lineWidth = 3 * F;
        
        // Main frame
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 10 * F);
        ctx.stroke();
        
        // Corner ornaments
        drawCornerOrnament(ctx, x, y, cornerSize, 0, F);
        drawCornerOrnament(ctx, x + width, y, cornerSize, 90, F);
        drawCornerOrnament(ctx, x + width, y + height, cornerSize, 180, F);
        drawCornerOrnament(ctx, x, y + height, cornerSize, 270, F);
        
        // Side decorations
        drawSideDecoration(ctx, x + width / 2, y, cornerSize * 0.6, F);
        drawSideDecoration(ctx, x + width / 2, y + height, cornerSize * 0.6, F);
        break;
        
      case 'golden':
        // Luxurious golden frame with glow
        ctx.shadowColor = 'rgba(212, 175, 55, 0.5)';
        ctx.shadowBlur = 15 * F;
        
        // Outer glow border
        ctx.strokeStyle = goldColor;
        ctx.lineWidth = 4 * F;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 15 * F);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        
        // Inner decorative line
        ctx.strokeStyle = goldLight;
        ctx.lineWidth = 2 * F;
        ctx.setLineDash([10 * F, 5 * F]);
        ctx.beginPath();
        ctx.roundRect(x + 10 * F, y + 10 * F, width - 20 * F, height - 20 * F, 10 * F);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Corner flourishes
        drawGoldenCorner(ctx, x, y, cornerSize, false, false, F);
        drawGoldenCorner(ctx, x + width, y, cornerSize, true, false, F);
        drawGoldenCorner(ctx, x + width, y + height, cornerSize, true, true, F);
        drawGoldenCorner(ctx, x, y + height, cornerSize, false, true, F);
        break;
        
      case 'geometric':
        // Islamic geometric pattern frame
        ctx.strokeStyle = goldColor;
        ctx.lineWidth = 2 * F;
        
        // Outer border
        ctx.strokeRect(x, y, width, height);
        
        // Geometric corner patterns
        drawGeometricCorner(ctx, x, y, cornerSize, F);
        drawGeometricCorner(ctx, x + width - cornerSize, y, cornerSize, F);
        drawGeometricCorner(ctx, x + width - cornerSize, y + height - cornerSize, cornerSize, F);
        drawGeometricCorner(ctx, x, y + height - cornerSize, cornerSize, F);
        
        // Connecting geometric lines
        ctx.beginPath();
        ctx.moveTo(x + cornerSize, y + cornerSize / 2);
        ctx.lineTo(x + width - cornerSize, y + cornerSize / 2);
        ctx.moveTo(x + cornerSize, y + height - cornerSize / 2);
        ctx.lineTo(x + width - cornerSize, y + height - cornerSize / 2);
        ctx.strokeStyle = goldLight;
        ctx.stroke();
        break;

      case 'minimal':
        // Fine editorial frame that scales quietly on mobile canvases.
        ctx.strokeStyle = 'rgba(232, 214, 157, 0.72)';
        ctx.lineWidth = Math.max(1, 1.5 * (width / 1080));
        ctx.strokeRect(x, y, width, height);
        ctx.strokeStyle = 'rgba(232, 214, 157, 0.28)';
        ctx.lineWidth = Math.max(0.75, 0.75 * (width / 1080));
        ctx.strokeRect(x + 7 * (width / 1080), y + 7 * (width / 1080), width - 14 * (width / 1080), height - 14 * (width / 1080));
        break;

      case 'modern': {
        // Modern corner rails leave generous breathing room around Arabic text.
        ctx.strokeStyle = 'rgba(245, 245, 245, 0.68)';
        ctx.lineWidth = Math.max(1, 2 * (width / 1080));
        const rail = Math.min(width, height) * 0.14;
        ctx.beginPath();
        ctx.moveTo(x, y + rail); ctx.lineTo(x, y); ctx.lineTo(x + rail, y);
        ctx.moveTo(x + width - rail, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + rail);
        ctx.moveTo(x, y + height - rail); ctx.lineTo(x, y + height); ctx.lineTo(x + rail, y + height);
        ctx.moveTo(x + width - rail, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - rail);
        ctx.stroke();
        break;
      }
    }
    
    ctx.restore();
  }, []);

  // Helper for corner ornament
  const drawCornerOrnament = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, scale = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    
    ctx.fillStyle = 'rgba(212, 175, 55, 0.4)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(size * 0.2, size * 0.2);
    ctx.quadraticCurveTo(size * 0.5, 0, size * 0.2, -size * 0.2);
    ctx.stroke();
    
    ctx.restore();
  };

  const drawSideDecoration = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale = 1) => {
    ctx.save();
    ctx.translate(x, y);
    
    ctx.fillStyle = 'rgba(212, 175, 55, 0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.7)';
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    
    ctx.restore();
  };

  const drawGoldenCorner = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flipX = false, flipY = false, scale = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.75)';
    ctx.lineWidth = 2 * scale;
    
    // Tight corner flourish that stays along the perimeter without intruding into text
    const r = Math.min(size * 0.45, 26 * scale);
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(4, r * 0.8);
    ctx.quadraticCurveTo(4, 4, r * 0.8, 4);
    ctx.strokeStyle = 'rgba(255, 224, 130, 0.5)';
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    
    // Inner small gold dot
    ctx.beginPath();
    ctx.arc(r * 0.35, r * 0.35, Math.max(2 * scale, r * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(212, 175, 55, 0.6)';
    ctx.fill();
    
    ctx.restore();
  };

  const drawGeometricCorner = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
    ctx.lineWidth = 1 * scale;
    
    // Create 8-pointed star pattern
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size, size / 2);
      ctx.lineTo(size / 2, size);
      ctx.lineTo(0, size / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(Math.PI / 4);
      ctx.translate(-size / 2, -size / 2);
    }
    
    ctx.restore();
  };

  // Draw full-screen decorative video border
  const drawFullScreenBorder = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, style?: string, colorScheme?: string) => {
    if (!style || style === 'none') return;
    ctx.save();
    const S = width / 1080;
    const palettes: Record<string, { primary: string; secondary: string; glow: string }> = {
      gold: { primary: '#D4AF37', secondary: '#FFE082', glow: 'rgba(212, 175, 55, 0.35)' },
      emerald: { primary: '#10B981', secondary: '#6EE7B7', glow: 'rgba(16, 185, 129, 0.35)' },
      silver: { primary: '#D1D5DB', secondary: '#F9FAFB', glow: 'rgba(209, 213, 219, 0.35)' },
      white: { primary: '#FFFFFF', secondary: '#E5E7EB', glow: 'rgba(255, 255, 255, 0.30)' }
    };
    const pal = palettes[colorScheme || 'gold'] || palettes.gold;
    const margin = 26 * S;
    const w = width - margin * 2;
    const h = height - margin * 2;
    const x = margin;
    const y = margin;

    if (style === 'goldenTrim') {
      ctx.strokeStyle = pal.primary;
      ctx.lineWidth = 3 * S;
      ctx.shadowColor = pal.glow;
      ctx.shadowBlur = 8 * S;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.secondary;
      ctx.lineWidth = 1 * S;
      ctx.strokeRect(x + 8 * S, y + 8 * S, w - 16 * S, h - 16 * S);
    } else if (style === 'islamicCorners') {
      ctx.strokeStyle = pal.primary;
      ctx.lineWidth = 2 * S;
      ctx.shadowColor = pal.glow;
      ctx.shadowBlur = 6 * S;
      const cLen = 75 * S;
      ctx.beginPath();
      ctx.moveTo(x + cLen, y); ctx.lineTo(x + w - cLen, y);
      ctx.moveTo(x + cLen, y + h); ctx.lineTo(x + w - cLen, y + h);
      ctx.moveTo(x, y + cLen); ctx.lineTo(x, y + h - cLen);
      ctx.moveTo(x + w, y + cLen); ctx.lineTo(x + w, y + h - cLen);
      ctx.stroke();

      const drawCorner = (cx: number, cy: number, rot: number) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.strokeStyle = pal.secondary;
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.moveTo(0, cLen); ctx.lineTo(0, 0); ctx.lineTo(cLen, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(12 * S, cLen - 15 * S);
        ctx.quadraticCurveTo(12 * S, 12 * S, cLen - 15 * S, 12 * S);
        ctx.stroke();
        ctx.fillStyle = pal.primary;
        ctx.beginPath();
        ctx.arc(18 * S, 18 * S, 3.5 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      drawCorner(x, y, 0);
      drawCorner(x + w, y, 90);
      drawCorner(x + w, y + h, 180);
      drawCorner(x, y + h, 270);
    } else if (style === 'doubleCinema') {
      ctx.strokeStyle = pal.primary;
      ctx.lineWidth = 3.5 * S;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = pal.secondary;
      ctx.lineWidth = 1.5 * S;
      ctx.strokeRect(x + 12 * S, y + 12 * S, w - 24 * S, h - 24 * S);
    } else if (style === 'royalCrest') {
      ctx.strokeStyle = pal.primary;
      ctx.lineWidth = 2.5 * S;
      ctx.strokeRect(x, y, w, h);
      const topCx = width / 2;
      const crestW = 90 * S;
      ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
      ctx.fillRect(topCx - crestW / 2, y - 6 * S, crestW, 12 * S);
      ctx.strokeStyle = pal.secondary;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(topCx - crestW / 2, y); ctx.lineTo(topCx - 15 * S, y - 10 * S);
      ctx.lineTo(topCx, y - 18 * S); ctx.lineTo(topCx + 15 * S, y - 10 * S); ctx.lineTo(topCx + crestW / 2, y);
      ctx.stroke();
      ctx.fillStyle = pal.primary;
      ctx.beginPath();
      ctx.arc(topCx, y - 18 * S, 3.5 * S, 0, Math.PI * 2);
      ctx.fill();

      const btmY = y + h;
      ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
      ctx.fillRect(topCx - crestW / 2, btmY - 6 * S, crestW, 12 * S);
      ctx.strokeStyle = pal.secondary;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(topCx - crestW / 2, btmY); ctx.lineTo(topCx - 15 * S, btmY + 10 * S);
      ctx.lineTo(topCx, btmY + 18 * S); ctx.lineTo(topCx + 15 * S, btmY + 10 * S); ctx.lineTo(topCx + crestW / 2, btmY);
      ctx.stroke();
      ctx.fillStyle = pal.primary;
      ctx.beginPath();
      ctx.arc(topCx, btmY + 18 * S, 3.5 * S, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'subtleVignette') {
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
      ctx.lineWidth = 1.5 * S;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
  }, []);

  // Draw frame on canvas
  const drawFrame = useCallback((
    targetCanvas?: HTMLCanvasElement,
    renderMode: 'preview' | 'recording' | 'recordingLite' = 'preview',
    syncOverride?: FrameSyncOverride
  ) => {
    const canvas = targetCanvas || canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const activeAyah = syncOverride?.currentAyah !== undefined ? syncOverride.currentAyah : currentAyah;
    const activeAyahWords = syncOverride?.currentAyahWords !== undefined ? syncOverride.currentAyahWords : currentAyahWords;
    const activeHighlightedWordIndex = syncOverride?.highlightedWordIndex !== undefined ? syncOverride.highlightedWordIndex : highlightedWordIndex;
    const activeHighlightWordProgress = syncOverride?.highlightWordProgress !== undefined ? syncOverride.highlightWordProgress : highlightWordProgress;
    const activeLyricsIndex = syncOverride?.currentLyricsIndex !== undefined ? syncOverride.currentLyricsIndex : currentLyricsIndex;

    const base = getRecordingDimensions();
    const previewScale = 0.38;
    const isPreviewRender = renderMode === 'preview';
    const isLiteRecording = renderMode === 'recordingLite';
    const recordingScale = isLiteRecording ? 0.67 : 1;

    // For recording: the canvas dimensions are set by the caller (PreviewPage)
    // based on quality preset. We only resize for preview mode.
    // IMPORTANT: Never resize during recording/recordingLite — the caller sets
    // the canvas dimensions once before captureStream(). Resizing mid-stream
    // clears the canvas and produces a static/blank video.
    if (isPreviewRender) {
      const width = Math.round(base.width * previewScale);
      const height = Math.round(base.height * previewScale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    // else: recording / recordingLite — canvas dimensions are set once by PreviewPage

    // Scale factor: all hardcoded sizes were designed for ~1080px width canvas.
    // Scale them relative to actual canvas width so they look right at all sizes.
    const S = canvas.width / 1080;

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // The free plan deliberately keeps basic image backgrounds static. Motion
    // and slideshow transitions are a premium entitlement, not a cosmetic-only
    // UI lock.
    const effectiveMotionSpeed = isPremium ? motionSpeed : 0;

    // Draw background motion (lighter in recordingLite)
    const motionFactor = isLiteRecording ? 0.55 : 1;
    const t = (Date.now() / 1000) * effectiveMotionSpeed * motionFactor;
    const scale = 1.04 + Math.sin(t * 0.2) * (0.03 * motionFactor);
    const offsetX = Math.sin(t * 0.12) * (20 * motionFactor);
    const offsetY = Math.cos(t * 0.1) * (16 * motionFactor);
    
    // Handle slideshow backgrounds
    if (isPremium && slideshowReady && slideshowImagesRef.current.length > 1) {
      const images = slideshowImagesRef.current;
      const presets = kenBurnsPresetsRef.current;
      const elapsed = Date.now() - slideshowStartTimeRef.current;
      const cycleDuration = SLIDESHOW_DISPLAY_DURATION + SLIDESHOW_TRANSITION_DURATION;
      const totalCycle = cycleDuration * images.length;
      const cyclePosition = elapsed % totalCycle;
      
      const currentIndex = Math.floor(cyclePosition / cycleDuration) % images.length;
      const nextIndex = (currentIndex + 1) % images.length;
      const positionInCycle = cyclePosition % cycleDuration;
      
      // Smooth ease function
      const easeInOut = (p: number) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

      // Cover-fit: draw image filling canvas without black bars
      const drawImageCover = (img: HTMLImageElement, cw: number, ch: number) => {
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const canvasRatio = cw / ch;
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
        if (imgRatio > canvasRatio) {
          sw = img.naturalHeight * canvasRatio;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          sh = img.naturalWidth / canvasRatio;
          sy = (img.naturalHeight - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      };

      // Use absolute elapsed time for Ken Burns so motion is continuous
      const elapsedSec = elapsed / 1000;
      const getKenBurns = (imgIndex: number) => {
        const preset = presets[imgIndex] || { zoomStart: 1.0, zoomEnd: 1.1, panXStart: 0, panXEnd: 0, panYStart: 0, panYEnd: 0 };
        const speedFactor = Math.max(effectiveMotionSpeed / 3, 0.01);
        // Continuous slow oscillation based on absolute time + per-image phase offset
        const phase = imgIndex * 1.7; // unique phase per image
        const period = 12 / speedFactor; // full cycle in seconds
        const p = ((elapsedSec + phase) % period) / period; // 0→1 continuous
        const wave = 0.5 - 0.5 * Math.cos(p * Math.PI * 2); // smooth 0→1→0
        const zoom = preset.zoomStart + (preset.zoomEnd - preset.zoomStart) * wave;
        const panX = preset.panXStart + (preset.panXEnd - preset.panXStart) * wave;
        const panY = preset.panYStart + (preset.panYEnd - preset.panYStart) * wave;
        return { zoom: Math.max(zoom, 1.0), panX, panY };
      };

      const curKB = getKenBurns(currentIndex);
      const currentImg = images[currentIndex];

      // Check transition type
      const isInTransition = positionInCycle > SLIDESHOW_DISPLAY_DURATION;
      const transType = (presets[currentIndex] || {}).transition || 'crossfade';
      const isOverlayTransition = !isInTransition || transType === 'crossfade' || transType === 'zoomThrough';

      // Draw with Ken Burns helper
      const drawWithKB = (img: HTMLImageElement | undefined, kb: { zoom: number; panX: number; panY: number }) => {
        if (!img) return;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(kb.zoom, kb.zoom);
        ctx.translate(-canvas.width / 2 + kb.panX, -canvas.height / 2 + kb.panY);
        drawImageCover(img, canvas.width, canvas.height);
      };

      if (isOverlayTransition) {
        ctx.save();
        drawWithKB(currentImg, curKB);
        ctx.restore();
      }

      // Transition to next image
      if (isInTransition) {
        const rawProgress = (positionInCycle - SLIDESHOW_DISPLAY_DURATION) / SLIDESHOW_TRANSITION_DURATION;
        const fadeProgress = easeInOut(Math.min(rawProgress, 1));
        const nextKB = getKenBurns(nextIndex);
        const nextImg = images[nextIndex];

        switch (transType) {
          case 'slideLeft': {
            const offset = canvas.width * fadeProgress;
            ctx.save();
            ctx.translate(-offset, 0);
            drawWithKB(currentImg, curKB);
            ctx.restore();
            ctx.save();
            ctx.translate(canvas.width - offset, 0);
            drawWithKB(nextImg, nextKB);
            ctx.restore();
            break;
          }
          case 'slideRight': {
            const offset = canvas.width * fadeProgress;
            ctx.save();
            ctx.translate(offset, 0);
            drawWithKB(currentImg, curKB);
            ctx.restore();
            ctx.save();
            ctx.translate(-canvas.width + offset, 0);
            drawWithKB(nextImg, nextKB);
            ctx.restore();
            break;
          }
          case 'slideUp': {
            const offset = canvas.height * fadeProgress;
            ctx.save();
            ctx.translate(0, -offset);
            drawWithKB(currentImg, curKB);
            ctx.restore();
            ctx.save();
            ctx.translate(0, canvas.height - offset);
            drawWithKB(nextImg, nextKB);
            ctx.restore();
            break;
          }
          case 'zoomThrough': {
            const zoomMul = 1 + fadeProgress * 0.3;
            ctx.save();
            ctx.globalAlpha = 1 - fadeProgress;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(curKB.zoom * zoomMul, curKB.zoom * zoomMul);
            ctx.translate(-canvas.width / 2 + curKB.panX, -canvas.height / 2 + curKB.panY);
            if (currentImg) drawImageCover(currentImg, canvas.width, canvas.height);
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = fadeProgress;
            const nextZoomMul = 1.2 - fadeProgress * 0.2;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(nextKB.zoom * nextZoomMul, nextKB.zoom * nextZoomMul);
            ctx.translate(-canvas.width / 2 + nextKB.panX, -canvas.height / 2 + nextKB.panY);
            if (nextImg) drawImageCover(nextImg, canvas.width, canvas.height);
            ctx.restore();
            break;
          }
          case 'wipe': {
            const wipeX = canvas.width * fadeProgress;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, wipeX, canvas.height);
            ctx.clip();
            drawWithKB(nextImg, nextKB);
            ctx.restore();
            break;
          }
          default: {
            ctx.save();
            ctx.globalAlpha = fadeProgress;
            drawWithKB(nextImg, nextKB);
            ctx.restore();
            break;
          }
        }
      }
    } else if (videoReady && videoRef.current) {
      // Draw video frame with Spec 90 Canvas Cover-Fit Algorithm (prevents distortion & black bars)
      const video = videoRef.current;
      const vw = video.videoWidth || 1920;
      const vh = video.videoHeight || 1080;
      const canvasRatio = canvas.width / canvas.height;
      const videoRatio = vw / vh;
      let sw = vw, sh = vh, sx = 0, sy = 0;
      if (videoRatio > canvasRatio) {
        sw = vh * canvasRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / canvasRatio;
        sy = (vh - sh) / 2;
      }

      if (isLiteRecording) {
        if (!videoScaleCanvasRef.current) {
          videoScaleCanvasRef.current = document.createElement('canvas');
        }
        const sc = videoScaleCanvasRef.current;
        const scaleW = 480;
        const scaleH = Math.round(scaleW / canvasRatio);
        if (sc.width !== scaleW || sc.height !== scaleH) {
          sc.width = scaleW;
          sc.height = scaleH;
        }
        const sCtx = sc.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(video, sx, sy, sw, sh, 0, 0, scaleW, scaleH);
          ctx.drawImage(sc, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        }
      } else {
        // High quality full-resolution direct draw with precise source crop
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      }
    } else if (imageRef.current && imageLoaded) {
      // Draw single image with Ken Burns + cover-fit
      const img = imageRef.current;
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = canvas.width / canvas.height;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (imgRatio > canvasRatio) {
        sw = img.naturalHeight * canvasRatio;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = img.naturalWidth / canvasRatio;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-canvas.width / 2 + offsetX, -canvas.height / 2 + offsetY);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      // Gradient fallback
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#1a1a2e');
      gradient.addColorStop(0.5, '#16213e');
      gradient.addColorStop(1, '#0f3460');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw overlay
    ctx.fillStyle = `rgba(0, 0, 0, ${textSettings.overlayOpacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw top/bottom gradients (skip during recording for performance)
    if (isPreviewRender) {
      const sizeChanged = gradientCacheSizeRef.current.w !== canvas.width || gradientCacheSizeRef.current.h !== canvas.height;
      if (sizeChanged || !topGradientCacheRef.current || !bottomGradientCacheRef.current) {
        const tg = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.25);
        tg.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
        tg.addColorStop(1, 'transparent');
        topGradientCacheRef.current = tg;
        const bg = ctx.createLinearGradient(0, canvas.height * 0.75, 0, canvas.height);
        bg.addColorStop(0, 'transparent');
        bg.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
        bottomGradientCacheRef.current = bg;
        gradientCacheSizeRef.current = { w: canvas.width, h: canvas.height };
      }
      ctx.fillStyle = topGradientCacheRef.current;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.25);
      ctx.fillStyle = bottomGradientCacheRef.current;
      ctx.fillRect(0, canvas.height * 0.75, canvas.width, canvas.height * 0.25);
    }

    

    // ── Subtle vignette effect (skip during recording to save GPU) ──────
    if (isPreviewRender && isPlaying) {
      const vignetteGrad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
        canvas.width / 2, canvas.height / 2, canvas.width * 0.9
      );
      vignetteGrad.addColorStop(0, 'transparent');
      vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
      ctx.fillStyle = vignetteGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ── Cinematic dawn atmosphere (the default Quranic editorial treatment) ──
    // Keep this layer deterministic so recording and preview never shimmer
    // differently, while still giving the background a premium sense of depth.
    // The gradients are intentionally subtle: the verse remains the hero.
    const visualDesign = displaySettings.visualDesign || 'dawn';
    const atmospherePalette = visualDesign === 'moonlit'
      ? { core: 'rgba(112, 175, 255, 0.16)', mid: 'rgba(74, 125, 205, 0.07)', veil: 'rgba(4, 10, 30, 0.28)', grain: '#d9e8ff' }
      : visualDesign === 'editorial'
        ? { core: 'rgba(194, 226, 184, 0.14)', mid: 'rgba(71, 150, 132, 0.07)', veil: 'rgba(4, 18, 19, 0.25)', grain: '#eff0d7' }
        : { core: 'rgba(255, 206, 128, 0.14)', mid: 'rgba(136, 158, 196, 0.06)', veil: 'rgba(6, 14, 28, 0.24)', grain: '#f8e9c5' };
    const atmosphere = ctx.createRadialGradient(
      canvas.width * 0.52, canvas.height * 0.30, 0,
      canvas.width * 0.52, canvas.height * 0.30, canvas.height * 0.72
    );
    atmosphere.addColorStop(0, atmospherePalette.core);
    atmosphere.addColorStop(0.32, atmospherePalette.mid);
    atmosphere.addColorStop(1, 'rgba(6, 14, 28, 0)');
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // A restrained lower-third veil creates a reliable contrast zone for
    // long Arabic verses without introducing a visible card or hard edge.
    const focusVeil = ctx.createLinearGradient(0, canvas.height * 0.34, 0, canvas.height * 0.80);
    focusVeil.addColorStop(0, 'rgba(5, 13, 28, 0)');
    focusVeil.addColorStop(0.58, 'rgba(5, 13, 28, 0.08)');
    focusVeil.addColorStop(1, atmospherePalette.veil);
    ctx.fillStyle = focusVeil;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Deterministic film grain is preview-only; recordings stay lightweight.
    if (isPreviewRender && isPlaying) {
      ctx.save();
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = atmospherePalette.grain;
      const grainCount = Math.min(420, Math.round(canvas.width * canvas.height / 9000));
      for (let i = 0; i < grainCount; i++) {
        const gx = (i * 83 + 17) % canvas.width;
        const gy = (i * 47 + 29) % canvas.height;
        const size = (i % 3) + 1;
        ctx.fillRect(gx, gy, size, size);
      }
      ctx.restore();
    }

    // Direction-specific signature mark. It is deliberately low contrast so
    // users can swap directions without sacrificing Quran text legibility.
    ctx.save();
    ctx.globalAlpha = !isPreviewRender ? 0.55 : 0.8;
    ctx.strokeStyle = visualDesign === 'moonlit' ? 'rgba(157, 199, 255, 0.34)' : visualDesign === 'editorial' ? 'rgba(179, 225, 187, 0.30)' : 'rgba(242, 194, 112, 0.32)';
    ctx.lineWidth = Math.max(1, 1.5 * S);
    if (visualDesign === 'moonlit') {
      const cx = canvas.width * 0.78;
      const cy = canvas.height * 0.16;
      const r = Math.max(18 * S, canvas.width * 0.035);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0.35 * Math.PI, 1.65 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r * 0.34, cy - r * 0.18, r * 0.92, 0.45 * Math.PI, 1.55 * Math.PI);
      ctx.stroke();
    } else if (visualDesign === 'editorial') {
      const inset = canvas.width * 0.075;
      const top = canvas.height * 0.27;
      const bottom = canvas.height * 0.75;
      ctx.setLineDash([5 * S, 9 * S]);
      ctx.strokeRect(inset, top, canvas.width - inset * 2, bottom - top);
      ctx.setLineDash([]);
    } else {
      const cx = canvas.width / 2;
      const top = canvas.height * 0.055;
      const w = canvas.width * 0.34;
      const h = canvas.height * 0.19;
      ctx.beginPath();
      ctx.moveTo(cx - w, top + h);
      ctx.lineTo(cx - w, top + h * 0.48);
      ctx.quadraticCurveTo(cx, top - h * 0.2, cx + w, top + h * 0.48);
      ctx.lineTo(cx + w, top + h);
      ctx.stroke();
    }
    ctx.restore();

    // ── Full-Screen Video Decorative Border ──────────────────────────────
    drawFullScreenBorder(ctx, canvas.width, canvas.height, displaySettings.screenBorderStyle, displaySettings.screenBorderColor);

    // Get the font family for canvas
    const fontName = getCanvasFontFamily(textSettings.fontFamily);

    // Text settings — apply textShadowStyle and reduce shadow cost during recording
    const isAnyRecording = !isPreviewRender;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Apply textShadowStyle setting
    const textShadowStyle = displaySettings.textShadowStyle || 'soft';
    if (textShadowStyle === 'none') {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (textShadowStyle === 'soft') {
      ctx.shadowColor = `rgba(0, 0, 0, ${isAnyRecording ? 0.3 : 0.4})`;
      ctx.shadowBlur = isAnyRecording ? 3 * S : 6 * S;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
    } else if (textShadowStyle === 'strong') {
      ctx.shadowColor = `rgba(0, 0, 0, ${isAnyRecording ? 0.5 : 0.8})`;
      ctx.shadowBlur = isAnyRecording ? 6 * S : 16 * S;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    } else if (textShadowStyle === 'glow') {
      ctx.shadowColor = 'rgba(212, 175, 55, 0.6)';
      ctx.shadowBlur = isAnyRecording ? 8 * S : 20 * S;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    const headerLayout = getResponsiveHeaderLayout({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      scale: S,
      showSurahName: Boolean(displaySettings.showSurahName),
      showReciterName: Boolean(displaySettings.showReciterName),
      surahNamePosition: displaySettings.surahNamePosition,
      surahNameStyle: displaySettings.surahNameStyle,
      reciterNameStyle: displaySettings.reciterNameStyle,
      textFontSize: textSettings.fontSize,
    });
    // Reserve the header band so verse frames never intrude into the reciter
    // label. For bottom-positioned headers the same guard is applied upward.
    const headerSafeTopRatio = (displaySettings.showSurahName || displaySettings.showReciterName)
      && displaySettings.surahNamePosition !== 'bottom'
      ? Math.min(0.72, Math.max(0.14, (headerLayout.separatorY + 20 * S) / canvas.height))
      : 0.14;
    const headerSafeBottomRatio = (displaySettings.showSurahName || displaySettings.showReciterName)
      && displaySettings.surahNamePosition === 'bottom'
      ? Math.max(0.28, Math.min(0.92, (headerLayout.separatorY - 20 * S) / canvas.height))
      : 0.92;

    // Draw surah name badge (if enabled) based on surahNameStyle
    if (displaySettings.showSurahName) {
      const badgeY = headerLayout.titleY;
      const badgeX = headerLayout.titleX;
      const nameStyle = displaySettings.surahNameStyle || 'classic';

      ctx.save();

      switch (nameStyle) {
        case 'banner': {
          const bw = 500 * S, bh = 90 * S;
          const grad = ctx.createLinearGradient(badgeX - bw / 2, badgeY, badgeX + bw / 2, badgeY);
          grad.addColorStop(0, 'rgba(212, 175, 55, 0)');
          grad.addColorStop(0.2, 'rgba(212, 175, 55, 0.25)');
          grad.addColorStop(0.5, 'rgba(212, 175, 55, 0.35)');
          grad.addColorStop(0.8, 'rgba(212, 175, 55, 0.25)');
          grad.addColorStop(1, 'rgba(212, 175, 55, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(badgeX - bw / 2, badgeY - bh / 2, bw, bh);
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
          ctx.lineWidth = 1.5 * S;
          ctx.beginPath();
          ctx.moveTo(badgeX - bw / 2 + 40 * S, badgeY - bh / 2);
          ctx.lineTo(badgeX + bw / 2 - 40 * S, badgeY - bh / 2);
          ctx.moveTo(badgeX - bw / 2 + 40 * S, badgeY + bh / 2);
          ctx.lineTo(badgeX + bw / 2 - 40 * S, badgeY + bh / 2);
          ctx.stroke();
          break;
        }
        case 'calligraphy': {
          ctx.fillStyle = 'rgba(212, 175, 55, 0.5)';
          [-100, -60, 60, 100].forEach(dx => {
            ctx.beginPath();
            ctx.arc(badgeX + dx * S, badgeY - 35 * S, 3 * S, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(badgeX + dx * S, badgeY + 35 * S, 3 * S, 0, Math.PI * 2);
            ctx.fill();
          });
          break;
        }
        case 'circle': {
          const radius = 75 * S;
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
          ctx.lineWidth = 3 * S;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, radius - 8 * S, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
          ctx.lineWidth = 1 * S;
          ctx.stroke();
          break;
        }
        case 'diamond': {
          const s = 80 * S;
          ctx.beginPath();
          ctx.moveTo(badgeX, badgeY - s);
          ctx.lineTo(badgeX + s * 1.8, badgeY);
          ctx.lineTo(badgeX, badgeY + s);
          ctx.lineTo(badgeX - s * 1.8, badgeY);
          ctx.closePath();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
          ctx.lineWidth = 2.5 * S;
          ctx.stroke();
          break;
        }
        case 'ribbon': {
          const rw = 420 * S, rh = 70 * S;
          const rx = badgeX - rw / 2;
          ctx.beginPath();
          ctx.moveTo(rx + 20 * S, badgeY - rh / 2);
          ctx.lineTo(rx + rw - 20 * S, badgeY - rh / 2);
          ctx.lineTo(rx + rw, badgeY);
          ctx.lineTo(rx + rw - 20 * S, badgeY + rh / 2);
          ctx.lineTo(rx + 20 * S, badgeY + rh / 2);
          ctx.lineTo(rx, badgeY);
          ctx.closePath();
          ctx.fillStyle = 'rgba(212, 175, 55, 0.2)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
          ctx.lineWidth = 2 * S;
          ctx.stroke();
          break;
        }
        default: {
          const badgeWidth = 360 * S;
          const badgeHeight = 100 * S;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.roundRect(badgeX - badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight, 50 * S);
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
          ctx.lineWidth = 3 * S;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.25)';
          ctx.lineWidth = 1 * S;
          ctx.beginPath();
          ctx.roundRect(badgeX - (badgeWidth - 10 * S) / 2, badgeY - (badgeHeight - 10 * S) / 2, badgeWidth - 10 * S, badgeHeight - 10 * S, 46 * S);
          ctx.stroke();
          break;
        }
      }

      // Draw surah name text — scaled
      ctx.font = `bold ${textSettings.fontSize * 2.5 * S}px "Amiri", "Scheherazade New", serif`;
      ctx.fillStyle = textSettings.textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
       ctx.shadowColor = 'rgba(212, 175, 55, 0.35)';
       ctx.shadowBlur = isAnyRecording ? 4 * S : 8 * S;
      ctx.fillText(surahName, badgeX, badgeY);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw reciter name (if enabled) with style — scaled
    if (displaySettings.showReciterName) {
      const { reciterX, reciterY } = headerLayout;
      const reciterText = `بصوت ${reciterName}`;
      const reciterStyle = displaySettings.reciterNameStyle || 'simple';
      
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      switch (reciterStyle) {
        case 'elegant': {
          ctx.font = `italic ${textSettings.fontSize * 1.1 * S}px "Amiri", "Scheherazade New", serif`;
          ctx.shadowColor = 'rgba(212, 175, 55, 0.4)';
           ctx.shadowBlur = isAnyRecording ? 3 * S : 6 * S;
          ctx.fillStyle = '#D4AF37';
          ctx.fillText(reciterText, reciterX, reciterY);
          break;
        }
        case 'badge': {
          ctx.font = `${textSettings.fontSize * 1.0 * S}px "${fontName}", "Noto Naskh Arabic", serif`;
          const tw = ctx.measureText(reciterText).width;
          const bw = tw + 60 * S, bh = 44 * S;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.roundRect(reciterX - bw / 2, reciterY - bh / 2, bw, bh, 22 * S);
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
          ctx.lineWidth = 1.5 * S;
          ctx.stroke();
          ctx.fillStyle = textSettings.textColor;
          ctx.globalAlpha = 0.85;
          ctx.fillText(reciterText, reciterX, reciterY);
          break;
        }
        case 'tag': {
          ctx.font = `bold ${textSettings.fontSize * 0.9 * S}px "${fontName}", "Noto Naskh Arabic", serif`;
          const tw = ctx.measureText(reciterText).width;
          const pw = 50 * S, ph = 36 * S;
          // Tag shape with pointed left edge
          const tx = reciterX - (tw + pw) / 2;
          ctx.fillStyle = 'rgba(212, 175, 55, 0.18)';
          ctx.beginPath();
          ctx.moveTo(tx + 16 * S, reciterY - ph / 2);
          ctx.lineTo(tx + tw + pw, reciterY - ph / 2);
          ctx.lineTo(tx + tw + pw, reciterY + ph / 2);
          ctx.lineTo(tx + 16 * S, reciterY + ph / 2);
          ctx.lineTo(tx, reciterY);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
          ctx.lineWidth = 1 * S;
          ctx.stroke();
          ctx.fillStyle = textSettings.textColor;
          ctx.globalAlpha = 0.9;
          ctx.fillText(reciterText, reciterX + 8 * S, reciterY);
          break;
        }
        case 'glow': {
          ctx.font = `${textSettings.fontSize * 1.0 * S}px "${fontName}", "Noto Naskh Arabic", serif`;
          ctx.shadowColor = '#D4AF37';
          ctx.shadowBlur = !isPreviewRender ? 4 * S : 18 * S;
          ctx.fillStyle = '#FFD700';
          ctx.fillText(reciterText, reciterX, reciterY);
          // Second pass for stronger glow — skip during recording
          if (isPreviewRender) {
            ctx.shadowBlur = 8 * S;
            ctx.fillText(reciterText, reciterX, reciterY);
          }
          break;
        }
        default: { // simple
          ctx.font = `${textSettings.fontSize * 1.0 * S}px "${fontName}", "Noto Naskh Arabic", serif`;
          ctx.fillStyle = textSettings.textColor;
          ctx.globalAlpha = 0.7;
          ctx.fillText(reciterText, reciterX, reciterY);
          break;
        }
      }
      ctx.restore();
    }

    // Draw decorative separator — skip during ALL recording modes for performance
    if (isPreviewRender && (displaySettings.showSurahName || displaySettings.showReciterName)) {
      const lineY = headerLayout.separatorY;
      const lineX = displaySettings.showReciterName ? headerLayout.reciterX : headerLayout.titleX;
      const lineHalf = 120 * S;

      // Draw small circles on ends + center dot
      ctx.save();
      ctx.fillStyle = 'rgba(212, 175, 55, 0.5)';
      ctx.beginPath();
      ctx.arc(lineX, lineY, 5 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lineX - lineHalf, lineY, 3 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lineX + lineHalf, lineY, 3 * S, 0, Math.PI * 2);
      ctx.fill();

      // Lines
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.35)';
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(lineX - lineHalf + 6, lineY);
      ctx.lineTo(lineX - 10, lineY);
      ctx.moveTo(lineX + 10, lineY);
      ctx.lineTo(lineX + lineHalf - 6, lineY);
      ctx.stroke();

      // Side ornaments (symmetric little arrows)
      drawSideOrnament(ctx, lineX - lineHalf - 20 * S, lineY, 12 * S, false);
      drawSideOrnament(ctx, lineX + lineHalf + 20 * S, lineY, 12 * S, true);
      ctx.restore();
    }

    // Helper for side ornaments
    function drawSideOrnament(c: CanvasRenderingContext2D, x: number, y: number, size: number, flip: boolean) {
      c.save();
      c.translate(x, y);
      if (flip) c.scale(-1, 1);
      c.fillStyle = 'rgba(212, 175, 55, 0.45)';
      c.beginPath();
      c.moveTo(0, -size / 2);
      c.quadraticCurveTo(-size, 0, 0, size / 2);
      c.quadraticCurveTo(-size / 2, 0, 0, -size / 2);
      c.fill();
      c.restore();
    }

    // Detect ayah change and start transition
    if (currentAyah && prevAyahRef.current && 
        currentAyah.numberInSurah !== prevAyahRef.current.numberInSurah) {
      transitionStartRef.current = Date.now();
      isTransitioningRef.current = true;
      currentRandomTransitionRef.current = RANDOM_TRANSITIONS[Math.floor(Math.random() * RANDOM_TRANSITIONS.length)];
      // Reset chunk counter and adaptive timing for new verse
      chunkCounterRef.current = 0;
      lastChunkTimeRef.current = Date.now();
      prevChunkIndexRef.current = -1;
      chunkFadeRef.current = 1;
      chunkStartWordIndexRef.current = 0;
      lastHighlightedWordRef.current = null;
      highlightWordTimestampsRef.current = [];
      adaptiveChunkIntervalRef.current = 800;
    }
    if (currentAyah) {
      prevAyahRef.current = currentAyah;
    }

    // Calculate transition progress
    const rawTransitionType = displaySettings.ayahTransition || 'fade';
    const transitionType = rawTransitionType === 'random' ? currentRandomTransitionRef.current : rawTransitionType;
    let transitionProgress = 1; // 1 = fully visible
    if (isTransitioningRef.current && transitionType !== 'none') {
      const elapsed = Date.now() - transitionStartRef.current;
      transitionProgress = Math.min(elapsed / VERSE_TRANSITION_DURATION, 1);
      if (transitionProgress >= 1) {
        isTransitioningRef.current = false;
      }
    }

    // Ease function for smooth transitions
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const easedProgress = easeOutCubic(transitionProgress);

    // ── Ibtahalat Lyrics Mode: Show multiple lines with golden glow on current ──
    if (ibtahalatLyricsMode && allLyricsLines.length > 0 && displaySettings.showAyahText) {
      const centerY = canvas.height * 0.52;
      const lyricsFontSize = textSettings.fontSize * 1.6 * S;
      const lyricsLineHeight = lyricsFontSize * 2.2;
      const lyricsStyle = displaySettings.lyricsDisplayStyle || 'scroll';
      const glowStyle = displaySettings.glowStyle || 'golden';
      const fontName = getCanvasFontFamily(textSettings.fontFamily);

      // ── Helper: draw glow for current line based on glowStyle ──
      const drawCurrentLineGlow = (ctx: CanvasRenderingContext2D, line: string, x: number, y: number, fontSize: number) => {
        if (glowStyle === 'none') {
          // No glow - just draw text in normal color
          ctx.font = `bold ${fontSize * 1.1}px "${fontName}", "Noto Naskh Arabic", serif`;
          ctx.fillStyle = textSettings.textColor;
          ctx.shadowColor = `rgba(0, 0, 0, ${textSettings.shadowIntensity})`;
          ctx.shadowBlur = isAnyRecording ? 3 * S : 6 * S;
          ctx.fillText(line, x, y);
          return;
        }

        const pulse = 0.6 + Math.sin(Date.now() / 400) * 0.4;
        let glowColor: string;
        let glowBlur: number;
        let textColor: string;

        switch (glowStyle) {
          case 'soft':
            glowColor = 'rgba(255, 255, 255, 0.6)';
            glowBlur = (12 + pulse * 8) * S;
            textColor = '#FFFFFF';
            break;
          case 'neon':
            glowColor = '#00FFFF';
            glowBlur = (20 + pulse * 20) * S;
            textColor = '#00FFFF';
            break;
          case 'pulse':
            glowColor = `rgba(212, 175, 55, ${0.3 + pulse * 0.7})`;
            glowBlur = (8 + pulse * 30) * S;
            textColor = `rgba(255, 215, 0, ${0.7 + pulse * 0.3})`;
            break;
          default: // golden
            glowColor = '#FFD700';
            glowBlur = (20 + pulse * 15) * S;
            textColor = '#FFD700';
            break;
        }

        // Background highlight for current line
        ctx.save();
        ctx.shadowBlur = 0;
        const tw = ctx.measureText(line).width;
        const padX = 30 * S;
        const padY = 14 * S;
        const gradient = ctx.createLinearGradient(x - tw / 2 - padX, y, x + tw / 2 + padX, y);
        const baseAlpha = glowStyle === 'neon' ? 0.1 : 0.15;
        gradient.addColorStop(0, `rgba(212, 175, 55, 0)`);
        gradient.addColorStop(0.15, `rgba(212, 175, 55, ${baseAlpha * 0.8})`);
        gradient.addColorStop(0.5, `rgba(212, 175, 55, ${baseAlpha})`);
        gradient.addColorStop(0.85, `rgba(212, 175, 55, ${baseAlpha * 0.8})`);
        gradient.addColorStop(1, `rgba(212, 175, 55, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x - tw / 2 - padX, y - padY - fontSize * 0.5, tw + padX * 2, fontSize + padY * 2);
        ctx.restore();

        // Draw text with glow
        ctx.font = `bold ${fontSize * 1.15}px "${fontName}", "Noto Naskh Arabic", serif`;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = glowBlur;
        ctx.fillStyle = textColor;
        ctx.fillText(line, x, y);
        // Double pass for stronger glow
        ctx.shadowBlur = glowBlur * 0.5;
        ctx.fillText(line, x, y);
      };

      // ── SCROLL mode (default): multiple lines, scrolling ──
      if (lyricsStyle === 'scroll') {
        const maxVisibleLines = Math.min(7, allLyricsLines.length);
        const halfVisible = Math.floor(maxVisibleLines / 2);
        
        let startLine = Math.max(0, currentLyricsIndex - halfVisible);
        const endLine = Math.min(allLyricsLines.length, startLine + maxVisibleLines);
        if (endLine - startLine < maxVisibleLines) {
          startLine = Math.max(0, endLine - maxVisibleLines);
        }
        
        const totalVisibleHeight = (endLine - startLine) * lyricsLineHeight;
        let baseY = centerY - totalVisibleHeight / 2 + lyricsLineHeight / 2;

        // Draw frame if user selected one (not hardcoded)
        if (displaySettings.frameStyle !== 'none') {
          ctx.font = `${lyricsFontSize}px "${fontName}", "Noto Naskh Arabic", serif`;
          const visibleLines = allLyricsLines.slice(startLine, endLine);
          const measuredWidth = Math.max(...visibleLines.map((line) => ctx.measureText(line).width), canvas.width * 0.56);
          const frameLayout = getResponsiveTextFrameLayout({
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contentTop: baseY - lyricsLineHeight / 2,
            contentBottom: baseY + totalVisibleHeight - lyricsLineHeight / 2,
            contentWidth: measuredWidth,
            scale: S,
            safeTopRatio: headerSafeTopRatio,
            safeBottomRatio: headerSafeBottomRatio,
          });
          baseY += frameLayout.offsetY;
          drawIslamicFrame(ctx, frameLayout.frameX, frameLayout.frameY, frameLayout.frameWidth, frameLayout.frameHeight, displaySettings.frameStyle);
        }

        // Draw lyrics lines
        ctx.save();
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let i = startLine; i < endLine; i++) {
          const line = allLyricsLines[i];
          const y = baseY + (i - startLine) * lyricsLineHeight;
          const isCurrent = i === currentLyricsIndex;
          const distFromCurrent = Math.abs(i - currentLyricsIndex);
          
          ctx.save();
          
          if (isCurrent) {
            drawCurrentLineGlow(ctx, line, canvas.width / 2, y, lyricsFontSize);
          } else {
            const alpha = Math.max(0.2, 0.7 - distFromCurrent * 0.2);
            ctx.globalAlpha = alpha;
            ctx.font = `${lyricsFontSize}px "${fontName}", "Noto Naskh Arabic", serif`;
            ctx.fillStyle = textSettings.textColor;
            ctx.shadowColor = `rgba(0, 0, 0, ${textSettings.shadowIntensity * 0.5})`;
            ctx.shadowBlur = 4 * S;
            ctx.fillText(line, canvas.width / 2, y);
          }
          
          ctx.restore();
        }
        
        // Scroll indicator dots
        if (allLyricsLines.length > maxVisibleLines) {
          const dotY = baseY + totalVisibleHeight / 2 + 30 * S;
          const dotSpacing = 8 * S;
          const numDots = Math.min(allLyricsLines.length, 15);
          const dotsWidth = numDots * dotSpacing;
          
          ctx.save();
          for (let i = 0; i < numDots; i++) {
            const dotX = canvas.width / 2 - dotsWidth / 2 + i * dotSpacing + dotSpacing / 2;
            const mappedIndex = Math.round((i / numDots) * allLyricsLines.length);
            const isCurrDot = Math.abs(mappedIndex - currentLyricsIndex) <= 1;
            ctx.beginPath();
            ctx.arc(dotX, dotY, isCurrDot ? 3 * S : 1.5 * S, 0, Math.PI * 2);
            ctx.fillStyle = isCurrDot ? 'rgba(212, 175, 55, 0.8)' : 'rgba(255, 255, 255, 0.3)';
            ctx.fill();
          }
          ctx.restore();
        }
        
        ctx.restore();
      }
      // ── SINGLE mode: only current line, large and centered ──
      else if (lyricsStyle === 'single') {
        const singleFontSize = lyricsFontSize * 1.3;
        const line = allLyricsLines[currentLyricsIndex] || '';
        let contentCenterY = centerY;

        // Draw frame if selected
        if (displaySettings.frameStyle !== 'none') {
          ctx.font = `bold ${singleFontSize * 1.1}px "${fontName}", "Noto Naskh Arabic", serif`;
          const measuredWidth = Math.max(ctx.measureText(line).width, canvas.width * 0.56);
          const frameLayout = getResponsiveTextFrameLayout({
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contentTop: centerY - singleFontSize,
            contentBottom: centerY + singleFontSize * 1.65,
            contentWidth: measuredWidth,
            scale: S,
            safeTopRatio: headerSafeTopRatio,
            safeBottomRatio: headerSafeBottomRatio,
          });
          contentCenterY += frameLayout.offsetY;
          drawIslamicFrame(ctx, frameLayout.frameX, frameLayout.frameY, frameLayout.frameWidth, frameLayout.frameHeight, displaySettings.frameStyle);
        }

        ctx.save();
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        drawCurrentLineGlow(ctx, line, canvas.width / 2, contentCenterY, singleFontSize);
        
        // Line counter
        ctx.save();
        ctx.font = `${14 * S}px "${fontName}", sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.shadowBlur = 0;
        ctx.fillText(`${currentLyricsIndex + 1} / ${allLyricsLines.length}`, canvas.width / 2, contentCenterY + singleFontSize * 1.5);
        ctx.restore();
        
        ctx.restore();
      }
      // ── KARAOKE mode: 3 lines visible, current bold and highlighted ──
      else if (lyricsStyle === 'karaoke') {
        const visibleCount = 3;
        const startIdx = Math.max(0, Math.min(currentLyricsIndex - 1, allLyricsLines.length - visibleCount));
        const endIdx = Math.min(allLyricsLines.length, startIdx + visibleCount);
        
        const totalH = (endIdx - startIdx) * lyricsLineHeight;
        let baseY = centerY - totalH / 2 + lyricsLineHeight / 2;

        if (displaySettings.frameStyle !== 'none') {
          ctx.font = `${lyricsFontSize}px "${fontName}", "Noto Naskh Arabic", serif`;
          const measuredWidth = Math.max(...allLyricsLines.slice(startIdx, endIdx).map((line) => ctx.measureText(line).width), canvas.width * 0.56);
          const frameLayout = getResponsiveTextFrameLayout({
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contentTop: baseY - lyricsLineHeight / 2,
            contentBottom: baseY + totalH - lyricsLineHeight / 2,
            contentWidth: measuredWidth,
            scale: S,
            safeTopRatio: headerSafeTopRatio,
            safeBottomRatio: headerSafeBottomRatio,
          });
          baseY += frameLayout.offsetY;
          drawIslamicFrame(ctx, frameLayout.frameX, frameLayout.frameY, frameLayout.frameWidth, frameLayout.frameHeight, displaySettings.frameStyle);
        }

        ctx.save();
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let i = startIdx; i < endIdx; i++) {
          const line = allLyricsLines[i];
          const y = baseY + (i - startIdx) * lyricsLineHeight;
          const isCurrent = i === currentLyricsIndex;
          
          ctx.save();
          if (isCurrent) {
            drawCurrentLineGlow(ctx, line, canvas.width / 2, y, lyricsFontSize);
          } else {
            ctx.globalAlpha = 0.35;
            ctx.font = `${lyricsFontSize * 0.9}px "${fontName}", "Noto Naskh Arabic", serif`;
            ctx.fillStyle = textSettings.textColor;
            ctx.shadowColor = `rgba(0, 0, 0, 0.4)`;
            ctx.shadowBlur = 3 * S;
            ctx.fillText(line, canvas.width / 2, y);
          }
          ctx.restore();
        }
        ctx.restore();
      }
      // ── FADE mode: only current line with fade transition ──
      else if (lyricsStyle === 'fade') {
        const fadeFontSize = lyricsFontSize * 1.2;
        const line = allLyricsLines[activeLyricsIndex] || '';
        let fadeCenterY = centerY;

        if (displaySettings.frameStyle !== 'none') {
          ctx.font = `bold ${fadeFontSize * 1.1}px "${fontName}", "Noto Naskh Arabic", serif`;
          const measuredWidth = Math.max(ctx.measureText(line).width, canvas.width * 0.56);
          const frameLayout = getResponsiveTextFrameLayout({
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contentTop: centerY - fadeFontSize,
            contentBottom: centerY + fadeFontSize,
            contentWidth: measuredWidth,
            scale: S,
            safeTopRatio: headerSafeTopRatio,
            safeBottomRatio: headerSafeBottomRatio,
          });
          fadeCenterY += frameLayout.offsetY;
          drawIslamicFrame(ctx, frameLayout.frameX, frameLayout.frameY, frameLayout.frameWidth, frameLayout.frameHeight, displaySettings.frameStyle);
        }

        ctx.save();
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Apply transition effect
        if (isTransitioningRef.current) {
          ctx.globalAlpha = easedProgress;
        }
        
        drawCurrentLineGlow(ctx, line, canvas.width / 2, fadeCenterY, fadeFontSize);
        
        ctx.restore();
      }
    }
    // Draw current ayah (if enabled) — standard Quran mode
    else if (activeAyah && displaySettings.showAyahText) {
      // The verse is centered within the remaining stage, not the whole canvas.
      // This protects it from the title/reciter header even when no text frame
      // is selected (the common 16:9 preset case).
      const hasTopHeader = (displaySettings.showSurahName || displaySettings.showReciterName)
        && displaySettings.surahNamePosition !== 'bottom';
      const hasBottomHeader = (displaySettings.showSurahName || displaySettings.showReciterName)
        && displaySettings.surahNamePosition === 'bottom';
      const verseSafeTop = hasTopHeader ? headerLayout.separatorY + 28 * S : canvas.height * 0.14;
      const verseSafeBottom = hasBottomHeader ? headerLayout.separatorY - 28 * S : canvas.height * 0.88;
      const ayahY = (verseSafeTop + verseSafeBottom) / 2;
      const maxWidth = canvas.width * 0.85;
      
      // Apply verse display mode - chunk words differently
      const verseMode = displaySettings.verseDisplayMode || 'full';
      
      // Dynamic font scaling based on verse display mode
      const modeScales: Record<string, number> = {
        wordByWord: 3.5,
        twoWords: 2.8,
        threeTwo: 2.4,
        full: 2.0,
      };
      const fontScale = modeScales[verseMode] || 2.0;
      let lineHeight = textSettings.fontSize * (verseMode === 'full' ? 3.2 : fontScale * 1.6) * S;
      
      ctx.font = `${textSettings.fontSize * fontScale * S}px "${fontName}", "Noto Naskh Arabic", serif`;
      ctx.fillStyle = textSettings.textColor;
      
      // Word wrap — with layout cache to avoid measureText every frame
      const allWords = (activeAyahWords?.length ? activeAyahWords : activeAyah.text.split(' ')).filter(Boolean);
      
      let displayWords: string[];
      let chunkStartWordIndex = 0; // Global word index where current chunk starts
      
      // ── Adaptive timing: learn reciter speed from highlightedWordIndex changes ──
      const now = Date.now();
      if (activeHighlightedWordIndex != null && activeHighlightedWordIndex !== lastHighlightedWordRef.current) {
        if (lastHighlightedWordRef.current != null) {
          highlightWordTimestampsRef.current.push(now);
          // Keep last 8 timestamps for rolling average
          if (highlightWordTimestampsRef.current.length > 8) {
            highlightWordTimestampsRef.current.shift();
          }
          // Calculate average time per word from recent transitions
          const ts = highlightWordTimestampsRef.current;
          if (ts.length >= 2) {
            const totalTime = ts[ts.length - 1] - ts[0];
            const avgPerWord = totalTime / (ts.length - 1);
            // Adaptive interval: scale by chunk size with some breathing room
            const chunkSize = verseMode === 'wordByWord' ? 1 : verseMode === 'twoWords' ? 2 : 2.5;
            adaptiveChunkIntervalRef.current = Math.max(300, Math.min(avgPerWord * chunkSize, 4000));
          }
        }
        lastHighlightedWordRef.current = activeHighlightedWordIndex;
      }
      
      // Use adaptive interval (learned from reciter) or fallback defaults
      const chunkInterval = activeHighlightedWordIndex != null 
        ? adaptiveChunkIntervalRef.current
        : (verseMode === 'wordByWord' ? 800 : verseMode === 'twoWords' ? 1500 : 1800);
      
      if (now - lastChunkTimeRef.current > chunkInterval) {
        chunkCounterRef.current += 1;
        lastChunkTimeRef.current = now;
      }
      
      let currentChunkIndex = 0;
      if (allWords.length === 0) {
        displayWords = [];
        currentChunkIndex = 0;
        chunkStartWordIndex = 0;
      } else if (verseMode === 'full') {
        displayWords = allWords;
        currentChunkIndex = 0;
        chunkStartWordIndex = 0;
      } else if (verseMode === 'wordByWord') {
        const wordIdx = activeHighlightedWordIndex != null ? Math.max(0, Math.min(activeHighlightedWordIndex, allWords.length - 1)) : (chunkCounterRef.current % allWords.length);
        displayWords = allWords[wordIdx] ? [allWords[wordIdx]] : allWords.slice(0, 1);
        currentChunkIndex = wordIdx;
        chunkStartWordIndex = wordIdx;
      } else if (verseMode === 'twoWords') {
        const chunkSize = 2;
        const totalChunks = Math.max(1, Math.ceil(allWords.length / chunkSize));
        const chunkIdx = activeHighlightedWordIndex != null
          ? Math.max(0, Math.min(Math.floor(activeHighlightedWordIndex / chunkSize), totalChunks - 1))
          : (chunkCounterRef.current % totalChunks);
        const start = chunkIdx * chunkSize;
        displayWords = allWords.slice(start, start + chunkSize);
        currentChunkIndex = chunkIdx;
        chunkStartWordIndex = start;
      } else if (verseMode === 'threeTwo') {
        const pattern = [3, 2];
        let pos = 0, chunkIndex = 0;
        const chunks: string[][] = [];
        const chunkStarts: number[] = [];
        while (pos < allWords.length) {
          const size = pattern[chunkIndex % pattern.length];
          chunkStarts.push(pos);
          chunks.push(allWords.slice(pos, pos + size));
          pos += size;
          chunkIndex++;
        }
        const totalChunks = Math.max(1, chunks.length);
        const cIdx = activeHighlightedWordIndex != null
          ? (() => { let p = 0; for (let i = 0; i < chunks.length; i++) { if (activeHighlightedWordIndex < p + chunks[i].length) return i; p += chunks[i].length; } return Math.max(0, chunks.length - 1); })()
          : (chunkCounterRef.current % totalChunks);
        displayWords = chunks[cIdx] || allWords.slice(0, 3);
        currentChunkIndex = cIdx;
        chunkStartWordIndex = chunkStarts[cIdx] || 0;
      } else {
        displayWords = allWords;
      }
      
      // Save chunk start for highlight mapping
      chunkStartWordIndexRef.current = chunkStartWordIndex;

      // Fade transition between chunks
      if (verseMode !== 'full' && currentChunkIndex !== prevChunkIndexRef.current) {
        prevChunkIndexRef.current = currentChunkIndex;
        chunkFadeRef.current = 0;
        chunkFadeStartRef.current = Date.now();
      }
      if (verseMode !== 'full' && chunkFadeRef.current < 1) {
        const fadeElapsed = Date.now() - chunkFadeStartRef.current;
        chunkFadeRef.current = Math.min(fadeElapsed / 300, 1);
      }
      
      const words = displayWords;
      const cacheKey = `${activeAyah.numberInSurah}|${canvas.width}|${textSettings.fontSize}|${fontName}|${words.join('|')}|${verseMode}|${displaySettings.frameStyle || 'none'}|${Math.round(verseSafeTop)}|${Math.round(verseSafeBottom)}`;

      let lines: string[][] = [];
      let spaceWidth = 0;
      let totalHeight = 0;
      let startY = ayahY;

      if (textLayoutCacheRef.current && textLayoutCacheRef.current.key === cacheKey) {
        // Use cached layout
        lines = textLayoutCacheRef.current.lines;
        spaceWidth = textLayoutCacheRef.current.spaceWidth;
        totalHeight = textLayoutCacheRef.current.totalHeight;
        startY = textLayoutCacheRef.current.startY;
        // Reuse the exact fitted metrics used to measure the cached lines.
        // Without this, a long verse was measured at the scaled font but drawn
        // at the original font on subsequent frames, causing overflow in 16:9.
        lineHeight = textLayoutCacheRef.current.lineHeight;
        ctx.font = `${textLayoutCacheRef.current.fontSize}px "${fontName}", "Noto Naskh Arabic", serif`;
      } else {
        // Compute and cache
        // When a frame is active, provide generous margin so text lines never collide with border flourishes
        const hasTextFrame = displaySettings.frameStyle && displaySettings.frameStyle !== 'none';
        const textFrameMargin = hasTextFrame ? 85 * S : 0;
        const adjustedMaxWidth = (verseMode !== 'full' ? canvas.width * 0.85 : maxWidth) - textFrameMargin;
        spaceWidth = ctx.measureText(' ').width;
        lines = [];
        let line: string[] = [];
        let lw = 0;

        for (const word of words) {
          const w = ctx.measureText(word).width;
          const add = line.length ? spaceWidth + w : w;
          if (lw + add > adjustedMaxWidth && line.length) {
            lines.push(line);
            line = [word];
            lw = w;
          } else {
            line.push(word);
            lw += add;
          }
        }
        if (line.length) lines.push(line);

        totalHeight = lines.length * lineHeight;
        startY = ayahY - totalHeight / 2;

        // Long verse safe-zone auto scaling. The available height is derived
        // from the actual frame bounds (including its padding and the ayah
        // badge), rather than a fixed percentage that only worked for 9:16.
        // This keeps every frame style inside the canvas on landscape output.
        const framePaddingEstimate = Math.max(20 * S, Math.min(65 * S, canvas.width * 0.045));
        const badgeFootprint = displaySettings.showAyahNumber
          ? ((verseMode === 'full' ? 36 : 28) + (verseMode === 'full' ? 40 : 24) + 16) * S
          : 16 * S;
        const maxAllowedHeight = Math.max(
          lineHeight,
          verseSafeBottom - verseSafeTop - (hasTextFrame ? framePaddingEstimate * 2 : 0) - badgeFootprint,
        );
        if (totalHeight > maxAllowedHeight && lines.length > 1) {
          const scaleDown = Math.max(0.52, Math.min(1, maxAllowedHeight / totalHeight));
          const adjustedFontSize = textSettings.fontSize * fontScale * S * scaleDown;
          ctx.font = `${adjustedFontSize}px "${fontName}", "Noto Naskh Arabic", serif`;
          lineHeight = lineHeight * scaleDown;
          spaceWidth = ctx.measureText(' ').width;
          lines = [];
          line = [];
          lw = 0;
          for (const word of words) {
            const w = ctx.measureText(word).width;
            const add = line.length ? spaceWidth + w : w;
            if (lw + add > adjustedMaxWidth && line.length) {
              lines.push(line);
              line = [word];
              lw = w;
            } else {
              line.push(word);
              lw += add;
            }
          }
          if (line.length) lines.push(line);
          totalHeight = lines.length * lineHeight;
          startY = ayahY - totalHeight / 2;
        }

        // Defend against a tall line box or a custom font whose glyph metrics
        // extend higher than the nominal line-height.
        const verseTop = startY - lineHeight / 2;
        const verseBottom = startY + totalHeight + lineHeight / 2 + badgeFootprint;
        if (verseTop < verseSafeTop) startY += verseSafeTop - verseTop;
        if (verseBottom > verseSafeBottom) startY -= verseBottom - verseSafeBottom;

        // Pre-compute line totals AND individual word widths to avoid per-frame measureText
        const wordWidths = lines.map(wordsInLine => wordsInLine.map(w => ctx.measureText(w).width));
        const lineTotals = wordWidths.map((ww, i) =>
          ww.reduce((sum, w) => sum + w, 0) +
          Math.max(lines[i].length - 1, 0) * spaceWidth
        );
        textLayoutCacheRef.current = {
          key: cacheKey,
          lines,
          spaceWidth,
          totalHeight,
          startY,
          lineHeight,
          fontSize: parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || String(textSettings.fontSize * fontScale * S)),
          lineTotals,
          wordWidths,
        };
      }

    // Helper: draw decorative vertical ornament on side
    function drawAyahSideOrnaments(c: CanvasRenderingContext2D, x: number, centerY: number, h: number, flipX = false) {
      c.save();
      c.translate(x, centerY);
      if (flipX) c.scale(-1, 1);
      c.strokeStyle = 'rgba(212, 175, 55, 0.4)';
      c.lineWidth = 2 * S;
      c.beginPath();
      c.moveTo(0, -h / 2);
      c.bezierCurveTo(30 * S, -h / 4, 30 * S, h / 4, 0, h / 2);
      c.stroke();

      // Small end circles
      c.fillStyle = 'rgba(212, 175, 55, 0.5)';
      c.beginPath();
      c.arc(0, -h / 2, 4 * S, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(0, h / 2, 4 * S, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Helper: draw horizontal separator line (subtle wave-like)
    function drawAyahSeparator(c: CanvasRenderingContext2D, cx: number, cy: number, width: number) {
      c.save();
      c.strokeStyle = 'rgba(212, 175, 55, 0.35)';
      c.lineWidth = 1.5 * S;
      const hw = width / 2;
      c.beginPath();
      c.moveTo(cx - hw, cy);
      c.bezierCurveTo(cx - hw + 30 * S, cy - 6 * S, cx - 30 * S, cy + 6 * S, cx, cy);
      c.bezierCurveTo(cx + 30 * S, cy - 6 * S, cx + hw - 30 * S, cy + 6 * S, cx + hw, cy);
      c.stroke();

      // End dots
      c.fillStyle = 'rgba(212, 175, 55, 0.5)';
      c.beginPath();
      c.arc(cx - hw - 5 * S, cy, 3 * S, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + hw + 5 * S, cy, 3 * S, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

      // Apply verse transition effects
      ctx.save();
      if (isTransitioningRef.current && transitionType !== 'none') {
        switch (transitionType) {
          case 'fade':
            ctx.globalAlpha = easedProgress;
            break;
          case 'slide':
            ctx.translate(0, (1 - easedProgress) * 80 * S);
            ctx.globalAlpha = easedProgress;
            break;
          case 'zoom': {
            const scaleVal = 0.85 + easedProgress * 0.15;
            ctx.translate(canvas.width / 2 * (1 - scaleVal), canvas.height * 0.52 * (1 - scaleVal));
            ctx.scale(scaleVal, scaleVal);
            ctx.globalAlpha = easedProgress;
            break;
          }
          case 'blur':
            ctx.globalAlpha = easedProgress;
            break;
          case 'rise': {
            const yOffset = (1 - easedProgress) * 120 * S;
            const scaleVal = 0.96 + easedProgress * 0.04;
            ctx.translate(canvas.width / 2, canvas.height * 0.52 + yOffset);
            ctx.scale(scaleVal, scaleVal);
            ctx.translate(-canvas.width / 2, -canvas.height * 0.52);
            ctx.globalAlpha = easedProgress;
            break;
          }
          case 'rotate': {
            const rotate = (1 - easedProgress) * 0.05;
            ctx.translate(canvas.width / 2, canvas.height * 0.52);
            ctx.rotate(rotate);
            ctx.translate(-canvas.width / 2, -canvas.height * 0.52);
            ctx.globalAlpha = easedProgress;
            break;
          }
          case 'cinematic': {
            const xOffset = (1 - easedProgress) * 60 * S;
            const yOffset = (1 - easedProgress) * 30 * S;
            const scaleVal = 1.05 - easedProgress * 0.05;
            ctx.translate(canvas.width / 2 + xOffset, canvas.height * 0.52 + yOffset);
            ctx.scale(scaleVal, scaleVal);
            ctx.translate(-canvas.width / 2, -canvas.height * 0.52);
            ctx.globalAlpha = Math.min(1, easedProgress * 1.15);
            break;
          }
          case 'elastic': {
            const elastic = Math.sin(easedProgress * Math.PI * 1.5) * (1 - easedProgress) * 0.08;
            const scaleVal = 0.9 + easedProgress * 0.1 + elastic;
            ctx.translate(canvas.width / 2, canvas.height * 0.52);
            ctx.scale(scaleVal, scaleVal);
            ctx.translate(-canvas.width / 2, -canvas.height * 0.52);
            ctx.globalAlpha = easedProgress;
            break;
          }
        }
      }

      // Apply chunk fade for non-full modes
      if (verseMode !== 'full') {
        ctx.globalAlpha = (ctx.globalAlpha || 1) * chunkFadeRef.current;
      }

      // Calculate the ayah number before drawing the frame so the number is
      // part of the same safe container as the verse. The previous renderer
      // drew the frame before applying the transition transform, which made
      // the text and badge move away from it during slide/zoom/rise effects.
      let badgeSize = 0;
      let badgeGap = 0;
      let badgeY = 0;
      if (displaySettings.showAyahNumber) {
        badgeSize = (verseMode === 'full' ? 36 : 28) * S;
        badgeGap = (verseMode === 'full' ? 40 : 24) * S;
        badgeY = Math.min(startY + totalHeight + badgeGap, canvas.height * 0.88);
        badgeY = Math.max(badgeY, startY + totalHeight + 16 * S);
      }

      // Draw the frame inside the transition transform, using the measured
      // line width and a responsive safe area. This keeps ornaments away from
      // Arabic glyphs on narrow/mobile canvases and prevents overflow on 16:9.
      if (displaySettings.frameStyle !== 'none') {
        const measuredLineWidth = Math.max(...(textLayoutCacheRef.current?.lineTotals || []), maxWidth * 0.58);
        const contentTop = startY - lineHeight / 2;
        const contentBottom = displaySettings.showAyahNumber
          ? badgeY + badgeSize
          : startY + totalHeight + lineHeight / 2;
        const frameLayout = getResponsiveTextFrameLayout({
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          contentTop,
          contentBottom,
          contentWidth: measuredLineWidth,
          scale: S,
          safeTopRatio: headerSafeTopRatio,
          safeBottomRatio: headerSafeBottomRatio,
        });

        // Shift the verse and badge together when the responsive safe zone
        // requires it. This is what keeps a long 16:9 verse from falling out
        // of the frame while preserving the chosen transition transform.
        startY += frameLayout.offsetY;
        if (displaySettings.showAyahNumber) badgeY += frameLayout.offsetY;
        const effectiveFrameStyle = isAnyRecording && (displaySettings.frameStyle === 'ornate' || displaySettings.frameStyle === 'golden' || displaySettings.frameStyle === 'geometric')
          ? 'simple' : displaySettings.frameStyle;
        drawIslamicFrame(ctx, frameLayout.frameX, frameLayout.frameY, frameLayout.frameWidth, frameLayout.frameHeight, effectiveFrameStyle);
      }

      // RTL text direction
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';

      // Cache primaryRaw to avoid per-frame DOM access
      if (!primaryColorCacheRef.current) {
        try {
          primaryColorCacheRef.current = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        } catch {
          primaryColorCacheRef.current = '';
        }
      }
      const primaryRaw = primaryColorCacheRef.current;
      
      // Different highlight styles
      let highlightBg: string;
      let highlightText: string;
      const highlightEnabled = displaySettings.highlightStyle !== 'none';
      
      switch (displaySettings.highlightStyle) {
        case 'none':
          highlightBg = 'transparent';
          highlightText = textSettings.textColor;
          break;
        case 'glow':
          highlightBg = 'transparent';
          highlightText = '#FFD700';
          break;
        case 'underline':
          highlightBg = 'transparent';
          highlightText = textSettings.textColor;
          break;
        default: // solid
          highlightBg = primaryRaw ? `hsl(${primaryRaw} / 0.28)` : 'rgba(212, 175, 55, 0.28)';
          highlightText = getTokenHsl('--primary-foreground', '#FFD700');
      }

      let localIndex = 0;
      const chunkStart = chunkStartWordIndexRef.current;
      const cachedLineTotals = textLayoutCacheRef.current?.lineTotals;
      const cachedWordWidths = textLayoutCacheRef.current?.wordWidths;
      (lines || []).forEach((wordsInLine, i) => {
        const lineTotal = cachedLineTotals?.[i] ?? (wordsInLine.reduce((sum, w) => sum + ctx.measureText(w).width, 0) +
          Math.max(wordsInLine.length - 1, 0) * spaceWidth);

        let cursorX = canvas.width / 2 + lineTotal / 2;
        const y = startY + i * lineHeight + lineHeight / 2;

        wordsInLine.forEach((w, j) => {
          const wWidth = cachedWordWidths?.[i]?.[j] ?? ctx.measureText(w).width;
          // Map local index to global: in chunked modes, the global word index = chunkStart + localIndex
          const globalWordIdx = verseMode === 'full' ? localIndex : chunkStart + localIndex;
          const isWordHighlighted = highlightEnabled && activeHighlightedWordIndex != null && globalWordIdx === activeHighlightedWordIndex;

          if (isWordHighlighted) {
            const glowStyle = displaySettings.glowStyle || 'golden';
            const progress = Math.min(Math.max(activeHighlightWordProgress ?? 0, 0), 1);
            const pulse = 0.35 + Math.sin(Math.PI * progress) * 0.65;

            // Determine palette based on glowStyle
            let glowColor = '#FFD700';
            let innerTextColor = '#FFF2A8';
            let auraRgba = `rgba(255, 215, 0, ${0.25 + pulse * 0.25})`;
            let coreBlur = (12 + pulse * 14) * S;
            let bloomBlur = (24 + pulse * 28) * S;

            if (glowStyle === 'neon') {
              glowColor = '#00FFFF';
              innerTextColor = '#E0FFFF';
              auraRgba = `rgba(0, 255, 255, ${0.22 + pulse * 0.22})`;
              coreBlur = (14 + pulse * 16) * S;
              bloomBlur = (26 + pulse * 30) * S;
            } else if (glowStyle === 'soft') {
              glowColor = '#FFF5D6';
              innerTextColor = '#FFFFFF';
              auraRgba = `rgba(255, 250, 235, ${0.18 + pulse * 0.18})`;
              coreBlur = (10 + pulse * 12) * S;
              bloomBlur = (20 + pulse * 22) * S;
            } else if (glowStyle === 'pulse') {
              glowColor = '#FFB800';
              innerTextColor = '#FFF8DB';
              auraRgba = `rgba(255, 184, 0, ${0.28 + pulse * 0.32})`;
              coreBlur = (14 + pulse * 22) * S;
              bloomBlur = (28 + pulse * 38) * S;
            } else if (glowStyle === 'emerald') {
              glowColor = '#10B981';
              innerTextColor = '#D1FAE5';
              auraRgba = `rgba(16, 185, 129, ${0.24 + pulse * 0.26})`;
              coreBlur = (12 + pulse * 16) * S;
              bloomBlur = (24 + pulse * 30) * S;
            } else if (glowStyle === 'royal') {
              glowColor = '#A855F7';
              innerTextColor = '#F3E8FF';
              auraRgba = `rgba(168, 85, 247, ${0.24 + pulse * 0.26})`;
              coreBlur = (12 + pulse * 16) * S;
              bloomBlur = (24 + pulse * 30) * S;
            }

            if (displaySettings.highlightStyle === 'glow') {
              // 1. Draw ethereal radial aura backdrop behind the word
              ctx.save();
              const auraPadX = 24 * S;
              const auraPadY = 14 * S;
              const auraCenterX = cursorX - wWidth / 2;
              const auraRadius = wWidth / 2 + auraPadX;
              const auraGrad = ctx.createRadialGradient(
                auraCenterX, y, 0,
                auraCenterX, y, auraRadius
              );
              auraGrad.addColorStop(0, auraRgba);
              auraGrad.addColorStop(0.65, auraRgba.replace(/[\d.]+\)$/, `${0.08 + pulse * 0.08})`));
              auraGrad.addColorStop(1, 'transparent');
              ctx.fillStyle = auraGrad;
              ctx.fillRect(
                cursorX - wWidth - auraPadX,
                y - textSettings.fontSize * 1.4 * S - auraPadY,
                wWidth + auraPadX * 2,
                textSettings.fontSize * 2.8 * S + auraPadY * 2
              );
              ctx.restore();

              // 2. First Pass: Wide diffused radiant bloom
              ctx.save();
              ctx.fillStyle = innerTextColor;
              ctx.shadowColor = glowColor;
              ctx.shadowBlur = isAnyRecording ? bloomBlur * 0.7 : bloomBlur;
              ctx.fillText(w, cursorX, y);
              ctx.restore();

              // 3. Second Pass: Concentrated high-intensity inner core
              ctx.save();
              ctx.fillStyle = innerTextColor;
              ctx.shadowColor = glowColor;
              ctx.shadowBlur = isAnyRecording ? coreBlur * 0.7 : coreBlur;
              ctx.fillText(w, cursorX, y);
              ctx.restore();
            } else if (displaySettings.highlightStyle === 'solid') {
              ctx.save();
              const padX = 20 * S;
              const padY = 12 * S;
              ctx.fillStyle = glowStyle === 'emerald' ? 'rgba(16, 185, 129, 0.35)' :
                              glowStyle === 'neon' ? 'rgba(0, 255, 255, 0.30)' :
                              glowStyle === 'royal' ? 'rgba(168, 85, 247, 0.35)' :
                              glowStyle === 'soft' ? 'rgba(255, 255, 255, 0.28)' :
                              glowStyle === 'pulse' ? 'rgba(255, 184, 0, 0.35)' :
                              (primaryRaw ? `hsl(${primaryRaw} / 0.28)` : 'rgba(212, 175, 55, 0.28)');
              const left = cursorX - wWidth - padX;
              const top = y - (textSettings.fontSize * 1.3 * S) - padY;
              const width = wWidth + padX * 2;
              const height = textSettings.fontSize * 2.4 * S + padY * 2;
              ctx.beginPath();
              ctx.roundRect(left, top, width, height, 24 * S);
              ctx.fill();
              ctx.restore();

              ctx.save();
              ctx.fillStyle = innerTextColor;
              ctx.fillText(w, cursorX, y);
              ctx.restore();
            } else if (displaySettings.highlightStyle === 'underline') {
              ctx.save();
              ctx.strokeStyle = glowColor;
              ctx.shadowColor = glowColor;
              ctx.shadowBlur = 8 * S;
              ctx.lineWidth = 3.5 * S;
              ctx.beginPath();
              ctx.moveTo(cursorX - wWidth, y + textSettings.fontSize * 0.85 * S);
              ctx.lineTo(cursorX, y + textSettings.fontSize * 0.85 * S);
              ctx.stroke();
              ctx.restore();

              ctx.save();
              ctx.fillStyle = innerTextColor;
              ctx.fillText(w, cursorX, y);
              ctx.restore();
            } else {
              ctx.save();
              ctx.fillStyle = innerTextColor;
              ctx.fillText(w, cursorX, y);
              ctx.restore();
            }
          } else {
            // Non-highlighted standard word with full textShadowStyle support
            ctx.save();
            const shadowStyle = displaySettings.textShadowStyle || 'none';
            if (shadowStyle === 'none') {
              ctx.shadowColor = 'transparent';
              ctx.shadowBlur = 0;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
            } else if (shadowStyle === 'strong') {
              ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
              ctx.shadowBlur = 10 * S;
              ctx.shadowOffsetX = 2 * S;
              ctx.shadowOffsetY = 3 * S;
            } else if (shadowStyle === '3d') {
              ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
              ctx.shadowBlur = 5 * S;
              ctx.shadowOffsetX = 3 * S;
              ctx.shadowOffsetY = 4 * S;
            } else if (shadowStyle === 'glow') {
              ctx.shadowColor = 'rgba(212, 175, 55, 0.7)';
              ctx.shadowBlur = 14 * S;
            } else if (shadowStyle === 'outline') {
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
              ctx.lineWidth = 3.5 * S;
              ctx.strokeText(w, cursorX, y);
              ctx.shadowColor = 'transparent';
              ctx.shadowBlur = 0;
            } else { // soft
              ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
              ctx.shadowBlur = 6 * S;
              ctx.shadowOffsetY = 2 * S;
            }
            ctx.fillStyle = textSettings.textColor;
            ctx.fillText(w, cursorX, y);
            ctx.restore();
          }

          cursorX -= wWidth + spaceWidth;
          localIndex += 1;
        });
      });

      // Draw ayah number badge (if enabled) — position adapts to verse mode
      if (displaySettings.showAyahNumber) {
        drawAyahBadge(ctx, canvas.width / 2, badgeY, activeAyah.numberInSurah, badgeSize, displaySettings.ayahNumberStyle, displaySettings.ayahNumberColor);
      }
      ctx.restore(); // End verse transition transform
    }

    // ── 1. Circular / Custom Logo Watermark (User Brand / AI Logo) ───────────
    const brandingHeader = getResponsiveHeaderLayout({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      scale: S,
      showSurahName: Boolean(displaySettings.showSurahName),
      showReciterName: Boolean(displaySettings.showReciterName),
      surahNamePosition: displaySettings.surahNamePosition,
      surahNameStyle: displaySettings.surahNameStyle,
      reciterNameStyle: displaySettings.reciterNameStyle,
      textFontSize: textSettings.fontSize,
    });
    const brandingLayout = getResponsiveBrandingLayout({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      scale: S,
      logoPosition: displaySettings.logoWatermarkPosition || 'topRight',
      logoSize: displaySettings.logoWatermarkSize || 85,
      socialPosition: displaySettings.socialWatermarkPosition || displaySettings.watermarkPosition || 'bottomCenter',
      socialSize: displaySettings.socialWatermarkSize || 18,
      headerActive: Boolean(displaySettings.showSurahName || displaySettings.showReciterName),
      headerPosition: displaySettings.surahNamePosition || 'top',
      headerSeparatorY: brandingHeader.separatorY,
      frameActive: Boolean(displaySettings.frameStyle && displaySettings.frameStyle !== 'none'),
    });
    const showLogo = displaySettings.logoWatermarkEnabled ?? true;
    if (showLogo) {
      ctx.save();
      const lPos = displaySettings.logoWatermarkPosition || 'topRight';
      const lSize = (displaySettings.logoWatermarkSize || 85) * S;
      const lOpacity = displaySettings.logoWatermarkOpacity ?? 0.95;
      const lx = brandingLayout.logoX;
      const ly = brandingLayout.logoY;

      ctx.globalAlpha = lOpacity;
      const radius = brandingLayout.logoRadius;

      // Check if user uploaded / generated a custom logo image
      if (logoImageRef.current && logoImageRef.current.complete && logoImageRef.current.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImageRef.current, lx - radius, ly - radius, lSize, lSize);
        ctx.restore();

        // Outer golden embossed ring around image
        const borderGrad = ctx.createLinearGradient(lx - radius, ly - radius, lx + radius, ly + radius);
        borderGrad.addColorStop(0, '#FFE082');
        borderGrad.addColorStop(0.35, '#D4AF37');
        borderGrad.addColorStop(0.7, '#FFF8E1');
        borderGrad.addColorStop(1, '#8C6B1B');

        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        ctx.arc(lx, ly, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Keep the channel identity readable even when a custom/AI image is used.
        const imageBrand = (displaySettings.logoBrandName || '').trim() || 'آيات قرآنية';
        const imageSubtitle = (displaySettings.logoSubtitle || '').trim() || 'تلاوات خاشعة';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(4, 13, 18, 0.68)';
        ctx.beginPath();
        ctx.roundRect(lx - radius * 0.78, ly - radius * 0.38, radius * 1.56, radius * 0.72, radius * 0.18);
        ctx.fill();
        let imageBrandSize = Math.max(9 * S, radius * 0.24);
        ctx.font = `bold ${imageBrandSize}px "Amiri", serif`;
        while (ctx.measureText(imageBrand).width > radius * 1.42 && imageBrandSize > 7 * S) {
          imageBrandSize -= 1 * S;
          ctx.font = `bold ${imageBrandSize}px "Amiri", serif`;
        }
        ctx.fillStyle = '#FFF1B8';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 5 * S;
        ctx.fillText(imageBrand, lx, ly - radius * 0.08);
        ctx.font = `600 ${Math.max(7 * S, radius * 0.14)}px "Cairo", sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(imageSubtitle, lx, ly + radius * 0.28);
      } else {
        // Static, broadcast-grade identity seals: shape is optional, but never
        // animated. This keeps channel branding stable and legible in exports.
        const logoPreset = displaySettings.logoWatermarkPreset || 'goldCalligraphy';
        const drawSealPath = (inset = 0) => {
          const r = Math.max(1, radius - inset);
          ctx.beginPath();
          if (logoPreset === 'geometricEmblem') {
            ctx.roundRect(lx - r, ly - r, r * 2, r * 2, r * 0.24);
          } else if (logoPreset === 'glassMonogram') {
            ctx.roundRect(lx - r * 0.96, ly - r * 0.82, r * 1.92, r * 1.64, r * 0.32);
          } else if (logoPreset === 'circularMedallion') {
            for (let i = 0; i < 8; i += 1) {
              const a = (i * Math.PI) / 4 - Math.PI / 8;
              const px = lx + Math.cos(a) * r;
              const py = ly + Math.sin(a) * r;
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
          } else {
            ctx.arc(lx, ly, r, 0, Math.PI * 2);
          }
        };
        const grad = logoPreset === 'glassMonogram'
          ? ctx.createLinearGradient(lx - radius, ly - radius, lx + radius, ly + radius)
          : ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
        if (logoPreset === 'glassMonogram') {
          grad.addColorStop(0, 'rgba(195, 231, 239, 0.72)');
          grad.addColorStop(0.42, 'rgba(22, 58, 72, 0.82)');
          grad.addColorStop(1, 'rgba(4, 13, 18, 0.92)');
        } else {
          grad.addColorStop(0, 'rgba(35, 26, 10, 0.85)');
          grad.addColorStop(0.7, 'rgba(20, 15, 5, 0.9)');
          grad.addColorStop(1, 'rgba(10, 8, 2, 0.95)');
        }

        drawSealPath();
        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 12 * S;
        ctx.fill();

        // Outer premium ring
        const borderGrad = ctx.createLinearGradient(lx - radius, ly - radius, lx + radius, ly + radius);
        borderGrad.addColorStop(0, '#FFE082');
        borderGrad.addColorStop(0.35, '#D4AF37');
        borderGrad.addColorStop(0.7, '#FFF8E1');
        borderGrad.addColorStop(1, '#8C6B1B');

        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 2.5 * S;
        ctx.stroke();

        // Inner safe ring reserves a clear area for both brand lines.
        drawSealPath(radius * 0.14);
        ctx.strokeStyle = 'rgba(255, 224, 130, 0.6)';
        ctx.lineWidth = 1 * S;
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = '#FFE082';
        ctx.strokeStyle = 'rgba(255, 224, 130, 0.85)';
        ctx.lineWidth = 1.2 * S;
        const ornamentCount = logoPreset === 'circularMedallion' ? 8 : 4;
        for (let i = 0; i < ornamentCount; i += 1) {
          const a = (i / ornamentCount) * Math.PI * 2 - Math.PI / 2;
          const ox = lx + Math.cos(a) * radius * 0.92;
          const oy = ly + Math.sin(a) * radius * 0.92;
          ctx.beginPath();
          ctx.arc(ox, oy, Math.max(1.8 * S, radius * 0.035), 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        if (logoPreset === 'circularMedallion') {
          ctx.strokeStyle = 'rgba(255, 240, 170, 0.55)';
          ctx.lineWidth = 1.2 * S;
          for (let i = 0; i < 12; i += 1) {
            const a = (i / 12) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(lx + Math.cos(a) * radius * 0.52, ly + Math.sin(a) * radius * 0.52);
            ctx.lineTo(lx + Math.cos(a) * radius * 0.78, ly + Math.sin(a) * radius * 0.78);
            ctx.stroke();
          }
        }
        ctx.restore();

        // User brand name on top, subtitle on bottom (NO hardcoded text)
        const brandText = (displaySettings.logoBrandName || '').trim() || 'آيات قرآنية';
        const subText = (displaySettings.logoSubtitle || '').trim() || 'تلاوات خاشعة';

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let brandFontSize = Math.max(9 * S, Math.round(radius * (brandText.length > 12 ? 0.28 : brandText.length > 7 ? 0.36 : 0.44)));
        ctx.font = `bold ${brandFontSize}px "Amiri", "Noto Naskh Arabic", serif`;
        while (ctx.measureText(brandText).width > radius * 1.42 && brandFontSize > 7 * S) {
          brandFontSize -= 1 * S;
          ctx.font = `bold ${brandFontSize}px "Amiri", "Noto Naskh Arabic", serif`;
        }
        ctx.fillStyle = '#FFE082';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 4 * S;
        ctx.fillText(brandText, lx, ly - radius * 0.18);

        const subFontSize = Math.max(8 * S, Math.round(radius * 0.24));
        ctx.font = `600 ${subFontSize}px "Cairo", sans-serif`;
        ctx.fillStyle = 'rgba(255, 248, 225, 0.85)';
        ctx.shadowBlur = 2 * S;
        ctx.fillText(subText, lx, ly + radius * 0.32);
      }
      ctx.restore();
    }

    // ── 2. Social Media Handle Watermark ─────────────────────────────────
    const showSocial = displaySettings.socialWatermarkEnabled ?? false;
    const socialHandle = (displaySettings.socialHandle || displaySettings.watermarkText || '').trim()
      || (showSocial ? '@QuranReels' : '');

    if (showSocial && socialHandle) {
      ctx.save();
      const pos = displaySettings.socialWatermarkPosition || displaySettings.watermarkPosition || 'bottomCenter';
      const fontSize = (displaySettings.socialWatermarkSize || 18) * S;
      const opacity = displaySettings.socialWatermarkOpacity ?? 0.85;

      ctx.globalAlpha = opacity;
      ctx.font = `600 ${fontSize}px "Cairo", "Noto Naskh Arabic", sans-serif`;
      ctx.fillStyle = '#E5C07B'; // Warm Quranic Gold
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 6 * S;

      const x = brandingLayout.socialX;
      const y = brandingLayout.socialY;

      if (pos === 'bottomLeft') {
        ctx.textAlign = 'left';
      } else if (pos === 'bottomRight') {
        ctx.textAlign = 'right';
      } else {
        ctx.textAlign = 'center';
      }
      if (pos === 'topCenter') ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      // Icon prefix
      const platform = displaySettings.socialPlatform || 'facebook';
      let icon = 'ⓕ ';
      if (platform === 'instagram') icon = '📸 ';
      else if (platform === 'tiktok') icon = '♪ ';
      else if (platform === 'youtube') icon = '▶ ';
      else if (platform === 'x') icon = '𝕏 ';
      else if (platform === 'custom') icon = '';

      const socialLabel = `${icon}${socialHandle}`;
      const socialWidth = ctx.measureText(socialLabel).width;
      const pillHeight = Math.max(30 * S, fontSize + 14 * S);
      const pillWidth = socialWidth + 28 * S;
      const pillX = ctx.textAlign === 'left' ? x - 14 * S : ctx.textAlign === 'right' ? x - pillWidth + 14 * S : x - pillWidth / 2;
      const pillY = pos === 'topCenter' ? y - fontSize - 10 * S : y - pillHeight + 5 * S;
      ctx.fillStyle = 'rgba(4, 13, 18, 0.72)';
      ctx.shadowBlur = 12 * S;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
      else ctx.rect(pillX, pillY, pillWidth, pillHeight);
      ctx.fill();
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
      ctx.lineWidth = 1.2 * S;
      ctx.stroke();
      ctx.fillStyle = '#FFF1B8';
      ctx.shadowBlur = 6 * S;
      ctx.fillText(socialLabel, x, y);
      ctx.restore();
    }

    // ── Progress Bar ──────────────────────────────────────────────────────
    if (typeof audioProgress === 'number' && audioProgress > 0) {
      const barHeight = 4 * S;
      const barY = canvas.height - barHeight;
      // Background track
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(0, barY, canvas.width, barHeight);
      // Progress fill
      const gradient = ctx.createLinearGradient(0, barY, canvas.width * audioProgress, barY);
      gradient.addColorStop(0, 'rgba(212, 175, 55, 0.9)');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0.7)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, barY, canvas.width * Math.min(audioProgress, 1), barHeight);
    }
  }, [imageLoaded, videoReady, slideshowReady, surahName, reciterName, currentAyah, currentAyahWords, highlightedWordIndex, highlightWordProgress, textSettings, displaySettings, getRecordingDimensions, getTokenHsl, drawAyahBadge, getCanvasFontFamily, drawIslamicFrame, drawFullScreenBorder, motionSpeed, isPremium, isPlaying, ibtahalatLyricsMode, allLyricsLines, currentLyricsIndex, audioProgress]);

  useEffect(() => {
    drawFrameRuntimeRef.current = drawFrame;
  }, [drawFrame]);

  // Animation loop for preview canvas — keeps live preview fluid during idle, playback, and recording
  useEffect(() => {
    const hasAnimatedBackground =
      (activeBackgroundType === 'video' && videoReady) ||
      (activeBackgroundType === 'animated' && slideshowReady);

    if (!isPlaying && !isRecording && !hasAnimatedBackground) {
      drawFrameRuntimeRef.current();
      return;
    }

    const targetFps = isRecording ? 24 : 15;
    const frameInterval = 1000 / targetFps;
    let lastFrameTime = 0;

    const animate = (now: number) => {
      animationFrameRef.current = requestAnimationFrame(animate);
      if (now - lastFrameTime < frameInterval) return;
      lastFrameTime = now;
      drawFrameRuntimeRef.current();
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [activeBackgroundType, isPlaying, isRecording, videoReady, slideshowReady]);

  // Notify when canvas is ready
  useEffect(() => {
    if (canvasRef.current && onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  useImperativeHandle(ref, () => ({
    getContainer: () => containerRef.current,
    getCanvas: () => canvasRef.current,
    isBackgroundReady: () => {
      if (activeBackgroundType === 'video') return videoReady;
      if (activeBackgroundType === 'animated') return slideshowReady || imageLoaded;
      return imageLoaded;
    },
    ensureBackgroundPlayback,
    getRecordingDimensions,
    getRecommendedRecordingFps,
    // Always route through the live draw function ref to avoid stale closure
    drawFrame: (
      targetCanvas?: HTMLCanvasElement,
      renderMode?: 'preview' | 'recording' | 'recordingLite',
      syncOverride?: FrameSyncOverride
    ) => drawFrameRuntimeRef.current(targetCanvas, renderMode, syncOverride),
  }));

  const containerClass = aspectRatio === '9:16'
    ? 'aspect-[9/16] max-w-[360px]'
    : 'aspect-video max-w-[640px]';

  return (
    <div
      ref={containerRef}
      className={`${containerClass} w-full mx-auto relative rounded-2xl overflow-hidden shadow-2xl bg-black`}
    >
      {/* Visible preview canvas (recording uses an isolated off-screen canvas) */}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
      />
    </div>
  );
});

VideoPreview.displayName = 'VideoPreview';

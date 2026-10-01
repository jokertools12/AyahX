import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BackgroundItem } from '@/data/backgrounds';
import type { DisplaySettings } from '@/components/DisplaySettingsPanel';
import { api } from '@/lib/api';

type RenderManifestLike = {
  revision?: string;
  fps?: number;
  aspectRatio?: '9:16' | '16:9';
  outputDimensions: { width: number; height: number };
  background?: { type?: string; url?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type RenderController = {
  initScene: (manifest: RenderManifestLike) => Promise<boolean>;
  renderFrame: (frameIndex: number, frameTimeSeconds: number) => Promise<boolean | void>;
  isSceneReady?: () => boolean;
  getVideoBackgroundStatus?: () => 'not-requested' | 'loading' | 'frames' | 'direct' | 'fallback';
};

type RenderControllerFactory = (targetCanvas: HTMLCanvasElement) => RenderController;

declare global {
  interface Window {
    __CREATE_RENDER_CONTROLLER__?: RenderControllerFactory;
  }
}

interface FullFidelityVideoPreviewProps {
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
  motionSpeed?: number;
  ibtahalatLyricsMode?: boolean;
  allLyricsLines?: string[];
  currentLyricsIndex?: number;
  audioProgress?: number;
  isPremium?: boolean;
  sceneManifest?: RenderManifestLike | null;
  getFrameTimeSeconds?: () => number;
}

export interface FullFidelityVideoPreviewRef {
  getContainer: () => HTMLDivElement | null;
  getCanvas: () => HTMLCanvasElement | null;
  isBackgroundReady: () => boolean;
  ensureBackgroundPlayback: () => Promise<void>;
  getRecordingDimensions: () => { width: number; height: number };
  getRecommendedRecordingFps: () => number;
  drawFrame: (
    targetCanvas?: HTMLCanvasElement,
    renderMode?: 'preview' | 'recording' | 'recordingLite',
    frameTimeSeconds?: number,
  ) => Promise<void>;
}

/**
 * The visible preview and local Browser Hybrid recorder execute the exact
 * same render-harness scene used by Browser Cloud and the native workers.
 * A hidden same-origin iframe supplies reusable controller factories; each
 * target canvas (preview or full-resolution recorder) gets its own scene
 * controller and manifest lifecycle.
 */
export const FullFidelityVideoPreview = forwardRef<FullFidelityVideoPreviewRef, FullFidelityVideoPreviewProps>(({
  aspectRatio,
  isPlaying,
  isRecording = false,
  onCanvasReady,
  onBackgroundLoadMethod,
  sceneManifest,
  getFrameTimeSeconds,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const factoryRef = useRef<RenderControllerFactory | null>(null);
  const controllerEntriesRef = useRef(new Map<HTMLCanvasElement, { signature: string; controller: RenderController }>());
  const proxiedVideoRef = useRef<{ sourceUrl: string; objectUrl: string | null; promise: Promise<string | null> | null }>({
    sourceUrl: '',
    objectUrl: null,
    promise: null,
  });
  const renderBusyRef = useRef(false);
  const renderPendingRef = useRef(false);
  const manifestRef = useRef<RenderManifestLike | null>(sceneManifest || null);
  const timeGetterRef = useRef(getFrameTimeSeconds);
  const [harnessReady, setHarnessReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    manifestRef.current = sceneManifest || null;
    controllerEntriesRef.current.clear();
    setSceneReady(false);
    setPreviewError(null);
    const sourceUrl = sceneManifest?.background?.type === 'video'
      ? String(sceneManifest.background.url || '')
      : '';
    const cached = proxiedVideoRef.current;
    if (cached.sourceUrl && cached.sourceUrl !== sourceUrl) {
      if (cached.objectUrl) URL.revokeObjectURL(cached.objectUrl);
      proxiedVideoRef.current = { sourceUrl: '', objectUrl: null, promise: null };
    }
  }, [sceneManifest]);

  useEffect(() => () => {
    if (proxiedVideoRef.current.objectUrl) URL.revokeObjectURL(proxiedVideoRef.current.objectUrl);
  }, []);

  useEffect(() => {
    timeGetterRef.current = getFrameTimeSeconds;
  }, [getFrameTimeSeconds]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const readFactory = () => {
      try {
        const factory = iframe.contentWindow?.__CREATE_RENDER_CONTROLLER__;
        if (typeof factory !== 'function') return;
        factoryRef.current = factory;
        // The factory lives in the iframe, but its preview canvas lives in
        // this document. Canvas font lookup uses the target document's fonts.
        for (const face of iframe.contentDocument?.fonts || []) document.fonts.add(face);
        setHarnessReady(true);
      } catch (error) {
        console.error('Failed to connect to the full-fidelity render harness:', error);
      }
    };

    iframe.addEventListener('load', readFactory);
    if (iframe.contentDocument?.readyState === 'complete') readFactory();
    return () => iframe.removeEventListener('load', readFactory);
  }, []);

  const sceneSignature = sceneManifest
    ? `${sceneManifest.revision || 'scene'}:${sceneManifest.fps || 30}`
    : '';

  const getProxiedVideoUrl = useCallback(async (sourceUrl: string): Promise<string | null> => {
    if (!/^https?:\/\//i.test(sourceUrl)) return null;
    const cached = proxiedVideoRef.current;
    if (cached.sourceUrl === sourceUrl && cached.objectUrl) return cached.objectUrl;
    if (cached.sourceUrl === sourceUrl && cached.promise) return cached.promise;

    const promise = api.services.videoProxy(sourceUrl)
      .then((blob) => {
        if (!blob.size) return null;
        const objectUrl = URL.createObjectURL(blob);
        const previous = proxiedVideoRef.current;
        if (previous.objectUrl && previous.objectUrl !== objectUrl) URL.revokeObjectURL(previous.objectUrl);
        proxiedVideoRef.current = { sourceUrl, objectUrl, promise: null };
        return objectUrl;
      })
      .catch(() => {
        if (proxiedVideoRef.current.sourceUrl === sourceUrl) {
          proxiedVideoRef.current = { sourceUrl: '', objectUrl: null, promise: null };
        }
        return null;
      });
    proxiedVideoRef.current = { sourceUrl, objectUrl: null, promise };
    return promise;
  }, []);

  const renderToCanvas = useCallback(async (targetCanvas: HTMLCanvasElement, frameTimeSeconds: number) => {
    const factory = factoryRef.current;
    const manifest = manifestRef.current;
    if (!factory || !manifest || !targetCanvas.width || !targetCanvas.height) return;

    const signature = `${manifest.revision || 'scene'}:${manifest.fps || 30}:${targetCanvas.width}x${targetCanvas.height}`;
    let entry = controllerEntriesRef.current.get(targetCanvas);
    if (!entry || entry.signature !== signature) {
      const controller = factory(targetCanvas);
      const initialized = await controller.initScene({
        ...manifest,
        outputDimensions: { width: targetCanvas.width, height: targetCanvas.height },
      });
      if (!initialized) throw new Error('Full-fidelity render harness could not initialize the preview scene.');
      // Audio/timing/settings can arrive while media is loading. Never install
      // the old scene over a newer manifest that has already cleared the cache.
      if (manifestRef.current !== manifest) return;

      const background = manifest.background;
      if (background?.type === 'video' && background.url && controller.getVideoBackgroundStatus?.() === 'fallback') {
        // Keep the thumbnail visible immediately, then atomically replace the
        // controller with a same-origin blob when the protected proxy arrives.
        void getProxiedVideoUrl(background.url).then(async (proxiedUrl) => {
          if (!proxiedUrl) return;
          const currentEntry = controllerEntriesRef.current.get(targetCanvas);
          if (!currentEntry || currentEntry.signature !== signature || currentEntry.controller !== controller) return;
          try {
            const proxiedController = factory(targetCanvas);
            const proxyInitialized = await proxiedController.initScene({
              ...manifest,
              background: { ...background, url: proxiedUrl },
              outputDimensions: { width: targetCanvas.width, height: targetCanvas.height },
            });
            if (!proxyInitialized) return;
            controllerEntriesRef.current.set(targetCanvas, { signature, controller: proxiedController });
            await proxiedController.renderFrame(Math.max(0, Math.floor(frameTimeSeconds * (manifest.fps || 30))), frameTimeSeconds);
            if (targetCanvas === canvasRef.current) onBackgroundLoadMethod?.('proxy');
          } catch (error) {
            console.warn('Video proxy background could not be activated:', error);
          }
        });
      }
      entry = { signature, controller };
      controllerEntriesRef.current.set(targetCanvas, entry);
      if (targetCanvas === canvasRef.current) {
        setSceneReady(true);
        onBackgroundLoadMethod?.(controller.getVideoBackgroundStatus?.() === 'fallback' ? 'fallback' : 'direct');
      }
    }

    const fps = manifest.fps || 30;
    const safeTime = Math.max(0, Number.isFinite(frameTimeSeconds) ? frameTimeSeconds : 0);
    await entry.controller.renderFrame(Math.max(0, Math.floor(safeTime * fps)), safeTime);
  }, [getProxiedVideoUrl, onBackgroundLoadMethod, sceneSignature]);

  const renderVisibleFrame = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (renderBusyRef.current) { renderPendingRef.current = true; return; }
    renderBusyRef.current = true;
    const startedManifest = manifestRef.current;
    try {
      await renderToCanvas(canvas, timeGetterRef.current?.() || 0);
    } catch (error) {
      console.error('Full-fidelity preview frame failed:', error);
      setPreviewError('تعذر تحميل المعاينة. أعد فتح الصفحة أو اختر خلفية أخرى.');
    } finally {
      renderBusyRef.current = false;
      if (renderPendingRef.current || startedManifest !== manifestRef.current) {
        renderPendingRef.current = false;
        requestAnimationFrame(() => { void renderVisibleFrame(); });
      }
    }
  }, [renderToCanvas]);

  const resizePreviewCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ratio = aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(360, Math.min(720, Math.round(container.clientWidth * deviceScale)));
    const height = Math.max(360, Math.round(width / ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    controllerEntriesRef.current.delete(canvas);
    void renderVisibleFrame();
  }, [aspectRatio, renderVisibleFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && onCanvasReady) onCanvasReady(canvas);
    resizePreviewCanvas();
    const observer = new ResizeObserver(resizePreviewCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [onCanvasReady, resizePreviewCanvas]);

  useEffect(() => {
    if (!harnessReady || !sceneManifest || !canvasRef.current) return;
    void renderVisibleFrame();
  }, [harnessReady, sceneManifest, renderVisibleFrame]);

  useEffect(() => {
    const animatedBackground = sceneManifest?.background?.type === 'slideshow' || sceneManifest?.background?.type === 'video';
    if (!harnessReady || !sceneManifest || (!isPlaying && !animatedBackground && !isRecording)) return;

    let stopped = false;
    let frameId: number | null = null;
    const tick = async () => {
      if (stopped) return;
      await renderVisibleFrame();
      if (!stopped) frameId = requestAnimationFrame(() => { void tick(); });
    };
    void tick();
    return () => {
      stopped = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [harnessReady, isPlaying, isRecording, renderVisibleFrame, sceneManifest]);

  useImperativeHandle(ref, () => ({
    getContainer: () => containerRef.current,
    getCanvas: () => canvasRef.current,
    isBackgroundReady: () => sceneReady,
    ensureBackgroundPlayback: async () => {
      if (!sceneReady) await renderVisibleFrame();
    },
    getRecordingDimensions: () => sceneManifest?.outputDimensions || { width: 720, height: 1280 },
    getRecommendedRecordingFps: () => sceneManifest?.fps || 30,
    drawFrame: async (targetCanvas, _renderMode, frameTimeSeconds) => {
      const canvas = targetCanvas || canvasRef.current;
      if (!canvas) return;
      await renderToCanvas(canvas, frameTimeSeconds ?? (timeGetterRef.current?.() || 0));
    },
  }), [renderToCanvas, renderVisibleFrame, sceneManifest, sceneReady]);

  const containerClass = aspectRatio === '9:16' ? 'aspect-[9/16] max-w-[360px]' : 'aspect-video max-w-[640px]';

  return (
    <div
      ref={containerRef}
      className={`${containerClass} w-full mx-auto relative rounded-2xl overflow-hidden shadow-2xl bg-black`}
    >
      <canvas ref={canvasRef} data-preview-state={!harnessReady ? 'loading-harness' : sceneReady ? 'ready' : 'loading-scene'} className="w-full h-full" style={{ display: 'block' }} />
      {!sceneReady && !previewError && <p role="status" className="absolute inset-x-4 top-4 rounded-xl bg-background/90 p-3 text-center text-sm">جارٍ تجهيز المعاينة…</p>}
      {previewError && <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-background/90 p-3 text-sm text-destructive">{previewError}</p>}
      <iframe
        ref={iframeRef}
        src="/render-harness.html"
        title=""
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0 }}
      />
    </div>
  );
});

FullFidelityVideoPreview.displayName = 'FullFidelityVideoPreview';

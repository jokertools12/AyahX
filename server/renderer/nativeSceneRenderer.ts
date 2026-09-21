import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createCanvas, GlobalFonts, Image } from '@napi-rs/canvas';
import { RenderManifest } from '../models/renderManifest';

type CanvasImage = InstanceType<typeof Image>;

let harnessSource: string | null = null;
let fontsRegistered = false;

function resolveHarnessPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'public/render-harness.html'),
    path.resolve(process.cwd(), 'dist/render-harness.html'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Render harness HTML not found for native scene renderer.');
  }
  return found;
}

/**
 * The browser renderer and the native renderers intentionally execute this
 * exact scene source. Keeping one source of truth prevents a successful MP4
 * from silently losing selected visual settings on a native engine.
 */
function getHarnessSource(): string {
  if (harnessSource) return harnessSource;
  const html = fs.readFileSync(resolveHarnessPath(), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i)?.[1];
  if (!script || !script.includes('__RENDER_CONTROLLER__')) {
    throw new Error('Render harness controller script could not be extracted.');
  }
  harnessSource = script;
  return script;
}

function registerNativeFonts(): void {
  if (fontsRegistered) return;
  const fontsDir = path.resolve(process.cwd(), 'server/assets/fonts');
  const families: Array<[string, string]> = [
    ['Amiri-Regular.ttf', 'Amiri'],
    // Amiri Quran and the premium font labels retain an Arabic-capable local
    // fallback when their web-font counterpart is unavailable in a worker.
    ['Amiri-Regular.ttf', 'Amiri Quran'],
    ['NotoNaskhArabic-Regular.ttf', 'Noto Naskh Arabic'],
    ['NotoNaskhArabic-Regular.ttf', 'Scheherazade New'],
    ['NotoNaskhArabic-Regular.ttf', 'Aref Ruqaa'],
    ['NotoNaskhArabic-Regular.ttf', 'Reem Kufi'],
    ['NotoNaskhArabic-Regular.ttf', 'Cairo'],
    ['NotoNaskhArabic-Regular.ttf', 'El Messiri'],
    ['NotoNaskhArabic-Regular.ttf', 'Lateef'],
    ['NotoNaskhArabic-Regular.ttf', 'Mada'],
    ['NotoNaskhArabic-Regular.ttf', 'Marhey'],
    ['NotoNaskhArabic-Regular.ttf', 'Mirza'],
    ['NotoNaskhArabic-Regular.ttf', 'Rakkas'],
    ['NotoNaskhArabic-Regular.ttf', 'Lalezar'],
    ['NotoNaskhArabic-Regular.ttf', 'Tajawal'],
  ];

  for (const [filename, family] of families) {
    const fontPath = path.join(fontsDir, filename);
    if (!fs.existsSync(fontPath)) continue;
    try {
      GlobalFonts.registerFromPath(fontPath, family);
    } catch {
      // Registering a process-global font twice is harmless.
    }
  }
  fontsRegistered = true;
}

function decodeDataUrl(value: string): Buffer | null {
  const match = value.match(/^data:image\/[\w+.-]+;base64,([\s\S]+)$/i);
  return match ? Buffer.from(match[1], 'base64') : null;
}

async function readImageSource(value: string): Promise<Buffer> {
  const dataUrl = decodeDataUrl(value);
  if (dataUrl) return dataUrl;

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'AyaX Native Scene Renderer' },
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed with HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const localPath = value.startsWith('file://') ? fileURLToPath(value) : value;
  return fs.promises.readFile(localPath);
}

/**
 * @napi-rs/canvas images are native drawable values, whereas browser images
 * expose load events. The harness expects both, so return the native image
 * while adding browser-compatible asynchronous src/onload behavior to it.
 */
function createNativeImageConstructor(): new () => CanvasImage {
  return function NativeImage(this: unknown): CanvasImage {
    const image = new Image() as CanvasImage & {
      onload?: (() => void) | null;
      onerror?: (() => void) | null;
      __nativeSceneSrc?: string;
    };
    const prototype = Object.getPrototypeOf(image);
    const sourceDescriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
    if (!sourceDescriptor?.set) {
      throw new Error('Native canvas Image does not expose a src setter.');
    }

    Object.defineProperties(image, {
      onload: { configurable: true, enumerable: true, writable: true, value: null },
      onerror: { configurable: true, enumerable: true, writable: true, value: null },
      src: {
        configurable: true,
        enumerable: true,
        get: () => image.__nativeSceneSrc || '',
        set: (value: unknown) => {
          const requested = String(value || '');
          image.__nativeSceneSrc = requested;
          void readImageSource(requested)
            .then((bytes) => {
              if (image.__nativeSceneSrc !== requested) return;
              sourceDescriptor.set!.call(image, bytes);
              queueMicrotask(() => image.onload?.());
            })
            .catch(() => {
              if (image.__nativeSceneSrc === requested) queueMicrotask(() => image.onerror?.());
            });
        },
      },
    });
    return image;
  } as unknown as new () => CanvasImage;
}

interface HarnessController {
  initScene(manifest: RenderManifest): Promise<boolean>;
  renderFrame(frameIndex: number, frameTimeSeconds: number): Promise<void>;
}

/**
 * Executes public/render-harness.html against a native Skia canvas. It avoids
 * Chromium completely while preserving the browser's scene contract: layout,
 * backgrounds, animation, typography, borders, badges, timing and branding.
 */
export class NativeSceneRenderer {
  private readonly canvas: ReturnType<typeof createCanvas>;
  private readonly context: any;
  private readonly controller: HarnessController;
  private closed = false;

  constructor(private readonly manifest: RenderManifest) {
    registerNativeFonts();
    this.canvas = createCanvas(manifest.outputDimensions.width, manifest.outputDimensions.height);
    this.context = this.canvas.getContext('2d');

    const document = {
      getElementById: (id: string) => (id === 'render-canvas' ? this.canvas : null),
      fonts: { ready: Promise.resolve() },
    };
    const window: Record<string, unknown> = {};
    const sandbox = {
      window,
      document,
      Image: createNativeImageConstructor(),
      Promise,
      Map,
      Math,
      Date,
      JSON,
      Number,
      String,
      Boolean,
      Array,
      Object,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isFinite,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      console,
    };
    window.window = window;
    window.document = document;

    vm.runInNewContext(getHarnessSource(), sandbox, {
      filename: 'render-harness.native.js',
      timeout: 10_000,
    });
    const controller = window.__RENDER_CONTROLLER__ as HarnessController | undefined;
    if (!controller) throw new Error('Native render harness controller was not created.');
    this.controller = controller;
  }

  async init(): Promise<void> {
    if (this.closed) throw new Error('Native scene renderer is closed.');
    const initialized = await this.controller.initScene(this.manifest);
    if (!initialized) throw new Error('Native render harness scene initialization failed.');
  }

  async renderFrameRgbaBuffer(frameIndex: number, frameTimeSeconds: number): Promise<Buffer> {
    if (this.closed) throw new Error('Native scene renderer is closed.');
    await this.controller.renderFrame(frameIndex, frameTimeSeconds);
    const { width, height } = this.manifest.outputDimensions;
    // Copy the pixels before the next canvas draw: FFmpeg may still be using
    // the prior buffer while a later frame is rendered.
    return Buffer.from(this.context.getImageData(0, 0, width, height).data);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

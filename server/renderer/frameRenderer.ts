import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { RenderManifest } from '../models/renderManifest';
import { logger } from '../logger';

export interface FrameRendererOptions {
  manifest: RenderManifest;
  signal?: AbortSignal;
  onProgress?: (renderedFrames: number, totalFrames: number) => void;
}

const DEFAULT_PROTOCOL_TIMEOUT_MS = 300_000;
const DEFAULT_FRAME_OPERATION_TIMEOUT_MS = 45_000;

function positiveEnvInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function protocolTimeoutMs(): number {
  return positiveEnvInt('RENDER_PROTOCOL_TIMEOUT_MS', DEFAULT_PROTOCOL_TIMEOUT_MS, 30_000, 900_000);
}

function frameOperationTimeoutMs(): number {
  return positiveEnvInt('RENDER_FRAME_OPERATION_TIMEOUT_MS', DEFAULT_FRAME_OPERATION_TIMEOUT_MS, 5_000, 180_000);
}

/**
 * Discovers a working Chrome/Chromium executable across Windows, Linux, and custom configurations
 */
export function resolveChromiumExecutablePath(): string {
  // 1. Explicit environment variable overrides
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 2. Platform-specific default paths
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'لم يتم العثور على متصفح Chrome أو Chromium على الخادم. يرجى تثبيته أو تحديد مساره عبر CHROME_BIN.'
  );
}

/**
 * Headless Chromium Frame Renderer Session
 */
export class DeterministicFrameRenderer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private manifest: RenderManifest;
  private isClosed = false;

  constructor(manifest: RenderManifest) {
    this.manifest = manifest;
  }

  /**
   * A renderer operation must have an application-level deadline. Puppeteer's
   * protocol timeout only controls CDP's callback registry; if Chromium is
   * under memory pressure it can remain alive but stop answering. The caller
   * can then recycle this isolated browser and continue the same frame.
   */
  private async withOperationTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
    const timeout = frameOperationTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Chromium ${label} timed out after ${timeout}ms`)), timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Initializes the headless Chromium instance and renders the offline scene harness
   */
  public async init(): Promise<void> {
    const executablePath = resolveChromiumExecutablePath();
    const { width, height } = this.manifest.outputDimensions;

    logger.info(`Launching Headless Chromium for deterministic render [${width}x${height}]...`);

    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      // Keep CDP itself patient while the application-level deadline above
      // gives us a deterministic recovery path for a wedged renderer.
      protocolTimeout: protocolTimeoutMs(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--renderer-process-limit=1',
        '--no-first-run',
        '--no-zygote',
        '--hide-scrollbars',
        '--mute-audio',
        '--allow-file-access-from-files',
        '--disable-web-security',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width, height, deviceScaleFactor: 1 });
    this.page.setDefaultTimeout(frameOperationTimeoutMs());
    this.page.setDefaultNavigationTimeout(30_000);

    this.page.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('React DevTools')) {
        logger.debug(`[HARNESS] ${text}`);
      }
    });
    this.page.on('pageerror', (err) => {
      logger.error(`[HARNESS PAGE ERROR] ${err instanceof Error ? err.message : String(err)}`);
    });

    let harnessPath = path.resolve(process.cwd(), 'public/render-harness.html');
    if (!fs.existsSync(harnessPath)) {
      harnessPath = path.resolve(process.cwd(), 'dist/render-harness.html');
    }
    if (!fs.existsSync(harnessPath)) {
      throw new Error(`Render harness HTML not found at: ${harnessPath}`);
    }

    const normalizedHarnessPath = harnessPath.replace(/\\/g, '/');
    const fileUrl = normalizedHarnessPath.startsWith('/')
      ? `file://${normalizedHarnessPath}`
      : `file:///${normalizedHarnessPath}`;
    await this.page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });

    // Initialize scene with manifest
    const initSuccess = await this.withOperationTimeout(this.page.evaluate(async (m) => {
      const controller = (window as any).__RENDER_CONTROLLER__;
      if (!controller) return false;
      return await controller.initScene(m);
    }, this.manifest), 'scene initialization');

    if (!initSuccess) {
      throw new Error('Failed to initialize scene inside render harness.');
    }

    logger.info('Deterministic render harness initialized successfully.');
  }

  /**
   * Renders a single frame mathematically at t = frameIndex / fps and returns a raw JPEG buffer
   */
  public async renderFrameBuffer(frameIndex: number, frameTimeSeconds: number): Promise<Buffer> {
    if (!this.page || this.isClosed) {
      throw new Error('Renderer is not initialized or has been closed.');
    }

    const { width, height } = this.manifest.outputDimensions;

    // Render frame at exact timestamp inside harness
    await this.withOperationTimeout(this.page.evaluate(
      async (idx, sec) => {
        await (window as any).__RENDER_CONTROLLER__.renderFrame(idx, sec);
      },
      frameIndex,
      frameTimeSeconds
    ), `frame ${frameIndex} drawing`);

    // Capture direct frame screenshot
    const configuredQuality = Number.parseInt(process.env.RENDER_JPEG_QUALITY || '90', 10);
    const screenshotQuality = Number.isFinite(configuredQuality)
      ? Math.max(70, Math.min(100, configuredQuality))
      : 90;
    const screenshot = await this.withOperationTimeout(this.page.screenshot({
      type: 'jpeg',
      quality: screenshotQuality,
      // Chromium's optimized JPEG path materially reduces per-frame CPU time
      // while preserving the deterministic pixels used by the final encoder.
      optimizeForSpeed: process.env.RENDER_SCREENSHOT_OPTIMIZE !== 'false',
      // Keep Chromium's compositor-surface capture as the default. In
      // headless mode view capture can race the canvas paint and return a
      // stale frame; callers may explicitly opt into view capture when they
      // have verified it for their Chromium build.
      ...(process.env.RENDER_SCREENSHOT_FROM_SURFACE === 'false'
        ? { fromSurface: false }
        : { fromSurface: true }),
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width, height },
    }), `frame ${frameIndex} screenshot`);

    return screenshot as Buffer;
  }

  /**
   * Closes browser and frees all memory / process handles
   */
  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      const page = this.page;
      const browser = this.browser;
      this.page = null;
      this.browser = null;
      const closeWithDeadline = async (
        operation: Promise<void>,
        timeoutMs: number,
        onTimeout?: () => void,
      ) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const completed = await Promise.race([
          operation.then(() => true).catch(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (!completed) onTimeout?.();
      };
      if (page) await closeWithDeadline(page.close(), 5_000);
      if (browser) {
        const browserProcess = browser.process();
        await closeWithDeadline(browser.close(), 8_000, () => {
          // A wedged CDP session can otherwise leave a Chromium child holding
          // the worker's memory until the container is OOM-killed.
          try {
            if (browserProcess && !browserProcess.killed) browserProcess.kill('SIGKILL');
          } catch {
            // The process may have exited between the timeout and kill.
          }
        });
      }
    } catch (err) {
      logger.warn('Error during frame renderer cleanup:', err);
    }
  }
}

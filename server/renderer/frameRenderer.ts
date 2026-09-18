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
   * Initializes the headless Chromium instance and renders the offline scene harness
   */
  public async init(): Promise<void> {
    const executablePath = resolveChromiumExecutablePath();
    const { width, height } = this.manifest.outputDimensions;

    logger.info(`Launching Headless Chromium for deterministic render [${width}x${height}]...`);

    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
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
    const initSuccess = await this.page.evaluate(async (m) => {
      const controller = (window as any).__RENDER_CONTROLLER__;
      if (!controller) return false;
      return await controller.initScene(m);
    }, this.manifest);

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
    await this.page.evaluate(
      async (idx, sec) => {
        await (window as any).__RENDER_CONTROLLER__.renderFrame(idx, sec);
      },
      frameIndex,
      frameTimeSeconds
    );

    // Capture direct frame screenshot
    const configuredQuality = Number.parseInt(process.env.RENDER_JPEG_QUALITY || '90', 10);
    const screenshotQuality = Number.isFinite(configuredQuality)
      ? Math.max(70, Math.min(100, configuredQuality))
      : 90;
    const screenshot = await this.page.screenshot({
      type: 'jpeg',
      quality: screenshotQuality,
      // Chromium's optimized JPEG path materially reduces per-frame CPU time
      // while preserving the deterministic pixels used by the final encoder.
      optimizeForSpeed: process.env.RENDER_SCREENSHOT_OPTIMIZE !== 'false',
      clip: { x: 0, y: 0, width, height },
    });

    return screenshot as Buffer;
  }

  /**
   * Closes browser and frees all memory / process handles
   */
  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch (err) {
      logger.warn('Error during frame renderer cleanup:', err);
    }
  }
}

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { estimateRenderJobProfile } from '../../server/services/renderCapacity';
import { RENDER_QUEUE_NAMES } from '../../server/services/renderQueueBroker';
import { getRenderEngine, listRenderEngines } from '../../server/services/renderEngineRegistry';

describe('Render v2 isolation contract', () => {
  it('keeps one versioned queue per engine', () => {
    expect(new Set(Object.values(RENDER_QUEUE_NAMES)).size).toBe(3);
    expect(RENDER_QUEUE_NAMES.ffmpeg_ass).toBe('quran-render-ffmpeg-v2');
    expect(RENDER_QUEUE_NAMES.skia_canvas).toBe('quran-render-skia-v2');
    expect(RENDER_QUEUE_NAMES.browser_cloud).toBe('quran-render-browser-v2');
  });

  it('exposes an explicit engine contract and reserves Chromium for Browser Cloud', () => {
    const engines = listRenderEngines();
    expect(engines.map((engine) => engine.id).sort()).toEqual(['browser_cloud', 'ffmpeg_ass', 'skia_canvas'].sort());
    expect(getRenderEngine('ffmpeg_ass').usesChromium).toBe(false);
    expect(getRenderEngine('skia_canvas').usesChromium).toBe(false);
    expect(getRenderEngine('browser_cloud').usesChromium).toBe(true);
  });

  it('ships a native worker image without Chromium and a browser image with it', () => {
    const lite = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile.worker-lite'), 'utf8');
    const browser = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile.worker-browser'), 'utf8');
    expect(lite.toLowerCase()).not.toContain('chromium');
    expect(browser.toLowerCase()).toContain('chromium');
  });

  it('estimates higher demand for a 4K animated scene than a 720p still scene', () => {
    const small = estimateRenderJobProfile('skia_canvas', { width: 720, height: 1280, fps: 30, durationSeconds: 15, backgroundType: 'color' });
    const large = estimateRenderJobProfile('skia_canvas', { width: 2160, height: 3840, fps: 60, durationSeconds: 300, backgroundType: 'video' });
    expect(large.memoryPerJobMb).toBeGreaterThan(small.memoryPerJobMb);
    expect(large.cpuPerJob).toBeGreaterThan(small.cpuPerJob);
    expect(large.estimatedSeconds).toBeGreaterThan(small.estimatedSeconds!);
  });
});

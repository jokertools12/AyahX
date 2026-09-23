import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Browser render harness', () => {
  it('keeps full-screen border drawing scoped to its scale factor', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const start = source.indexOf('function drawFullScreenBorder');
    const end = source.indexOf('// Text wrapping for RTL Arabic', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const borderFunction = source.slice(start, end);
    expect(borderFunction).not.toMatch(/\bF\b/);
    expect(borderFunction).toContain('ctx.lineWidth = 1 * S;');
  });

  it('exposes one reusable scene controller for preview and local capture', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('function createRenderController(targetCanvas)');
    expect(source).toContain('window.__CREATE_RENDER_CONTROLLER__ = createRenderController;');
    expect(source).toContain('window.__RENDER_CONTROLLER__ = defaultCanvas ? createRenderController(defaultCanvas) : null;');
  });

  it('uses explicit timing-map source metadata and composition offsets', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain("timingMapSource === 'quran_foundation'");
    expect(source).toContain('compositionMatchesAudioRange');
    expect(source).not.toContain('firstWordStart >= (rangeOffsetMs * 0.7)');
  });

  it('keeps direct video and timed lyric modes inside the shared scene contract', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('async function syncDirectVideo');
    expect(source).toContain("videoBackgroundStatus = bgVideo ? 'direct' : 'fallback'");
    expect(source).toContain("manifest.contentKind === 'lyrics'");
    expect(source).toContain('drawLyricLine');
  });
});

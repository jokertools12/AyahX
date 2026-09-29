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

  it('keeps source attribution mandatory without mislabeling QUA as Quran Foundation', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain("manifest.timingMap?.sourceId === 'quran_foundation'");
    expect(source).toContain("manifest.timingMap?.alignment?.provider === 'quran_foundation'");
    expect(source).toContain("manifest.audio?.sourceMode === 'qf'");
    expect(source).toContain("const isQuaTiming = manifest.timingMap?.sourceId === 'quranic_universal_audio';");
    expect(source).toContain("? 'Source: Quranic Universal Audio'");
    expect(source).toContain(": 'Source: Quran Foundation';");
    expect(source).toContain('if (requiresQfCredit || isQuaTiming)');
    expect(source).toContain('window.__CREATE_RENDER_CONTROLLER__ = createRenderController;');
  });

  it('never manufactures verse or word timing when evidence is absent', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('No timing evidence. Keep a stable static verse');
    expect(source).toContain('it cannot');
    expect(source).toContain('manufacture a word boundary from duration');
    expect(source).not.toContain('allowApproximateTiming');
    expect(source).not.toContain('computeWordPhoneticWeight');
    expect(source).not.toContain('Fallback proportional duration across verses');
    expect(source).not.toContain('activeAyahIndex = Math.floor(fraction * allAyahs.length)');
  });

  it('shares deterministic Animate profiles with the canonical timing map contract', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain("'teleprompter'");
    expect(source).toContain("'isolate'");
    expect(source).toContain('hasTrustedWordTiming ? animationProfile : \'static\'');
    expect(source).toContain("const verseMode = hasTrustedWordTiming ? requestedVerseMode : 'full';");
    expect(source).toContain("hasTrustedWordTiming && verseMode === 'full' && animationProfile === 'teleprompter'");
    expect(source).toContain("hasTrustedWordTiming && verseMode === 'full' && animationProfile === 'isolate'");
    expect(source).toContain('animationReducedMotion');
    expect(source).toMatch(/keep the complete current ayah\s*\/\/\s*visible until its first verified word starts/);
    expect(source).toContain('activeWordIndexInAyah == null && hasTrustedWordTiming');
  });

  it('keeps direct video and timed lyric modes inside the shared scene contract', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('async function syncDirectVideo');
    expect(source).toContain("videoBackgroundStatus = bgVideo ? 'direct' : 'fallback'");
    expect(source).toContain("manifest.contentKind === 'lyrics'");
    expect(source).toContain('drawLyricLine');
  });
});

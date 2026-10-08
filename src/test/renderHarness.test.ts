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

  it('keeps QUA credits and playback progress out of the video scene', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain("manifest.timingMap?.sourceId === 'quran_foundation'");
    expect(source).toContain("manifest.timingMap?.alignment?.provider === 'quran_foundation'");
    expect(source).toContain("manifest.audio?.sourceMode === 'qf'");
    expect(source).toContain("const isQuaTiming = manifest.timingMap?.sourceId === 'quranic_universal_audio';");
    expect(source).not.toContain('Source: Quranic Universal Audio');
    expect(source).not.toContain('timelineProgress');
    expect(source).toContain("const creditText = 'Source: Quran Foundation';");
    expect(source).toContain('if (requiresQfCredit)');
    expect(source).toContain('window.__CREATE_RENDER_CONTROLLER__ = createRenderController;');
  });

  it('never manufactures verse or word timing when evidence is absent', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('static no-timing fallback');
    expect(source).toContain('it cannot');
    expect(source).toContain('manufacture a word boundary from duration');
    expect(source).not.toContain('allowApproximateTiming');
    expect(source).not.toContain('computeWordPhoneticWeight');
    expect(source).not.toContain('Fallback proportional duration across verses');
    expect(source).not.toContain('activeAyahIndex = Math.floor(fraction * allAyahs.length)');
  });

  it('keeps the active next ayah when composition offsets are present', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const start = source.indexOf('function resolveActiveAyahTimeline(');
    const end = source.indexOf('// Rosette / Ayah Badge Drawing', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const resolveTimeline = new Function('input', `${source.slice(start, end)}\nreturn resolveActiveAyahTimeline(input);`) as (input: unknown) => {
      activeAyahIndex: number;
      currentAyahStartSec: number;
      currentAyahEndSec: number;
      activeCompositionOffset: { ayahNumber: number } | null;
    };

    const result = resolveTimeline({
      allAyahs: [{ numberInSurah: 63 }, { numberInSurah: 64 }, { numberInSurah: 65 }],
      everyAyahTimestamps: [],
      timingMap: {
        compositionOffsets: [
          { ayahNumber: 63, startMs: 10_000, endMs: 20_000 },
          { ayahNumber: 64, startMs: 20_000, endMs: 30_000 },
        ],
        words: [],
      },
      frameTimeSeconds: 25,
      lookupTimeMs: 25_000,
      isTimingMapAbsolute: true,
      rangeOffsetMs: 10_000,
      audioDurationSeconds: 60,
    });

    expect(result.activeCompositionOffset?.ayahNumber).toBe(64);
    expect(result.activeAyahIndex).toBe(1);
    expect(result.currentAyahStartSec).toBe(10);
    expect(result.currentAyahEndSec).toBe(20);
  });

  it('reveals only source-timed glyph groups as the audio clock advances', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const start = source.indexOf('function resolveRevealedLetters(');
    const end = source.indexOf('// Rosette / Ayah Badge Drawing', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const resolveRevealedLetters = new Function('letterSpans', 'lookupTimeMs',
      `${source.slice(start, end)}\nreturn resolveRevealedLetters(letterSpans, lookupTimeMs);`) as (
        letterSpans: Array<{ token: string; startMs: number }>,
        lookupTimeMs: number,
      ) => string;
    const spans = [
      { token: 'ٱللَّ', startMs: 100 },
      { token: 'هِ', startMs: 320 },
    ];

    expect(resolveRevealedLetters(spans, 99)).toBe('');
    expect(resolveRevealedLetters(spans, 100)).toBe('ٱللَّ');
    expect(resolveRevealedLetters(spans, 320)).toBe('ٱللَّهِ');
  });

  it('retains spoken words while revealing only timed glyphs of the next word', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const helperStart = source.indexOf('function resolveRevealedLetters(');
    const helperEnd = source.indexOf('// Rosette / Ayah Badge Drawing', helperStart);
    const blockStart = source.indexOf("if (hasTrustedWordTiming && verseMode === 'letterByLetter' && activeWordIndexInAyah != null)");
    const blockEnd = source.indexOf('// Teleprompter/isolate', blockStart);
    const reveal = new Function('lookupTimeMs', 'activeWordIndexInAyah', `
      ${source.slice(helperStart, helperEnd)}
      const hasTrustedWordTiming = true, verseMode = 'letterByLetter';
      const manifest = { canonicalAyahRange: { surahNumber: 1 } };
      const activeAyah = { numberInSurah: 1 };
      const ayahWords = ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ'];
      const timingMap = { words: [
        { canonicalWordKey: '1:1:1', letters: [{ token: 'بِ', startMs: 100 }, { token: 'سْمِ', startMs: 200 }] },
        { canonicalWordKey: '1:1:2', letters: [{ token: 'ٱللَّ', startMs: 500 }, { token: 'هِ', startMs: 700 }] }
      ] };
      let displayWords = [], chunkStartWordIdx = 0;
      ${source.slice(blockStart, blockEnd)}
      return displayWords;
    `);
    expect(reveal(99, 0)).toEqual([]);
    expect(reveal(100, 0)).toEqual(['بِ']);
    expect(reveal(450, 1)).toEqual(['بِسْمِ']);
    expect(reveal(500, 1)).toEqual(['بِسْمِ', 'ٱللَّ']);
    expect(reveal(700, 1)).toEqual(['بِسْمِ', 'ٱللَّهِ']);
    // Seeking backwards derives the reveal from the audio clock, not history.
    expect(reveal(100, 0)).toEqual(['بِ']);
  });

  it('shares deterministic Animate profiles with the canonical timing map contract', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain("'teleprompter'");
    expect(source).toContain("'isolate'");
    expect(source).toContain("hasTrustedWordTiming ? (verseMode === 'letterByLetter' ? 'reveal' : animationProfile) : 'static'");
    expect(source).toContain("const verseMode = hasTrustedWordTiming ? requestedVerseMode : 'full';");
    expect(source).toContain("hasTrustedWordTiming && verseMode === 'full' && animationProfile === 'teleprompter'");
    expect(source).toContain("hasTrustedWordTiming && verseMode === 'full' && animationProfile === 'isolate'");
    expect(source).toContain('animationReducedMotion');
    expect(source).toMatch(/keep the complete current ayah\s*\/\/\s*visible until its first verified word starts/);
    expect(source).toContain('activeWordIndexInAyah == null && hasTrustedWordTiming');
    expect(source).toMatch(/verseMode === 'letterByLetter'\s*\?\s*\{ startIndex: 0, wordCount: 0 \}/);
  });

  it('keeps direct video and timed lyric modes inside the shared scene contract', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    expect(source).toContain('async function syncDirectVideo');
    expect(source).toContain("videoBackgroundStatus = bgVideo ? 'direct' : 'fallback'");
    expect(source).toContain("manifest.contentKind === 'lyrics'");
    expect(source).toContain('drawLyricLine');
  });
});

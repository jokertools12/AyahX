import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANIMATION_PROFILES,
  resolveVerseWordWindow,
  resolveAnimationStates,
  normalizeAnimationProfile,
} from '../lib/animationTimeline';
import type { TimingWord } from '../lib/timingMap';

const words: TimingWord[] = [1, 2, 3, 4].map((n, index) => ({
  canonicalWordKey: `1:1:${n}`,
  occurrenceId: `1:1:${n}:occurrence:1`,
  displayWordIndex: index,
  displayToken: `كلمة${n}`,
  normalizedAlignmentToken: `كلمه${n}`,
  startMs: index * 500,
  endMs: index * 500 + 400,
  confidence: 1,
}));

describe('deterministic animation timeline', () => {
  it('normalizes unknown profiles without inventing a new mode', () => {
    expect(normalizeAnimationProfile('not-a-profile')).toBe('karaoke');
  });

  it('keeps occurrence identities stable for repeated visual words', () => {
    const states = resolveAnimationStates(words, 1, 0.5, 'spotlight');
    expect(states.map((state) => state.occurrenceId)).toEqual(words.map((word) => word.occurrenceId));
    expect(states[1].isActive).toBe(true);
    expect(states[0].opacity).toBeLessThan(states[1].opacity);
  });

  it('implements reveal, isolate, and consume semantics deterministically', () => {
    const reveal = resolveAnimationStates(words, 1, 0, 'reveal');
    expect(reveal[0].opacity).toBe(1);
    expect(reveal[2].opacity).toBeLessThan(1);

    const isolate = resolveAnimationStates(words, 1, 0, 'isolate');
    expect(isolate[1].opacity).toBe(1);
    expect(isolate[0].opacity).toBe(0);

    const consume = resolveAnimationStates(words, 1, 0, 'consume');
    expect(consume[0].opacity).toBe(0);
    expect(consume[2].opacity).toBeGreaterThan(0);
  });

  it('shows no guessed first word while a trusted map is between verses and the next word has not begun', () => {
    expect(resolveVerseWordWindow('wordByWord', 4, null)).toEqual({ startIndex: 0, wordCount: 0 });
    expect(resolveVerseWordWindow('twoWords', 4, null)).toEqual({ startIndex: 0, wordCount: 0 });
    expect(resolveVerseWordWindow('threeTwo', 4, null)).toEqual({ startIndex: 0, wordCount: 0 });
    expect(resolveVerseWordWindow('full', 4, null)).toEqual({ startIndex: 0, wordCount: 4 });
  });

  it('selects deterministic word, pair, and three-two chunks around the current timed word', () => {
    expect(resolveVerseWordWindow('wordByWord', 5, 4)).toEqual({ startIndex: 4, wordCount: 1 });
    expect(resolveVerseWordWindow('twoWords', 5, 2)).toEqual({ startIndex: 2, wordCount: 2 });
    expect(resolveVerseWordWindow('threeTwo', 5, 3)).toEqual({ startIndex: 3, wordCount: 2 });
  });

  it('removes pulse motion without changing emphasis', () => {
    const animated = resolveAnimationStates(words, 1, 0.5, 'karaoke');
    const reduced = resolveAnimationStates(words, 1, 0.5, 'karaoke', { reducedMotion: true });
    expect(animated[1].emphasis).toBe(reduced[1].emphasis);
    expect(animated[1].scale).toBeGreaterThan(1);
    expect(reduced[1].scale).toBe(1);
  });

  it('keeps the production render harness animation logic in parity with the shared timeline', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const start = html.indexOf('      const ANIMATION_PROFILES =');
    const end = html.indexOf('      // Rosette / Ayah Badge Drawing', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const sandbox: Record<string, unknown> = {};
    runInNewContext(
      `${html.slice(start, end)}\nglobalThis.__animation = { ANIMATION_PROFILES, normalizeAnimationProfile, getAnimationState, resolveVerseWordWindow };`,
      sandbox,
    );
    const harness = sandbox.__animation as {
      ANIMATION_PROFILES: string[];
      resolveVerseWordWindow: (
        mode: 'full' | 'twoWords' | 'threeTwo' | 'wordByWord',
        totalWords: number,
        activeWordIndex: number | null,
      ) => { startIndex: number; wordCount: number };
      getAnimationState: (
        index: number,
        activeIndex: number,
        progress: number,
        profile: string,
        wordCount: number,
        reducedMotion: boolean,
      ) => { opacity: number; emphasis: number; scale: number; translateY: number; isActive: boolean };
    };

    expect(harness.ANIMATION_PROFILES).toEqual(ANIMATION_PROFILES);
    for (const mode of ['full', 'twoWords', 'threeTwo', 'wordByWord'] as const) {
      for (const activeIndex of [null, -1, 0, 2, 4, 5] as const) {
        expect(harness.resolveVerseWordWindow(mode, words.length, activeIndex))
          .toEqual(resolveVerseWordWindow(mode, words.length, activeIndex));
      }
    }
    for (const profile of ANIMATION_PROFILES) {
      for (const activeIndex of [null, 0, 2, words.length] as const) {
        for (const progress of [0, 0.5, 1]) {
          for (const reducedMotion of [false, true]) {
            const expected = resolveAnimationStates(words, activeIndex, progress, profile, { reducedMotion })
              .map(({ opacity, emphasis, scale, translateY, isActive }) => ({
                opacity,
                emphasis,
                scale,
                translateY,
                isActive,
              }));
            const harnessActiveIndex = activeIndex ?? Number.NaN;
            const actual = words.map((_, index) => {
              const state = harness.getAnimationState(
                index,
                harnessActiveIndex,
                progress,
                profile,
                words.length,
                reducedMotion,
              );
              return {
                opacity: state.opacity,
                emphasis: state.emphasis,
                scale: state.scale,
                translateY: state.translateY,
                isActive: state.isActive,
              };
            });
            expect(actual, `${profile} active=${activeIndex} progress=${progress} reduced=${reducedMotion}`)
              .toEqual(expected);
          }
        }
      }
    }
  });
});

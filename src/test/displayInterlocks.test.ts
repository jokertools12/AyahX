import { describe, expect, it } from 'vitest';
import {
  canAnimateLetters,
  describeLetterTiming,
  describeVerseModeConflict,
  isGlowColorEnabled,
  isGlowSectionEnabled,
  isReducedMotionEnabled,
  profileNeedsChunkedVerse,
  resolveEffectiveVerseMode,
} from '../lib/displayInterlocks';
import {
  ANIMATION_PROFILE_OPTIONS,
  AYAH_NUMBER_COLOR_OPTIONS,
  AYAH_NUMBER_STYLE_OPTIONS,
  AYAH_TRANSITION_OPTIONS,
  FRAME_STYLE_OPTIONS,
  GLOW_STYLE_OPTIONS,
  HIGHLIGHT_STYLE_OPTIONS,
  RECITER_NAME_STYLE_OPTIONS,
  SURA_NAME_POSITION_OPTIONS,
  SURA_NAME_STYLE_OPTIONS,
  TEXT_SHADOW_OPTIONS,
  VERSE_DISPLAY_MODE_OPTIONS,
  optionLabel,
} from '../data/displayOptions';
import { ANIMATION_PROFILES } from '../lib/animationTimeline';

describe('display setting interlocks', () => {
  it('disables the glow section when no highlight style can be coloured', () => {
    expect(isGlowSectionEnabled({ highlightStyle: 'none' })).toBe(false);
    expect(isGlowSectionEnabled({ highlightStyle: 'glow' })).toBe(true);
    // A missing highlight style falls back to the same default the renderers use.
    expect(isGlowSectionEnabled({})).toBe(true);
  });

  it('disables the glow colour picker when the palette itself is off', () => {
    expect(isGlowColorEnabled({ highlightStyle: 'none', glowStyle: 'golden' })).toBe(false);
    expect(isGlowColorEnabled({ highlightStyle: 'glow', glowStyle: 'none' })).toBe(false);
    expect(isGlowColorEnabled({ highlightStyle: 'glow', glowStyle: 'golden' })).toBe(true);
  });

  it('disables reduced motion under the static profile, which never pulses', () => {
    expect(isReducedMotionEnabled({ animationProfile: 'static' })).toBe(false);
    expect(isReducedMotionEnabled({ animationProfile: 'karaoke' })).toBe(true);
    expect(isReducedMotionEnabled({})).toBe(true);
  });

  it('warns, but never rewrites, when a window-only profile meets the full verse', () => {
    expect(profileNeedsChunkedVerse('isolate')).toBe(true);
    expect(profileNeedsChunkedVerse('teleprompter')).toBe(true);
    expect(profileNeedsChunkedVerse('karaoke')).toBe(false);

    const conflict = describeVerseModeConflict({
      verseDisplayMode: 'full',
      animationProfile: 'isolate',
    });
    expect(conflict).toBeTruthy();

    // Any chunked verse mode resolves the conflict, and non-window profiles never raise it.
    expect(describeVerseModeConflict({ verseDisplayMode: 'wordByWord', animationProfile: 'isolate' })).toBeNull();
    expect(describeVerseModeConflict({ verseDisplayMode: 'full', animationProfile: 'karaoke' })).toBeNull();
  });

  it('falls back to word timing when the letter tier is genuinely absent', () => {
    // Animate letter mode is only truthful while a letter tier can exist.
    expect(canAnimateLetters('available')).toBe(true);
    expect(canAnimateLetters('loading')).toBe(true);
    expect(canAnimateLetters('idle')).toBe(true);
    expect(canAnimateLetters('unsupported')).toBe(false);
    expect(canAnimateLetters('unavailable')).toBe(false);
    expect(canAnimateLetters('requires-auth')).toBe(false);

    // Requested letter mode with no letter tier degrades instead of pretending.
    expect(resolveEffectiveVerseMode('letterByLetter', 'unsupported')).toBe('wordByWord');
    expect(resolveEffectiveVerseMode('letterByLetter', 'available')).toBe('letterByLetter');
    // A non-letter request is never rewritten.
    expect(resolveEffectiveVerseMode('threeTwo', 'unsupported')).toBe('threeTwo');
    expect(resolveEffectiveVerseMode(undefined, 'available')).toBe('full');
  });

  it('gives every letter-timing tier a distinct, non-empty message', () => {
    const tiers = ['idle', 'loading', 'available', 'unavailable', 'requires-auth', 'unsupported'] as const;
    const messages = tiers.map((tier) => describeLetterTiming(tier).message);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
    expect(new Set(messages).size).toBe(tiers.length);
  });
});

describe('shared display option catalog', () => {
  it('exposes exactly the animation profiles the timeline engine implements', () => {
    expect(ANIMATION_PROFILE_OPTIONS.map((option) => option.value).sort())
      .toEqual([...ANIMATION_PROFILES].sort());
  });

  it('has no duplicate values within any single option list', () => {
    const lists = {
      verseDisplayMode: VERSE_DISPLAY_MODE_OPTIONS,
      animationProfile: ANIMATION_PROFILE_OPTIONS,
      highlightStyle: HIGHLIGHT_STYLE_OPTIONS,
      glowStyle: GLOW_STYLE_OPTIONS,
      textShadowStyle: TEXT_SHADOW_OPTIONS,
      ayahTransition: AYAH_TRANSITION_OPTIONS,
      ayahNumberStyle: AYAH_NUMBER_STYLE_OPTIONS,
      ayahNumberColor: AYAH_NUMBER_COLOR_OPTIONS,
      surahNameStyle: SURA_NAME_STYLE_OPTIONS,
      surahNamePosition: SURA_NAME_POSITION_OPTIONS,
      reciterNameStyle: RECITER_NAME_STYLE_OPTIONS,
      frameStyle: FRAME_STYLE_OPTIONS,
    };
    for (const [name, options] of Object.entries(lists)) {
      const values = options.map((option) => option.value);
      expect(new Set(values).size, `${name} has duplicate values`).toBe(values.length);
    }
  });

  it('labels and describes every option, and includes the Animate badge', () => {
    const lists = [
      VERSE_DISPLAY_MODE_OPTIONS,
      ANIMATION_PROFILE_OPTIONS,
      HIGHLIGHT_STYLE_OPTIONS,
      GLOW_STYLE_OPTIONS,
      TEXT_SHADOW_OPTIONS,
      AYAH_TRANSITION_OPTIONS,
      RECITER_NAME_STYLE_OPTIONS,
    ];
    for (const options of lists) {
      for (const option of options) {
        expect(option.label.length, `${option.value} label`).toBeGreaterThan(1);
        expect(option.description.length, `${option.value} description`).toBeGreaterThan(1);
      }
    }
    // The letter-by-letter Animate mode is the one that needs the tier notice.
    const animate = VERSE_DISPLAY_MODE_OPTIONS.find((option) => option.value === 'letterByLetter');
    expect(animate?.badge).toBe('Animate');
  });

  it('reaches renderer-only styles that the previous UI could not express', () => {
    // These values exist in renderManifest.ts and the production renderers but
    // were unreachable from the settings UI before the catalog was unified.
    expect(RECITER_NAME_STYLE_OPTIONS.map((o) => o.value)).toContain('pill');
    expect(SURA_NAME_STYLE_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining(['modern', 'ornate', 'minimal']),
    );
    expect(SURA_NAME_POSITION_OPTIONS.map((o) => o.value)).toContain('center');
    expect(TEXT_SHADOW_OPTIONS.map((o) => o.value)).toContain('double');
  });

  it('resolves labels and returns the fallback for an unknown value', () => {
    expect(optionLabel(GLOW_STYLE_OPTIONS, 'emerald')).toBe('أخضر زمردي');
    expect(optionLabel(GLOW_STYLE_OPTIONS, 'not-a-real-glow', 'fallback')).toBe('fallback');
    expect(optionLabel(GLOW_STYLE_OPTIONS, undefined, 'fallback')).toBe('fallback');
  });
});

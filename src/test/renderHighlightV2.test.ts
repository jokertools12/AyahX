import { describe, expect, it } from 'vitest';
import { selectRenderHighlight, type HighlightTimeline } from '../../shared/render/selectRenderHighlight';

const timeline: HighlightTimeline = { ayahs: [
  { ayah: 31, startMs: 150, endMs: 1800, highlightMode: 'word', words: [
    { wordIndex: 9, occurrenceId: '9:first', startMs: 150, endMs: 300 },
    { wordIndex: 10, occurrenceId: '10:first', startMs: 350, endMs: 500 },
    { wordIndex: 9, occurrenceId: '9:repeat', startMs: 1200, endMs: 1400 },
    { wordIndex: 10, occurrenceId: '10:repeat', startMs: 1450, endMs: 1800 },
  ] }, { ayah: 32, startMs: 2200, endMs: 3000, highlightMode: 'ayah', words: [] },
] };
describe('v2 time-driven highlight expectation (pixels checked separately)', () => {
  it('selects start inclusively, end exclusively, and jumps backward by stored occurrence', () => {
    expect(selectRenderHighlight(timeline, 149)?.wordIndex).toBeNull(); expect(selectRenderHighlight(timeline, 150)?.occurrenceId).toBe('9:first');
    expect(selectRenderHighlight(timeline, 350)?.occurrenceId).toBe('10:first'); expect(selectRenderHighlight(timeline, 1250)?.wordIndex).toBe(9);
    expect(selectRenderHighlight(timeline, 1250)?.occurrenceId).toBe('9:repeat'); expect(selectRenderHighlight(timeline, 1800)?.wordIndex).toBeNull();
  });
  it('holds only short intra-ayah gaps (250ms) without borrowing a later word', () => {
    expect(selectRenderHighlight(timeline, 325)).toMatchObject({ occurrenceId: '9:first', held: true });
    expect(selectRenderHighlight(timeline, 750)).toMatchObject({ occurrenceId: '10:first', held: true });
    expect(selectRenderHighlight(timeline, 750.1)?.wordIndex).toBeNull(); expect(selectRenderHighlight(timeline, 1199)?.wordIndex).toBeNull();
  });
  it('holds prior ayah display through inter-ayah gap without word glow and changes at next start', () => {
    expect(selectRenderHighlight(timeline, 2000)).toMatchObject({ ayah: 31, wordIndex: null });
    expect(selectRenderHighlight(timeline, 2200)).toEqual({ ayah: 32, mode: 'ayah', wordIndex: null, occurrenceId: null, held: false });
  });
  it('never selects words for review/estimated ayah-only mode or invalid frame time', () => {
    const malicious: HighlightTimeline = { ayahs: [timeline.ayahs[0], { ...timeline.ayahs[1], words: [{ wordIndex: 1, occurrenceId: 'untrusted', startMs: 2200, endMs: 3000 }] }] };
    expect(selectRenderHighlight(malicious, 2500)?.wordIndex).toBeNull();
    for (const t of [-1, NaN, Infinity]) expect(selectRenderHighlight(timeline, t)).toBeNull(); expect(selectRenderHighlight({ ayahs: [] }, 0)).toBeNull();
  });
});

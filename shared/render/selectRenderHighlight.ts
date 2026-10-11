/** Reference expectation only; rendered pixels are verified independently by native QA. */
export interface HighlightTimeline {
  ayahs: ReadonlyArray<{ ayah: number; startMs: number; endMs: number; highlightMode: 'word'|'ayah';
    words: ReadonlyArray<{ wordIndex: number; occurrenceId: string; startMs: number; endMs: number }> }>;
}
export interface RenderHighlight {
  ayah: number; mode: 'word'|'ayah'; wordIndex: number|null; occurrenceId: string|null; held: boolean;
}
export const V2_WAQF_HOLD_MS = 250;
export function selectRenderHighlight(timeline: HighlightTimeline, timeMs: number): RenderHighlight|null {
  if (!Number.isFinite(timeMs) || timeMs < 0 || !timeline.ayahs.length) return null;
  const active = timeline.ayahs.find(a => a.startMs <= timeMs && timeMs < a.endMs)
    ?? timeline.ayahs.filter(a => a.startMs <= timeMs).at(-1) ?? timeline.ayahs[0];
  const state: RenderHighlight = { ayah: active.ayah, mode: active.highlightMode, wordIndex: null, occurrenceId: null, held: false };
  if (active.highlightMode !== 'word') return state;
  let word = active.words.find(w => w.startMs <= timeMs && timeMs < w.endMs);
  if (!word) {
    const previous = active.words.filter(w => w.endMs <= timeMs).at(-1);
    if (previous && timeMs - previous.endMs <= V2_WAQF_HOLD_MS && timeMs < active.endMs) { word = previous; state.held = true; }
  }
  if (word) { state.wordIndex = word.wordIndex; state.occurrenceId = word.occurrenceId; }
  return state;
}

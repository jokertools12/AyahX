/** Release coordinates remain untouched. Matching keys never replace Quran text. */
export type ReleaseWord = [number, number, number];
export type ReleaseTimingRow = [string, number, number, boolean, number, ReleaseWord[], string | null];
export interface NormalizedTiming {
  segments: Array<[number, number, boolean, number]>;
  words: Array<[number | null, number, number, number]>;
  spoken_text: string | null;
  source_rows: ReleaseTimingRow[];
  start_ms: number | null; end_ms: number | null;
  review_status: 'ready' | 'needs_review';
  word_highlight_enabled: boolean;
  coverage_words: number; expected_words: number;
  missing_words: Array<[number, string]>;
  review_reasons: string[];
}
const matchingKey = (s: string): string => s.normalize('NFC').replace(/\p{M}/gu, '').replace(/ٱ/gu, 'ا');
const validTime = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;

/** Word diff with repeated spans. Ambiguous restarts fail closed. */
export function mapSpokenWords(spoken: string[], canonical: string[]): Array<number | null> {
  const legal = canonical.map(matchingKey); let cursor = 0;
  return spoken.map((word) => {
    const key = matchingKey(word);
    if (legal[cursor] === key) return ++cursor;
    const candidates = legal.flatMap((value, i) => value === key && i < cursor ? [i + 1] : []);
    if (candidates.length !== 1) return null;
    cursor = candidates[0]; return cursor;
  });
}

export function normalizeTiming(rows: ReleaseTimingRow[], canonical: string[] | null): NormalizedTiming {
  const reasons = new Set<string>(); const covered = new Set<number>();
  const result: NormalizedTiming = { segments: [], words: [], spoken_text: rows.some((r) => r[6] === null) ? null : rows.map((r) => r[6]).join(' '),
    source_rows: structuredClone(rows), start_ms: null, end_ms: null, review_status: 'needs_review',
    word_highlight_enabled: false, coverage_words: 0, expected_words: canonical?.length ?? 0,
    missing_words: [], review_reasons: [] };
  if (!rows.length) reasons.add('MISSING_SOURCE_AYAH');
  if (!canonical) reasons.add('CANONICAL_TEXT_UNAVAILABLE');
  let priorStart = -1; let occurrence = 0;
  for (const row of rows) {
    const [, start, end, flag, silence, sourceWords, text] = row;
    const rowValid = validTime(start) && validTime(end) && end > start;
    if (!rowValid) reasons.add('INVALID_AYAH_INTERVAL');
    if (validTime(start) && start < priorStart) reasons.add('SOURCE_OCCURRENCE_ORDER');
    priorStart = start;
    if (typeof flag !== 'boolean' || !validTime(silence)) reasons.add('INVALID_SOURCE_METADATA');
    if (rowValid) {
      result.segments.push([start, end, flag, silence]);
      result.start_ms = Math.min(result.start_ms ?? start, start);
      result.end_ms = Math.max(result.end_ms ?? end, end);
    }
    if (text === null) reasons.add('SPOKEN_TEXT_UNAVAILABLE');
    const tokens = text?.trim().split(/\s+/u).filter(Boolean) ?? [];
    const mapping = canonical ? mapSpokenWords(tokens, canonical) : tokens.map(() => null);
    if (mapping.some((index) => index === null)) reasons.add('WORD_DIFF_UNMAPPED');
    if (!Array.isArray(sourceWords) || sourceWords.length !== tokens.length) reasons.add('SPOKEN_WORD_COUNT_MISMATCH');
    let priorEnd = start;
    for (const [i, from, to] of sourceWords ?? []) {
      const mapped = mapping[i - 1] ?? null;
      const valid = Number.isSafeInteger(i) && i >= 1 && (text === null || i <= tokens.length) &&
        validTime(from) && validTime(to) && to > from && rowValid && from >= start && to <= end;
      if (!valid) reasons.add('INVALID_WORD_INTERVAL');
      if (validTime(from) && from < priorEnd) reasons.add('SOURCE_WORD_OVERLAP_OR_ORDER');
      priorEnd = to;
      if (valid && mapped !== null) covered.add(mapped);
      // Invalid source times are retained only in source_rows, never active words.
      if (valid) result.words.push([mapped, occurrence, from, to]);
      occurrence += 1;
    }
  }
  result.coverage_words = covered.size;
  for (let i = 1; i <= (canonical?.length ?? 0); i++) if (!covered.has(i)) result.missing_words.push([i, 'NO_VALID_MAPPED_SOURCE_INTERVAL']);
  if (result.missing_words.length) reasons.add('CANONICAL_WORD_COVERAGE_INCOMPLETE');
  result.review_reasons = [...reasons];
  if (!reasons.size) { result.review_status = 'ready'; result.word_highlight_enabled = true; }
  return result;
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeTiming, mapSpokenWords, type ReleaseTimingRow } from '../../server/services/qudTimingNormalization';

const good: ReleaseTimingRow = ['1:1', 100, 300, true, 0, [[1, 100, 200], [2, 200, 300]], 'قال الحق'];
describe('D3 deterministic timing normalization', () => {
  it('keeps release coordinates and text and covers every canonical word', () => {
    const result = normalizeTiming([good], ['قال', 'الحق']);
    expect(result).toMatchObject({ review_status: 'ready', coverage_words: 2, missing_words: [], start_ms: 100, end_ms: 300 });
    expect(result.source_rows).toEqual([good]); expect(result.words).toEqual([[1, 0, 100, 200], [2, 1, 200, 300]]);
  });
  it('maps repeated words without changing canonical display text', () => {
    expect(mapSpokenWords(['قال', 'قال', 'الحق'], ['قال', 'الحق'])).toEqual([1, 1, 2]);
    expect(mapSpokenWords(['قال', 'غير'], ['قال', 'الحق'])).toEqual([1, null]);
  });
  it('retains invalid source and disables word highlight without healing', () => {
    const row = structuredClone(good); row[5][0][2] = row[5][0][1];
    const result = normalizeTiming([row], ['قال', 'الحق']);
    expect(result.review_status).toBe('needs_review'); expect(result.word_highlight_enabled).toBe(false);
    expect(result.source_rows).toEqual([row]); expect(result.missing_words).toEqual([[1, 'NO_VALID_MAPPED_SOURCE_INTERVAL']]);
  });
  it('does not borrow Hafs text for other riwayat or reorder occurrences', () => {
    expect(normalizeTiming([good], null).review_reasons).toContain('CANONICAL_TEXT_UNAVAILABLE');
    const late = structuredClone(good); late[1] = 500; late[2] = 700; late[5] = [[1, 500, 600], [2, 600, 700]];
    expect(normalizeTiming([late, good], ['قال', 'الحق']).review_reasons).toContain('SOURCE_OCCURRENCE_ORDER');
  });
  it('rejects all seven retained defective real fixtures', () => {
    const fixtures = JSON.parse(readFileSync('docs/data/d1-defective-timing-rows.json', 'utf8')) as Array<{ invalid_events: number[][] }>;
    expect(fixtures).toHaveLength(7);
    for (const fixture of fixtures) {
      const max = Math.max(...fixture.invalid_events.map((event) => event[0]));
      const row: ReleaseTimingRow = ['1:1', 0, 1000000, true, 0, fixture.invalid_events as [number, number, number][], Array(max).fill('قال').join(' ')];
      expect(normalizeTiming([row], Array(max).fill('قال')).review_status).toBe('needs_review');
      expect(normalizeTiming([row], Array(max).fill('قال')).source_rows).toEqual([row]);
    }
  });
});

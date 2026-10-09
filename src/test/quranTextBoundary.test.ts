import { describe, expect, it } from 'vitest';
import { containsQuranReference } from '../../server/services/quranTextBoundary';

describe('D1 canonical Quran text boundary', () => {
  it('rejects explicit legal Quran references before AI work', () => {
    expect(containsQuranReference({ lines: [{ text: 'text', reference: { table: 'quran_ayahs', id: 'a' } }] })).toBe(true);
    expect(containsQuranReference({ contentType: 'quran', lines: [] })).toBe(true);
    expect(containsQuranReference({ lines: [{ quran_ayah_id: 'a' }] })).toBe(true);
  });
  it('preserves the existing non-Quran subtitle request shape', () => {
    expect(containsQuranReference({ lines: [{ text: 'ابتهال', start: 0, end: 1000 }] })).toBe(false);
    expect(containsQuranReference({ contentType: 'ibtahalat', lines: [] })).toBe(false);
  });
});

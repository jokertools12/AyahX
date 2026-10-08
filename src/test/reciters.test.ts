import { describe, expect, it } from 'vitest';
import { getReciterById, isAccreditedReciter } from '../data/reciters';

describe('reciter accreditation', () => {
  it('only marks a reciter with a pinned QUA package as accredited', () => {
    const approved = getReciterById('mishary_alafasy');
    const audioOnly = getReciterById('saad_ghamdi');

    expect(isAccreditedReciter(approved)).toBe(true);
    expect(isAccreditedReciter(audioOnly)).toBe(false);
  });

  it('keeps audio-only reciters available for full-ayah playback', () => {
    const audioOnly = getReciterById('saad_ghamdi');
    expect(audioOnly?.everyAyahSubfolder).toBeTruthy();
    expect(audioOnly?.quranUniversalSlug).toBeUndefined();
  });
});

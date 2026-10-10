import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTiming } from '../../server/services/qudTimingNormalization';
import type { QuranTextCorpus } from '../../server/services/quranTextImport';
import type { PreparedTiming } from '../../server/services/qudTimingPackage';

const enabled = Boolean(process.env.D3_INPUT_DIRECTORY && process.env.D1_QURAN_CORPUS);
describe.skipIf(!enabled)('section 6 golden fixtures from actual pinned inputs', () => {
  it('replays all five source rows and preserves unresolved canonical mismatch', () => {
    const corpus = JSON.parse(readFileSync(process.env.D1_QURAN_CORPUS!, 'utf8')) as QuranTextCorpus;
    const rows = readFileSync(join(process.env.D3_INPUT_DIRECTORY!, 'abdul_hamid_ghraio_2025_yt.timings.jsonl'), 'utf8').trim().split('\n').map((s) => JSON.parse(s) as PreparedTiming);
    for (const ref of ['1:2','1:3','2:7','2:32','2:31']) {
      const [surah, ayah] = ref.split(':').map(Number);
      const row = rows.find((r) => r.surah === surah && r.ayah === ayah)!;
      const legal = corpus.ayahs.find((r) => r.surah === surah && r.ayah === ayah)!;
      const normalized = normalizeTiming(row.source_rows, legal.words);
      expect(normalized.source_rows).toEqual(row.source_rows);
      expect(normalized.words).toEqual(row.words);
      expect(normalized.coverage_words).toBe(row.coverage_words);
      expect(normalized.missing_words).toEqual(row.missing_words);
      if (ref === '2:31') expect(normalized).toMatchObject({ review_status: 'needs_review', word_highlight_enabled: false });
      else expect(normalized.review_status).toBe('ready');
    }
  });
});

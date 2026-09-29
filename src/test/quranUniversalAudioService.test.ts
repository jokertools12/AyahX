import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUniversalReciter, QUA_RECITATIONS, resolveUniversalQuranAudio } from '../../server/services/quranUniversalAudioService';
import { resolveAnimationStates, resolveVerseWordWindow, getAvailableTimingGranularity } from '../lib/animationTimeline';
import { resolveActiveWordAtTime } from '../lib/wordTimingEngine';
import { tokenizeQuranicText } from '../lib/timingMap';

let shaToRestore: { slug: string; sha256: string } | null = null;
afterEach(() => {
  if (shaToRestore) QUA_RECITATIONS[shaToRestore.slug].sha256 = shaToRestore.sha256;
  shaToRestore = null;
  vi.unstubAllGlobals();
});

describe('Quranic Universal Audio catalogue', () => {
  it('treats invisible Uthmani positioning marks as intraword formatting, not word boundaries', () => {
    expect(tokenizeQuranicText('ٱلصِّرَ ٰ⁠طَ ٱلْمُسْتَقِيمَ')).toEqual(['ٱلصِّرَٰطَ', 'ٱلْمُسْتَقِيمَ']);
  });

  it('exposes the production direct-audio catalogue without model configuration', () => {
    expect(Object.keys(QUA_RECITATIONS).length).toBeGreaterThanOrEqual(20);
    expect(isUniversalReciter('mishary_rashid_al_afasy_mp3quran')).toBe(true);
    expect(isUniversalReciter('not-a-reciter')).toBe(false);
  });

  it('keeps each enabled reader pinned to an immutable release package', () => {
    for (const reciter of Object.values(QUA_RECITATIONS)) {
      expect(reciter.zip).toMatch(/\.zip$/);
      expect(reciter.slug).toBeTruthy();
      expect(reciter.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('uses the exact v3 package audio and offset, selects canonical rows, and labels asset-reference fingerprints', async () => {
    const slug = 'mishary_rashid_al_afasy_mp3quran';
    const chapterUrl = 'https://server8.mp3quran.net/afs/001.mp3';
    const catalog = {
      schema_version: 3,
      slug,
      audio_category: 'by_surah',
      riwayah: 'hafs_an_asim',
      coverage: { ayahs: 6236, surahs: 114 },
      audio: {
        chapter_urls: { '1': chapterUrl, '2': 'https://attacker.example/audio.mp3', '3': 'https://server8.mp3quran.net/afs/003.mp3' },
        chapter_offsets_ms: { '1': 5000 },
        sample_rate_hz: 48000,
        channels: 2,
      },
    };
    const word = {
      _meta: {
        schema_version: 3,
        slug,
        audio_category: 'by_surah',
        units: 'ms',
        riwayah: 'hafs',
        tier: 'word',
        script_sha256: '19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86',
      },
      rows: [
        ['1:1', 0, 1000, true, 0, [[1, 0, 200], [2, 200, 400], [3, 400, 700], [4, 700, 1000]]],
        // A repeated acoustic occurrence is kept in the source but not mistaken for a second canonical verse.
        ['1:1', 1100, 2000, false, 0, [[1, 1100, 1200], [2, 1200, 1400], [3, 1400, 1700], [4, 1700, 2000]]],
        ['3:1', 0, 1000, true, 0, [[-1, 0, 200], [2, 200, 400], [3, 400, 700], [4, 700, 1000]]],
      ],
    };
    const letterText = 'بسم الله الرحمن الرحيم';
    const letterRows = word.rows.map((row) => {
      if (row[0] !== '1:1' || row[3] !== true) {
        return [row[0], row[1], row[2], row[3], row[4], row[5], letterText, []];
      }
      const scalars = Array.from(letterText);
      const events: Array<[number, number, number, boolean, Array<[number, number]>]> = [];
      let scalarIndex = 0;
      const sourceWords = row[5] as Array<[number, number, number]>;
      sourceWords.forEach((sourceWord, wordIndex) => {
        while (scalars[scalarIndex] === ' ') scalarIndex += 1;
        const tokenScalars = Array.from(letterText.split(/\s+/)[wordIndex]);
        const startMs = sourceWord[1];
        const endMs = sourceWord[2];
        tokenScalars.forEach((_, tokenIndex) => {
          const simultaneousSecondWordGlyph = wordIndex === 1 && tokenIndex < 3;
          const from = simultaneousSecondWordGlyph
            ? startMs
            : startMs + Math.floor((endMs - startMs) * tokenIndex / tokenScalars.length);
          const to = simultaneousSecondWordGlyph
            ? startMs + Math.floor((endMs - startMs) * 0.65)
            : startMs + Math.floor((endMs - startMs) * (tokenIndex + 1) / tokenScalars.length);
          events.push([wordIndex, from, to, tokenIndex === tokenScalars.length - 1, [[scalarIndex + tokenIndex, scalarIndex + tokenIndex + 1]]]);
        });
        scalarIndex += tokenScalars.length;
      });
      return [row[0], row[1], row[2], row[3], row[4], row[5], letterText, events];
    });
    const letter = {
      _meta: {
        schema_version: 3,
        slug,
        audio_category: 'by_surah',
        units: 'ms',
        riwayah: 'hafs',
        tier: 'letter',
        script: 'digital_khatt_v2',
        script_sha256: '19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86',
        unicode_indexing: 'scalar',
      },
      rows: letterRows,
    };
    const archive = zipSync({
      'catalog.json': strToU8(JSON.stringify(catalog)),
      'word_timestamps.json.gz': gzipSync(strToU8(JSON.stringify(word))),
      'letter_timestamps.json.gz': gzipSync(strToU8(JSON.stringify(letter))),
    });
    shaToRestore = { slug, sha256: QUA_RECITATIONS[slug].sha256 };
    QUA_RECITATIONS[slug].sha256 = createHash('sha256').update(archive).digest('hex');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(archive, { status: 200 })));
    vi.stubGlobal('AbortSignal', { timeout: () => undefined });

    const result = await resolveUniversalQuranAudio({
      reciterId: 'mishary',
      reciterSlug: slug,
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
    });

    expect(result.audioUrl).toBe(chapterUrl);
    expect(result.reciter.coverageAyahs).toBe(6236);
    expect(result.timingMap.words).toHaveLength(4);
    expect(result.timingMap.words[0].letters).toBeUndefined();
    expect(result.timingMap.words).toHaveLength(4);
    expect(result.timingMap.words[0].startMs).toBe(5000);
    expect(result.timingMap.words.at(-1)?.endMs).toBe(6000);
    expect(result.timingMap.compositionOffsets?.[0].startMs).toBe(5000);
    expect(result.timingMap.alignment?.availableGranularities).toEqual(['word']);
    expect(result.timingMap.alignment?.requestedGranularity).toBe('word');
    expect(result.timingMap.sampleRate).toBe(48000);
    expect(result.timingMap.audioFingerprintKind).toBe('dataset_asset_identity_sha256');
    expect(result.timingMap.audioContentHash).toBe(createHash('sha256')
      .update(`quranic-universal-audio:v3.2.0:${slug}:${QUA_RECITATIONS[slug].sha256}:1:${chapterUrl}:5000`)
      .digest('hex'));
    expect(result.timingMap.alignment?.inputAudioSha256).toBeUndefined();
    expect(result.timingMap.sourceUrlOrImmutableAssetId).toBe(chapterUrl);
    expect(result.timingMap.diagnostics?.sourceAudioBytesVerified).toBe(false);
    expect(result.timingMap.review?.note).toContain('not a downloaded audio-byte hash');
    const nextWord = result.timingMap.words[1];
    const active = resolveActiveWordAtTime(result.timingMap, nextWord.startMs);
    expect(active.activeWord?.canonicalWordKey).toBe(nextWord.canonicalWordKey);
    const animated = resolveAnimationStates(result.timingMap.words, 1, 0.5, 'spotlight', { reducedMotion: true });
    expect(animated[1].isActive).toBe(true);
    expect(animated[1].scale).toBe(1);
    expect(resolveVerseWordWindow('letterByLetter', result.timingMap.words.length, 1).wordCount).toBe(1);
    expect(getAvailableTimingGranularity(result.timingMap.words[1])).toBe('word');

    const letterResult = await resolveUniversalQuranAudio({
      reciterId: 'mishary',
      reciterSlug: slug,
      granularity: 'letter',
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: letterText }],
      },
    });
    expect(letterResult.timingMap.validationStatus).toBe('approved');
    expect(letterResult.timingMap.alignment?.availableGranularities).toEqual(['word', 'letter']);
    expect(letterResult.timingMap.alignment?.requestedGranularity).toBe('letter');
    expect(letterResult.timingMap.words[1].letters?.map((span) => span.token).join('')).toBe('الله');
    expect(letterResult.timingMap.words[1].letters).toHaveLength(2);
    expect(getAvailableTimingGranularity(letterResult.timingMap.words[1])).toBe('letter');

    await expect(resolveUniversalQuranAudio({
      reciterId: 'mishary',
      reciterSlug: slug,
      reference: {
        surahNumber: 2,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
    })).rejects.toThrow('UNIVERSAL_ALIGNMENT_AUDIO_URL_UNSAFE');

    await expect(resolveUniversalQuranAudio({
      reciterId: 'mishary',
      reciterSlug: slug,
      reference: {
        surahNumber: 3,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
    })).rejects.toThrow('UNIVERSAL_ALIGNMENT_DATA_INVALID');

    await expect(resolveUniversalQuranAudio({
      reciterId: 'abdulbasit',
      reciterSlug: 'abdulbasit_abdulsamad_mujawwad_tarteel',
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
      },
    })).rejects.toThrow('UNIVERSAL_ALIGNMENT_PACKAGE_CHECKSUM_MISMATCH');
  });
});

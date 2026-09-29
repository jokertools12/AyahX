import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUniversalReciter, QUA_RECITATIONS, resolveUniversalQuranAudio } from '../../server/services/quranUniversalAudioService';
import { resolveAnimationStates, resolveVerseWordWindow, getAvailableTimingGranularity } from '../lib/animationTimeline';
import { resolveActiveWordAtTime } from '../lib/wordTimingEngine';

let shaToRestore: { slug: string; sha256: string } | null = null;
afterEach(() => {
  if (shaToRestore) QUA_RECITATIONS[shaToRestore.slug].sha256 = shaToRestore.sha256;
  shaToRestore = null;
  vi.unstubAllGlobals();
});

describe('Quranic Universal Audio catalogue', () => {
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
    const archive = zipSync({
      'catalog.json': strToU8(JSON.stringify(catalog)),
      'word_timestamps.json.gz': gzipSync(strToU8(JSON.stringify(word))),
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

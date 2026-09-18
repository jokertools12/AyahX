import { describe, it, expect } from 'vitest';
import {
  TimingMap,
  createTimingMapCacheKey,
  computeAudioContentHash,
  validateTimingMap,
  normalizeQuranFoundationSegmentsToTimingMap,
  buildAudioAlignedTimingMap,
  timingMapRegistry,
  resolveActiveWordAtTime,
  resolveActiveWordAtFrame,
  normalizeQuranicToken,
} from '../lib/wordTimingEngine';

describe('Exact-Audio TimingMap Engine (Track E)', () => {
  const sampleAudioHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('normalizes Arabic tokens while strictly preserving base consonants', () => {
    expect(normalizeQuranicToken('الرَّحْمَٰنِ')).toBe('الرحمن');
    expect(normalizeQuranicToken('الرَّحِيمِ')).toBe('الرحيم');
    expect(normalizeQuranicToken('إِيَّاكَ')).toBe('اياك');
    expect(normalizeQuranicToken('الصِّرَاطَ')).toBe('الصراط');
    expect(normalizeQuranicToken('عَلَيْهِمْ')).toBe('عليهم');
  });

  it('computes deterministic audio fingerprints', async () => {
    const dataA = 'AUDIO_BINARY_STREAM_SAMPLE_1';
    const dataB = 'AUDIO_BINARY_STREAM_SAMPLE_2';

    const hashA1 = await computeAudioContentHash(dataA);
    const hashA2 = await computeAudioContentHash(dataA);
    const hashB = await computeAudioContentHash(dataB);

    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
    expect(typeof hashA1).toBe('string');
    expect(hashA1.length).toBeGreaterThan(16);
  });

  it('constructs collision-resistant cache keys isolating reciters and audio hashes', () => {
    const keyAlafasy = createTimingMapCacheKey({
      reciterId: 'alafasy',
      audioContentHash: sampleAudioHash,
      surahNumber: 1,
      ayahRange: { from: 1, to: 7 },
    });

    const keyHusary = createTimingMapCacheKey({
      reciterId: 'husary',
      audioContentHash: sampleAudioHash,
      surahNumber: 1,
      ayahRange: { from: 1, to: 7 },
    });

    const keyDifferentHash = createTimingMapCacheKey({
      reciterId: 'alafasy',
      audioContentHash: '0000000000000000000000000000000000000000000000000000000000000000',
      surahNumber: 1,
      ayahRange: { from: 1, to: 7 },
    });

    expect(keyAlafasy).not.toEqual(keyHusary);
    expect(keyAlafasy).not.toEqual(keyDifferentHash);
    expect(keyAlafasy).toContain('reciter:alafasy');
    expect(keyAlafasy).toContain('ayah:1:1-7');
  });

  it('validates TimingMap strictly: enforces monotonic order and zero overlaps', () => {
    const invalidMap: TimingMap = {
      schemaVersion: '1.0.0',
      mapId: 'test-invalid',
      reciterId: 'test',
      sourceId: 'test',
      sourceUrlOrImmutableAssetId: 'http://test',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 5000,
      sampleRate: 44100,
      channels: 2,
      audioProcessingVersion: 'v1',
      surahNumber: 1,
      ayahRange: { from: 1, to: 1 },
      quranTextVersion: 'uthmani_hafs_v1',
      segmentationVersion: 'v1',
      alignerVersion: 'v1',
      sourceMethod: 'forced_alignment',
      validationStatus: 'approved',
      createdAt: new Date().toISOString(),
      words: [
        {
          canonicalWordKey: '1:1:1',
          displayWordIndex: 0,
          displayToken: 'بِسْمِ',
          normalizedAlignmentToken: 'بسم',
          startMs: 200,
          endMs: 800,
          confidence: 0.95,
        },
        {
          // OVERLAPPING ERROR: starts at 700ms before previous ends at 800ms
          canonicalWordKey: '1:1:2',
          displayWordIndex: 1,
          displayToken: 'اللَّهِ',
          normalizedAlignmentToken: 'الله',
          startMs: 700,
          endMs: 1400,
          confidence: 0.95,
        },
      ],
      gaps: [],
    };

    const res = validateTimingMap(invalidMap);
    expect(res.isValid).toBe(false);
    expect(res.validationStatus).toBe('rejected');
    expect(res.errors.some(e => e.includes('overlaps'))).toBe(true);
  });

  it('normalizes Quran Foundation segments into an authentic, approved TimingMap', () => {
    const normalized = normalizeQuranFoundationSegmentsToTimingMap({
      reciterId: '7',
      providerRecitationId: 7,
      surahNumber: 1,
      startAyah: 1,
      endAyah: 2,
      audioUrl: 'https://audio.qurancdn.com/Alafasy/001.mp3',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 10500,
      sampleRate: 44100,
      channels: 2,
      qfTimestamps: [
        {
          verse_key: '1:1',
          timestamp_from: 150,
          timestamp_to: 4500,
          segments: [
            [1, 200, 750],     // بِسْمِ
            [2, 790, 1600],    // اللَّهِ
            [3, 1650, 2600],   // الرَّحْمَٰنِ
            [4, 2650, 4200],   // الرَّحِيمِ
          ],
        },
        {
          verse_key: '1:2',
          timestamp_from: 4800,
          timestamp_to: 9800,
          segments: [
            [1, 5000, 5800],   // الْحَمْدُ
            [2, 5850, 6600],   // لِلَّهِ
            [3, 6650, 7500],   // رَبِّ
            [4, 7550, 9400],   // الْعَالَمِينَ
          ],
        },
      ],
      ayahsText: [
        { numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' },
        { numberInSurah: 2, text: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' },
      ],
    });

    expect(normalized.words.length).toBe(8);
    expect(normalized.validationStatus).toBe('approved');
    expect(normalized.words[0].displayToken).toBe('بِسْمِ');
    expect(normalized.words[3].displayToken).toBe('الرَّحِيمِ');
    expect(normalized.words[4].displayToken).toBe('الْحَمْدُ');

    // Verify inter-ayah gap detection
    expect(normalized.gaps.length).toBeGreaterThan(0);
    const interAyahGap = normalized.gaps.find(g => g.startMs >= 4200 && g.endMs <= 5000);
    expect(interAyahGap).toBeDefined();
  });

  it('enforces exact boundary semantics: holding during pauses, never illuminating next word early', () => {
    const timingMap = normalizeQuranFoundationSegmentsToTimingMap({
      reciterId: 'alafasy',
      providerRecitationId: 7,
      surahNumber: 1,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'http://test.mp3',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 5000,
      qfTimestamps: [
        {
          verse_key: '1:1',
          timestamp_from: 100,
          timestamp_to: 4500,
          segments: [
            [1, 200, 800],    // Word 0: [200ms, 800ms)
            [2, 1000, 1800],  // Word 1: [1000ms, 1800ms) - Gap is [800ms, 1000ms)
            [3, 2000, 3000],  // Word 2: [2000ms, 3000ms) - Gap is [1800ms, 2000ms)
            [4, 3200, 4200],  // Word 3: [3200ms, 4200ms)
          ],
        },
      ],
      ayahsText: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
    });

    // 1. Before speech onset (< 200ms) -> Null, progress = 0
    const beforeSpeech = resolveActiveWordAtTime(timingMap, 150);
    expect(beforeSpeech.activeWordIndex).toBeNull();
    expect(beforeSpeech.wordProgress).toBe(0);

    // 2. Exact word onset (200ms) -> Word 0, progress = 0
    const word0Onset = resolveActiveWordAtTime(timingMap, 200);
    expect(word0Onset.activeWordIndex).toBe(0);
    expect(word0Onset.wordProgress).toBe(0);
    expect(word0Onset.isGap).toBe(false);

    // 3. Middle of word 0 (500ms) -> Word 0, progress = 0.5
    const word0Mid = resolveActiveWordAtTime(timingMap, 500);
    expect(word0Mid.activeWordIndex).toBe(0);
    expect(word0Mid.wordProgress).toBeCloseTo(0.5, 2);
    expect(word0Mid.isGap).toBe(false);

    // 4. Inter-word pause [800ms - 999ms]:
    // CRITICAL: MUST HOLD WORD 0 WITH progress=1.0, MUST NOT ILLUMINATE WORD 1 EARLY!
    const inPause = resolveActiveWordAtTime(timingMap, 900);
    expect(inPause.activeWordIndex).toBe(0); // Holds previous word!
    expect(inPause.wordProgress).toBe(1.0);
    expect(inPause.isGap).toBe(true);

    const justBeforeWord1 = resolveActiveWordAtTime(timingMap, 999);
    expect(justBeforeWord1.activeWordIndex).toBe(0); // Still word 0, NOT word 1!
    expect(justBeforeWord1.wordProgress).toBe(1.0);
    expect(justBeforeWord1.isGap).toBe(true);

    // 5. Exact word 1 onset (1000ms) -> Transitions to Word 1
    const word1Onset = resolveActiveWordAtTime(timingMap, 1000);
    expect(word1Onset.activeWordIndex).toBe(1);
    expect(word1Onset.wordProgress).toBe(0);
    expect(word1Onset.isGap).toBe(false);

    // 6. Outro waqf decay after last word (4300ms) -> Holds final word 3
    const outroHold = resolveActiveWordAtTime(timingMap, 4300);
    expect(outroHold.activeWordIndex).toBe(3);
    expect(outroHold.wordProgress).toBe(1.0);
    expect(outroHold.isGap).toBe(true);
  });

  it('guarantees 100% mathematical parity between preview and export frame resolver', () => {
    const timingMap = normalizeQuranFoundationSegmentsToTimingMap({
      reciterId: 'alafasy',
      providerRecitationId: 7,
      surahNumber: 1,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'http://test.mp3',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 4000,
      qfTimestamps: [
        {
          verse_key: '1:1',
          timestamp_from: 0,
          timestamp_to: 4000,
          segments: [
            [1, 100, 1000],
            [2, 1100, 2000],
            [3, 2100, 3000],
            [4, 3100, 3900],
          ],
        },
      ],
      ayahsText: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }],
    });

    const fps = 30;
    // Test 120 frames (4 seconds at 30 fps)
    for (let frameIdx = 0; frameIdx < 120; frameIdx++) {
      const derivedMs = (frameIdx * 1000) / fps;
      const resultFromTime = resolveActiveWordAtTime(timingMap, derivedMs);
      const resultFromFrame = resolveActiveWordAtFrame(timingMap, frameIdx, fps);

      expect(resultFromFrame.activeWordIndex).toBe(resultFromTime.activeWordIndex);
      expect(resultFromFrame.wordProgress).toBe(resultFromTime.wordProgress);
      expect(resultFromFrame.isGap).toBe(resultFromTime.isGap);
      expect(resultFromFrame.validationStatus).toBe(resultFromTime.validationStatus);
    }
  });

  it('marks unaligned recitations as "needs_review" and does not invent fake word timing', () => {
    const unalignedMap = buildAudioAlignedTimingMap({
      reciterId: 'unaligned_reciter',
      surahNumber: 1,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'http://everyayah.com/sample.mp3',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 5000,
      sampleRate: 44100,
      channels: 2,
      ayahs: [
        {
          numberInSurah: 1,
          text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
          audioStartMs: 0,
          audioEndMs: 5000,
        },
      ],
      // No explicit word spans provided
    });

    expect(unalignedMap.validationStatus).toBe('needs_review');
    expect(unalignedMap.words.length).toBe(0);

    const res = resolveActiveWordAtTime(unalignedMap, 2500);
    // Truthful behavior: Does NOT highlight random words with fake timing!
    expect(res.activeWordIndex).toBeNull();
    expect(res.validationStatus).toBe('needs_review');
  });

  it('stores and retrieves verified maps from the TimingMapRegistry safely', () => {
    timingMapRegistry.clear();

    const sampleMap = normalizeQuranFoundationSegmentsToTimingMap({
      reciterId: 'alafasy',
      providerRecitationId: 7,
      surahNumber: 1,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'http://test.mp3',
      audioContentHash: sampleAudioHash,
      decodedDurationMs: 3000,
      qfTimestamps: [
        {
          verse_key: '1:1',
          timestamp_from: 0,
          timestamp_to: 3000,
          segments: [[1, 100, 2900]],
        },
      ],
      ayahsText: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }],
    });

    timingMapRegistry.register(sampleMap);

    // Retrieve with exact matching params
    const retrieved = timingMapRegistry.get({
      reciterId: 'alafasy',
      audioContentHash: sampleAudioHash,
      surahNumber: 1,
      ayahRange: { from: 1, to: 1 },
      quranTextVersion: sampleMap.quranTextVersion,
      segmentationVersion: sampleMap.segmentationVersion,
      alignerVersion: sampleMap.alignerVersion,
      audioProcessingVersion: sampleMap.audioProcessingVersion,
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.mapId).toBe(sampleMap.mapId);

    // Attempt retrieve with mismatched audio content hash: must return null!
    const mismatched = timingMapRegistry.get({
      reciterId: 'alafasy',
      audioContentHash: 'different_hash_content_12345',
      surahNumber: 1,
      ayahRange: { from: 1, to: 1 },
    });
    expect(mismatched).toBeNull();
  });

  it('guarantees Preview and Recorder contract: disables glow on "needs_review" and enables on "approved"', () => {
    // 1. Unaligned / needs_review map (e.g. EveryAyah concatenated or unverified audio)
    const reviewMap = buildAudioAlignedTimingMap({
      reciterId: 'everyayah_reciter',
      surahNumber: 108,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'https://everyayah.com/sample.mp3',
      audioContentHash: 'sample_hash_ea',
      decodedDurationMs: 4000,
      ayahs: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ', audioStartMs: 0, audioEndMs: 4000 }],
    });

    expect(reviewMap.validationStatus).toBe('needs_review');

    // Test playback sync at multiple times:
    [500, 1500, 2500, 3500].forEach((ms) => {
      const sync = resolveActiveWordAtTime(reviewMap, ms);
      expect(sync.activeWordIndex).toBeNull();
      expect(sync.wordProgress).toBe(0);
      expect(sync.validationStatus).toBe('needs_review');
    });

    // 2. Approved map (e.g. Quran Foundation authentic alignment)
    const approvedMap = normalizeQuranFoundationSegmentsToTimingMap({
      reciterId: 'qf_reciter',
      providerRecitationId: 7,
      surahNumber: 108,
      startAyah: 1,
      endAyah: 1,
      audioUrl: 'https://audio.qurancdn.com/sample.mp3',
      audioContentHash: 'sample_hash_qf',
      decodedDurationMs: 4000,
      qfTimestamps: [
        {
          verse_key: '108:1',
          timestamp_from: 0,
          timestamp_to: 4000,
          segments: [
            [1, 200, 1000],
            [2, 1050, 2200],
            [3, 2250, 3800],
          ],
        },
      ],
      ayahsText: [{ numberInSurah: 1, text: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ' }],
    });

    expect(approvedMap.validationStatus).toBe('approved');

    // Test word 1 onset (500ms)
    const activeWord1 = resolveActiveWordAtTime(approvedMap, 500);
    expect(activeWord1.activeWordIndex).toBe(0);
    expect(activeWord1.wordProgress).toBeGreaterThan(0);
    expect(activeWord1.validationStatus).toBe('approved');
  });
});


import { describe, expect, it } from 'vitest';
import {
  alignmentDocumentToTimingMap,
  normalizeAlignmentResult,
  validateAlignmentDocument,
  type AlignmentRequest,
} from '../../server/services/alignmentProvider';
import {
  applyAlignmentReview,
  getAlignmentProviderRegistry,
  getAlignmentProviderDescriptors,
  parseAlignmentRequest,
  runAlignment,
} from '../../server/services/alignmentService';

function request(overrides: Partial<AlignmentRequest> = {}): AlignmentRequest {
  return {
    providerId: 'manual',
    reciterId: 'test-reciter',
    audio: {
      contentHash: 'sha256-test-audio',
      durationMs: 2_000,
      sourceUrlOrAssetId: 'asset:test-audio',
    },
    reference: {
      surahNumber: 1,
      startAyah: 1,
      endAyah: 1,
      ayahs: [{ numberInSurah: 1, text: 'قُلْ هُوَ اللَّهُ' }],
    },
    ...overrides,
  };
}

describe('alignment provider contract', () => {
  it('requires explicit word intervals and preserves repeated acoustic occurrences', () => {
    const result = normalizeAlignmentResult(request(), {
      providerId: 'manual',
      providerVersion: 'test-v1',
      words: [
        { canonicalWordKey: '1:1:1', startMs: 100, endMs: 450, confidence: 0.9 },
        { canonicalWordKey: '1:1:1', startMs: 600, endMs: 900, confidence: 0.8 },
        { canonicalWordKey: '1:1:2', startMs: 1_000, endMs: 1_500, confidence: 0.95 },
      ],
      letters: [
        { parentWordKey: '1:1:1', label: 'ق', startMs: 120, endMs: 250, confidence: 0.9 },
      ],
    });

    expect(result.document.words[0].occurrenceId).not.toBe(result.document.words[1].occurrenceId);
    expect(result.document.letters[0].parentOccurrenceId).toBeUndefined();
    expect(result.validation.status).toBe('needs_review');
    expect(result.validation.warnings.some((warning) => warning.includes('unambiguous'))).toBe(true);
    const invalid = normalizeAlignmentResult(request(), {
      providerId: 'manual',
      words: [{ canonicalWordKey: '1:1:1', startMs: 100, endMs: 100 }],
    });
    expect(invalid.validation.valid).toBe(false);
    expect(invalid.validation.status).toBe('rejected');
    expect(invalid.validation.errors.length).toBeGreaterThan(0);
  });

  it('binds nested spans to a unique occurrence and projects them to TimingMap v2', () => {
    const result = normalizeAlignmentResult(request(), {
      providerId: 'manual',
      providerVerified: true,
      words: [
        { canonicalWordKey: '1:1:1', startMs: 100, endMs: 450, confidence: 0.95 },
        { canonicalWordKey: '1:1:2', startMs: 500, endMs: 900, confidence: 0.95 },
        { canonicalWordKey: '1:1:3', startMs: 950, endMs: 1_400, confidence: 0.95 },
      ],
      letters: [
        { parentWordKey: '1:1:1', label: 'ق', startMs: 120, endMs: 230, confidence: 0.9 },
        { parentWordKey: '1:1:1', label: 'ل', startMs: 240, endMs: 400, confidence: 0.9 },
      ],
    });
    expect(result.validation.status).toBe('approved');
    expect(result.document.letters[0].parentOccurrenceId).toBe(result.document.words[0].occurrenceId);
    const map = alignmentDocumentToTimingMap(result.document);
    expect(map.schemaVersion).toBe('2.0.0');
    expect(map.alignment?.provider).toBe('manual');
    expect(map.words[0].letters).toHaveLength(2);
    expect(map.words[0].letters?.[1].endMs).toBe(400);
  });
});

describe('alignment orchestration', () => {
  it('never accepts browser-supplied Quran Foundation timing or audio identity as an attestation', async () => {
    const clientPayload = {
      providerId: 'quran_foundation',
      reciterId: 'test-reciter',
      audio: {
        contentHash: 'forged-browser-hash',
        durationMs: 99_999,
        sourceUrlOrAssetId: 'https://example.test/forged.mp3',
      },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ' }],
      },
      providerInput: {
        recitationId: 7,
        timestamps: [{ verse_key: '1:1', timestamp_from: 0, timestamp_to: 500, segments: [[1, 0, 500]] }],
      },
    };
    const parsed = parseAlignmentRequest(clientPayload);
    expect(parsed.audio.contentHash).toBe('pending-qf-server-fingerprint');
    expect(parsed.audio.sourceUrlOrAssetId).toBe('asset:pending-qf-server-fetch');

    await expect(getAlignmentProviderRegistry().get('quran_foundation').align(parsed)).rejects
      .toThrow(/QF_STRICT_SERVER_ATTESTATION_REQUIRED/);
  });

  it('requires an exact contiguous Quran reference snapshot', () => {
    expect(() => parseAlignmentRequest({
      providerId: 'manual',
      reciterId: 'test-reciter',
      audio: { contentHash: 'sha256-test-audio', durationMs: 1_000, sourceUrlOrAssetId: 'asset:test' },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 2,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ' }],
      },
      providerInput: { words: [] },
    })).toThrow(/ALIGNMENT_REFERENCE_AYAHS_INCOMPLETE/);
  });

  it('projects a server-attested complete QF result as approved while ignoring legacy marker rows', async () => {
    const qfRequest: AlignmentRequest = {
      providerId: 'quran_foundation',
      reciterId: 'test-reciter',
      audio: {
        contentHash: 'a'.repeat(64),
        durationMs: 500,
        sourceUrlOrAssetId: 'https://download.quranicaudio.com/qdc/example/001.mp3',
      },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ هُوَ' }],
      },
      providerInput: {
        serverAttested: true,
        recitationId: 7,
        timestamps: [{
          verse_key: '1:1',
          timestamp_from: 0,
          timestamp_to: 500,
          segments: [[1, 0, 200], [25001], [2, 200, 500]],
        }],
      },
    };
    const providerResult = await getAlignmentProviderRegistry().get('quran_foundation').align(qfRequest);
    const normalized = normalizeAlignmentResult(qfRequest, providerResult);
    const map = alignmentDocumentToTimingMap(normalized.document);
    expect(normalized.validation.status).toBe('approved');
    expect(map.validationStatus).toBe('approved');
    expect(map.review).toBeUndefined();
    expect(map.words).toHaveLength(2);
  });

  it('does not silently fall back when an explicitly selected provider is unavailable', async () => {
    await expect(runAlignment({
      providerId: 'internal_ctc',
      reciterId: 'test-reciter',
      audio: { contentHash: 'sha256-test-audio', durationMs: 1_000, sourceUrlOrAssetId: 'asset:test' },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ' }],
      },
      providerInput: {},
    })).rejects.toThrow(/NOT_CONFIGURED/);
  });

  it('rejects unsupported granularity instead of downgrading to word timing', async () => {
    const parsed = parseAlignmentRequest({
      providerId: 'quran_foundation',
      reciterId: 'test-reciter',
      granularity: 'letter',
      audio: { contentHash: 'browser-supplied', durationMs: 1_000, sourceUrlOrAssetId: 'https://download.quranicaudio.com/qdc/example/001.mp3' },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ' }],
      },
      providerInput: { recitationId: 7 },
    });
    await expect(getAlignmentProviderRegistry().get('quran_foundation').align(parsed))
      .rejects.toThrow(/GRANULARITY_NOT_SUPPORTED/);
  });

  it('creates an immutable approved manual review revision without mutating the source', async () => {
    const initial = await runAlignment({
      providerId: 'manual',
      reciterId: 'test-reciter',
      audio: { contentHash: 'sha256-test-audio', durationMs: 1_000, sourceUrlOrAssetId: 'asset:test' },
      reference: {
        surahNumber: 1,
        startAyah: 1,
        endAyah: 1,
        ayahs: [{ numberInSurah: 1, text: 'قُلْ هُوَ' }],
      },
      providerInput: {
        words: [
          { canonicalWordKey: '1:1:1', startMs: 100, endMs: 350, confidence: 0.8 },
          { canonicalWordKey: '1:1:2', startMs: 400, endMs: 700, confidence: 0.8 },
        ],
      },
    });
    expect(initial.document.validationStatus).toBe('needs_review');
    const revised = applyAlignmentReview(initial.document, [
      { occurrenceId: initial.document.words[0].occurrenceId, startMs: 80, endMs: 360, confidence: 0.99 },
    ], { status: 'approved', reviewerId: 'reviewer-1', note: 'تمت المطابقة مع الصوت' });
    expect(revised.document.documentId).not.toBe(initial.document.documentId);
    expect(revised.document.parentDocumentId).toBe(initial.document.documentId);
    expect(initial.document.words[0].startMs).toBe(100);
    expect(revised.document.words[0].startMs).toBe(80);
    expect(revised.document.validationStatus).toBe('approved');
    expect(revised.timingMap.review?.status).toBe('approved');
  });

  it('reports provider availability and legal review state explicitly', () => {
    const descriptors = getAlignmentProviderDescriptors();
    const qua = descriptors.find((provider) => provider.id === 'quranic_universal_aligner');
    expect(qua).toBeDefined();
    expect(qua?.requiresHumanReview).toBe(true);
    expect(qua?.legalStatus).toBe('external_review_required');
  });
});

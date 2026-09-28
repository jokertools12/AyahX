/**
 * Canonical alignment boundary for AyahX.
 *
 * Providers (Quran Foundation, QUA, an internal CTC worker, or a manual
 * reviewer) return the same small result shape.  This module deliberately has
 * no model/network dependency: providers are injected by the caller and all
 * untrusted output passes through the normalizer and validator before it can
 * reach a render manifest.
 */

import type {
  AlignmentProviderId,
  AlignmentProvenance,
  AlignmentReview,
  TimingGap,
  TimingMap,
  TimingSubsegment,
  TimingWord,
} from '../../src/lib/timingMap';

export type AlignmentGranularity = 'word' | 'letter' | 'phoneme';
export type AlignmentValidationStatus = 'approved' | 'low_confidence' | 'needs_review' | 'rejected';

export interface AlignmentReferenceAyah {
  numberInSurah: number;
  text: string;
}

export interface AlignmentAudio {
  contentHash: string;
  durationMs: number;
  sampleRate?: number;
  channels?: number;
  sourceUrlOrAssetId?: string;
}

export interface AlignmentRequest {
  /** Stable job id supplied by the queue/API when available. */
  jobId?: string;
  providerId: string;
  reciterId: string;
  audio: AlignmentAudio;
  reference: {
    surahNumber: number;
    startAyah: number;
    endAyah: number;
    ayahs: AlignmentReferenceAyah[];
    quranTextVersion?: string;
    riwayah?: string;
  };
  granularity?: AlignmentGranularity;
  /** Provider-specific input. It is intentionally opaque to this contract. */
  providerInput?: unknown;
  signal?: AbortSignal;
}

export interface ProviderWordSpan {
  /** Prefer a canonical Quran key. The normalizer will derive it from the two indexes when present. */
  canonicalWordKey?: string;
  ayahNumber?: number;
  wordIndex1Based?: number;
  displayToken?: string;
  normalizedAlignmentToken?: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  flags?: string[];
}

export interface ProviderSubspan {
  /** Word key or occurrence to which a letter/phoneme belongs. */
  parentWordKey?: string;
  /** Optional provider occurrence id when the same canonical word is repeated. */
  parentOccurrenceId?: string;
  label: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ProviderGap {
  startMs: number;
  endMs: number;
  type: TimingGap['type'];
}

export interface AlignmentProviderResult {
  providerId: string;
  providerVersion?: string;
  sourceMethod?: TimingMap['sourceMethod'] | string;
  words: ProviderWordSpan[];
  letters?: ProviderSubspan[];
  phonemes?: ProviderSubspan[];
  gaps?: ProviderGap[];
  /** A provider may attest to its own reviewed/ground-truth output. */
  providerVerified?: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface AlignmentProvider {
  readonly id: string;
  readonly version: string;
  align(request: AlignmentRequest): Promise<AlignmentProviderResult>;
}

export interface AlignmentWord {
  canonicalWordKey: string;
  /** Distinguishes repeated recitations of the same Quran word. */
  occurrenceId: string;
  displayWordIndex: number;
  displayToken: string;
  normalizedAlignmentToken: string;
  startMs: number;
  endMs: number;
  confidence: number;
  flags?: string[];
}

export interface AlignmentSubspan {
  parentWordKey?: string;
  parentOccurrenceId?: string;
  label: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface AlignmentDocument {
  schemaVersion: '2.0.0';
  documentId: string;
  parentDocumentId?: string;
  reciterId: string;
  providerId: string;
  providerVersion: string;
  /** Granularity requested by the caller; never inferred from a fallback. */
  requestedGranularity: AlignmentGranularity;
  sourceMethod: string;
  providerVerified: boolean;
  audio: Required<Pick<AlignmentAudio, 'contentHash' | 'durationMs'>> & {
    sampleRate: number;
    channels: number;
    sourceUrlOrAssetId: string;
  };
  reference: {
    surahNumber: number;
    ayahRange: { from: number; to: number };
    /** Snapshot used for deterministic review validation years later. */
    ayahs: AlignmentReferenceAyah[];
    quranTextVersion: string;
    riwayah?: string;
  };
  words: AlignmentWord[];
  letters: AlignmentSubspan[];
  phonemes: AlignmentSubspan[];
  gaps: ProviderGap[];
  review: AlignmentReview;
  validationStatus: AlignmentValidationStatus;
  diagnostics: Record<string, unknown>;
  provenance: {
    providerId: string;
    providerVersion: string;
    sourceMethod: string;
    audioContentHash: string;
    createdAt: string;
    parentDocumentId?: string;
  };
}

export interface AlignmentValidationResult {
  valid: boolean;
  status: AlignmentValidationStatus;
  errors: string[];
  warnings: string[];
  diagnostics: {
    wordCount: number;
    expectedWordCount: number;
    coveredReferenceWordCount: number;
    missingReferenceWordCount: number;
    duplicateOccurrenceCount: number;
    meanConfidence: number;
    minConfidence: number;
    monotonic: boolean;
    nonOverlapping: boolean;
    durationBounded: boolean;
  };
}

export interface NormalizeAlignmentResult {
  document: AlignmentDocument;
  validation: AlignmentValidationResult;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_CHANNELS = 2;
const DURATION_TOLERANCE_MS = 150;
const LOW_CONFIDENCE_THRESHOLD = 0.65;
const MIN_CONFIDENCE_THRESHOLD = 0.3;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_').slice(0, 80) || 'unknown';
}

function createDocumentId(request: AlignmentRequest, result: AlignmentProviderResult): string {
  const base = request.jobId || `${request.audio.contentHash}-${Date.now()}`;
  return `aln-${safeIdPart(result.providerId || request.providerId)}-${safeIdPart(base)}`;
}

function canonicalKeyForSpan(
  span: ProviderWordSpan,
  request: AlignmentRequest,
): string | null {
  if (typeof span.canonicalWordKey === 'string' && /^\d+:\d+:\d+$/.test(span.canonicalWordKey.trim())) {
    return span.canonicalWordKey.trim();
  }
  if (finiteNumber(span.ayahNumber) && finiteNumber(span.wordIndex1Based)) {
    const ayah = Math.trunc(span.ayahNumber);
    const word = Math.trunc(span.wordIndex1Based);
    if (ayah >= request.reference.startAyah && ayah <= request.reference.endAyah && word >= 1) {
      return `${request.reference.surahNumber}:${ayah}:${word}`;
    }
  }
  return null;
}

function tokenForKey(key: string, request: AlignmentRequest): string {
  const [, ayahText, wordText] = key.split(':');
  const ayah = Number(ayahText);
  const word = Number(wordText);
  const ref = request.reference.ayahs.find((item) => item.numberInSurah === ayah);
  const token = ref?.text.split(/\s+/).filter(Boolean)[word - 1];
  return token || '';
}

function normalizeConfidence(value: unknown): number {
  if (!finiteNumber(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeSubspans(
  spans: ProviderSubspan[] | undefined,
  words: AlignmentWord[],
  warnings: string[],
): AlignmentSubspan[] {
  if (!Array.isArray(spans)) return [];
  return spans.map((span, index) => {
    const parentWordKey = typeof span.parentWordKey === 'string' ? span.parentWordKey : undefined;
    const requestedOccurrenceId = typeof span.parentOccurrenceId === 'string' ? span.parentOccurrenceId : undefined;
    const directParent = requestedOccurrenceId
      ? words.find((word) => word.occurrenceId === requestedOccurrenceId)
      : undefined;
    const parentsForKey = parentWordKey
      ? words.filter((word) => word.canonicalWordKey === parentWordKey)
      : [];
    const parent = directParent || (parentsForKey.length === 1 ? parentsForKey[0] : undefined);
    if (!parent) {
      warnings.push(`subsegment[${index}] has no unambiguous parent word occurrence`);
    }
    return {
      parentWordKey: parent?.canonicalWordKey || parentWordKey,
      parentOccurrenceId: parent?.occurrenceId || requestedOccurrenceId,
      label: typeof span.label === 'string' ? span.label : '',
      startMs: span.startMs,
      endMs: span.endMs,
      confidence: normalizeConfidence(span.confidence),
    };
  }).sort((left, right) => {
    const parent = (left.parentOccurrenceId || '').localeCompare(right.parentOccurrenceId || '');
    return parent || left.startMs - right.startMs || left.endMs - right.endMs;
  });
}

function referenceKeys(request: AlignmentRequest): Set<string> {
  const keys = new Set<string>();
  for (const ayah of request.reference.ayahs) {
    const tokens = ayah.text.split(/\s+/).filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      keys.add(`${request.reference.surahNumber}:${ayah.numberInSurah}:${index + 1}`);
    }
  }
  return keys;
}

/**
 * Converts arbitrary provider output into the immutable server contract.
 * It never creates proportional timings: a word without an explicit interval
 * is rejected, and an absent reference word is reported as needs_review.
 */
export function normalizeAlignmentResult(
  request: AlignmentRequest,
  result: AlignmentProviderResult,
): NormalizeAlignmentResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const refKeys = referenceKeys(request);
  const seenOccurrences = new Map<string, number>();
  const words: AlignmentWord[] = [];

  if (!result || typeof result !== 'object') {
    throw new Error('ALIGNMENT_PROVIDER_RESULT_INVALID');
  }
  if (!Array.isArray(result.words)) {
    throw new Error('ALIGNMENT_PROVIDER_WORDS_MISSING');
  }

  for (let index = 0; index < result.words.length; index += 1) {
    const span = result.words[index];
    const key = canonicalKeyForSpan(span, request);
    if (!key) {
      errors.push(`word[${index}] has no canonical Quran word key`);
      continue;
    }
    if (!finiteNumber(span.startMs) || !finiteNumber(span.endMs)) {
      errors.push(`word[${index}] has non-finite timing`);
      continue;
    }
    if (span.startMs < 0 || span.endMs <= span.startMs) {
      errors.push(`word[${index}] has invalid interval ${span.startMs}-${span.endMs}ms`);
      continue;
    }
    if (!refKeys.has(key)) {
      warnings.push(`word[${index}] references a word outside the requested Quran text: ${key}`);
    }
    const occurrenceNumber = (seenOccurrences.get(key) || 0) + 1;
    seenOccurrences.set(key, occurrenceNumber);
    const token = typeof span.displayToken === 'string' && span.displayToken.trim()
      ? span.displayToken
      : tokenForKey(key, request);
    if (!token) warnings.push(`word[${index}] has no display token: ${key}`);
    words.push({
      canonicalWordKey: key,
      occurrenceId: `${key}#${occurrenceNumber}`,
      displayWordIndex: index,
      displayToken: token,
      normalizedAlignmentToken: span.normalizedAlignmentToken || token,
      startMs: span.startMs,
      endMs: span.endMs,
      confidence: normalizeConfidence(span.confidence),
      flags: Array.isArray(span.flags) ? span.flags.filter((flag): flag is string => typeof flag === 'string') : undefined,
    });
  }

  const gaps = Array.isArray(result.gaps) ? result.gaps.map((gap) => ({
    startMs: gap.startMs,
    endMs: gap.endMs,
    type: gap.type,
  })) : [];

  const document: AlignmentDocument = {
    schemaVersion: '2.0.0',
    documentId: createDocumentId(request, result),
    reciterId: request.reciterId,
    providerId: result.providerId || request.providerId,
    providerVersion: result.providerVersion || 'unknown',
    requestedGranularity: request.granularity || 'word',
    sourceMethod: result.sourceMethod || result.providerId || request.providerId,
    providerVerified: result.providerVerified === true,
    audio: {
      contentHash: request.audio.contentHash,
      durationMs: request.audio.durationMs,
      sampleRate: request.audio.sampleRate || DEFAULT_SAMPLE_RATE,
      channels: request.audio.channels || DEFAULT_CHANNELS,
      sourceUrlOrAssetId: request.audio.sourceUrlOrAssetId || request.audio.contentHash,
    },
    reference: {
      surahNumber: request.reference.surahNumber,
      ayahRange: { from: request.reference.startAyah, to: request.reference.endAyah },
      ayahs: request.reference.ayahs.map((ayah) => ({ ...ayah })),
      quranTextVersion: request.reference.quranTextVersion || 'uthmani_hafs_v1',
      riwayah: request.reference.riwayah,
    },
    words,
    letters: normalizeSubspans(result.letters, words, warnings),
    phonemes: normalizeSubspans(result.phonemes, words, warnings),
    gaps,
    review: { status: 'unreviewed' },
    validationStatus: 'needs_review',
    diagnostics: {
      providerDiagnostics: result.diagnostics,
      normalizationWarnings: warnings,
      normalizationErrors: errors,
    },
    provenance: {
      providerId: result.providerId || request.providerId,
      providerVersion: result.providerVersion || 'unknown',
      sourceMethod: result.sourceMethod || result.providerId || request.providerId,
      audioContentHash: request.audio.contentHash,
      createdAt: new Date().toISOString(),
    },
  };

  const validation = validateAlignmentDocument(document, request);
  // Normalization warnings are part of the public validation result too; a
  // caller must not have to inspect an implementation-only diagnostics blob
  // to discover that a nested span was ambiguous.
  validation.warnings = [...warnings, ...validation.warnings];
  if (validation.valid && validation.warnings.length > 0 && validation.status === 'approved') {
    validation.status = 'needs_review';
  }
  document.validationStatus = validation.status;
  document.diagnostics = {
    ...document.diagnostics,
    validation: validation.diagnostics,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
  return { document, validation };
}

/** Validates normalized output without mutating it or inventing missing timings. */
export function validateAlignmentDocument(
  document: AlignmentDocument,
  request?: AlignmentRequest,
): AlignmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const words = Array.isArray(document?.words) ? document.words : [];
  const expectedKeys = request ? referenceKeys(request) : new Set<string>();
  const coveredKeys = new Set<string>();
  const occurrenceIds = new Set<string>();
  let monotonic = true;
  let nonOverlapping = true;
  let durationBounded = true;
  let confidenceTotal = 0;
  let minConfidence = words.length ? 1 : 0;

  if (!document || typeof document !== 'object') errors.push('alignment document is not an object');
  if (!document?.audio?.contentHash) errors.push('audio content hash is required');
  if (!finiteNumber(document?.audio?.durationMs) || document.audio.durationMs < 0) errors.push('audio duration is invalid');
  if (!document?.providerId) errors.push('provider id is required');
  if (!document?.reciterId) errors.push('reciter id is required');

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word.canonicalWordKey || !/^\d+:\d+:\d+$/.test(word.canonicalWordKey)) {
      errors.push(`word[${index}] canonical key is invalid`);
    }
    if (!word.displayToken) warnings.push(`word[${index}] display token is empty`);
    if (!finiteNumber(word.startMs) || !finiteNumber(word.endMs) || word.startMs < 0 || word.endMs <= word.startMs) {
      errors.push(`word[${index}] interval is invalid`);
    }
    if (index > 0 && finiteNumber(word.startMs) && finiteNumber(words[index - 1].startMs)) {
      if (word.startMs < words[index - 1].startMs) monotonic = false;
      if (word.startMs < words[index - 1].endMs) nonOverlapping = false;
    }
    if (finiteNumber(word.endMs) && finiteNumber(document?.audio?.durationMs) && word.endMs > document.audio.durationMs + DURATION_TOLERANCE_MS) {
      durationBounded = false;
    }
    if (!finiteNumber(word.confidence) || word.confidence < 0 || word.confidence > 1) {
      errors.push(`word[${index}] confidence is invalid`);
    }
    const confidence = normalizeConfidence(word.confidence);
    confidenceTotal += confidence;
    minConfidence = Math.min(minConfidence, confidence);
    if (coveredKeys.has(word.canonicalWordKey)) warnings.push(`repeated occurrence: ${word.canonicalWordKey}`);
    coveredKeys.add(word.canonicalWordKey);
    if (occurrenceIds.has(word.occurrenceId)) errors.push(`duplicate occurrence id: ${word.occurrenceId}`);
    occurrenceIds.add(word.occurrenceId);
  }

  if (!monotonic) errors.push('word intervals are not monotonic');
  if (!nonOverlapping) errors.push('word intervals overlap');
  if (!durationBounded) warnings.push('one or more words exceed the audio duration tolerance');
  if (words.length === 0) errors.push('alignment contains no word intervals');

  const requestedGranularity = document.requestedGranularity || 'word';
  if (requestedGranularity === 'letter' && (document.letters || []).length === 0) {
    errors.push('requested letter granularity has no explicit letter intervals');
  }
  if (requestedGranularity === 'phoneme' && (document.phonemes || []).length === 0) {
    errors.push('requested phoneme granularity has no explicit phoneme intervals');
  }

  const missingReferenceWordCount = expectedKeys.size
    ? [...expectedKeys].filter((key) => !coveredKeys.has(key)).length
    : 0;
  if (missingReferenceWordCount > 0) warnings.push(`${missingReferenceWordCount} reference words have no aligned occurrence`);
  if (document.gaps.some((gap) => !finiteNumber(gap.startMs) || !finiteNumber(gap.endMs) || gap.startMs < 0 || gap.endMs <= gap.startMs)) {
    errors.push('one or more gaps have invalid intervals');
  }

  const validateSubspans = (kind: 'letters' | 'phonemes', spans: AlignmentSubspan[]) => {
    const byOccurrence = new Map(words.map((word) => [word.occurrenceId, word]));
    const previousEndByParent = new Map<string, number>();
    spans.forEach((span, index) => {
      const parent = span.parentOccurrenceId ? byOccurrence.get(span.parentOccurrenceId) : undefined;
      const label = `${kind}[${index}]`;
      if (!parent) {
        warnings.push(`${label} has no matching parent occurrence`);
        return;
      }
      if (!finiteNumber(span.startMs) || !finiteNumber(span.endMs) || span.startMs >= span.endMs) {
        errors.push(`${label} interval is invalid`);
        return;
      }
      if (span.startMs < parent.startMs || span.endMs > parent.endMs) {
        errors.push(`${label} falls outside parent word ${parent.occurrenceId}`);
      }
      const previousEnd = previousEndByParent.get(parent.occurrenceId);
      if (previousEnd !== undefined && span.startMs < previousEnd) {
        errors.push(`${label} overlaps a prior ${kind.slice(0, -1)} on ${parent.occurrenceId}`);
      }
      previousEndByParent.set(parent.occurrenceId, Math.max(previousEnd || parent.startMs, span.endMs));
      if (!finiteNumber(span.confidence) || span.confidence < 0 || span.confidence > 1) {
        warnings.push(`${label} confidence is invalid`);
      }
    });
  };
  validateSubspans('letters', document.letters || []);
  validateSubspans('phonemes', document.phonemes || []);

  const meanConfidence = words.length ? confidenceTotal / words.length : 0;
  const structuralValid = errors.length === 0;
  let status: AlignmentValidationStatus = 'approved';
  if (!structuralValid) status = 'rejected';
  else if (document.review?.status === 'rejected') status = 'rejected';
  else if (missingReferenceWordCount > 0 || warnings.length > 0) status = 'needs_review';
  else if (meanConfidence < LOW_CONFIDENCE_THRESHOLD || minConfidence < MIN_CONFIDENCE_THRESHOLD) status = 'low_confidence';
  else if (document.review?.status === 'approved' || document.providerVerified) status = 'approved';
  else status = 'needs_review';

  return {
    valid: structuralValid,
    status,
    errors,
    warnings,
    diagnostics: {
      wordCount: words.length,
      expectedWordCount: expectedKeys.size,
      coveredReferenceWordCount: coveredKeys.size,
      missingReferenceWordCount,
      duplicateOccurrenceCount: Math.max(0, words.length - coveredKeys.size),
      meanConfidence,
      minConfidence,
      monotonic,
      nonOverlapping,
      durationBounded,
    },
  };
}

/**
 * Converts the canonical server document to AyahX's existing client/render
 * TimingMap contract. This is intentionally a projection; the richer v2
 * document remains the source of truth for provenance and review state.
 */
export function alignmentDocumentToTimingMap(document: AlignmentDocument): TimingMap {
  const subsegmentsFor = (word: AlignmentWord, kind: 'letters' | 'phonemes'): TimingSubsegment[] | undefined => {
    const source = kind === 'letters' ? document.letters : document.phonemes;
    const matching = source.filter((span) => span.parentOccurrenceId === word.occurrenceId)
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
    if (matching.length === 0) return undefined;
    return matching.map((span, index) => ({
      occurrenceId: `${word.occurrenceId}:${kind.slice(0, -1)}:${index + 1}`,
      token: span.label,
      startMs: span.startMs,
      endMs: span.endMs,
      confidence: span.confidence,
    }));
  };
  const words: TimingWord[] = document.words.map((word) => ({
    canonicalWordKey: word.canonicalWordKey,
    occurrenceId: word.occurrenceId,
    displayWordIndex: word.displayWordIndex,
    displayToken: word.displayToken,
    normalizedAlignmentToken: word.normalizedAlignmentToken,
    startMs: word.startMs,
    endMs: word.endMs,
    confidence: word.confidence,
    letters: subsegmentsFor(word, 'letters'),
    phonemes: subsegmentsFor(word, 'phonemes'),
    flags: word.flags,
  }));
  const provider = (document.providerId || 'unknown') as AlignmentProviderId;
  const availableGranularities: AlignmentGranularity[] = ['word'];
  if (document.letters.length > 0) availableGranularities.push('letter');
  if (document.phonemes.length > 0) availableGranularities.push('phoneme');
  const alignment: AlignmentProvenance = {
    provider,
    providerVersion: document.providerVersion,
    requestedGranularity: document.requestedGranularity || (document.letters.length > 0 ? 'letter' : 'word'),
    availableGranularities,
    inputAudioSha256: document.audio.contentHash,
    quranEdition: document.reference.quranTextVersion,
    riwayah: document.reference.riwayah,
    createdBy: document.provenance.sourceMethod === 'manual_override' ? 'manual_review' : 'provider',
    parentMapId: document.parentDocumentId,
  };
  // An authenticated, complete first-party result is independently attested
  // by the provider. Preserve an unreviewed state in the immutable document
  // for audit, but do not project it as a client review downgrade; otherwise a
  // mathematically approved QF map would become unapproved merely by crossing
  // the document-to-render boundary. Any non-approved validation state still
  // keeps its review marker and remains non-renderable word timing.
  const projectedReview = document.providerVerified
    && document.validationStatus === 'approved'
    && document.review?.status === 'unreviewed'
    ? undefined
    : document.review;
  return {
    schemaVersion: '2.0.0',
    mapId: document.documentId,
    reciterId: document.reciterId,
    sourceId: document.providerId,
    sourceUrlOrImmutableAssetId: document.audio.sourceUrlOrAssetId,
    audioContentHash: document.audio.contentHash,
    decodedDurationMs: document.audio.durationMs,
    sampleRate: document.audio.sampleRate,
    channels: document.audio.channels,
    audioProcessingVersion: 'alignment-v2',
    surahNumber: document.reference.surahNumber,
    ayahRange: document.reference.ayahRange,
    quranTextVersion: document.reference.quranTextVersion,
    segmentationVersion: 'alignment-v2',
    alignerVersion: `${document.providerId}@${document.providerVersion}`,
    sourceMethod: document.sourceMethod === 'quran_foundation_segments'
      ? 'quran_foundation_segments'
      : document.sourceMethod === 'manual_override'
      ? 'manual_override'
      : document.providerVerified
      ? 'verified_dataset'
      : 'forced_alignment',
    validationStatus: document.validationStatus,
    alignment,
    review: projectedReview,
    createdAt: document.provenance.createdAt,
    words,
    gaps: document.gaps,
    diagnostics: document.diagnostics,
  };
}

/**
 * Pure adapter for Quran Foundation's v4 `[word, start, end]` segments. It
 * does not perform network access; the existing quranFoundationService or a
 * caller-provided job owns fetching and authentication.
 */
export function quranFoundationResultFromTimestamps(params: {
  providerVersion?: string;
  timestamps: Array<{
    verse_key: string;
    timestamp_from: number;
    timestamp_to: number;
    segments?: [number, number, number][];
  }>;
  ayahs: AlignmentReferenceAyah[];
  surahNumber: number;
  sourceMethod?: string;
  /** Set only by a trusted server-side Quran Foundation fetch. */
  providerVerified?: boolean;
}): AlignmentProviderResult {
  const words: ProviderWordSpan[] = [];
  const gaps: ProviderGap[] = [];
  for (const timestamp of params.timestamps) {
    const [, ayahText] = timestamp.verse_key.split(':');
    const ayahNumber = Number(ayahText);
    const ayah = params.ayahs.find((item) => item.numberInSurah === ayahNumber);
    const tokens = ayah?.text.split(/\s+/).filter(Boolean) || [];
    const segments = Array.isArray(timestamp.segments) ? timestamp.segments : [];
    for (const segment of segments) {
      const [wordIndex1Based, startMs, endMs] = segment;
      const token = tokens[wordIndex1Based - 1] || '';
      words.push({
        canonicalWordKey: `${params.surahNumber}:${ayahNumber}:${wordIndex1Based}`,
        ayahNumber,
        wordIndex1Based,
        displayToken: token,
        startMs,
        endMs,
        confidence: 1,
      });
    }
    if (segments.length > 0) {
      const lastEnd = segments[segments.length - 1][2];
      if (timestamp.timestamp_to > lastEnd + 80) {
        gaps.push({
          startMs: lastEnd,
          endMs: timestamp.timestamp_to,
          type: 'waqf',
        });
      }
    }
  }
  return {
    providerId: 'quran_foundation',
    providerVersion: params.providerVersion || 'qdc-v4',
    sourceMethod: params.sourceMethod || 'quran_foundation_segments',
    providerVerified: params.providerVerified === true,
    words,
    gaps,
  };
}

/** Explicit provider registry. Missing providers fail; there is no implicit fallback. */
export class AlignmentProviderRegistry {
  private readonly providers = new Map<string, AlignmentProvider>();

  register(provider: AlignmentProvider): this {
    if (!provider || !provider.id || typeof provider.align !== 'function') {
      throw new Error('ALIGNMENT_PROVIDER_INVALID');
    }
    if (this.providers.has(provider.id)) throw new Error(`ALIGNMENT_PROVIDER_DUPLICATE:${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  get(providerId: string): AlignmentProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`ALIGNMENT_PROVIDER_NOT_REGISTERED:${providerId}`);
    return provider;
  }

  list(): AlignmentProvider[] {
    return [...this.providers.values()];
  }
}

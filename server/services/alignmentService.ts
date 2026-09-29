/**
 * Alignment orchestration for AyahX.
 *
 * This module is deliberately explicit about provider choice.  A missing or
 * unavailable provider is an error; the service never silently switches to a
 * different model, a proportional timer, or a different audio asset.
 */

import crypto from 'crypto';
import {
  AlignmentDocument,
  AlignmentGranularity,
  AlignmentProvider,
  AlignmentProviderRegistry,
  AlignmentProviderResult,
  AlignmentRequest,
  AlignmentReferenceAyah,
  AlignmentValidationResult,
  ProviderGap,
  ProviderSubspan,
  ProviderWordSpan,
  alignmentDocumentToTimingMap,
  normalizeAlignmentResult,
  validateAlignmentDocument,
} from './alignmentProvider';
import { fingerprintTrustedQuranAudio } from './audioFingerprintService';
import { fetchQuranFoundationContentStrict } from './quranFoundationService';
import { validateUrlForSsrf } from './assetCatalogResolver';
import type { AlignmentReview, TimingMap } from '../../src/lib/timingMap';

export type AlignmentProviderKey =
  | 'quran_foundation'
  | 'manual'
  | 'internal_ctc'
  | 'quranic_universal_aligner'
  | 'lafzize'
  | 'verified_dataset';

export interface AlignmentProviderDescriptor {
  id: AlignmentProviderKey;
  label: string;
  configured: boolean;
  supports: AlignmentGranularity[];
  requiresHumanReview: boolean;
  legalStatus: 'first_party_data' | 'internal_only' | 'external_review_required' | 'disabled';
  unavailableReason?: string;
}

export interface AlignmentRunResult {
  document: AlignmentDocument;
  timingMap: TimingMap;
  validation: AlignmentValidationResult;
}

export interface AlignmentRevision {
  occurrenceId?: string;
  canonicalWordKey?: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

const MAX_REFERENCE_AYAHS = 300;
const MAX_PROVIDER_WORDS = 20_000;
const MAX_PROVIDER_INPUT_BYTES = 12 * 1024 * 1024;
const QF_VERSE_BOUNDARY_TOLERANCE_MS = 250;

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function nonEmptyString(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`ALIGNMENT_${field.toUpperCase()}_INVALID`);
  }
  return value.trim();
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertProviderInputSize(value: unknown): void {
  if (value === undefined) return;
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('ALIGNMENT_PROVIDER_INPUT_INVALID');
  }
  if (encoded.length > MAX_PROVIDER_INPUT_BYTES) throw new Error('ALIGNMENT_PROVIDER_INPUT_TOO_LARGE');
}

type QuranFoundationTimestamp = {
  verse_key: string;
  timestamp_from: number;
  timestamp_to: number;
  segments?: [number, number, number][];
};

/**
 * Normalizes the documented QF triplets while ignoring legacy marker rows
 * such as `[1]`.  Those rows have no end time and therefore can never become
 * a word event.  A later coverage check still rejects the response if a real
 * Quran word is missing its complete interval.
 */
function normalizeTimestampInput(
  value: unknown,
  ignoredSegmentDiagnostics?: string[],
): QuranFoundationTimestamp[] {
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_WORDS) {
    throw new Error('ALIGNMENT_QF_TIMESTAMPS_REQUIRED');
  }
  return value.map((item, index) => {
    const row = record(item);
    const verseKey = nonEmptyString(row.verse_key, `qf_timestamp_${index}_verse_key`, 32);
    const from = Number(row.timestamp_from);
    const to = Number(row.timestamp_to);
    if (!finite(from) || !finite(to) || from < 0 || to <= from) {
      throw new Error(`ALIGNMENT_QF_TIMESTAMP_${index}_INVALID`);
    }
    let segments: [number, number, number][] | undefined;
    if (row.segments !== undefined) {
      if (!Array.isArray(row.segments) || row.segments.length > MAX_PROVIDER_WORDS) {
        throw new Error(`ALIGNMENT_QF_SEGMENTS_${index}_INVALID`);
      }
      segments = [];
      row.segments.forEach((segment: unknown, segmentIndex: number) => {
        // QF's public data contains occasional one-value marker records. They
        // do not describe a word span and must be excluded, never guessed.
        if (!Array.isArray(segment) || segment.length < 3) {
          ignoredSegmentDiagnostics?.push(`${verseKey}[${segmentIndex}]`);
          return;
        }
        if (segment.length !== 3) {
          throw new Error(`ALIGNMENT_QF_SEGMENT_${index}_${segmentIndex}_INVALID`);
        }
        const wordIndex = Number(segment[0]);
        const start = Number(segment[1]);
        const end = Number(segment[2]);
        if (!Number.isInteger(wordIndex) || wordIndex < 1 || !finite(start) || !finite(end) || start < 0 || end <= start) {
          throw new Error(`ALIGNMENT_QF_SEGMENT_${index}_${segmentIndex}_INVALID`);
        }
        segments!.push([wordIndex, start, end]);
      });
    }
    return { verse_key: verseKey, timestamp_from: from, timestamp_to: to, segments };
  });
}

function normalizeProviderWords(value: unknown): ProviderWordSpan[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROVIDER_WORDS) {
    throw new Error('ALIGNMENT_PROVIDER_WORDS_REQUIRED');
  }
  return value.map((item, index) => {
    const row = record(item);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    if (!finite(startMs) || !finite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error(`ALIGNMENT_WORD_${index}_INTERVAL_INVALID`);
    }
    const span: ProviderWordSpan = {
      canonicalWordKey: typeof row.canonicalWordKey === 'string' ? row.canonicalWordKey : undefined,
      ayahNumber: finite(Number(row.ayahNumber)) ? Number(row.ayahNumber) : undefined,
      wordIndex1Based: finite(Number(row.wordIndex1Based)) ? Number(row.wordIndex1Based) : undefined,
      displayToken: typeof row.displayToken === 'string' ? row.displayToken : undefined,
      normalizedAlignmentToken: typeof row.normalizedAlignmentToken === 'string' ? row.normalizedAlignmentToken : undefined,
      startMs,
      endMs,
      confidence: row.confidence === undefined ? undefined : Number(row.confidence),
      flags: Array.isArray(row.flags) ? row.flags.filter((flag: unknown): flag is string => typeof flag === 'string').slice(0, 32) : undefined,
    };
    return span;
  });
}

function normalizeSubspanInput(value: unknown): ProviderSubspan[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_WORDS * 8) throw new Error('ALIGNMENT_SUBSEGMENTS_INVALID');
  return value.map((item, index) => {
    const row = record(item);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    if (!finite(startMs) || !finite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error(`ALIGNMENT_SUBSEGMENT_${index}_INTERVAL_INVALID`);
    }
    return {
      parentWordKey: typeof row.parentWordKey === 'string' ? row.parentWordKey : undefined,
      parentOccurrenceId: typeof row.parentOccurrenceId === 'string' ? row.parentOccurrenceId : undefined,
      label: typeof row.label === 'string' ? row.label.slice(0, 120) : '',
      startMs,
      endMs,
      confidence: row.confidence === undefined ? undefined : Number(row.confidence),
    };
  });
}

function normalizeGaps(value: unknown): ProviderGap[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_WORDS) throw new Error('ALIGNMENT_GAPS_INVALID');
  const allowed = new Set<ProviderGap['type']>(['silence', 'waqf', 'breath', 'intro', 'outro']);
  return value.map((item, index) => {
    const row = record(item);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    const type = row.type as ProviderGap['type'];
    if (!finite(startMs) || !finite(endMs) || startMs < 0 || endMs <= startMs || !allowed.has(type)) {
      throw new Error(`ALIGNMENT_GAP_${index}_INVALID`);
    }
    return { startMs, endMs, type };
  });
}

function parseQuranFoundationRecitationId(value: unknown): number {
  const recitationId = Number(value);
  if (!Number.isInteger(recitationId) || recitationId < 1 || recitationId > 1_000_000) {
    throw new Error('ALIGNMENT_QF_RECITATION_ID_INVALID');
  }
  return recitationId;
}

function quranFoundationAudioPayload(data: unknown): {
  audioUrl: string;
  timestamps: QuranFoundationTimestamp[];
  ignoredSegments: string[];
  durationMs?: number;
} {
  const root = record(data);
  const audioFile = record(root.audio_file ?? root.audioFile ?? root);
  const audioUrl = nonEmptyString(audioFile.audio_url ?? audioFile.audioUrl, 'qf_audio_url', 2_048);
  const ignoredSegments: string[] = [];
  const timestamps = normalizeTimestampInput(audioFile.timestamps, ignoredSegments);
  const rawDuration = Number(audioFile.duration_ms ?? audioFile.durationMs ?? audioFile.duration);
  return {
    audioUrl,
    timestamps,
    ignoredSegments,
    durationMs: finite(rawDuration) && rawDuration > 0 ? rawDuration : undefined,
  };
}

/**
 * QF responds with some historical marker rows that are not timing triplets.
 * This checker proves that the remaining triplets fully cover the requested
 * Uthmani text, stay within each verse's tolerance window, and form one
 * monotonic word sequence.  A partial response is deliberately rejected
 * rather than promoted to a polished-looking approximate animation.
 */
function requireCompleteQuranFoundationCoverage(
  timestamps: QuranFoundationTimestamp[],
  request: AlignmentRequest,
): QuranFoundationTimestamp[] {
  const byVerseKey = new Map(timestamps.map((timestamp) => [timestamp.verse_key, timestamp]));
  const selected: QuranFoundationTimestamp[] = [];
  let previousEnd = -1;

  for (const ayah of request.reference.ayahs) {
    const verseKey = `${request.reference.surahNumber}:${ayah.numberInSurah}`;
    const timestamp = byVerseKey.get(verseKey);
    if (!timestamp) throw new Error(`QF_STRICT_TIMESTAMP_MISSING:${verseKey}`);

    const expectedWordCount = ayah.text.split(/\s+/).filter(Boolean).length;
    const segments = [...(timestamp.segments || [])].sort((left, right) => left[1] - right[1] || left[2] - right[2]);
    if (expectedWordCount === 0 || segments.length === 0) {
      throw new Error(`QF_STRICT_SEGMENT_COVERAGE:${verseKey}`);
    }

    const seenWordIndexes = new Set<number>();
    for (const [segmentPosition, [wordIndex, startMs, endMs]] of segments.entries()) {
      if (wordIndex > expectedWordCount || seenWordIndexes.has(wordIndex)) {
        throw new Error(`QF_STRICT_SEGMENT_WORD_INDEX_INVALID:${verseKey}:${wordIndex}`);
      }
      if (wordIndex !== segmentPosition + 1) {
        throw new Error(`QF_STRICT_SEGMENT_WORD_ORDER_INVALID:${verseKey}:${wordIndex}`);
      }
      if (startMs < timestamp.timestamp_from - QF_VERSE_BOUNDARY_TOLERANCE_MS
        || endMs > timestamp.timestamp_to + QF_VERSE_BOUNDARY_TOLERANCE_MS) {
        throw new Error(`QF_STRICT_SEGMENT_OUTSIDE_VERSE:${verseKey}:${wordIndex}`);
      }
      if (previousEnd >= 0 && startMs < previousEnd) {
        throw new Error(`QF_STRICT_SEGMENTS_NON_MONOTONIC:${verseKey}:${wordIndex}`);
      }
      seenWordIndexes.add(wordIndex);
      previousEnd = endMs;
    }
    for (let wordIndex = 1; wordIndex <= expectedWordCount; wordIndex += 1) {
      if (!seenWordIndexes.has(wordIndex)) {
        throw new Error(`QF_STRICT_SEGMENT_COVERAGE:${verseKey}:${wordIndex}`);
      }
    }
    selected.push({ ...timestamp, segments });
  }

  return selected;
}

/**
 * Hydrates the QF provider request from the authenticated upstream response.
 * Client-side timestamps, URLs, byte hashes, and durations are ignored: only
 * the server-fetched response and the streamed SHA-256 identity can attest a
 * QF result as approved.
 */
async function hydrateQuranFoundationRequest(request: AlignmentRequest): Promise<AlignmentRequest> {
  const input = record(request.providerInput);
  const recitationId = parseQuranFoundationRecitationId(input.recitationId ?? input.quranFoundationRecitationId);
  const upstream = await fetchQuranFoundationContentStrict(
    `/chapter_recitations/${recitationId}/${request.reference.surahNumber}`,
    { segments: 'true' },
  );
  const payload = quranFoundationAudioPayload(upstream);
  const timestamps = requireCompleteQuranFoundationCoverage(payload.timestamps, request);
  const fingerprint = await fingerprintTrustedQuranAudio(payload.audioUrl);
  const maxTimestamp = Math.max(...timestamps.map((timestamp) => timestamp.timestamp_to));
  const durationMs = Math.max(payload.durationMs || 0, maxTimestamp);
  if (!finite(durationMs) || durationMs <= 0) throw new Error('QF_STRICT_AUDIO_DURATION_INVALID');

  return {
    ...request,
    audio: {
      contentHash: fingerprint.sha256,
      durationMs,
      sampleRate: 44_100,
      channels: 2,
      sourceUrlOrAssetId: fingerprint.sourceUrl,
    },
    providerInput: {
      recitationId,
      timestamps,
      providerVersion: 'qdc-v4-segments-v1',
      serverAttested: true,
      ignoredLegacySegmentMarkers: payload.ignoredSegments.length,
      upstreamAudioUrl: fingerprint.sourceUrl,
    },
  };
}

function quranFoundationProvider(): AlignmentProvider {
  return {
    id: 'quran_foundation',
    version: 'qdc-v4-segments-v1',
    async align(request): Promise<AlignmentProviderResult> {
      if ((request.granularity || 'word') !== 'word') {
        throw new Error('ALIGNMENT_GRANULARITY_NOT_SUPPORTED:quran_foundation');
      }
      const input = record(request.providerInput);
      if (input.serverAttested !== true) {
        throw new Error('QF_STRICT_SERVER_ATTESTATION_REQUIRED');
      }
      const ignoredSegments: string[] = [];
      const timestamps = normalizeTimestampInput(input.timestamps ?? input.qfTimestamps, ignoredSegments);
      const completeTimestamps = requireCompleteQuranFoundationCoverage(timestamps, request);
      const result = (await import('./alignmentProvider')).quranFoundationResultFromTimestamps({
        providerVersion: typeof input.providerVersion === 'string' ? input.providerVersion : 'qdc-v4',
        timestamps: completeTimestamps,
        ayahs: request.reference.ayahs,
        surahNumber: request.reference.surahNumber,
        sourceMethod: 'quran_foundation_segments',
        providerVerified: true,
      });
      result.diagnostics = {
        ...(result.diagnostics || {}),
        recitationId: input.recitationId,
        ignoredLegacySegmentMarkers: Number(input.ignoredLegacySegmentMarkers || 0) + ignoredSegments.length,
        serverAttested: true,
      };
      return result;
    },
  };
}

function manualProvider(): AlignmentProvider {
  return {
    id: 'manual',
    version: 'manual-input-v1',
    async align(request): Promise<AlignmentProviderResult> {
      const input = record(request.providerInput);
      return {
        providerId: 'manual',
        providerVersion: typeof input.providerVersion === 'string' ? input.providerVersion : 'manual-input-v1',
        sourceMethod: 'manual_override',
        providerVerified: false,
        words: normalizeProviderWords(input.words),
        letters: normalizeSubspanInput(input.letters),
        phonemes: normalizeSubspanInput(input.phonemes),
        gaps: normalizeGaps(input.gaps),
        diagnostics: { source: 'explicit_manual_input' },
      };
    },
  };
}

function verifiedDatasetProvider(): AlignmentProvider {
  return {
    id: 'verified_dataset',
    version: 'dataset-import-v1',
    async align(request): Promise<AlignmentProviderResult> {
      if (process.env.ALIGNMENT_VERIFIED_DATASET_ENABLED !== 'true') {
        throw new Error('ALIGNMENT_PROVIDER_NOT_CONFIGURED:verified_dataset');
      }
      const input = record(request.providerInput);
      const words = normalizeProviderWords(input.words);
      if (input.attestation !== process.env.ALIGNMENT_VERIFIED_DATASET_ATTESTATION) {
        throw new Error('ALIGNMENT_DATASET_ATTESTATION_REQUIRED');
      }
      return {
        providerId: 'verified_dataset',
        providerVersion: typeof input.providerVersion === 'string' ? input.providerVersion : 'dataset-import-v1',
        sourceMethod: 'verified_dataset',
        providerVerified: true,
        words,
        letters: normalizeSubspanInput(input.letters),
        phonemes: normalizeSubspanInput(input.phonemes),
        gaps: normalizeGaps(input.gaps),
        diagnostics: { source: 'attested_dataset_import' },
      };
    },
  };
}

const externalProviderConfig: Record<Exclude<AlignmentProviderKey, 'quran_foundation' | 'manual' | 'verified_dataset'>, {
  envUrl: string;
  altEnvUrl?: string;
  tokenEnv?: string;
  version: string;
}> = {
  internal_ctc: { envUrl: 'ALIGNMENT_INTERNAL_CTC_URL', tokenEnv: 'ALIGNMENT_INTERNAL_CTC_TOKEN', version: 'internal-ctc-v1' },
  quranic_universal_aligner: { envUrl: 'QUA_ALIGNER_API_URL', altEnvUrl: 'QUA_ALIGNER_URL', tokenEnv: 'QUA_ALIGNER_API_TOKEN', version: 'qua-adapter-v1' },
  lafzize: { envUrl: 'LAFZIZE_API_URL', altEnvUrl: 'LAFZIZE_URL', tokenEnv: 'LAFZIZE_API_TOKEN', version: 'lafzize-adapter-v1' },
};

function externalProvider(id: Exclude<AlignmentProviderKey, 'quran_foundation' | 'manual' | 'verified_dataset'>): AlignmentProvider {
  const config = externalProviderConfig[id];
  return {
    id,
    version: config.version,
    async align(request): Promise<AlignmentProviderResult> {
      if (id === 'internal_ctc' && (request.granularity || 'word') !== 'word') {
        throw new Error('ALIGNMENT_GRANULARITY_NOT_SUPPORTED:internal_ctc');
      }
      if (id === 'lafzize' && process.env.LAFZIZE_LICENSE_REVIEW_APPROVED !== 'true') {
        throw new Error('ALIGNMENT_PROVIDER_LICENSE_REVIEW_REQUIRED:lafzize');
      }
      const endpoint = process.env[config.envUrl] || (config.altEnvUrl ? process.env[config.altEnvUrl] : undefined);
      if (!endpoint) throw new Error(`ALIGNMENT_PROVIDER_NOT_CONFIGURED:${id}`);
      let parsed: URL;
      try {
        parsed = new URL(endpoint);
      } catch {
        throw new Error(`ALIGNMENT_PROVIDER_ENDPOINT_INVALID:${id}`);
      }
      const isRailwayPrivateEndpoint = parsed.hostname.toLowerCase().endsWith('.railway.internal');
      const allowsPrivateHttp = id === 'internal_ctc' && isRailwayPrivateEndpoint && parsed.protocol === 'http:';
      const allowsLocalDevelopmentHttp = process.env.NODE_ENV !== 'production'
        && parsed.protocol === 'http:'
        && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
      if (parsed.protocol !== 'https:' && !allowsPrivateHttp && !allowsLocalDevelopmentHttp) {
        throw new Error(`ALIGNMENT_PROVIDER_ENDPOINT_MUST_USE_HTTPS:${id}`);
      }
      if (parsed.username || parsed.password) throw new Error(`ALIGNMENT_PROVIDER_ENDPOINT_CREDENTIALS_NOT_ALLOWED:${id}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
        const token = config.tokenEnv ? process.env[config.tokenEnv] : undefined;
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(parsed, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            providerId: id,
            reciterId: request.reciterId,
            audio: request.audio,
            reference: request.reference,
            granularity: request.granularity || 'word',
            providerInput: request.providerInput,
          }),
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`ALIGNMENT_PROVIDER_HTTP_${response.status}:${id}`);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_INPUT_BYTES) {
          throw new Error(`ALIGNMENT_PROVIDER_RESPONSE_TOO_LARGE:${id}`);
        }
        const rawBody = await response.text();
        if (Buffer.byteLength(rawBody, 'utf8') > MAX_PROVIDER_INPUT_BYTES) {
          throw new Error(`ALIGNMENT_PROVIDER_RESPONSE_TOO_LARGE:${id}`);
        }
        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new Error(`ALIGNMENT_PROVIDER_RESPONSE_INVALID:${id}`);
        }
        const result = body?.result || body;
        if (!result || !Array.isArray(result.words)) throw new Error(`ALIGNMENT_PROVIDER_RESPONSE_INVALID:${id}`);
        return {
          providerId: id,
          providerVersion: result.providerVersion || config.version,
          sourceMethod: result.sourceMethod || 'forced_alignment',
          // An HTTP adapter is not a first-party attestation boundary.  Even
          // if a remote service claims `providerVerified`, AyahX requires a
          // human review or the separately attested dataset path before the
          // result can drive exact animation.
          providerVerified: false,
          words: normalizeProviderWords(result.words),
          letters: normalizeSubspanInput(result.letters),
          phonemes: normalizeSubspanInput(result.phonemes),
          gaps: normalizeGaps(result.gaps),
          diagnostics: {
            ...(record(result.diagnostics)),
            remoteProviderVerifiedClaimIgnored: result.providerVerified === true,
          },
        };
      } catch (error: any) {
        if (error?.name === 'AbortError') throw new Error(`ALIGNMENT_PROVIDER_TIMEOUT:${id}`);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

let defaultRegistry: AlignmentProviderRegistry | null = null;

export function getAlignmentProviderRegistry(): AlignmentProviderRegistry {
  if (defaultRegistry) return defaultRegistry;
  defaultRegistry = new AlignmentProviderRegistry()
    .register(manualProvider())
    .register(verifiedDatasetProvider())
    .register(externalProvider('internal_ctc'))
    .register(externalProvider('quranic_universal_aligner'))
    .register(externalProvider('lafzize'));
  return defaultRegistry;
}

export function getAlignmentProviderDescriptors(): AlignmentProviderDescriptor[] {
  const external = (id: 'internal_ctc' | 'quranic_universal_aligner' | 'lafzize'): AlignmentProviderDescriptor => {
    const config = externalProviderConfig[id];
    const endpointConfigured = Boolean(process.env[config.envUrl] || (config.altEnvUrl && process.env[config.altEnvUrl]));
    const licenseApproved = id !== 'lafzize' || process.env.LAFZIZE_LICENSE_REVIEW_APPROVED === 'true';
    const configured = endpointConfigured && licenseApproved;
    return {
      id,
      label: id === 'internal_ctc' ? 'AyahX Internal CTC' : id === 'quranic_universal_aligner' ? 'Quranic Universal Aligner' : 'Lafzize adapter',
      configured,
      // The bundled CTC adapter produces word spans. Letter/phoneme timing is
      // accepted only from an explicitly configured adapter that can attest
      // those subsegments; advertising unsupported granularities would invite
      // a caller to mistake token frames for phonemes.
      supports: id === 'internal_ctc' ? ['word'] : ['word', 'letter', 'phoneme'],
      requiresHumanReview: true,
      legalStatus: id === 'internal_ctc' ? 'internal_only' : 'external_review_required',
      ...(configured ? {} : { unavailableReason: !licenseApproved ? 'يتطلب Lafzize مراجعة ترخيص صريحة قبل تفعيله' : 'لم يتم تهيئة نقطة الخدمة في بيئة التشغيل' }),
    };
  };
  return [
    {
      id: 'manual',
      label: 'مراجعة يدوية',
      configured: true,
      supports: ['word', 'letter', 'phoneme'],
      requiresHumanReview: true,
      legalStatus: 'internal_only',
    },
    {
      id: 'verified_dataset',
      label: 'Verified dataset import',
      configured: process.env.ALIGNMENT_VERIFIED_DATASET_ENABLED === 'true',
      supports: ['word', 'letter', 'phoneme'],
      requiresHumanReview: false,
      legalStatus: process.env.ALIGNMENT_VERIFIED_DATASET_ENABLED === 'true' ? 'internal_only' : 'disabled',
      ...(process.env.ALIGNMENT_VERIFIED_DATASET_ENABLED === 'true' ? {} : { unavailableReason: 'يتطلب تفعيل استيراد dataset مع attestation صريح' }),
    },
    external('internal_ctc'),
    external('quranic_universal_aligner'),
    external('lafzize'),
  ];
}

function buildReferenceRequest(input: any): AlignmentRequest {
  const reference = record(input.reference);
  const audio = record(input.audio);
  const providerId = nonEmptyString(input.providerId, 'provider_id', 80) as AlignmentProviderKey;
  const ayahs = Array.isArray(reference.ayahs) ? reference.ayahs : [];
  if (ayahs.length === 0 || ayahs.length > MAX_REFERENCE_AYAHS) throw new Error('ALIGNMENT_REFERENCE_AYAHS_REQUIRED');
  const normalizedAyahs: AlignmentReferenceAyah[] = ayahs.map((ayah: unknown, index: number) => {
    const row = record(ayah);
    const numberInSurah = Number(row.numberInSurah);
    const text = nonEmptyString(row.text, `reference_ayah_${index}_text`, 4_000);
    if (!Number.isInteger(numberInSurah) || numberInSurah < 1 || numberInSurah > 300) {
      throw new Error(`ALIGNMENT_REFERENCE_AYAH_${index}_NUMBER_INVALID`);
    }
    return { numberInSurah, text };
  });
  const surahNumber = Number(reference.surahNumber);
  const startAyah = Number(reference.startAyah);
  const endAyah = Number(reference.endAyah);
  if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114
    || !Number.isInteger(startAyah) || !Number.isInteger(endAyah) || startAyah < 1 || endAyah < startAyah) {
    throw new Error('ALIGNMENT_REFERENCE_RANGE_INVALID');
  }
  const expectedAyahCount = endAyah - startAyah + 1;
  if (expectedAyahCount > MAX_REFERENCE_AYAHS || normalizedAyahs.length !== expectedAyahCount) {
    throw new Error('ALIGNMENT_REFERENCE_AYAHS_INCOMPLETE');
  }
  const referenceNumbers = new Set<number>();
  for (const ayah of normalizedAyahs) {
    if (ayah.numberInSurah < startAyah || ayah.numberInSurah > endAyah || referenceNumbers.has(ayah.numberInSurah)) {
      throw new Error('ALIGNMENT_REFERENCE_AYAHS_INVALID');
    }
    referenceNumbers.add(ayah.numberInSurah);
  }
  for (let ayahNumber = startAyah; ayahNumber <= endAyah; ayahNumber += 1) {
    if (!referenceNumbers.has(ayahNumber)) throw new Error('ALIGNMENT_REFERENCE_AYAHS_INCOMPLETE');
  }
  normalizedAyahs.sort((left, right) => left.numberInSurah - right.numberInSurah);
  let durationMs: number;
  let contentHash: string;
  let sourceUrlOrAssetId: string;
  if (providerId === 'quran_foundation') {
    // The initial request intentionally contains no client-attested audio
    // identity. `hydrateQuranFoundationRequest` replaces these placeholders
    // with the authenticated QF URL and a streamed server SHA-256.
    parseQuranFoundationRecitationId(record(input.providerInput).recitationId ?? record(input.providerInput).quranFoundationRecitationId);
    durationMs = 1;
    contentHash = 'pending-qf-server-fingerprint';
    sourceUrlOrAssetId = 'asset:pending-qf-server-fetch';
  } else {
    durationMs = Number(audio.durationMs);
    if (!finite(durationMs) || durationMs <= 0 || durationMs > 3_600_000) throw new Error('ALIGNMENT_AUDIO_DURATION_INVALID');
    contentHash = nonEmptyString(audio.contentHash, 'audio_content_hash', 256);
    sourceUrlOrAssetId = nonEmptyString(audio.sourceUrlOrAssetId || contentHash, 'audio_source', 2_048);
    if (/^(blob:|data:|javascript:)/i.test(sourceUrlOrAssetId)) throw new Error('ALIGNMENT_AUDIO_SOURCE_UNSAFE');
    if (/^http:\/\//i.test(sourceUrlOrAssetId) && process.env.NODE_ENV === 'production') {
      throw new Error('ALIGNMENT_AUDIO_SOURCE_MUST_USE_HTTPS');
    }
    if (/^https:\/\//i.test(sourceUrlOrAssetId)) {
      const urlSafety = validateUrlForSsrf(sourceUrlOrAssetId);
      if (!urlSafety.safe) throw new Error(`ALIGNMENT_AUDIO_SOURCE_UNSAFE:${urlSafety.reason || 'unknown'}`);
    } else if (!/^asset:/i.test(sourceUrlOrAssetId)) {
      throw new Error('ALIGNMENT_AUDIO_SOURCE_UNSAFE');
    }
  }
  const granularity = (input.granularity || 'word') as AlignmentGranularity;
  if (!['word', 'letter', 'phoneme'].includes(granularity)) throw new Error('ALIGNMENT_GRANULARITY_INVALID');
  return {
    jobId: typeof input.jobId === 'string' ? input.jobId.slice(0, 128) : undefined,
    providerId,
    reciterId: nonEmptyString(input.reciterId, 'reciter_id', 128),
    audio: {
      contentHash,
      durationMs,
      sampleRate: audio.sampleRate === undefined ? undefined : Number(audio.sampleRate),
      channels: audio.channels === undefined ? undefined : Number(audio.channels),
      sourceUrlOrAssetId,
    },
    reference: {
      surahNumber,
      startAyah,
      endAyah,
      ayahs: normalizedAyahs,
      quranTextVersion: typeof reference.quranTextVersion === 'string' ? reference.quranTextVersion.slice(0, 128) : undefined,
      riwayah: typeof reference.riwayah === 'string' ? reference.riwayah.slice(0, 64) : undefined,
    },
    granularity,
    providerInput: input.providerInput,
  };
}

export function parseAlignmentRequest(input: unknown): AlignmentRequest {
  if (!input || typeof input !== 'object') throw new Error('ALIGNMENT_REQUEST_INVALID');
  const value = input as Record<string, any>;
  assertProviderInputSize(value.providerInput);
  return buildReferenceRequest(value);
}

export async function runAlignment(input: unknown): Promise<AlignmentRunResult> {
  let request = parseAlignmentRequest(input);
  if (request.providerId === 'quran_foundation') {
    request = await hydrateQuranFoundationRequest(request);
  }
  const provider = getAlignmentProviderRegistry().get(request.providerId);
  const result = await provider.align(request);
  const normalized = normalizeAlignmentResult(request, result);
  const timingMap = alignmentDocumentToTimingMap(normalized.document);
  return { document: normalized.document, timingMap, validation: normalized.validation };
}

function requestFromDocument(document: AlignmentDocument): AlignmentRequest {
  return {
    providerId: document.providerId,
    reciterId: document.reciterId,
    audio: {
      contentHash: document.audio.contentHash,
      durationMs: document.audio.durationMs,
      sampleRate: document.audio.sampleRate,
      channels: document.audio.channels,
      sourceUrlOrAssetId: document.audio.sourceUrlOrAssetId,
    },
    reference: {
      surahNumber: document.reference.surahNumber,
      startAyah: document.reference.ayahRange.from,
      endAyah: document.reference.ayahRange.to,
      ayahs: document.reference.ayahs.map((ayah) => ({ ...ayah })),
      quranTextVersion: document.reference.quranTextVersion,
      riwayah: document.reference.riwayah,
    },
    granularity: document.requestedGranularity || (document.letters.length > 0 ? 'letter' : 'word'),
  };
}

export function applyAlignmentReview(
  base: AlignmentDocument,
  revisions: AlignmentRevision[],
  reviewInput: Omit<AlignmentReview, 'status'> & { status: 'approved' | 'needs_review' | 'rejected' },
): AlignmentRunResult {
  if (!Array.isArray(revisions) || revisions.length > MAX_PROVIDER_WORDS) throw new Error('ALIGNMENT_REVISIONS_INVALID');
  const byIdentity = new Map<string, AlignmentRevision>();
  revisions.forEach((revision, index) => {
    if (!finite(revision.startMs) || !finite(revision.endMs) || revision.startMs < 0 || revision.endMs <= revision.startMs) {
      throw new Error(`ALIGNMENT_REVISION_${index}_INTERVAL_INVALID`);
    }
    const identity = revision.occurrenceId || revision.canonicalWordKey;
    if (!identity) throw new Error(`ALIGNMENT_REVISION_${index}_IDENTITY_REQUIRED`);
    byIdentity.set(identity, revision);
  });
  const words = base.words.map((word) => {
    const revision = byIdentity.get(word.occurrenceId) || byIdentity.get(word.canonicalWordKey);
    if (!revision) return { ...word };
    return {
      ...word,
      startMs: revision.startMs,
      endMs: revision.endMs,
      confidence: revision.confidence === undefined ? word.confidence : Math.max(0, Math.min(1, revision.confidence)),
    };
  });
  const next: AlignmentDocument = {
    ...base,
    documentId: `aln-manual-${crypto.randomUUID()}`,
    parentDocumentId: base.documentId,
    providerId: 'manual',
    providerVersion: 'manual-review-v1',
    sourceMethod: 'manual_override',
    providerVerified: false,
    words,
    review: {
      status: reviewInput.status,
      reviewerId: reviewInput.reviewerId,
      reviewedAt: reviewInput.reviewedAt || new Date().toISOString(),
      note: reviewInput.note,
    },
    provenance: {
      ...base.provenance,
      providerId: 'manual',
      providerVersion: 'manual-review-v1',
      sourceMethod: 'manual_override',
      createdAt: new Date().toISOString(),
      parentDocumentId: base.documentId,
    },
    diagnostics: {
      ...base.diagnostics,
      reviewRevisionCount: revisions.length,
      parentDocumentId: base.documentId,
    },
  };
  const validation = validateAlignmentDocument(next, requestFromDocument(next));
  next.validationStatus = validation.status;
  next.diagnostics = {
    ...next.diagnostics,
    validation: validation.diagnostics,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
  return { document: next, timingMap: alignmentDocumentToTimingMap(next), validation };
}

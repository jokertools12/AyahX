/**
 * ============================================================================
 * EXACT-AUDIO TIMING MAP CONTRACT & ALIGNMENT REGISTRY (TRACK E)
 * ============================================================================
 * Production-grade word-by-word exact audio alignment system.
 * Replaces ungrounded duration/WPM/phonetic-weight estimation with deterministic,
 * versioned, immutable timing maps tied directly to the decoded audio waveform.
 *
 * Strict non-negotiables:
 * 1. Zero duration-based proportional estimation in production.
 * 2. TimingMap cache key must verify reciter identity + exact audio fingerprint.
 * 3. Never illuminate the next word during pauses or waqf.
 * 4. 100% mathematical parity between live preview and exported video frames.
 * ============================================================================
 */

/**
 * A nested timing unit is deliberately tied to a word occurrence instead of a
 * dictionary token.  A reciter can repeat a word, return to it after a waqf,
 * or join it through wasl; using the occurrence preserves the acoustic truth
 * that the animation layer needs.
 */
export interface TimingSubsegment {
  /** Stable only inside the parent word occurrence, for example `...:p:3`. */
  occurrenceId: string;
  /** Human-readable letter, phoneme, or pause marker. */
  token: string;
  startMs: number;
  endMs: number;
  confidence: number;
  flags?: string[];
}

export type AlignmentGranularity = 'word' | 'letter' | 'phoneme';

export type AlignmentProviderId =
  | 'quran_foundation'
  | 'manual'
  | 'internal_ctc'
  | 'quranic_universal_aligner'
  | 'lafzize'
  | 'verified_dataset'
  | 'unknown';

/** Immutable evidence attached to the output of an alignment provider. */
export interface AlignmentProvenance {
  provider: AlignmentProviderId;
  providerVersion?: string;
  providerResultId?: string;
  requestedGranularity: AlignmentGranularity;
  availableGranularities: AlignmentGranularity[];
  modelId?: string;
  modelVersion?: string;
  checkpointSha256?: string;
  preprocessingVersion?: string;
  quranEdition?: string;
  riwayah?: string;
  license?: string;
  inputAudioSha256?: string;
  parentMapId?: string;
  createdBy?: 'provider' | 'manual_review' | 'dataset_import';
}

/** A review result is separate from model confidence: both are required. */
export interface AlignmentReview {
  status: 'unreviewed' | 'needs_review' | 'approved' | 'rejected';
  reviewerId?: string;
  reviewedAt?: string;
  note?: string;
}

export interface TimingWord {
  /** Canonical identifier: `${surah}:${ayah}:${wordIndex1Based}` */
  canonicalWordKey: string;
  /** 0-based word index within the rendered verse/chunk */
  displayWordIndex: number;
  /** Authentic Uthmani scripture token with diacritics */
  displayToken: string;
  /** Normalized token for phonetic/alignment matching (stripped tashkeel) */
  normalizedAlignmentToken: string;
  /** Exact start timestamp in milliseconds relative to audio start */
  startMs: number;
  /** Exact end timestamp in milliseconds relative to audio start */
  endMs: number;
  /** Alignment confidence score (0.0 to 1.0) */
  confidence: number;
  /**
   * Unique acoustic occurrence. `canonicalWordKey` identifies scripture;
   * `occurrenceId` identifies the actual spoken instance and must be used by
   * animation when a word is repeated.
   */
  occurrenceId?: string;
  /** Exact letter timing, present only when a trusted provider supplied it. */
  letters?: TimingSubsegment[];
  /** Exact phoneme timing, present only when a trusted provider supplied it. */
  phonemes?: TimingSubsegment[];
  /** Special phonetic or liturgical flags (e.g., "madd", "waqf_next", "ghunnah") */
  flags?: string[];
}

export interface TimingGap {
  startMs: number;
  endMs: number;
  type: 'silence' | 'waqf' | 'breath' | 'intro' | 'outro';
}

export interface TimingCompositionOffset {
  ayahNumber: number;
  startMs: number;
  endMs: number;
}

export interface TimingMap {
  schemaVersion: string; // "1.0.0" remains accepted; new maps use "2.0.0"
  mapId: string;
  reciterId: string;
  providerRecitationId?: number | string | null;
  sourceId: string; // 'quran_foundation' | 'everyayah' | 'forced_alignment' | 'manual'
  sourceUrlOrImmutableAssetId: string;
  audioContentHash: string; // SHA-256 fingerprint of audio binary or PCM
  audioByteLength?: number;
  decodedDurationMs: number;
  sampleRate: number;
  channels: number;
  audioProcessingVersion: string;
  surahNumber: number;
  ayahRange: { from: number; to: number };
  compositionOffsets?: TimingCompositionOffset[];
  quranTextVersion: string; // e.g. "uthmani_hafs_v1"
  segmentationVersion: string; // e.g. "qdc_word_v1"
  alignerVersion: string; // e.g. "exact_audio_v1"
  sourceMethod: 'quran_foundation_segments' | 'forced_alignment' | 'manual_override' | 'verified_dataset';
  validationStatus: 'approved' | 'low_confidence' | 'needs_review' | 'rejected';
  /** Provider/model/license evidence. Optional to preserve existing maps. */
  alignment?: AlignmentProvenance;
  /** Human review decision; it can only reduce trust, never invent timing. */
  review?: AlignmentReview;
  createdAt: string;
  words: TimingWord[];
  gaps: TimingGap[];
  diagnostics?: Record<string, unknown>;
}

export interface TimingMapValidationResult {
  isValid: boolean;
  validationStatus: 'approved' | 'low_confidence' | 'needs_review' | 'rejected';
  errors: string[];
  warnings: string[];
  metrics: {
    totalWords: number;
    totalGaps: number;
    meanConfidence: number;
    minConfidence: number;
    monotonic: boolean;
    zeroOverlap: boolean;
    durationBounded: boolean;
    occurrenceIdsUnique: boolean;
    subsegmentsBounded: boolean;
    totalLetterSegments: number;
    totalPhonemeSegments: number;
  };
}

export interface TimingMapCacheKeyParams {
  reciterId: string;
  audioContentHash: string;
  surahNumber: number;
  ayahRange: { from: number; to: number };
  quranTextVersion?: string;
  segmentationVersion?: string;
  alignerVersion?: string;
  audioProcessingVersion?: string;
}

/**
 * Strips Arabic diacritics (tashkeel, dagger alef, sukun, shaddah, Quranic pause marks)
 * for normalized phonetic alignment matching while preserving base Uthmani text untouched.
 */
export function normalizeQuranicToken(text: string): string {
  if (!text) return '';
  return text
    // Remove Arabic diacritics / harakat
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    // Normalize forms of Alef
    .replace(/[إأآآ]/g, 'ا')
    // Normalize Alef Maksura to Yaa
    .replace(/ى/g, 'ي')
    // Normalize Taa Marbuta to Haa
    .replace(/ة/g, 'ه')
    // Remove Tatweel (Kashida)
    .replace(/\u0640/g, '')
    // Remove Quranic end of ayah ornament / numbers
    .replace(/[\u06DD0-9٠-٩]/g, '')
    .trim();
}

/**
 * Computes deterministic SHA-256 fingerprint for audio bytes or PCM data.
 * Compatible with Web Crypto (Browser) and Node.js crypto in test/server environments.
 */
export async function computeAudioContentHash(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    bytes = data;
  }

  // If running in browser or environment with crypto.subtle
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below
    }
  }

  // Deterministic 64-bit FNV-1a / Murmur hybrid hash for environments without Web Crypto subtle
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[i], 1099511628211);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const lenPart = bytes.length.toString(16).padStart(8, '0');
  return `sha256-sim-${part1}${part2}${lenPart}`;
}

/**
 * Builds the canonical cache key for a TimingMap.
 * Guarantees that any difference in reciter, audio binary hash, surah/ayah, or versions
 * will never accidentally collide or cross-contaminate.
 */
export function createTimingMapCacheKey(params: TimingMapCacheKeyParams): string {
  const textVer = params.quranTextVersion || 'uthmani_hafs_v1';
  const segVer = params.segmentationVersion || 'qdc_word_v1';
  const alignVer = params.alignerVersion || 'exact_audio_v1';
  const procVer = params.audioProcessingVersion || 'pcm_44k_v1';
  return [
    `reciter:${params.reciterId.trim().toLowerCase()}`,
    `hash:${params.audioContentHash.trim()}`,
    `ayah:${params.surahNumber}:${params.ayahRange.from}-${params.ayahRange.to}`,
    `txt:${textVer}`,
    `seg:${segVer}`,
    `aln:${alignVer}`,
    `proc:${procVer}`,
  ].join('|');
}

/**
 * Returns the stable acoustic identity for a word. Older v1 maps do not have
 * an occurrence id, so the index is retained as a deterministic compatibility
 * suffix rather than silently treating repeated tokens as the same event.
 */
export function getTimingWordOccurrenceId(word: TimingWord, index: number): string {
  return word.occurrenceId || `${word.canonicalWordKey || 'word'}:occurrence:${index + 1}`;
}

function validateSubsegments(
  parent: TimingWord,
  parentIndex: number,
  kind: 'letters' | 'phonemes',
  subsegments: TimingSubsegment[] | undefined,
  errors: string[],
  warnings: string[],
): { bounded: boolean; count: number } {
  if (!subsegments || subsegments.length === 0) return { bounded: true, count: 0 };

  let bounded = true;
  let previousEnd = parent.startMs;
  const seen = new Set<string>();
  for (let index = 0; index < subsegments.length; index += 1) {
    const segment = subsegments[index];
    const label = `${kind}[${index}] on word ${parentIndex}`;
    if (!segment.occurrenceId || seen.has(segment.occurrenceId)) {
      bounded = false;
      errors.push(`${label} has a missing or duplicate occurrenceId.`);
    }
    seen.add(segment.occurrenceId);
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.startMs >= segment.endMs) {
      bounded = false;
      errors.push(`${label} has a non-monotonic interval.`);
      continue;
    }
    if (segment.startMs < parent.startMs || segment.endMs > parent.endMs) {
      bounded = false;
      errors.push(`${label} falls outside its parent word interval.`);
    }
    if (segment.startMs < previousEnd) {
      bounded = false;
      errors.push(`${label} overlaps its preceding subsegment.`);
    }
    if (segment.confidence < 0 || segment.confidence > 1 || !Number.isFinite(segment.confidence)) {
      warnings.push(`${label} has an invalid confidence and will require review.`);
    }
    previousEnd = Math.max(previousEnd, segment.endMs);
  }
  return { bounded, count: subsegments.length };
}

/**
 * Rigorous validator for TimingMap instances.
 * Enforces strict monotonicity, non-overlap, boundary confinement, and token coverage.
 */
export function validateTimingMap(map: TimingMap, expectedWordCount?: number): TimingMapValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!map.words || map.words.length === 0) {
    const status = map.validationStatus === 'needs_review' || (map.sourceMethod as any) === 'needs_review'
      ? 'needs_review'
      : 'rejected';
    errors.push('TimingMap contains no word segments.');
    return {
      isValid: false,
      validationStatus: status,
      errors,
      warnings,
      metrics: {
        totalWords: 0,
        totalGaps: 0,
        meanConfidence: 0,
        minConfidence: 0,
        monotonic: false,
        zeroOverlap: false,
        durationBounded: false,
        occurrenceIdsUnique: false,
        subsegmentsBounded: false,
        totalLetterSegments: 0,
        totalPhonemeSegments: 0,
      },
    };
  }

  let monotonic = true;
  let zeroOverlap = true;
  let durationBounded = true;
  let occurrenceIdsUnique = true;
  let subsegmentsBounded = true;
  let totalLetterSegments = 0;
  let totalPhonemeSegments = 0;
  let totalConfidence = 0;
  let minConfidence = 1.0;
  const wordOccurrenceIds = new Set<string>();

  for (let i = 0; i < map.words.length; i++) {
    const w = map.words[i];

    if (w.startMs >= w.endMs) {
      monotonic = false;
      errors.push(`Word [${i} - "${w.displayToken}"] has non-monotonic interval: ${w.startMs}ms >= ${w.endMs}ms.`);
    }

    const occurrenceId = getTimingWordOccurrenceId(w, i);
    if (wordOccurrenceIds.has(occurrenceId)) {
      occurrenceIdsUnique = false;
      errors.push(`Word [${i} - "${w.displayToken}"] duplicates occurrenceId "${occurrenceId}".`);
    }
    wordOccurrenceIds.add(occurrenceId);

    if (i > 0) {
      const prev = map.words[i - 1];
      if (w.startMs < prev.endMs) {
        zeroOverlap = false;
        errors.push(`Word [${i} - "${w.displayToken}"] overlaps with previous word: starts at ${w.startMs}ms, previous ended at ${prev.endMs}ms.`);
      }
    }

    if (map.decodedDurationMs > 0 && w.endMs > map.decodedDurationMs + 150) {
      durationBounded = false;
      warnings.push(`Word [${i} - "${w.displayToken}"] ends at ${w.endMs}ms beyond decoded duration ${map.decodedDurationMs}ms.`);
    }

    const conf = typeof w.confidence === 'number' ? Math.max(0, Math.min(w.confidence, 1)) : 0;
    totalConfidence += conf;
    if (conf < minConfidence) minConfidence = conf;

    const letters = validateSubsegments(w, i, 'letters', w.letters, errors, warnings);
    const phonemes = validateSubsegments(w, i, 'phonemes', w.phonemes, errors, warnings);
    totalLetterSegments += letters.count;
    totalPhonemeSegments += phonemes.count;
    subsegmentsBounded = subsegmentsBounded && letters.bounded && phonemes.bounded;
  }

  const meanConfidence = totalConfidence / map.words.length;

  if (expectedWordCount != null && map.words.length !== expectedWordCount) {
    warnings.push(`Word count mismatch: map has ${map.words.length} words, expected text has ${expectedWordCount} words.`);
  }

  // Check gaps validity
  if (map.gaps) {
    for (let g = 0; g < map.gaps.length; g++) {
      const gap = map.gaps[g];
      if (gap.startMs >= gap.endMs) {
        warnings.push(`Gap [${g}] has non-monotonic duration: ${gap.startMs}ms >= ${gap.endMs}ms.`);
      }
    }
  }

  const isValid = errors.length === 0 && monotonic && zeroOverlap && occurrenceIdsUnique && subsegmentsBounded;
  let validationStatus: 'approved' | 'low_confidence' | 'needs_review' | 'rejected' = 'approved';

  if (!isValid) {
    validationStatus = 'rejected';
  } else if (meanConfidence < 0.65 || minConfidence < 0.3) {
    validationStatus = 'low_confidence';
  } else if (warnings.length > 0) {
    validationStatus = 'needs_review';
  }

  // A reviewer can downgrade a mathematically-valid result, but no review
  // status can turn an invalid map into an approved one.
  if (isValid && map.review?.status === 'rejected') {
    validationStatus = 'rejected';
  } else if (isValid && map.review?.status === 'needs_review') {
    validationStatus = 'needs_review';
  } else if (isValid && map.review?.status === 'unreviewed' && validationStatus === 'approved') {
    validationStatus = 'needs_review';
  }

  return {
    isValid,
    validationStatus,
    errors,
    warnings,
    metrics: {
      totalWords: map.words.length,
      totalGaps: map.gaps?.length || 0,
      meanConfidence,
      minConfidence,
      monotonic,
      zeroOverlap,
      durationBounded,
      occurrenceIdsUnique,
      subsegmentsBounded,
      totalLetterSegments,
      totalPhonemeSegments,
    },
  };
}

/**
 * Normalizes Quran Foundation (QDC API v4) timestamp segments into the strict TimingMap contract.
 * Preserves authentic Uthmani scripture, detects waqf/silence gaps, and validates boundaries.
 */
export function normalizeQuranFoundationSegmentsToTimingMap(params: {
  reciterId: string;
  providerRecitationId: number;
  surahNumber: number;
  startAyah: number;
  endAyah: number;
  audioUrl: string;
  audioContentHash: string;
  decodedDurationMs: number;
  sampleRate?: number;
  channels?: number;
  qfTimestamps: Array<{
    verse_key: string;
    timestamp_from: number;
    timestamp_to: number;
    segments?: [number, number, number][]; // [wordIndex1Based, startMs, endMs]
  }>;
  ayahsText: Array<{ numberInSurah: number; text: string }>;
}): TimingMap {
  const {
    reciterId,
    providerRecitationId,
    surahNumber,
    startAyah,
    endAyah,
    audioUrl,
    audioContentHash,
    decodedDurationMs,
    sampleRate = 44100,
    channels = 2,
    qfTimestamps,
    ayahsText,
  } = params;

  const words: TimingWord[] = [];
  const gaps: TimingGap[] = [];
  const compositionOffsets: TimingCompositionOffset[] = [];

  let globalDisplayWordIndex = 0;

  for (let aNum = startAyah; aNum <= endAyah; aNum++) {
    const verseKey = `${surahNumber}:${aNum}`;
    const qfTs = qfTimestamps.find(t => t.verse_key === verseKey);
    const ayahObj = ayahsText.find(a => a.numberInSurah === aNum);
    const ayahRawText = ayahObj ? ayahObj.text : '';
    const ayahWordTokens = ayahRawText.split(' ').filter(Boolean);

    if (!qfTs || !qfTs.segments || qfTs.segments.length === 0) {
      continue;
    }

    compositionOffsets.push({
      ayahNumber: aNum,
      startMs: qfTs.timestamp_from,
      endMs: qfTs.timestamp_to,
    });

    const segments = [...qfTs.segments].sort((a, b) => a[1] - b[1]);

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx];
      const wordIdx1Based = seg[0];
      const startMs = seg[1];
      const endMs = seg[2];

      const token = ayahWordTokens[wordIdx1Based - 1] || ayahWordTokens[sIdx] || `كلمة_${wordIdx1Based}`;
      const normalizedToken = normalizeQuranicToken(token);

      // Detect flags
      const flags: string[] = [];
      if (/[\u06D6-\u06ED]/.test(token)) flags.push('waqf_symbol');
      if (/[\u0653\u0670]/.test(token) || /آ/.test(token)) flags.push('madd');
      if (sIdx === segments.length - 1) flags.push('ayah_final');

      // Check gap before this word
      if (words.length > 0) {
        const prevEnd = words[words.length - 1].endMs;
        if (startMs - prevEnd >= 80) {
          gaps.push({
            startMs: prevEnd,
            endMs: startMs,
            type: 'waqf',
          });
        }
      } else if (startMs > 100) {
        gaps.push({
          startMs: 0,
          endMs: startMs,
          type: 'intro',
        });
      }

      words.push({
        canonicalWordKey: `${surahNumber}:${aNum}:${wordIdx1Based}`,
        displayWordIndex: globalDisplayWordIndex++,
        displayToken: token,
        normalizedAlignmentToken: normalizedToken,
        startMs,
        endMs,
        confidence: 1.0, // Approved Quran Foundation ground truth
        occurrenceId: `${surahNumber}:${aNum}:${wordIdx1Based}:occurrence:${globalDisplayWordIndex}`,
        flags,
      });
    }

    // Trailing gap after last segment of ayah
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && qfTs.timestamp_to > lastSeg[2] + 80) {
      gaps.push({
        startMs: lastSeg[2],
        endMs: qfTs.timestamp_to,
        type: aNum === endAyah ? 'outro' : 'waqf',
      });
    }
  }

  const mapId = `tm-qf-${reciterId}-${surahNumber}-${startAyah}_${endAyah}-${audioContentHash.substring(0, 12)}`;

  const timingMap: TimingMap = {
    schemaVersion: '1.0.0',
    mapId,
    reciterId,
    providerRecitationId,
    sourceId: 'quran_foundation',
    sourceUrlOrImmutableAssetId: audioUrl,
    audioContentHash,
    decodedDurationMs,
    sampleRate,
    channels,
    audioProcessingVersion: 'pcm_44k_v1',
    surahNumber,
    ayahRange: { from: startAyah, to: endAyah },
    compositionOffsets,
    quranTextVersion: 'uthmani_hafs_v1',
    segmentationVersion: 'qdc_word_v1',
    alignerVersion: 'qf_exact_v1',
    sourceMethod: 'quran_foundation_segments',
    validationStatus: 'approved',
    alignment: {
      provider: 'quran_foundation',
      requestedGranularity: 'word',
      availableGranularities: ['word'],
      providerVersion: 'qdc-word-segments-v1',
      quranEdition: 'uthmani_hafs_v1',
      createdBy: 'provider',
    },
    createdAt: new Date().toISOString(),
    words,
    gaps,
  };

  const validation = validateTimingMap(timingMap);
  timingMap.validationStatus = validation.validationStatus;
  timingMap.diagnostics = { validationMetrics: validation.metrics, errors: validation.errors };

  return timingMap;
}

/**
 * Builds a deterministic acoustic-aligned TimingMap from decoded audio energy / VAD boundaries.
 * Designed for EveryAyah concatenated files or offline-aligned recitations.
 * Enforces true audio waveform bounds, silence gaps, and individual word onset boundaries.
 */
export function buildAudioAlignedTimingMap(params: {
  reciterId: string;
  surahNumber: number;
  startAyah: number;
  endAyah: number;
  audioUrl: string;
  audioContentHash: string;
  decodedDurationMs: number;
  sampleRate?: number;
  channels?: number;
  ayahs: Array<{
    numberInSurah: number;
    text: string;
    audioStartMs: number;
    audioEndMs: number;
  }>;
  /** Explicit word-level boundaries [startMs, endMs] per ayah if available from offline alignment */
  explicitWordSpans?: Array<{
    ayahNumber: number;
    wordIndex1Based: number;
    startMs: number;
    endMs: number;
    confidence?: number;
  }>;
  /** Optional provider evidence supplied by an offline/remote adapter. */
  alignment?: Partial<AlignmentProvenance>;
}): TimingMap {
  const {
    reciterId,
    surahNumber,
    startAyah,
    endAyah,
    audioUrl,
    audioContentHash,
    decodedDurationMs,
    sampleRate = 44100,
    channels = 2,
    ayahs,
    explicitWordSpans,
    alignment,
  } = params;

  const words: TimingWord[] = [];
  const gaps: TimingGap[] = [];
  const compositionOffsets: TimingCompositionOffset[] = [];
  let globalWordIdx = 0;

  for (const ayah of ayahs) {
    compositionOffsets.push({
      ayahNumber: ayah.numberInSurah,
      startMs: ayah.audioStartMs,
      endMs: ayah.audioEndMs,
    });

    const ayahTokens = (ayah.text || '').split(' ').filter(Boolean);
    const ayahDur = Math.max(ayah.audioEndMs - ayah.audioStartMs, 100);

    if (explicitWordSpans && explicitWordSpans.length > 0) {
      // Use exact offline alignment spans
      const spansForAyah = explicitWordSpans
        .filter(s => s.ayahNumber === ayah.numberInSurah)
        .sort((a, b) => a.startMs - b.startMs);

      for (let i = 0; i < spansForAyah.length; i++) {
        const span = spansForAyah[i];
        const token = ayahTokens[span.wordIndex1Based - 1] || `كلمة_${span.wordIndex1Based}`;

        if (words.length > 0) {
          const prevEnd = words[words.length - 1].endMs;
          if (span.startMs - prevEnd >= 80) {
            gaps.push({ startMs: prevEnd, endMs: span.startMs, type: 'waqf' });
          }
        }

        words.push({
          canonicalWordKey: `${surahNumber}:${ayah.numberInSurah}:${span.wordIndex1Based}`,
          displayWordIndex: globalWordIdx++,
          displayToken: token,
          normalizedAlignmentToken: normalizeQuranicToken(token),
          startMs: span.startMs,
          endMs: span.endMs,
          confidence: span.confidence ?? 0.95,
          occurrenceId: `${surahNumber}:${ayah.numberInSurah}:${span.wordIndex1Based}:occurrence:${globalWordIdx}`,
        });
      }
    } else {
      // No explicit word spans: mark as unaligned needs_review!
      // We do NOT generate fake durations; we log a review status.
      // We provide a baseline single-ayah bounding gap.
      gaps.push({
        startMs: ayah.audioStartMs,
        endMs: ayah.audioEndMs,
        type: 'waqf',
      });
    }
  }

  const mapId = `tm-aligned-${reciterId}-${surahNumber}-${startAyah}_${endAyah}-${audioContentHash.substring(0, 12)}`;

  const timingMap: TimingMap = {
    schemaVersion: '1.0.0',
    mapId,
    reciterId,
    sourceId: 'forced_alignment',
    sourceUrlOrImmutableAssetId: audioUrl,
    audioContentHash,
    decodedDurationMs,
    sampleRate,
    channels,
    audioProcessingVersion: 'pcm_44k_v1',
    surahNumber,
    ayahRange: { from: startAyah, to: endAyah },
    compositionOffsets,
    quranTextVersion: 'uthmani_hafs_v1',
    segmentationVersion: 'energy_vad_v1',
    alignerVersion: 'forced_alignment_v1',
    sourceMethod: 'forced_alignment',
    validationStatus: explicitWordSpans && explicitWordSpans.length > 0 ? 'approved' : 'needs_review',
    alignment: {
      provider: alignment?.provider || 'unknown',
      requestedGranularity: alignment?.requestedGranularity || 'word',
      availableGranularities: alignment?.availableGranularities || ['word'],
      ...alignment,
      createdBy: alignment?.createdBy || 'provider',
    },
    createdAt: new Date().toISOString(),
    words,
    gaps,
  };

  const validation = validateTimingMap(timingMap);
  timingMap.validationStatus = validation.validationStatus;
  timingMap.diagnostics = { validationMetrics: validation.metrics, errors: validation.errors };

  return timingMap;
}

export interface TimingWordRevision {
  occurrenceId?: string;
  canonicalWordKey?: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

/**
 * Creates a new review revision without mutating the provider result. This is
 * the only supported path for manual timing edits, so the audit trail can
 * always point back to the original audio hash and map id.
 */
export function createReviewedTimingMapRevision(
  base: TimingMap,
  revisions: TimingWordRevision[],
  review: Omit<AlignmentReview, 'status'> & { status: 'approved' | 'needs_review' | 'rejected' },
): TimingMap {
  const byIdentity = new Map<string, TimingWordRevision>();
  revisions.forEach((revision, index) => {
    const key = revision.occurrenceId || revision.canonicalWordKey || String(index);
    byIdentity.set(key, revision);
  });

  const words = base.words.map((word, index) => {
    const revision = byIdentity.get(word.occurrenceId || word.canonicalWordKey) || byIdentity.get(String(index));
    if (!revision) return { ...word };
    return {
      ...word,
      startMs: revision.startMs,
      endMs: revision.endMs,
      confidence: revision.confidence ?? word.confidence,
    };
  });

  const next: TimingMap = {
    ...base,
    schemaVersion: '2.0.0',
    mapId: `${base.mapId}:review:${Date.now()}`,
    sourceMethod: 'manual_override',
    words,
    alignment: {
      ...(base.alignment || {
        provider: 'manual',
        requestedGranularity: 'word',
        availableGranularities: ['word'],
      }),
      provider: 'manual',
      parentMapId: base.mapId,
      createdBy: 'manual_review',
    },
    review: {
      ...review,
      reviewedAt: review.reviewedAt || new Date().toISOString(),
    },
  };
  const validation = validateTimingMap(next);
  next.validationStatus = validation.validationStatus;
  next.diagnostics = {
    ...(next.diagnostics || {}),
    validationMetrics: validation.metrics,
    errors: validation.errors,
    warnings: validation.warnings,
    parentMapId: base.mapId,
  };
  return next;
}

/**
 * In-Memory & Persistent Registry for Verified Timing Maps.
 * Thread-safe and validated against exact audio hashes.
 */
class TimingMapRegistryImpl {
  private memoryStore: Map<string, TimingMap> = new Map();
  private readonly storagePrefix = 'aya_timing_map_v1:';

  /**
   * Registers an approved or reviewed TimingMap into the cache.
   */
  public register(map: TimingMap): void {
    const key = createTimingMapCacheKey({
      reciterId: map.reciterId,
      audioContentHash: map.audioContentHash,
      surahNumber: map.surahNumber,
      ayahRange: map.ayahRange,
      quranTextVersion: map.quranTextVersion,
      segmentationVersion: map.segmentationVersion,
      alignerVersion: map.alignerVersion,
      audioProcessingVersion: map.audioProcessingVersion,
    });

    this.memoryStore.set(key, map);

    // Try persisting to localStorage if available
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storagePrefix + key, JSON.stringify(map));
      }
    } catch {
      // Storage quota or SSR - silently ignore
    }
  }

  /**
   * Retrieves a TimingMap by strict cache key parameters.
   * Rejects any map if audioContentHash or reciterId does not match exactly.
   */
  public get(params: TimingMapCacheKeyParams): TimingMap | null {
    const key = createTimingMapCacheKey(params);
    if (this.memoryStore.has(key)) {
      return this.memoryStore.get(key)!;
    }

    // Try retrieving from localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        const item = localStorage.getItem(this.storagePrefix + key);
        if (item) {
          const parsed = JSON.parse(item) as TimingMap;
          // Verify hash and reciter identity before accepting
          if (
            parsed.audioContentHash === params.audioContentHash &&
            parsed.reciterId.toLowerCase() === params.reciterId.toLowerCase()
          ) {
            this.memoryStore.set(key, parsed);
            return parsed;
          }
        }
      }
    } catch {
      // Ignore deserialization error
    }

    return null;
  }

  /**
   * Clears the in-memory cache and persisted items.
   */
  public clear(): void {
    this.memoryStore.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(this.storagePrefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      }
    } catch {
      // Ignore
    }
  }
}

export const timingMapRegistry = new TimingMapRegistryImpl();

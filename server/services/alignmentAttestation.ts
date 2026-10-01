/**
 * Short-lived proof that an approved TimingMap was produced by the AyahX
 * server for the current account. A render request is otherwise just a JSON
 * payload supplied by a browser, so structural validation alone cannot prove
 * that its word offsets came from a trusted provider or a saved review.
 */

import crypto from 'crypto';

type AttestableSubsegment = {
  occurrenceId?: string;
  token?: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  flags?: string[];
};

export type AttestableTimingMap = {
  mapId?: string;
  audioContentHash?: string;
  audioFingerprintKind?: string;
  validationStatus?: string;
  sourceId?: string;
  sourceMethod?: string;
  alignment?: {
    provider?: string;
    providerVersion?: string;
    requestedGranularity?: string;
    availableGranularities?: string[];
    providerResultId?: string;
  };
  review?: { status?: string; reviewerId?: string; reviewedAt?: string };
  compositionOffsets?: Array<{ ayahNumber?: number; startMs?: number; endMs?: number }>;
  words?: Array<{
    canonicalWordKey?: string;
    occurrenceId?: string;
    displayWordIndex?: number;
    displayToken?: string;
    normalizedAlignmentToken?: string;
    startMs?: number;
    endMs?: number;
    confidence?: number;
    flags?: string[];
    letters?: AttestableSubsegment[];
    phonemes?: AttestableSubsegment[];
  }>;
  gaps?: Array<{ startMs?: number; endMs?: number; type?: string }>;
};

export interface AlignmentAttestationVerification {
  valid: boolean;
  code?: string;
}

const ATTESTATION_PREFIX = 'a1';
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;

function configuredSecret(): string | null {
  // Keep this proof key separate from the login token key in production. A
  // compromise of one capability must not mint render-authorizing proofs for
  // the other. The JWT fallback is intentionally development-only.
  const value = process.env.NODE_ENV === 'production'
    ? process.env.ALIGNMENT_ATTESTATION_SECRET
    : process.env.ALIGNMENT_ATTESTATION_SECRET || process.env.JWT_SECRET;
  if (value && value.trim().length >= 32) return value;
  // Keep local development usable while requiring a real secret in production.
  return process.env.NODE_ENV === 'production' ? null : 'ayahx-development-alignment-attestation-only';
}

function ttlSeconds(): number {
  const parsed = Number(process.env.ALIGNMENT_ATTESTATION_TTL_SECONDS || 24 * 60 * 60);
  if (!Number.isFinite(parsed)) return 24 * 60 * 60;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.trunc(parsed)));
}

function normalizedSubsegments(items: AttestableSubsegment[] | undefined): Array<unknown> {
  return (items || []).map((item) => [
    item.occurrenceId || '', item.token || '', item.startMs, item.endMs,
    item.confidence, [...(item.flags || [])],
  ]);
}

/** A deterministic, intentionally narrow representation of timing evidence. */
export function alignmentTimingDigest(map: AttestableTimingMap): string {
  const evidence = {
    mapId: map.mapId || '',
    audioContentHash: map.audioContentHash || '',
    audioFingerprintKind: map.audioFingerprintKind || '',
    validationStatus: map.validationStatus || '',
    sourceId: map.sourceId || '',
    sourceMethod: map.sourceMethod || '',
    alignment: map.alignment ? {
      provider: map.alignment.provider || '',
      providerVersion: map.alignment.providerVersion || '',
      requestedGranularity: map.alignment.requestedGranularity || '',
      availableGranularities: [...(map.alignment.availableGranularities || [])],
    } : null,
    review: map.review ? {
      status: map.review.status || '',
      reviewerId: map.review.reviewerId || '',
      reviewedAt: map.review.reviewedAt || '',
    } : null,
    compositionOffsets: (map.compositionOffsets || []).map((offset) => [offset.ayahNumber, offset.startMs, offset.endMs]),
    words: (map.words || []).map((word) => [
      word.canonicalWordKey || '', word.occurrenceId || '', word.displayWordIndex,
      word.displayToken || '', word.normalizedAlignmentToken || '', word.startMs,
      word.endMs, word.confidence, [...(word.flags || [])],
      normalizedSubsegments(word.letters), normalizedSubsegments(word.phonemes),
    ]),
    gaps: (map.gaps || []).map((gap) => [gap.startMs, gap.endMs, gap.type || '']),
  };
  return crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('base64url');
}

function signature(secret: string, userId: string, map: AttestableTimingMap, expiresAt: number, nonce: string): string {
  const material = [
    'ayahx-alignment-attestation-v1', userId, map.mapId || '', map.alignment?.provider || '',
    map.audioContentHash || '', alignmentTimingDigest(map), String(expiresAt), nonce,
  ].join('|');
  return crypto.createHmac('sha256', secret).update(material).digest('base64url');
}

/** Issues proof only for an approved map. */
export function issueApprovedTimingMapAttestation(map: AttestableTimingMap, userId: string, now = Date.now()): string | null {
  const secret = configuredSecret();
  if (!secret || map.validationStatus !== 'approved' || !map.mapId || !map.audioContentHash || !map.alignment?.provider) return null;
  const expiresAt = Math.floor(now / 1000) + ttlSeconds();
  const nonce = crypto.randomBytes(12).toString('base64url');
  return [ATTESTATION_PREFIX, expiresAt.toString(36), nonce, signature(secret, userId, map, expiresAt, nonce)].join('.');
}

/** Guest previews stay public; authenticated approved maps carry export proof. */
export function attestTimingMapForUser<T extends AttestableTimingMap>(map: T, userId?: string): T {
  if (!userId || map.validationStatus !== 'approved') return map;
  const token = issueApprovedTimingMapAttestation(map, userId);
  if (!token) throw new Error('ALIGNMENT_ATTESTATION_SECRET_NOT_CONFIGURED');
  return { ...map, alignment: { ...map.alignment, providerResultId: token } } as T;
}

/** Rejects an altered approved map; non-approved maps remain static-renderable. */
export function verifyApprovedTimingMapAttestation(map: AttestableTimingMap, userId: string, now = Date.now()): AlignmentAttestationVerification {
  if (map.validationStatus !== 'approved') return { valid: true };
  const secret = configuredSecret();
  if (!secret) return { valid: false, code: 'ALIGNMENT_ATTESTATION_SECRET_NOT_CONFIGURED' };
  const token = map.alignment?.providerResultId;
  if (!token || typeof token !== 'string') return { valid: false, code: 'ALIGNMENT_ATTESTATION_REQUIRED' };
  const [prefix, encodedExpiry, nonce, suppliedSignature, ...rest] = token.split('.');
  if (prefix !== ATTESTATION_PREFIX || !encodedExpiry || !nonce || !suppliedSignature || rest.length > 0) return { valid: false, code: 'ALIGNMENT_ATTESTATION_FORMAT_INVALID' };
  const expiresAt = Number.parseInt(encodedExpiry, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(now / 1000)) return { valid: false, code: 'ALIGNMENT_ATTESTATION_EXPIRED' };
  const expectedBuffer = Buffer.from(signature(secret, userId, map, expiresAt, nonce));
  const suppliedBuffer = Buffer.from(suppliedSignature);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return { valid: false, code: 'ALIGNMENT_ATTESTATION_INVALID' };
  return { valid: true };
}

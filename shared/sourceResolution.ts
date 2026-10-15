import { z } from 'zod';
import { rangeSelectionSchema, readerScopeSchema, sha256Schema, timingLevelSchema } from './recordingAvailability';

// Pure validation only. No schema establishes trusted authority, byte checksums,
// approval, destination consent, persistence, idempotency or safe recovery.
const reference = readerScopeSchema.shape.recordingId;
// Opaque server-issued ledger references. This shape is only a boundary check;
// construction must still be server-owned and never sourced from raw provider data.
const opaqueReference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
const epochMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const MAX_RESOLUTION_SOURCES = 32;
// A record-size/elapsed-time validation bound, not an adapter execution timeout.
export const MAX_ATTEMPT_DURATION_MS = 24 * 60 * 60 * 1000;

const lockObject = readerScopeSchema.extend({
  surahNumber: rangeSelectionSchema.shape.surahNumber,
  fromAyah: rangeSelectionSchema.shape.fromAyah,
  toAyah: rangeSelectionSchema.shape.toAyah,
  textRevision: reference, textFingerprint: sha256Schema,
  audioAssetId: reference, audioFingerprint: sha256Schema,
  requiredTiming: timingLevelSchema,
}).strict();
export const resolutionLockSchema = lockObject.refine(lock => lock.toAyah >= lock.fromAyah, 'Invalid locked range');
export type ResolutionLock = z.infer<typeof resolutionLockSchema>;

export const sourcePolicyEntrySchema = z.object({
  sourceId: opaqueReference, sourceRevision: opaqueReference,
  eligibleLock: resolutionLockSchema,
  licenseReference: opaqueReference,
  licenseDecision: z.enum(['allowed', 'blocked']),
  consentDecision: z.enum(['not_required', 'granted', 'blocked']),
  consentReference: opaqueReference.nullable(),
}).strict().refine(entry => entry.consentDecision !== 'granted' || entry.consentReference !== null,
  'Granted consent requires a protected decision reference');
export const orderedSourcePolicySchema = z.object({
  revision: opaqueReference,
  sources: z.array(sourcePolicyEntrySchema).min(1).max(MAX_RESOLUTION_SOURCES),
}).strict().refine(policy => new Set(policy.sources.map(entry => entry.sourceId)).size === policy.sources.length,
  'Duplicate policy source');
export type OrderedSourcePolicy = z.infer<typeof orderedSourcePolicySchema>;

/** Fixed field order; hash exact UTF-8 output server-side. Never normalize content. */
export function resolutionLockHashInput(input: ResolutionLock): string {
  const lock = resolutionLockSchema.parse(input);
  return JSON.stringify(lock);
}
export function orderedSourcePolicyHashInput(input: OrderedSourcePolicy): string {
  return JSON.stringify(orderedSourcePolicySchema.parse(input));
}

export const resolutionRequestSchema = z.object({
  serverRequestId: opaqueReference,
  actorReference: opaqueReference, ownershipReference: opaqueReference,
  purpose: z.enum(['review', 'final_export']), requiredTiming: timingLevelSchema,
  lock: resolutionLockSchema, lockHash: sha256Schema,
  policy: orderedSourcePolicySchema, policyHash: sha256Schema,
  payloadHash: sha256Schema,
}).strict().superRefine((request, ctx) => {
  if (request.requiredTiming !== request.lock.requiredTiming) {
    ctx.addIssue({ code: 'custom', path: ['requiredTiming'], message: 'Exact requested timing must match lock' });
  }
  const identity = resolutionLockHashInput(request.lock);
  request.policy.sources.forEach((entry, index) => {
    if (resolutionLockHashInput(entry.eligibleLock) !== identity) {
      ctx.addIssue({ code: 'custom', path: ['policy', 'sources', index, 'eligibleLock'], message: 'Policy identity differs from lock' });
    }
  });
});
export type ResolutionRequest = z.infer<typeof resolutionRequestSchema>;

/** Includes exact timing, ownership and ordered policy, excluding only payloadHash itself. */
export function resolutionRequestHashInput(input: ResolutionRequest): string {
  const { payloadHash: _payloadHash, ...payload } = resolutionRequestSchema.parse(input);
  return JSON.stringify(payload);
}

export const sourceFailureSchema = z.enum([
  'timeout', 'rate_limited', 'not_indexed', 'capacity',
  'riwayah_mismatch', 'numbering_mismatch', 'mushaf_mismatch', 'range_mismatch',
  'fingerprint_mismatch', 'audio_mismatch', 'reciter_mismatch', 'recording_mismatch',
  'license_blocked', 'privacy_blocked', 'invalid_payload', 'approval_required', 'unknown_error',
]);
export type SourceFailure = z.infer<typeof sourceFailureSchema>;
/** Classifies known codes only; never copy raw provider exception details. */
export function classifySourceFailure(input: unknown): SourceFailure {
  const result = sourceFailureSchema.safeParse(input);
  return result.success ? result.data : 'unknown_error';
}
export function canFallbackSource(input: unknown): boolean {
  return ['timeout', 'rate_limited', 'not_indexed', 'capacity'].includes(classifySourceFailure(input));
}

const candidateReviewStatus = z.enum(['draft', 'reviewed', 'approved', 'rejected', 'expired', 'provisional']);
const candidateAyahRange = z.string().regex(/^\d{1,3}:\d{1,4}-\d{1,4}$/);
const candidateTextSchema = z.object({
  riwayahCode: opaqueReference, mushafProfileId: opaqueReference, numberingSystem: opaqueReference,
  ayahRange: candidateAyahRange, textFingerprint: sha256Schema, reviewStatus: candidateReviewStatus,
}).strict();
const candidateAlignmentSchema = candidateTextSchema.extend({
  reciterId: opaqueReference, recordingId: opaqueReference, audioFingerprint: sha256Schema,
}).strict();
const resolutionCandidateSchema = z.object({ text: candidateTextSchema, alignment: candidateAlignmentSchema.optional() }).strict();

/** Validates provider output against the immutable lock before a result is selected. */
export function validateResolutionCandidate(lockInput: unknown, candidateInput: unknown, purpose: ResolutionRequest['purpose']): SourceFailure | null {
  const lockResult = resolutionLockSchema.safeParse(lockInput);
  const candidateResult = resolutionCandidateSchema.safeParse(candidateInput);
  if (!lockResult.success || !candidateResult.success) return 'invalid_payload';
  const lock = lockResult.data;
  const candidate = candidateResult.data;
  const expectedRange = `${lock.surahNumber}:${lock.fromAyah}-${lock.toAyah}`;
  const text = candidate.text;
  if (text.riwayahCode !== lock.riwayahCode) return 'riwayah_mismatch';
  if (text.mushafProfileId !== lock.mushafProfileId) return 'mushaf_mismatch';
  if (text.numberingSystem !== lock.numberingSystem) return 'numbering_mismatch';
  if (text.ayahRange !== expectedRange) return 'range_mismatch';
  if (text.textFingerprint !== lock.textFingerprint) return 'fingerprint_mismatch';
  if (text.reviewStatus !== 'approved') return 'approval_required';
  const alignment = candidate.alignment;
  if (!alignment) return 'not_indexed';
  if (alignment.riwayahCode !== lock.riwayahCode) return 'riwayah_mismatch';
  if (alignment.mushafProfileId !== lock.mushafProfileId) return 'mushaf_mismatch';
  if (alignment.numberingSystem !== lock.numberingSystem) return 'numbering_mismatch';
  if (alignment.ayahRange !== expectedRange) return 'range_mismatch';
  if (alignment.textFingerprint !== lock.textFingerprint) return 'fingerprint_mismatch';
  if (alignment.audioFingerprint !== lock.audioFingerprint) return 'audio_mismatch';
  if (alignment.reciterId !== lock.reciterId) return 'reciter_mismatch';
  if (alignment.recordingId !== lock.recordingId) return 'recording_mismatch';
  if (alignment.reviewStatus === 'rejected' || alignment.reviewStatus === 'expired') return 'invalid_payload';
  if (purpose === 'final_export' && alignment.reviewStatus !== 'approved') return 'approval_required';
  return null;
}

const attemptIdentity = z.object({
  serverRequestId: opaqueReference, payloadHash: sha256Schema, lockHash: sha256Schema, policyHash: sha256Schema,
  policyRevision: opaqueReference,
  ordinal: z.number().int().min(0).max(MAX_RESOLUTION_SOURCES - 1),
  sourceId: opaqueReference, sourceRevision: opaqueReference, startedAtEpochMs: epochMs,
}).strict();
export const startedSourceAttemptSchema = attemptIdentity.extend({ phase: z.literal('started') }).strict();
export const terminalSourceAttemptSchema = attemptIdentity.extend({
  phase: z.literal('terminal'), endedAtEpochMs: epochMs,
  durationMs: z.number().int().nonnegative().max(MAX_ATTEMPT_DURATION_MS),
  status: z.enum(['selected', 'review_required', 'failed', 'rejected', 'skipped']),
  failureClass: sourceFailureSchema.nullable(),
  reasonCode: z.enum(['candidate_validated', 'provisional_review', ...sourceFailureSchema.options]),
}).strict().superRefine((attempt, ctx) => {
  if (attempt.endedAtEpochMs - attempt.startedAtEpochMs !== attempt.durationMs) {
    ctx.addIssue({ code: 'custom', path: ['durationMs'], message: 'Duration must equal nonnegative elapsed time' });
  }
  const success = attempt.status === 'selected' || attempt.status === 'review_required';
  const expectedReason = attempt.status === 'selected' ? 'candidate_validated' : 'provisional_review';
  if (success ? attempt.failureClass !== null || attempt.reasonCode !== expectedReason
    : attempt.failureClass === null || attempt.reasonCode !== attempt.failureClass) {
    ctx.addIssue({ code: 'custom', message: 'Status, failure and reason must agree' });
  }
});
export type StartedSourceAttempt = z.infer<typeof startedSourceAttemptSchema>;
export type TerminalSourceAttempt = z.infer<typeof terminalSourceAttemptSchema>;

/** Pair/anchor consistency only; does not prove either record was persisted. */
export function validateSourceAttemptPair(requestInput: unknown, startedInput: unknown, terminalInput: unknown): boolean {
  const request = resolutionRequestSchema.safeParse(requestInput);
  const started = startedSourceAttemptSchema.safeParse(startedInput);
  const terminal = terminalSourceAttemptSchema.safeParse(terminalInput);
  if (!request.success || !started.success || !terminal.success) return false;
  const anchor = request.data;
  const start = started.data;
  const end = terminal.data;
  const source = anchor.policy.sources[start.ordinal];
  if (!source || source.sourceId !== start.sourceId || source.sourceRevision !== start.sourceRevision) return false;
  const blocked = source.licenseDecision === 'blocked' || source.consentDecision === 'blocked';
  if (blocked && (end.status === 'selected' || end.status === 'review_required')) return false;
  if (end.status === 'review_required' && anchor.purpose !== 'review') return false;
  if (blocked) {
    const expected = source.licenseDecision === 'blocked' ? 'license_blocked' : 'privacy_blocked';
    if (end.failureClass !== expected || end.reasonCode !== expected || !['failed', 'rejected'].includes(end.status)) return false;
  }
  if (start.serverRequestId !== anchor.serverRequestId || start.payloadHash !== anchor.payloadHash
    || start.lockHash !== anchor.lockHash || start.policyHash !== anchor.policyHash
    || start.policyRevision !== anchor.policy.revision) return false;
  return (Object.keys(attemptIdentity.shape) as Array<keyof typeof start>).every(key => start[key] === end[key as keyof typeof end]);
}

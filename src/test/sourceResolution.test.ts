import { describe, expect, it } from 'vitest';
import {
  canFallbackSource, classifySourceFailure, MAX_ATTEMPT_DURATION_MS, MAX_RESOLUTION_SOURCES,
  orderedSourcePolicyHashInput, orderedSourcePolicySchema, resolutionLockHashInput, resolutionLockSchema,
  resolutionRequestHashInput, resolutionRequestSchema, sourceFailureSchema, startedSourceAttemptSchema,
  terminalSourceAttemptSchema, validateSourceAttemptPair,
  type ResolutionLock, type ResolutionRequest, type StartedSourceAttempt, type TerminalSourceAttempt,
} from '../../shared/sourceResolution';

// Synthetic references and hashes only; these fixtures are not source approvals.
const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const makeLock = (): ResolutionLock => ({
  reciterId: 'reader-fixture', recordingId: 'recording-fixture', riwayahCode: 'hafs-fixture',
  mushafProfileId: 'mushaf-fixture', numberingSystem: 'numbering-fixture',
  surahNumber: 1, fromAyah: 1, toAyah: 7,
  textRevision: 'text-v1', textFingerprint: hash, audioAssetId: 'audio-fixture', audioFingerprint: hash,
  requiredTiming: 'word',
});
const makeRequest = (): ResolutionRequest => ({
  serverRequestId: 'request-fixture', actorReference: 'actor-ref', ownershipReference: 'owner-ref',
  purpose: 'final_export', requiredTiming: 'word', lock: makeLock(), lockHash: hash,
  policy: { revision: 'policy-v1', sources: ['primary', 'secondary'].map(sourceId => ({
    sourceId, sourceRevision: 'source-v1', eligibleLock: makeLock(),
    licenseReference: 'license-ref', licenseDecision: 'allowed', consentDecision: 'granted', consentReference: 'consent-ref',
  })) }, policyHash: hash, payloadHash: hash,
});
const makeStart = (): StartedSourceAttempt => ({
  serverRequestId: 'request-fixture', payloadHash: hash, lockHash: hash, policyHash: hash,
  policyRevision: 'policy-v1',
  ordinal: 0, sourceId: 'primary', sourceRevision: 'source-v1', startedAtEpochMs: 1000, phase: 'started',
});
const makeEnd = (): TerminalSourceAttempt => ({
  ...makeStart(), phase: 'terminal', endedAtEpochMs: 1500, durationMs: 500,
  status: 'failed', failureClass: 'timeout', reasonCode: 'timeout',
});

describe('pure source-resolution contract validation', () => {
  it('accepts a pinned request and paired sanitized attempts without mutating inputs', () => {
    const request = makeRequest();
    const original = JSON.stringify(request);
    Object.freeze(request);
    expect(resolutionRequestSchema.safeParse(request).success).toBe(true);
    expect(validateSourceAttemptPair(request, makeStart(), makeEnd())).toBe(true);
    expect(JSON.stringify(request)).toBe(original);
    expect(validateSourceAttemptPair(request, makeStart(), null)).toBe(false);
  });

  it.each([
    { surahNumber: 0 }, { surahNumber: 115 }, { fromAyah: 0 }, { toAyah: 1001 },
    { fromAyah: 8 }, { toAyah: 1.5 }, { audioFingerprint: 'not-a-hash' }, { textRevision: ' text-v1' },
    { requiredTiming: 'segment' }, { text: 'private text' },
  ])('rejects malformed lock %j', change => {
    expect(resolutionLockSchema.safeParse({ ...makeLock(), ...change }).success).toBe(false);
  });

  it('uses availability integer bounds and supports independent complete identities', () => {
    expect(resolutionLockSchema.safeParse({ ...makeLock(), surahNumber: 114, fromAyah: 1000, toAyah: 1000 }).success).toBe(true);
    expect(resolutionLockSchema.safeParse({ ...makeLock(), riwayahCode: 'warsh-fixture', mushafProfileId: 'warsh-mushaf' }).success).toBe(true);
  });

  it.each(Object.keys(makeLock()) as Array<keyof ResolutionLock>)('rejects changed policy eligibility %s', field => {
    const request = makeRequest();
    const original = request.policy.sources[1].eligibleLock[field];
    Object.assign(request.policy.sources[1].eligibleLock, {
      [field]: typeof original === 'number' ? original + 1 : field.endsWith('Fingerprint') ? otherHash : field === 'requiredTiming' ? 'ayah' : 'different',
    });
    expect(resolutionRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects duplicate source IDs even with different revisions, empty and excessive order', () => {
    const policy = makeRequest().policy;
    expect(orderedSourcePolicySchema.safeParse({ ...policy, sources: [] }).success).toBe(false);
    expect(orderedSourcePolicySchema.safeParse({ ...policy, sources: [policy.sources[0], { ...policy.sources[0], sourceRevision: 'v2' }] }).success).toBe(false);
    const sources = Array.from({ length: MAX_RESOLUTION_SOURCES }, (_, index) => ({ ...policy.sources[0], sourceId: `source-${index}` }));
    expect(orderedSourcePolicySchema.safeParse({ ...policy, sources }).success).toBe(true);
    expect(orderedSourcePolicySchema.safeParse({ ...policy, sources: [...sources, { ...sources[0], sourceId: 'extra' }] }).success).toBe(false);
  });

  it('requires explicit timing at both anchor and lock and never infers a timing level', () => {
    const request = makeRequest();
    expect(resolutionRequestSchema.safeParse({ ...request, requiredTiming: undefined }).success).toBe(false);
    expect(resolutionRequestSchema.safeParse({ ...request, requiredTiming: 'ayah' }).success).toBe(false);
    expect(resolutionRequestSchema.safeParse({ ...request, lock: { ...request.lock, requiredTiming: undefined } }).success).toBe(false);
    const changed = makeRequest();
    changed.requiredTiming = changed.lock.requiredTiming = 'letter';
    changed.policy.sources.forEach(source => { source.eligibleLock.requiredTiming = 'letter'; });
    expect(resolutionRequestHashInput(changed)).not.toBe(resolutionRequestHashInput(request));
    expect(resolutionLockHashInput(changed.lock)).not.toBe(resolutionLockHashInput(request.lock));
  });

  it('makes hash input deterministic across property order and sensitive to policy, ownership and order', () => {
    const request = makeRequest();
    expect(resolutionRequestHashInput({ ...request, lock: { ...request.lock } })).toBe(resolutionRequestHashInput(request));
    const reordered = Object.fromEntries(Object.entries(request).reverse()) as ResolutionRequest;
    expect(resolutionRequestHashInput(reordered)).toBe(resolutionRequestHashInput(request));
    for (const change of [{ actorReference: 'other-actor' }, { ownershipReference: 'other-owner' }, { purpose: 'review' as const }, { serverRequestId: 'another-request' }]) {
      expect(resolutionRequestHashInput({ ...request, ...change })).not.toBe(resolutionRequestHashInput(request));
    }
    expect(resolutionRequestHashInput({ ...request, payloadHash: otherHash })).toBe(resolutionRequestHashInput(request));
    const policy = request.policy;
    expect(orderedSourcePolicyHashInput({ ...policy, revision: 'policy-v2' })).not.toBe(orderedSourcePolicyHashInput(policy));
    expect(orderedSourcePolicyHashInput({ ...policy, sources: [...policy.sources].reverse() })).not.toBe(orderedSourcePolicyHashInput(policy));
  });

  it('requires bounded protected ownership and consent references', () => {
    const request = makeRequest();
    for (const change of [{ actorReference: '' }, { ownershipReference: ' ' }, { serverRequestId: 'x'.repeat(201) }, { actorEmail: 'private@example.invalid' }]) {
      expect(resolutionRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
    }
    request.policy.sources[0].consentReference = null;
    expect(resolutionRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each(['https://provider.invalid/private', 'person@example.invalid', 'source?token=secret',
    'source\nprivate', 'source\u0000private', 'source\tprivate'])('rejects raw data embedded in existing reference fields: %j', value => {
    const request = makeRequest();
    for (const field of ['serverRequestId', 'actorReference', 'ownershipReference'] as const) {
      expect(resolutionRequestSchema.safeParse({ ...request, [field]: value }).success).toBe(false);
    }
    for (const field of ['sourceId', 'sourceRevision', 'licenseReference', 'consentReference'] as const) {
      const changed = makeRequest();
      changed.policy.sources[0][field] = value;
      expect(resolutionRequestSchema.safeParse(changed).success).toBe(false);
    }
    expect(orderedSourcePolicySchema.safeParse({ ...request.policy, revision: value }).success).toBe(false);
    for (const field of ['serverRequestId', 'sourceId', 'sourceRevision', 'policyRevision'] as const) {
      expect(startedSourceAttemptSchema.safeParse({ ...makeStart(), [field]: value }).success).toBe(false);
      expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), [field]: value }).success).toBe(false);
    }
    const changed = makeRequest();
    changed.policy.sources[0].sourceId = value;
    expect(validateSourceAttemptPair(changed, { ...makeStart(), sourceId: value }, { ...makeEnd(), sourceId: value })).toBe(false);
  });

  it('keeps existing recording identity bounds distinct from opaque ledger references', () => {
    expect(resolutionLockSchema.safeParse({ ...makeLock(), recordingId: 'catalog.recording/v1' }).success).toBe(true);
    expect(resolutionRequestSchema.safeParse({ ...makeRequest(), serverRequestId: 'r'.repeat(200) }).success).toBe(true);
  });

  it.each(sourceFailureSchema.options)('permits fallback only for explicit transient code %s', failure => {
    expect(canFallbackSource(failure)).toBe(['timeout', 'rate_limited', 'not_indexed', 'capacity'].includes(failure));
  });
  it.each([null, undefined, 'TIMEOUT', 'network_error', new Error('private failure'), { failureClass: 'timeout' }])('makes unknown failure terminal without inspecting raw data', failure => {
    expect(classifySourceFailure(failure)).toBe('unknown_error');
    expect(canFallbackSource(failure)).toBe(false);
  });

  it.each(['sourceId', 'sourceRevision', 'serverRequestId', 'payloadHash', 'lockHash', 'policyHash', 'policyRevision', 'ordinal', 'startedAtEpochMs'] as const)('rejects pair spoofing of %s', field => {
    const change = field === 'ordinal' ? 1 : field === 'startedAtEpochMs' ? 1001 : field.endsWith('Hash') ? otherHash : 'spoofed';
    expect(validateSourceAttemptPair(makeRequest(), makeStart(), { ...makeEnd(), [field]: change })).toBe(false);
  });
  it('rejects a paired source or revision outside the exact ordinal policy', () => {
    for (const change of [{ sourceId: 'secondary' }, { sourceRevision: 'source-v2' }, { ordinal: 1 }, { ordinal: 2 }]) {
      expect(validateSourceAttemptPair(makeRequest(), { ...makeStart(), ...change }, { ...makeEnd(), ...change })).toBe(false);
    }
    const request = makeRequest();
    request.policy.sources[0].sourceRevision = 'source-v2';
    expect(validateSourceAttemptPair(request, makeStart(), makeEnd())).toBe(false);
    const changedPolicy = makeRequest();
    changedPolicy.policy.revision = 'policy-v2';
    expect(validateSourceAttemptPair(changedPolicy, makeStart(), makeEnd())).toBe(false);
  });

  it('accepts zero elapsed time and rejects negative, fractional, inconsistent, excessive and unsafe time values', () => {
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), endedAtEpochMs: 1000, durationMs: 0 }).success).toBe(true);
    for (const change of [
      { durationMs: -1 }, { durationMs: 0.5 }, { durationMs: 499 }, { endedAtEpochMs: 999 },
      { endedAtEpochMs: 1001 + MAX_ATTEMPT_DURATION_MS, durationMs: MAX_ATTEMPT_DURATION_MS + 1 },
      { startedAtEpochMs: Number.MAX_SAFE_INTEGER + 1 }, { endedAtEpochMs: Infinity },
    ]) expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), ...change }).success).toBe(false);
  });

  it('pairs terminal statuses with sanitized reasons and failure classes', () => {
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), status: 'selected', failureClass: null, reasonCode: 'candidate_validated' }).success).toBe(true);
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), status: 'review_required', failureClass: null, reasonCode: 'provisional_review' }).success).toBe(true);
    for (const change of [
      { status: 'selected' }, { failureClass: null }, { reasonCode: 'license_blocked' },
      { status: 'review_required', failureClass: null, reasonCode: 'candidate_validated' },
      { status: 'selected', failureClass: null, reasonCode: 'provisional_review' },
      { failureClass: 'future_failure', reasonCode: 'future_failure' },
    ]) expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), ...change }).success).toBe(false);
  });

  it.each(['licenseDecision', 'consentDecision'] as const)('rejects success against blocked %s and requires an appropriate denial record', field => {
    const request = makeRequest();
    request.purpose = 'review';
    request.policy.sources[0][field] = 'blocked';
    for (const terminal of [
      { ...makeEnd(), status: 'selected', failureClass: null, reasonCode: 'candidate_validated' },
      { ...makeEnd(), status: 'review_required', failureClass: null, reasonCode: 'provisional_review' },
      makeEnd(),
    ]) expect(validateSourceAttemptPair(request, makeStart(), terminal)).toBe(false);
    const failureClass = field === 'licenseDecision' ? 'license_blocked' : 'privacy_blocked';
    for (const status of ['failed', 'rejected'] as const) {
      expect(validateSourceAttemptPair(request, makeStart(), { ...makeEnd(), status, failureClass, reasonCode: failureClass })).toBe(true);
    }
    expect(validateSourceAttemptPair(request, makeStart(), { ...makeEnd(), status: 'skipped', failureClass, reasonCode: failureClass })).toBe(false);
  });

  it('limits provisional review outcomes to review requests', () => {
    const request = makeRequest();
    const provisional = { ...makeEnd(), status: 'review_required', failureClass: null, reasonCode: 'provisional_review' };
    expect(validateSourceAttemptPair(request, makeStart(), provisional)).toBe(false);
    expect(validateSourceAttemptPair({ ...request, purpose: 'review' }, makeStart(), provisional)).toBe(true);
    expect(validateSourceAttemptPair(request, makeStart(), {
      ...makeEnd(), status: 'selected', failureClass: null, reasonCode: 'candidate_validated',
    })).toBe(true);
  });

  it.each(['reason', 'error', 'context', 'url', 'media', 'text', 'token', 'email'])('rejects raw diagnostic field %s in both phases', field => {
    expect(startedSourceAttemptSchema.safeParse({ ...makeStart(), [field]: 'private provider data' }).success).toBe(false);
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), [field]: 'private provider data' }).success).toBe(false);
  });
  it('rejects raw reason text, terminal data on start and omitted terminal phase', () => {
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), reasonCode: 'https://provider.invalid/private?token=secret' }).success).toBe(false);
    expect(startedSourceAttemptSchema.safeParse({ ...makeStart(), status: 'selected' }).success).toBe(false);
    expect(terminalSourceAttemptSchema.safeParse({ ...makeEnd(), phase: undefined }).success).toBe(false);
  });
});

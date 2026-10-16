import { describe, expect, it } from 'vitest';
import { createApprovedSourceAdapters } from '../../server/services/approvedSourceAdapters';
import type { ResolutionRequest } from '../../shared/sourceResolution';

const hash = 'a'.repeat(64);
const lock = { reciterId: 'r', recordingId: 'rec', riwayahCode: 'hafs', mushafProfileId: 'm', numberingSystem: 'hijri', surahNumber: 1, fromAyah: 1, toAyah: 1, textRevision: 't1', textFingerprint: hash, audioAssetId: 'audio', audioFingerprint: hash, requiredTiming: 'ayah' as const };
const request: ResolutionRequest = {
  serverRequestId: 'req-approved', actorReference: 'actor', ownershipReference: 'owner', purpose: 'review', requiredTiming: 'ayah', lock, lockHash: hash, policyHash: hash, payloadHash: hash,
  policy: { revision: 'p1', sources: [{ sourceId: 'local', sourceRevision: 'v1', eligibleLock: lock, licenseReference: 'lic-local', licenseDecision: 'allowed', consentDecision: 'not_required', consentReference: null }] },
};
const provenance = { sourceId: 'local', sourceRevision: 'v1', licenseReference: 'lic-local', retrievedAt: '2026-10-16T00:00:00.000Z', contentChecksum: hash };
const candidate = { text: { riwayahCode: 'hafs', mushafProfileId: 'm', numberingSystem: 'hijri', ayahRange: '1:1-1', textFingerprint: hash, reviewStatus: 'approved' as const }, alignment: { reciterId: 'r', recordingId: 'rec', riwayahCode: 'hafs', mushafProfileId: 'm', numberingSystem: 'hijri', ayahRange: '1:1-1', textFingerprint: hash, audioFingerprint: hash, reviewStatus: 'reviewed' as const }, provenance };

describe('approved source adapters', () => {
  it('returns a provenance-bearing candidate only for the exact lock', async () => {
    const adapters = createApprovedSourceAdapters([{ sourceId: 'local', sourceRevision: 'v1', eligibleLock: lock, candidate, provenance }]);
    const result = await adapters['local@v1'](request, request.policy.sources[0]);
    expect(result).toMatchObject({ provenance });
  });

  it('rejects a lock mismatch as unavailable so the resolver may try the next pinned source', async () => {
    const adapters = createApprovedSourceAdapters([{ sourceId: 'local', sourceRevision: 'v1', eligibleLock: { ...lock, riwayahCode: 'warsh' }, candidate, provenance }]);
    const result = await adapters['local@v1'](request, request.policy.sources[0]);
    expect(result).toBe('not_indexed');
  });

  it('rejects missing provenance instead of treating a plausible payload as trusted', async () => {
    const adapters = createApprovedSourceAdapters([{ sourceId: 'local', sourceRevision: 'v1', eligibleLock: lock, candidate: { ...candidate, provenance: undefined }, provenance }]);
    const result = await adapters['local@v1'](request, request.policy.sources[0]);
    expect(result).toBe('invalid_payload');
  });

  it('rejects provenance licensed under a different policy reference', async () => {
    const adapters = createApprovedSourceAdapters([{ sourceId: 'local', sourceRevision: 'v1', eligibleLock: lock, candidate, provenance: { ...provenance, licenseReference: 'other-license' } }]);
    const result = await adapters['local@v1'](request, request.policy.sources[0]);
    expect(result).toBe('invalid_payload');
  });
});

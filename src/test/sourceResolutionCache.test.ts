import { describe, expect, it } from 'vitest';
import { createSourceResolutionCache } from '../../server/services/sourceResolutionCache';
import type { ResolutionRequest } from '../../shared/sourceResolution';

const request = (lockHash: string): ResolutionRequest => ({
  serverRequestId: 'req-1', actorReference: 'actor-1', ownershipReference: 'owner-1',
  purpose: 'review', requiredTiming: 'word', lockHash, policyHash: 'policy-hash', payloadHash: 'payload-hash',
  lock: {
    recordingId: 'recording-1', reciterId: 'reciter-1', riwayahCode: 'hafs', mushafProfileId: 'mushaf-1', numberingSystem: 'hijri',
    surahNumber: 1, fromAyah: 1, toAyah: 1, textRevision: 'text-v1', textFingerprint: 'a'.repeat(64),
    audioAssetId: 'audio-1', audioFingerprint: 'b'.repeat(64), requiredTiming: 'word',
  },
  policy: { revision: 'policy-v1', sources: [{
    sourceId: 'source-a', sourceRevision: 'rev-1', eligibleLock: {
      recordingId: 'recording-1', reciterId: 'reciter-1', riwayahCode: 'hafs', mushafProfileId: 'mushaf-1', numberingSystem: 'hijri',
      surahNumber: 1, fromAyah: 1, toAyah: 1, textRevision: 'text-v1', textFingerprint: 'a'.repeat(64), audioAssetId: 'audio-1', audioFingerprint: 'b'.repeat(64), requiredTiming: 'word',
    }, licenseReference: 'license-1', licenseDecision: 'allowed', consentDecision: 'not_required', consentReference: null,
  }] },
});

describe('source resolution cache', () => {
  it('returns only a candidate for the exact lock and source revision', () => {
    const now = 1000;
    const cache = createSourceResolutionCache<{ id: string }>(() => now);
    const first = request('lock-a');
    const source = first.policy.sources[0];
    cache.set(first, source, { id: 'candidate-a' }, 5000);
    expect(cache.get(first, source)).toEqual({ id: 'candidate-a' });
    expect(cache.get(request('lock-b'), source)).toBeUndefined();
    expect(cache.get(first, { ...source, sourceRevision: 'rev-2' })).toBeUndefined();
  });

  it('expires entries and ignores non-positive TTLs', () => {
    let now = 1000;
    const cache = createSourceResolutionCache<{ id: string }>(() => now);
    const anchor = request('lock-a');
    const source = anchor.policy.sources[0];
    cache.set(anchor, source, { id: 'candidate-a' }, 0);
    expect(cache.get(anchor, source)).toBeUndefined();
    cache.set(anchor, source, { id: 'candidate-b' }, 100);
    now = 1100;
    expect(cache.get(anchor, source)).toBeUndefined();
  });

  it('clears all entries explicitly', () => {
    const cache = createSourceResolutionCache<{ id: string }>(() => 1000);
    const anchor = request('lock-a');
    const source = anchor.policy.sources[0];
    cache.set(anchor, source, { id: 'candidate-a' }, 1000);
    cache.clear();
    expect(cache.get(anchor, source)).toBeUndefined();
  });
});

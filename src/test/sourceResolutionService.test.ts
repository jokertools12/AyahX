import { describe, expect, it, vi } from 'vitest';
import { resolveSource, type SourceAdapter, type SourceAdapterMap } from '../../server/services/sourceResolutionService';
import type { ResolutionRequest, StartedSourceAttempt, TerminalSourceAttempt } from '../../shared/sourceResolution';

const hash = 'a'.repeat(64);
const lock = { reciterId: 'r', recordingId: 'rec', riwayahCode: 'hafs', mushafProfileId: 'm', numberingSystem: 'n', surahNumber: 1, fromAyah: 1, toAyah: 1, textRevision: 't', textFingerprint: hash, audioAssetId: 'a', audioFingerprint: hash, requiredTiming: 'ayah' as const };
const request = (purpose: ResolutionRequest['purpose'] = 'final_export'): ResolutionRequest => ({
  serverRequestId: 'req', actorReference: 'actor', ownershipReference: 'owner', purpose, requiredTiming: 'ayah', lock, lockHash: hash, policyHash: hash, payloadHash: hash,
  policy: { revision: 'p1', sources: ['one', 'two', 'three'].map(sourceId => ({ sourceId, sourceRevision: 'v1', eligibleLock: lock, licenseReference: 'lic', licenseDecision: 'allowed' as const, consentDecision: 'not_required' as const, consentReference: null })) },
});
function repo(events: string[]) {
  return {
    createRequestAnchor: vi.fn(async () => { events.push('anchor'); return 'created' as const; }),
    appendStarted: vi.fn(async (_r: ResolutionRequest, a: StartedSourceAttempt) => { events.push(`start:${a.sourceId}`); }),
    appendTerminal: vi.fn(async (_r: ResolutionRequest, _s: StartedSourceAttempt, t: TerminalSourceAttempt) => { events.push(`end:${t.sourceId}:${t.status}`); }),
    appendTerminalThen: vi.fn(async <T>(_r: ResolutionRequest, _s: StartedSourceAttempt, t: TerminalSourceAttempt, next: () => Promise<T>): Promise<T> => { events.push(`end:${t.sourceId}:${t.status}`); return next(); }),
    readAttempts: vi.fn(async () => []),
  };
}

describe('source resolution service', () => {
  it('falls back in pinned order and persists terminal before next start', async () => {
    const events: string[] = []; const repository = repo(events);
    const adapters: SourceAdapterMap<string> = new Map<string, SourceAdapter<string>>([
      ['one@v1', async () => ({ failure: 'timeout' as const })],
      ['two@v1', async () => ({ candidate: 'ok' })],
    ]);
    const result = await resolveSource({ request: request(), adapters, repository, validateCandidate: () => null, now: (() => { let n = 0; return () => n += 1; })() });
    expect(result.status).toBe('selected'); if ('candidate' in result) expect(result.candidate).toBe('ok');
    expect(events).toEqual(['anchor', 'start:one', 'end:one:failed', 'start:two', 'end:two:selected']);
  });
  it('stops on identity mismatch and does not call later adapters', async () => {
    const calls: string[] = []; const events: string[] = []; const repository = repo(events);
    const result = await resolveSource({ request: request(), adapters: { 'one@v1': async () => { calls.push('one'); return { candidate: 'candidate' }; }, 'two@v1': async () => { calls.push('two'); return 'ok'; } }, repository, validateCandidate: () => 'fingerprint_mismatch', now: () => 10 });
    expect(result).toMatchObject({ status: 'rejected', failure: 'fingerprint_mismatch' }); expect(calls).toEqual(['one']);
  });
  it('persists blocked policy and stops', async () => {
    const events: string[] = []; const req = request(); req.policy.sources[0].consentDecision = 'blocked';
    const result = await resolveSource({ request: req, adapters: {}, repository: repo(events), validateCandidate: () => null, now: () => 10 });
    expect(result).toMatchObject({ status: 'rejected', failure: 'privacy_blocked' });
  });
  it('returns review_required for review purpose and rejects unapproved final export', async () => {
    const review = await resolveSource({ request: request('review'), adapters: { 'one@v1': async () => ({ candidate: 'candidate' }) }, repository: repo([]), validateCandidate: () => null, now: () => 10 });
    expect(review.status).toBe('review_required');
    const final = await resolveSource({ request: request(), adapters: { 'one@v1': async () => ({ candidate: 'candidate' }) }, repository: repo([]), validateCandidate: () => 'approval_required', now: () => 10 });
    expect(final).toMatchObject({ status: 'rejected', failure: 'approval_required' });
  });
  it('propagates anchor conflicts and persistence failures', async () => {
    const events: string[] = []; const repository = repo(events); repository.createRequestAnchor.mockRejectedValueOnce(new Error('conflict'));
    await expect(resolveSource({ request: request(), adapters: {}, repository, validateCandidate: () => null })).rejects.toThrow('conflict');
    const failing = repo([]); failing.appendStarted.mockRejectedValueOnce(new Error('write failed'));
    await expect(resolveSource({ request: request(), adapters: {}, repository: failing, validateCandidate: () => null })).rejects.toThrow('write failed');
  });
  it('records provider exceptions as terminal unknown_error without fallback', async () => {
    const calls: string[] = []; const events: string[] = [];
    const result = await resolveSource({ request: request(), adapters: {
      'one@v1': async () => { calls.push('one'); throw new Error('provider detail must stay private'); },
      'two@v1': async () => { calls.push('two'); return { candidate: 'unexpected' }; },
    }, repository: repo(events), validateCandidate: () => null, now: () => 10 });
    expect(result).toMatchObject({ status: 'rejected', failure: 'unknown_error' });
    expect(calls).toEqual(['one']);
    expect(JSON.stringify(events)).not.toContain('provider detail');
  });
});

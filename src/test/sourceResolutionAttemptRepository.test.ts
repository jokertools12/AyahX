import { describe, expect, it, vi } from 'vitest';
import { createSourceResolutionAttemptRepository, sourceResolutionAttemptInsertSql, sourceResolutionRequestInsertSql, SourceResolutionIdempotencyConflictError } from '../../server/db/sourceResolutionAttemptRepository';
import type { ResolutionRequest, StartedSourceAttempt, TerminalSourceAttempt } from '../../shared/sourceResolution';

const sha = 'a'.repeat(64);
const lock = { reciterId: 'r', recordingId: 'rec', riwayahCode: 'hafs', mushafProfileId: 'm', numberingSystem: 'kufi', surahNumber: 1, fromAyah: 1, toAyah: 1, textRevision: 't', textFingerprint: sha, audioAssetId: 'a', audioFingerprint: sha, requiredTiming: 'ayah' as const };
const request: ResolutionRequest = { serverRequestId: 'req-1', actorReference: 'actor-1', ownershipReference: 'owner-1', purpose: 'review', requiredTiming: 'ayah', lock, lockHash: sha, policyHash: sha, payloadHash: sha, policy: { revision: 'policy-1', sources: [{ sourceId: 'source-1', sourceRevision: 'rev-1', eligibleLock: lock, licenseReference: 'lic-1', licenseDecision: 'allowed', consentDecision: 'not_required', consentReference: null }] } };
const started: StartedSourceAttempt = { serverRequestId: 'req-1', payloadHash: sha, lockHash: sha, policyHash: sha, policyRevision: 'policy-1', ordinal: 0, sourceId: 'source-1', sourceRevision: 'rev-1', phase: 'started', startedAtEpochMs: 1000 };
const terminal: TerminalSourceAttempt = { ...started, phase: 'terminal', endedAtEpochMs: 1001, durationMs: 1, status: 'failed', failureClass: 'timeout', reasonCode: 'timeout' };

describe('source resolution attempt SQL boundary', () => {
  it('uses parameterized anchor and attempt writes, never diagnostics', async () => {
    const query = vi.fn(async () => [] as unknown[]);
    const repository = createSourceResolutionAttemptRepository(query);
    expect(await repository.createRequestAnchor(request)).toBe('created');
    await repository.appendStarted(request, started);
    await repository.appendTerminal(request, started, terminal);
    const calls = query.mock.calls as Array<[string, readonly unknown[]]>;
    expect(calls[1]?.[0]).toBe(sourceResolutionRequestInsertSql);
    expect(calls[2]?.[0]).toBe(sourceResolutionAttemptInsertSql);
    expect(calls.flatMap(call => call[1])).not.toContain('https://');
    expect(calls.every(call => !call[0].includes('' + request.serverRequestId))).toBe(true);
  });
  it('treats same id and payload as idempotent and changed payload as conflict', async () => {
    const query = vi.fn(async () => [{ serverRequestId: request.serverRequestId, payloadHash: request.payloadHash }] as unknown[]);
    const repository = createSourceResolutionAttemptRepository(query);
    expect(await repository.createRequestAnchor(request)).toBe('existing');
    await expect(repository.createRequestAnchor({ ...request, payloadHash: 'b'.repeat(64) })).rejects.toBeInstanceOf(SourceResolutionIdempotencyConflictError);
  });
  it('persists terminal before invoking the next callback', async () => {
    const query = vi.fn(async () => [] as unknown[]);
    const repository = createSourceResolutionAttemptRepository(query);
    const order: string[] = [];
    await repository.appendTerminalThen(request, started, terminal, async () => { order.push('next'); return 'ok'; });
    expect(order).toEqual(['next']);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rejects identity mismatch before SQL', async () => {
    const query = vi.fn(async () => [] as unknown[]);
    const repository = createSourceResolutionAttemptRepository(query);
    await expect(repository.appendTerminal(request, started, { ...terminal, sourceRevision: 'spoofed' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it('reads only schema-valid attempts through an ownership-bound parameterized query', async () => {
    const query = vi.fn(async () => [started, terminal, { ...terminal, reasonCode: 'https://private.invalid/token' }] as unknown[]);
    const repository = createSourceResolutionAttemptRepository(query);
    await expect(repository.readAttempts(request.serverRequestId, request.ownershipReference)).resolves.toEqual([started, terminal]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ownership_reference = ?'), [request.serverRequestId, request.ownershipReference]);
  });
});

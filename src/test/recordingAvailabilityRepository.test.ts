// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRecordingAvailabilityLoader, recordingAvailabilityReadSql } from '../../server/services/recordingAvailabilityRepository';
import { catalogSubjectSha256 as hash, parseCatalogApprovalUtc, type CatalogAuthorityRequest } from '../../server/services/catalogApprovalPolicy';
import { evaluateRecordingRange, type AvailabilitySnapshot } from '../../shared/recordingAvailability';

// Synthetic records only: no canonical Quran, approved license, live source or activation grant.
const now = Date.UTC(2026, 9, 15, 12);
const scope = { recordingId: 'recording-A', reciterId: 'reader-A', mushafProfileId: 'profile-A', riwayahCode: 'fixture-hafs', numberingSystem: 'fixture-kufi' };
const sha = 'a'.repeat(64);
const envelope = (subjectKind: 'source' | 'profile', subjectId: string, subjectRevision: string, subjectSha256: string) => ({
  schemaVersion: 1, subjectKind, subjectId, subjectRevision, subjectSha256, actorId: 'approver', evidenceId: 'evidence', approvedAtEpochMs: now - 2000,
});
function fixture() {
  const fontBinding = { fontAssetId: 'font-fixture', fontFingerprint: sha, licenseReference: 'font-license-fixture' };
  const policy = (allowedUses: ('audio' | 'text')[]) => ({ allowedUses, rightsReference: 'rights-fixture', attributionReference: 'attribution-fixture', retentionPolicy: 'retention-fixture' });
  const audioPolicy = policy(['audio']);
  const textPolicy = policy(['text']);
  const snapshot: AvailabilitySnapshot = { ...scope, revision: 'coverage-1', sourceId: 'audio-source', sourceRevision: 'a1', state: 'verified',
    issuedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60000, textRevision: 'text-1', textFingerprint: sha, surahAyahCounts: { 1: 7 },
    intervals: [{ surahNumber: 1, fromAyah: 1, toAyah: 7, audioState: 'verified', audioAssetId: 'audio-fixture', audioFingerprint: sha,
      timing: { ...scope, surahNumber: 1, fromAyah: 1, toAyah: 7, documentId: 'timing-fixture', revision: 't1',
        audioAssetId: 'audio-fixture', audioFingerprint: sha, textRevision: 'text-1', textFingerprint: sha,
        validatedLevels: ['ayah'], validationEvidenceId: 'timing-evidence', review: 'approved' } }] };
  const profile = { id: scope.mushafProfileId, revision: 'p1', riwayahCode: scope.riwayahCode, numberingSystem: scope.numberingSystem,
    sourceId: 'text-source', sourceRevision: 's1', textRevision: 'text-1', textFingerprint: sha, surahAyahCounts: { 1: 7 }, fontBinding };
  return { ...scope, catalogReciterId: scope.reciterId, variant: 'fixture-tarteel', active: 1, currentRevision: 'coverage-1',
    mushafProfileRevision: 'p1', sourceId: 'audio-source', sourceRevision: 'a1', profileId: scope.mushafProfileId,
    profileRevision: 'p1', profileSourceId: 'text-source', profileSourceRevision: 's1', textRevision: 'text-1', textFingerprint: sha,
    surahAyahCounts: { 1: 7 }, fontBinding, profileApproval: envelope('profile', scope.mushafProfileId, 'p1', hash(profile)),
    audioSourceId: 'audio-source', audioSourceRevision: 'a1', audioSourceEnabled: 1,
    audioSourceReview: { schemaVersion: 1, policy: audioPolicy, approval: envelope('source', 'audio-source', 'a1', hash({ id: 'audio-source', revision: 'a1', policy: audioPolicy })) },
    textSourceId: 'text-source', textSourceRevision: 's1', textSourceEnabled: 1,
    textSourceReview: { schemaVersion: 1, policy: textPolicy, approval: envelope('source', 'text-source', 's1', hash({ id: 'text-source', revision: 's1', policy: textPolicy })) },
    coverageRecordingId: scope.recordingId, coverageRevision: 'coverage-1', snapshotJson: snapshot, snapshotSha256: hash(snapshot),
    approvalActorId: 'approver', approvedAtUtc: new Date(now - 500).toISOString().replace('Z', '000Z'), approvalEvidenceId: 'coverage-evidence',
    approvalChecksum: hash(snapshot), revokedBy: null, revokedAt: null, revocationEvidenceId: null };
}
type Fixture = ReturnType<typeof fixture>;
function database(row: unknown = fixture()) {
  const query = vi.fn(async (_sql: string, _parameters: readonly string[]) => [row]);
  const verify = vi.fn(async (_request: CatalogAuthorityRequest) => true);
  return { query, verify, load: createRecordingAvailabilityLoader(query, verify, () => now) };
}
function updateSnapshot(row: Fixture, mutate: (snapshot: AvailabilitySnapshot) => void) {
  mutate(row.snapshotJson);
  row.snapshotSha256 = hash(row.snapshotJson);
  row.approvalChecksum = row.snapshotSha256;
}
describe('trusted read-only recording availability repository', () => {
  it('loads exact approved joined records and verifies every authority binding freshly', async () => {
    const row = fixture();
    const db = database(row);
    expect(await db.load(scope)).toEqual(row.snapshotJson);
    expect(db.query).toHaveBeenCalledExactlyOnceWith(recordingAvailabilityReadSql,
      [scope.recordingId, scope.reciterId, scope.mushafProfileId, scope.riwayahCode, scope.numberingSystem]);
    expect(db.verify).toHaveBeenCalledTimes(5);
    const approvalRequests = db.verify.mock.calls.map(([request]) => request).filter(request => request.kind === 'catalog_approval');
    expect(approvalRequests.map(request => request.approval.subjectKind)).toEqual(['source', 'source', 'profile', 'coverage']);
    expect(approvalRequests[3].context).toEqual({ audioSourceSha256: row.audioSourceReview.approval.subjectSha256,
      textSourceSha256: row.textSourceReview.approval.subjectSha256, profileSha256: row.profileApproval.subjectSha256,
      recordingSha256: hash({ id: row.recordingId, reciterId: row.reciterId, mushafProfileId: row.mushafProfileId,
        mushafProfileRevision: row.mushafProfileRevision, sourceId: row.sourceId, sourceRevision: row.sourceRevision, variant: row.variant }) });
    expect(db.verify.mock.calls[4][0]).toEqual({ kind: 'timing_binding', timing: row.snapshotJson.intervals[0].timing,
      snapshotSha256: row.snapshotSha256, context: approvalRequests[3].context });
    await db.load(scope);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.verify).toHaveBeenCalledTimes(10);
  });
  it('decodes mysql JSON string values without accepting a client snapshot', async () => {
    const row = fixture();
    const encoded: Record<string, unknown> = { ...row };
    for (const key of ['snapshotJson', 'surahAyahCounts', 'fontBinding', 'profileApproval', 'audioSourceReview', 'textSourceReview']) encoded[key] = JSON.stringify(encoded[key]);
    expect(await database(encoded).load(scope)).toEqual(row.snapshotJson);
    const db = database();
    expect(await db.load({ ...scope, snapshot: row.snapshotJson } as typeof scope)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('defaults to deny and never treats embedded approval labels as authority', async () => {
    const db = database();
    expect(await createRecordingAvailabilityLoader(db.query, undefined, () => now)(scope)).toBeNull();
    for (const rejectedCall of [0, 1, 2, 3, 4]) {
      const current = database();
      current.verify.mockImplementation(async () => current.verify.mock.calls.length - 1 !== rejectedCall);
      expect(await current.load(scope)).toBeNull();
    }
    expect(await createRecordingAvailabilityLoader(db.query, async () => 'true' as unknown as boolean, () => now)(scope)).toBeNull();
  });
  it('binds variant metadata to fresh authority context and refuses copied coverage approval', async () => {
    const row = fixture(); const db = database(row);
    let approvedRecordingSha256: string | undefined;
    db.verify.mockImplementation(async request => {
      approvedRecordingSha256 ??= request.context.recordingSha256;
      return request.context.recordingSha256 === approvedRecordingSha256;
    });
    expect(await db.load(scope)).not.toBeNull();
    row.variant = 'different-variant';
    expect(await db.load(scope)).toBeNull();
    row.variant = ' ';
    expect(await db.load(scope)).toBeNull();
  });
  it.each(['active', 'audioSourceEnabled', 'textSourceEnabled'])('requires enabled/active numeric server flag %s', async flag => {
    for (const value of [0, true, null, '1']) expect(await database({ ...fixture(), [flag]: value }).load(scope)).toBeNull();
  });
  it.each(['recordingId', 'reciterId', 'mushafProfileId', 'riwayahCode', 'numberingSystem'])('keeps requested %s case-sensitive', async key => {
    expect(await database().load({ ...scope, [key]: scope[key as keyof typeof scope].toLowerCase() === scope[key as keyof typeof scope]
      ? scope[key as keyof typeof scope].toUpperCase() : scope[key as keyof typeof scope].toLowerCase() })).toBeNull();
  });
  it.each(['catalogReciterId', 'profileId', 'profileRevision', 'sourceId', 'sourceRevision', 'profileSourceId', 'profileSourceRevision',
    'coverageRecordingId', 'coverageRevision', 'currentRevision'])('rejects inconsistent joined identity %s', async key => {
    expect(await database({ ...fixture(), [key]: 'different' }).load(scope)).toBeNull();
  });
  it('uses parameters for hostile identifiers and no SQL mutation or provider operation', async () => {
    const db = database();
    const hostile = "recording' OR 1=1 --";
    expect(await db.load({ ...scope, recordingId: hostile })).toBeNull();
    expect(db.query.mock.calls[0][1][0]).toBe(hostile);
    expect(db.query.mock.calls[0][0]).not.toContain(hostile);
    expect(recordingAvailabilityReadSql).toMatch(/^SELECT/);
    expect(recordingAvailabilityReadSql).not.toMatch(/INSERT|UPDATE|DELETE|ALTER|CREATE|DROP/);
  });
  it.each(['revokedBy', 'revokedAt', 'revocationEvidenceId'])('rejects any partial relational revocation %s', async key => {
    expect(await database({ ...fixture(), [key]: '' }).load(scope)).toBeNull();
  });
  it('rejects revocation metadata or JSON role grants on strict approval envelopes', async () => {
    for (const location of ['profile', 'audio', 'text']) {
      const row = fixture();
      const approval = location === 'profile' ? row.profileApproval : location === 'audio' ? row.audioSourceReview.approval : row.textSourceReview.approval;
      Object.assign(approval, { revokedAt: null, role: 'admin' });
      expect(await database(row).load(scope)).toBeNull();
    }
  });
  it('rejects unbound, copied, future, incomplete or wrong-version approvals', async () => {
    for (const change of [{ subjectId: 'other' }, { subjectRevision: 'other' }, { subjectKind: 'source' }, { subjectSha256: 'b'.repeat(64) },
      { actorId: '' }, { evidenceId: '' }, { approvedAtEpochMs: now + 1 }, { schemaVersion: 2 }]) {
      const row = fixture(); Object.assign(row.profileApproval, change);
      expect(await database(row).load(scope)).toBeNull();
    }
    const row = fixture(); row.textSourceReview.approval = row.audioSourceReview.approval;
    expect(await database(row).load(scope)).toBeNull();
  });
  it('requires use-specific source rights and binds changed policy, font, text and counts to approvals', async () => {
    const changes: ((r: Fixture) => void)[] = [r => { r.audioSourceReview.policy.allowedUses = ['text']; },
      r => { r.textSourceReview.policy.allowedUses = ['audio']; }, r => { r.audioSourceReview.policy.rightsReference = ''; },
      r => { r.audioSourceReview.policy.retentionPolicy = 'changed'; }, r => { r.fontBinding.fontFingerprint = 'b'.repeat(64); },
      r => { r.fontBinding.licenseReference = ''; }, r => { r.textFingerprint = 'b'.repeat(64); }, r => { r.surahAyahCounts[1] = 6; }];
    for (const change of changes) { const row = fixture(); change(row); expect(await database(row).load(scope)).toBeNull(); }
  });
  it('checks snapshot SHA, relational approval checksum, snapshot identity and full schema', async () => {
    const changedHash = fixture(); changedHash.snapshotSha256 = 'b'.repeat(64);
    expect(await database(changedHash).load(scope)).toBeNull();
    expect(await database({ ...fixture(), approvalChecksum: 'b'.repeat(64) }).load(scope)).toBeNull();
    for (const field of ['recordingId', 'reciterId', 'mushafProfileId', 'riwayahCode', 'numberingSystem', 'revision', 'sourceId', 'sourceRevision', 'textRevision', 'textFingerprint']) {
      const row = fixture(); updateSnapshot(row, s => Object.assign(s, { [field]: field === 'textFingerprint' ? 'b'.repeat(64) : 'different' }));
      expect(await database(row).load(scope)).toBeNull();
    }
    const row = fixture(); Object.assign(row.snapshotJson, { extra: true });
    expect(await database(row).load(scope)).toBeNull();
  });
  it.each(['surahAyahCounts', 'fontBinding', 'profileApproval', 'audioSourceReview', 'textSourceReview', 'snapshotJson'])('denies malformed JSON field %s', async key => {
    expect(await database({ ...fixture(), [key]: '{' }).load(scope)).toBeNull();
  });
  it('requires exactly one row and propagates database/verifier failures', async () => {
    const query = vi.fn(async () => [] as unknown[]);
    const load = createRecordingAvailabilityLoader(query, async () => true, () => now);
    expect(await load(scope)).toBeNull();
    query.mockResolvedValueOnce([fixture(), fixture()]); expect(await load(scope)).toBeNull();
    query.mockRejectedValueOnce(new Error('database unavailable')); await expect(load(scope)).rejects.toThrow('database unavailable');
    const db = database(); db.verify.mockRejectedValueOnce(new Error('authority unavailable'));
    await expect(db.load(scope)).rejects.toThrow('authority unavailable');
  });
  it('strictly interprets UTC DATETIME(3), rejecting Date objects, offsets and impossible dates', async () => {
    for (const value of [new Date(now), '2026-10-15 12:00:00.000', '2026-10-15T12:00:00Z', '2026-02-30T12:00:00.000Z',
      '2026-10-15T12:00:00.000001Z', '2026-10-15T14:00:00.000+02:00', null]) {
      expect(parseCatalogApprovalUtc(value)).toBeNull();
      expect(await database({ ...fixture(), approvedAtUtc: value }).load(scope)).toBeNull();
    }
    expect(parseCatalogApprovalUtc('2026-10-15T12:00:00.000000Z')).toBe(now);
    expect(await database({ ...fixture(), approvedAtUtc: new Date(now + 1).toISOString() }).load(scope)).toBeNull();
  });
  it('checks TTL both after read and after fresh authority verification', async () => {
    for (const issuedAtEpochMs of [now + 1, now - 3600001]) {
      const row = fixture(); updateSnapshot(row, s => { s.issuedAtEpochMs = issuedAtEpochMs; });
      expect(await database(row).load(scope)).toBeNull();
    }
    const row = fixture(); updateSnapshot(row, s => { s.expiresAtEpochMs = now; });
    expect(await database(row).load(scope)).toBeNull();
    const db = database(); const clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now + 60000);
    expect(await createRecordingAvailabilityLoader(db.query, db.verify, clock)(scope)).toBeNull();
  });
  it.each(['provisional', 'rejected', 'expired'] as const)('preserves authenticated %s timing for audio while export remains denied', async review => {
    const row = fixture(); updateSnapshot(row, s => { s.intervals[0].timing!.review = review; });
    const loaded = await database(row).load(scope);
    expect(loaded?.intervals[0].timing?.review).toBe(review);
    const selection = { ...scope, snapshotRevision: 'coverage-1', surahNumber: 1, fromAyah: 1, toAyah: 7, requiredTiming: 'ayah', intent: 'audio_selection' };
    expect(evaluateRecordingRange(loaded, selection, now)).toEqual({ allowed: true });
    expect(evaluateRecordingRange(loaded, { ...selection, intent: 'final_export' }, now)).toEqual({ allowed: false, reason: 'timing_or_approval_missing' });
  });
  it('permits audio without timing but rejects independently mismatched timing scope or bytes', async () => {
    const noTiming = fixture(); updateSnapshot(noTiming, s => { s.intervals[0].timing = null; });
    const db = database(noTiming); expect(await db.load(scope)).not.toBeNull(); expect(db.verify).toHaveBeenCalledTimes(4);
    for (const field of ['documentId', 'recordingId', 'audioFingerprint', 'textFingerprint']) {
      const row = fixture(); updateSnapshot(row, s => Object.assign(s.intervals[0].timing!, { [field]: field === 'documentId' ? '' : field.endsWith('Fingerprint') ? 'b'.repeat(64) : 'different' }));
      expect(await database(row).load(scope)).toBeNull();
    }
  });
  it('isolates snapshot bytes from mutation by an authority callback', async () => {
    const db = database();
    db.verify.mockImplementation(async request => { if (request.kind === 'timing_binding') request.timing.review = 'rejected'; return true; });
    expect((await db.load(scope))?.intervals[0].timing?.review).toBe('approved');
  });
});

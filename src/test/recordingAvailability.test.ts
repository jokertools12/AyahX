import { describe, expect, it, vi } from 'vitest';
import { evaluateRecordingRange, quranFontBindingSchema, type AvailabilitySnapshot, type RangeSelection } from '../../shared/recordingAvailability';
import { loadAndEvaluateRecordingRange, revalidateRecordingRange, revalidateRenderManifestAvailability } from '../../server/services/recordingAvailabilityService';

// Synthetic identity fixtures, not approved Quran/font/source mappings.
const scope = { reciterId: 'reader', recordingId: 'recording-a', riwayahCode: 'hafs-fixture', mushafProfileId: 'mushaf-fixture', numberingSystem: 'kufi-fixture' };
const hash = 'a'.repeat(64);
const timing = { ...scope, surahNumber: 1, fromAyah: 1, toAyah: 7, documentId: 'timing-a', revision: 't1', audioAssetId: 'asset-a', audioFingerprint: hash,
  textRevision: 'text1', textFingerprint: hash, validatedLevels: ['ayah' as const], validationEvidenceId: 'segments1', review: 'approved' as const };
const makeSnapshot = (): AvailabilitySnapshot => ({ ...scope, revision: 'v1', sourceId: 'fixture', sourceRevision: 'f1',
  state: 'verified', issuedAtEpochMs: 1000, expiresAtEpochMs: 2000, textRevision: 'text1', textFingerprint: hash,
  surahAyahCounts: { 1: 7 }, intervals: [{ surahNumber: 1, fromAyah: 1, toAyah: 7, audioState: 'verified',
    audioAssetId: 'asset-a', audioFingerprint: hash, timing: { ...timing } }] });
const makeSelection = (): RangeSelection => ({ ...scope, snapshotRevision: 'v1', surahNumber: 1, fromAyah: 1, toAyah: 7,
  intent: 'final_export', requiredTiming: 'ayah' });
const deny = (reason: string) => ({ allowed: false, reason });

describe('recording-scoped availability contract', () => {
  it('allows exact approved recording and independent Warsh fixture without cross-mapping', () => {
    expect(evaluateRecordingRange(makeSnapshot(), makeSelection(), 1500)).toEqual({ allowed: true });
    const warsh = { riwayahCode: 'warsh-fixture', mushafProfileId: 'warsh-mushaf-fixture', numberingSystem: 'madani-fixture' };
    const snapshot = { ...makeSnapshot(), ...warsh };
    snapshot.intervals[0].timing = { ...timing, ...warsh };
    expect(evaluateRecordingRange(snapshot, { ...makeSelection(), ...warsh }, 1500)).toEqual({ allowed: true });
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('scope_changed'));
  });
  it.each(Object.keys(scope))('rejects a changed %s even when the reciter otherwise matches', field => {
    expect(evaluateRecordingRange(makeSnapshot(), { ...makeSelection(), [field]: 'different' }, 1500)).toEqual(deny('scope_changed'));
  });
  it.each([null, {}, { ...makeSelection(), intent: 'preview' }, { ...makeSelection(), requiredTiming: 'unknown' },
    { ...makeSelection(), recordingId: ' ' }, { ...makeSelection(), toAyah: 2.5 }])('rejects malformed selection %j', selection => {
    expect(evaluateRecordingRange(makeSnapshot(), selection, 1500)).toEqual(deny('invalid_payload'));
  });
  it.each([999, 2000, NaN, Infinity])('rejects future, expired or invalid server time %s', now => {
    expect(evaluateRecordingRange(makeSnapshot(), makeSelection(), now)).toEqual(deny('snapshot_stale'));
  });
  it('rejects changed revision, excessive TTL, out-of-bounds and reversed ranges', () => {
    expect(evaluateRecordingRange(makeSnapshot(), { ...makeSelection(), snapshotRevision: 'v0' }, 1500)).toEqual(deny('snapshot_stale'));
    expect(evaluateRecordingRange({ ...makeSnapshot(), expiresAtEpochMs: 4000000 }, makeSelection(), 1500)).toEqual(deny('invalid_payload'));
    for (const bounds of [{ toAyah: 8 }, { fromAyah: 6, toAyah: 2 }]) {
      expect(evaluateRecordingRange(makeSnapshot(), { ...makeSelection(), ...bounds }, 1500)).toEqual(deny('invalid_range'));
    }
  });
  it('permits adjacent intervals but rejects a one-ayah gap and overlap', () => {
    const snapshot = makeSnapshot();
    const original = snapshot.intervals[0];
    snapshot.intervals = [{ ...original, toAyah: 3 }, { ...original, fromAyah: 4 }];
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual({ allowed: true });
    snapshot.intervals[1].fromAyah = 5;
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('audio_gap'));
    snapshot.intervals[1].fromAyah = 3;
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('invalid_payload'));
  });
  it('does not treat unknown as missing, or audio-only selection as timing approval', () => {
    expect(evaluateRecordingRange({ ...makeSnapshot(), state: 'unknown' }, makeSelection(), 1500)).toEqual(deny('availability_unknown'));
    const snapshot = makeSnapshot();
    snapshot.intervals[0].timing!.review = 'provisional';
    expect(evaluateRecordingRange(snapshot, { ...makeSelection(), intent: 'audio_selection' }, 1500)).toEqual({ allowed: true });
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('timing_or_approval_missing'));
    snapshot.intervals[0] = { ...snapshot.intervals[0], audioState: 'unknown', timing: null };
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('availability_unknown'));
    snapshot.intervals[0] = { ...snapshot.intervals[0], audioState: 'missing', timing: null };
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('audio_gap'));
  });
  it('does not extend timing beyond certified ayahs or into a different surah', () => {
    const snapshot = makeSnapshot();
    snapshot.intervals[0].timing!.toAyah = 3;
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('timing_or_approval_missing'));
    expect(evaluateRecordingRange(snapshot, { ...makeSelection(), toAyah: 3 }, 1500)).toEqual({ allowed: true });
    snapshot.intervals[0].timing!.surahNumber = 2;
    expect(evaluateRecordingRange(snapshot, { ...makeSelection(), toAyah: 3 }, 1500)).toEqual(deny('timing_or_approval_missing'));
  });
  it.each(['ayah', 'word', 'letter'] as const)('requires explicitly certified %s coverage', requiredTiming => {
    const snapshot = makeSnapshot();
    snapshot.intervals[0].timing!.validatedLevels = [requiredTiming];
    expect(evaluateRecordingRange(snapshot, { ...makeSelection(), requiredTiming }, 1500)).toEqual({ allowed: true });
    snapshot.intervals[0].timing!.validatedLevels = [];
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('invalid_payload'));
  });
  it.each(['audioFingerprint', 'textFingerprint', 'textRevision', 'audioAssetId', 'recordingId', 'riwayahCode', 'mushafProfileId', 'numberingSystem'])('rejects mismatched timing %s', field => {
    const snapshot = makeSnapshot();
    Object.assign(snapshot.intervals[0].timing!, { [field]: field.endsWith('Fingerprint') ? 'b'.repeat(64) : 'different' });
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('identity_mismatch'));
  });
  it('requires byte hashes and approved font provenance', () => {
    expect(quranFontBindingSchema.safeParse({ ...scope, textRevision: 't', textFingerprint: hash,
      fontAssetId: 'font', fontFingerprint: 'unverified', licenseReference: 'license', review: 'approved' }).success).toBe(false);
    const snapshot = makeSnapshot();
    snapshot.intervals[0].audioFingerprint = null;
    expect(evaluateRecordingRange(snapshot, makeSelection(), 1500)).toEqual(deny('invalid_payload'));
  });
  it('reloads server approval rather than accepting a fabricated client snapshot', async () => {
    const load = vi.fn(async () => makeSnapshot());
    expect(await revalidateRecordingRange(makeSelection(), load, () => 1500)).toEqual({ allowed: true });
    const revoked = makeSnapshot();
    revoked.intervals[0].timing!.review = 'rejected';
    load.mockResolvedValueOnce(revoked);
    expect(await revalidateRecordingRange(makeSelection(), load, () => 1500)).toEqual(deny('timing_or_approval_missing'));
    expect(load).toHaveBeenCalledWith(scope);
    expect(await revalidateRecordingRange({ ...makeSelection(), snapshot: makeSnapshot() }, load)).toEqual(deny('invalid_payload'));
  });
  it('returns the exact freshly loaded snapshot for downstream audio/timing binding', async () => {
    const snapshot = makeSnapshot();
    const result = await loadAndEvaluateRecordingRange(makeSelection(), async () => snapshot, () => 1500);
    expect(result.decision).toEqual({ allowed: true });
    expect(result.snapshot).toBe(snapshot);
  });
  it('propagates loader failures so admission can return service unavailable', async () => {
    await expect(loadAndEvaluateRecordingRange(makeSelection(), async () => {
      throw new Error('database unavailable');
    }, () => 1500)).rejects.toThrow('database unavailable');
  });
  it('binds the approved timing document and status to the final-export manifest', async () => {
    const manifest = {
      availabilitySelection: { ...scope, snapshotRevision: 'v1', requiredTiming: 'ayah', audioAssetId: 'asset-a', audioFingerprint: hash,
        timingDocumentId: 'timing-a', timingRevision: 't1' },
      canonicalAyahRange: { surahNumber: 1, startAyah: 1, endAyah: 7 },
      audio: { audioContentHash: hash },
      timingMap: { mapId: 'timing-a', availabilityTimingDocumentId: 'timing-a', availabilityTimingRevision: 't1', audioContentHash: hash,
        validationStatus: 'approved', review: { status: 'approved' } },
    };
    const fingerprint = async () => ({ sha256: hash });
    expect(await revalidateRenderManifestAvailability(manifest, async () => makeSnapshot(), () => 1500, fingerprint)).toEqual({ allowed: true });
    expect(await revalidateRenderManifestAvailability({ ...manifest, timingMap: { ...manifest.timingMap, mapId: 'other' } }, async () => makeSnapshot(), () => 1500, fingerprint))
      .toEqual(deny('identity_mismatch'));
    expect(await revalidateRenderManifestAvailability({ ...manifest, timingMap: { ...manifest.timingMap, validationStatus: 'needs_review' } }, async () => makeSnapshot(), () => 1500, fingerprint))
      .toEqual(deny('identity_mismatch'));
  });
});

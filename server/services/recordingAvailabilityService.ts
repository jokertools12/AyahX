import {
  rangeSelectionSchema, evaluateRecordingRange,
  type AvailabilitySnapshot, type ReaderScope, type RangeDecision,
} from '../../shared/recordingAvailability';

/** Inject a repository backed by approved server records, never a client snapshot. */
export type AvailabilityLoader = (scope: ReaderScope) => Promise<AvailabilitySnapshot | null>;
export async function revalidateRenderManifestAvailability(
  manifestInput: unknown, loadCurrent: AvailabilityLoader, clock: () => number = Date.now,
): Promise<RangeDecision> {
  if (!manifestInput || typeof manifestInput !== 'object') return { allowed: false, reason: 'invalid_payload' };
  const manifest = manifestInput as Record<string, any>;
  const availability = manifest.availabilitySelection;
  if (!availability) return { allowed: true };
  const range = manifest.canonicalAyahRange;
  if (!range || !manifest.audio || !manifest.timingMap) return { allowed: false, reason: 'invalid_payload' };
  const { audioAssetId: _audioAssetId, audioFingerprint: _audioFingerprint,
    timingDocumentId: _timingDocumentId, timingRevision: _timingRevision, ...selectionScope } = availability;
  const checked = await loadAndEvaluateRecordingRange({
    ...selectionScope, surahNumber: range.surahNumber, fromAyah: range.startAyah, toAyah: range.endAyah,
    intent: 'final_export',
  }, loadCurrent, clock);
  if (!checked.decision.allowed) return checked.decision;
  const covered = checked.snapshot?.intervals.filter(interval => interval.surahNumber === range.surahNumber
    && interval.toAyah >= range.startAyah && interval.fromAyah <= range.endAyah) ?? [];
  const bindingMatches = covered.length > 0 && covered.every(interval => {
    const timing = interval.timing;
    return interval.audioState === 'verified' && interval.audioAssetId === availability.audioAssetId
      && interval.audioFingerprint === availability.audioFingerprint
      && timing?.documentId === availability.timingDocumentId && timing.revision === availability.timingRevision;
  }) && manifest.audio.audioContentHash === availability.audioFingerprint
    && manifest.timingMap.audioContentHash === availability.audioFingerprint
    && manifest.timingMap.mapId === availability.timingDocumentId
    && manifest.timingMap.availabilityTimingDocumentId === availability.timingDocumentId
    && manifest.timingMap.availabilityTimingRevision === availability.timingRevision
    && manifest.timingMap.validationStatus === 'approved'
    && manifest.timingMap.review?.status === 'approved';
  return bindingMatches ? { allowed: true } : { allowed: false, reason: 'identity_mismatch' };
}

export async function loadAndEvaluateRecordingRange(
  selectionInput: unknown, loadCurrent: AvailabilityLoader, clock: () => number = Date.now,
): Promise<{ decision: RangeDecision; snapshot: AvailabilitySnapshot | null }> {
  const parsed = rangeSelectionSchema.safeParse(selectionInput);
  if (!parsed.success) return { decision: { allowed: false, reason: 'invalid_payload' }, snapshot: null };
  const { reciterId, recordingId, riwayahCode, mushafProfileId, numberingSystem } = parsed.data;
  const current = await loadCurrent({ reciterId, recordingId, riwayahCode, mushafProfileId, numberingSystem });
  if (!current) return { decision: { allowed: false, reason: 'availability_unknown' }, snapshot: null };
  return { decision: evaluateRecordingRange(current, parsed.data, clock()), snapshot: current };
}

export async function revalidateRecordingRange(
  selectionInput: unknown, loadCurrent: AvailabilityLoader, clock: () => number = Date.now,
): Promise<RangeDecision> {
  // Evaluate server time after the repository read; approval revocation cannot use a client cache.
  return (await loadAndEvaluateRecordingRange(selectionInput, loadCurrent, clock)).decision;
}

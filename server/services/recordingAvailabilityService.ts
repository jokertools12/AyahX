import {
  rangeSelectionSchema, evaluateRecordingRange,
  type AvailabilitySnapshot, type ReaderScope, type RangeDecision,
} from '../../shared/recordingAvailability';

/** Inject a repository backed by approved server records, never a client snapshot. */
export type AvailabilityLoader = (scope: ReaderScope) => Promise<AvailabilitySnapshot | null>;

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

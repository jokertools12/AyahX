import {
  rangeSelectionSchema, evaluateRecordingRange,
  type AvailabilitySnapshot, type ReaderScope, type RangeDecision,
} from '../../shared/recordingAvailability';

/** Inject a repository backed by approved server records, never a client snapshot. */
export type AvailabilityLoader = (scope: ReaderScope) => Promise<AvailabilitySnapshot | null>;

export async function revalidateRecordingRange(
  selectionInput: unknown, loadCurrent: AvailabilityLoader, clock: () => number = Date.now,
): Promise<RangeDecision> {
  const parsed = rangeSelectionSchema.safeParse(selectionInput);
  if (!parsed.success) return { allowed: false, reason: 'invalid_payload' };
  const { reciterId, recordingId, riwayahCode, mushafProfileId, numberingSystem } = parsed.data;
  const current = await loadCurrent({ reciterId, recordingId, riwayahCode, mushafProfileId, numberingSystem });
  if (!current) return { allowed: false, reason: 'availability_unknown' };
  // Evaluate server time after the repository read; approval revocation cannot use a client cache.
  return evaluateRecordingRange(current, parsed.data, clock());
}

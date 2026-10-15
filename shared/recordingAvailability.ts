import { z } from 'zod';

const id = z.string().min(1).max(200).refine(value => value.trim() === value && value.length > 0);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const timingLevelSchema = z.enum(['ayah', 'word', 'letter']);
export type TimingLevel = z.infer<typeof timingLevelSchema>;
export const readerScopeSchema = z.object({
  reciterId: id, recordingId: id, riwayahCode: id,
  mushafProfileId: id, numberingSystem: id,
}).strict();
export type ReaderScope = z.infer<typeof readerScopeSchema>;
const scopeFields = ['reciterId', 'recordingId', 'riwayahCode', 'mushafProfileId', 'numberingSystem'] as const;

/** Hash original font bytes and exact UTF-8 canonical text, without normalization. */
export const quranFontBindingSchema = readerScopeSchema.extend({
  textRevision: id, textFingerprint: sha256Schema,
  fontAssetId: id, fontFingerprint: sha256Schema, licenseReference: id,
  review: z.literal('approved'),
}).strict();

const rangeSchema = z.object({
  surahNumber: z.number().int().min(1).max(114),
  fromAyah: z.number().int().positive().max(1000),
  toAyah: z.number().int().positive().max(1000),
});

const timingBindingSchema = readerScopeSchema.merge(rangeSchema).extend({
  documentId: id, revision: id,
  audioAssetId: id, audioFingerprint: sha256Schema,
  textRevision: id, textFingerprint: sha256Schema,
  // Explicit capabilities certified by segment validation; no letter -> word inference.
  validatedLevels: z.array(timingLevelSchema).min(1).max(3),
  validationEvidenceId: id,
  review: z.enum(['approved', 'provisional', 'rejected', 'expired']),
}).strict().refine(value => value.toAyah >= value.fromAyah, 'Invalid certified timing range');

const intervalSchema = rangeSchema.extend({
  audioState: z.enum(['verified', 'missing', 'unknown']),
  audioAssetId: id.nullable(), audioFingerprint: sha256Schema.nullable(),
  timing: timingBindingSchema.nullable(),
}).strict();

export const MAX_AVAILABILITY_TTL_MS = 60 * 60 * 1000;
export const availabilitySnapshotSchema = readerScopeSchema.extend({
  revision: id, sourceId: id, sourceRevision: id,
  state: z.enum(['verified', 'unknown', 'loading', 'failed']),
  issuedAtEpochMs: z.number().int().nonnegative(),
  expiresAtEpochMs: z.number().int().nonnegative(),
  textRevision: id, textFingerprint: sha256Schema,
  surahAyahCounts: z.record(z.string().regex(/^(?:[1-9]|[1-9][0-9]|10[0-9]|11[0-4])$/), z.number().int().positive().max(1000)),
  intervals: z.array(intervalSchema).max(10000),
}).strict().superRefine((snapshot, ctx) => {
  const ttl = snapshot.expiresAtEpochMs - snapshot.issuedAtEpochMs;
  if (ttl <= 0 || ttl > MAX_AVAILABILITY_TTL_MS) {
    ctx.addIssue({ code: 'custom', message: 'Invalid availability TTL' });
  }
  const previousEnd = new Map<number, number>();
  for (const interval of [...snapshot.intervals].sort((a, b) => a.surahNumber - b.surahNumber || a.fromAyah - b.fromAyah)) {
    const count = snapshot.surahAyahCounts[String(interval.surahNumber)];
    if (!count || interval.toAyah < interval.fromAyah || interval.toAyah > count
      || interval.fromAyah <= (previousEnd.get(interval.surahNumber) ?? 0)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid or overlapping coverage interval' });
    }
    previousEnd.set(interval.surahNumber, interval.toAyah);
    if (interval.audioState === 'verified' && (!interval.audioAssetId || !interval.audioFingerprint)) {
      ctx.addIssue({ code: 'custom', message: 'Verified audio requires asset and byte hash' });
    }
    if (interval.audioState !== 'verified' && interval.timing !== null) {
      ctx.addIssue({ code: 'custom', message: 'Unverified audio cannot certify timing' });
    }
  }
});
export type AvailabilitySnapshot = z.infer<typeof availabilitySnapshotSchema>;
export const rangeSelectionSchema = readerScopeSchema.merge(rangeSchema).extend({
  snapshotRevision: id,
  intent: z.enum(['audio_selection', 'final_export']), requiredTiming: timingLevelSchema,
}).strict();
export type RangeSelection = z.infer<typeof rangeSelectionSchema>;
export type AvailabilityFailure = 'invalid_payload' | 'scope_changed' | 'snapshot_stale'
  | 'availability_unknown' | 'invalid_range' | 'audio_gap' | 'timing_or_approval_missing' | 'identity_mismatch';
export type RangeDecision = { allowed: true } | { allowed: false; reason: AvailabilityFailure };

/** Pure guard, not authority: server callers must reload trusted state before use. */
export function evaluateRecordingRange(snapshotInput: unknown, selectionInput: unknown, nowEpochMs: number): RangeDecision {
  const parsedSnapshot = availabilitySnapshotSchema.safeParse(snapshotInput);
  const parsedSelection = rangeSelectionSchema.safeParse(selectionInput);
  const deny = (reason: AvailabilityFailure): RangeDecision => ({ allowed: false, reason });
  if (!parsedSnapshot.success || !parsedSelection.success) return deny('invalid_payload');
  const snapshot = parsedSnapshot.data;
  const selection = parsedSelection.data;
  if (scopeFields.some(field => snapshot[field] !== selection[field])) return deny('scope_changed');
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < snapshot.issuedAtEpochMs
    || nowEpochMs >= snapshot.expiresAtEpochMs || selection.snapshotRevision !== snapshot.revision) return deny('snapshot_stale');
  if (snapshot.state !== 'verified') return deny('availability_unknown');
  const count = snapshot.surahAyahCounts[String(selection.surahNumber)];
  if (!count || selection.toAyah < selection.fromAyah || selection.toAyah > count) return deny('invalid_range');
  const intervals = snapshot.intervals.filter(item => item.surahNumber === selection.surahNumber
    && item.toAyah >= selection.fromAyah && item.fromAyah <= selection.toAyah).sort((a, b) => a.fromAyah - b.fromAyah);
  let next = selection.fromAyah;
  for (const interval of intervals) {
    if (interval.fromAyah > next) return deny('audio_gap');
    if (interval.audioState === 'unknown') return deny('availability_unknown');
    if (interval.audioState !== 'verified') return deny('audio_gap');
    if (selection.intent === 'final_export') {
      const timing = interval.timing;
      if (!timing || timing.review !== 'approved' || !timing.validatedLevels.includes(selection.requiredTiming)) {
        return deny('timing_or_approval_missing');
      }
      if (timing.surahNumber !== selection.surahNumber
        || timing.fromAyah > Math.max(interval.fromAyah, selection.fromAyah)
        || timing.toAyah < Math.min(interval.toAyah, selection.toAyah)) return deny('timing_or_approval_missing');
      if (scopeFields.some(field => timing[field] !== snapshot[field])
        || timing.audioAssetId !== interval.audioAssetId || timing.audioFingerprint !== interval.audioFingerprint
        || timing.textRevision !== snapshot.textRevision || timing.textFingerprint !== snapshot.textFingerprint) {
        return deny('identity_mismatch');
      }
    }
    next = interval.toAyah + 1;
    if (next > selection.toAyah) return { allowed: true };
  }
  return deny('audio_gap');
}

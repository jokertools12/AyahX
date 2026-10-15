import { z } from 'zod';
import { availabilitySnapshotSchema, readerScopeSchema, sha256Schema } from '../../shared/recordingAvailability';
import type { AvailabilityLoader } from './recordingAvailabilityService';
import { approvalEnvelopeSchema, approvalMatches, catalogId, catalogSubjectSha256, denyCatalogAuthority,
  parseCatalogApprovalUtc, profileFontBindingSchema, sourceReviewSchema, type CatalogAuthorityVerifier } from './catalogApprovalPolicy';

export type CatalogReadQuery = (sql: string, parameters: readonly string[]) => Promise<unknown[]>;
// One statement reads one coherent current revision, its profile, and independently reviewed audio/text sources.
export const recordingAvailabilityReadSql = `SELECT
 r.id AS recordingId, r.reciter_id AS reciterId, rc.id AS catalogReciterId, r.variant, r.active,
 r.current_availability_revision AS currentRevision, r.mushaf_profile_id AS mushafProfileId,
 r.mushaf_profile_revision AS mushafProfileRevision, r.source_id AS sourceId, r.source_revision AS sourceRevision,
 p.id AS profileId, p.revision AS profileRevision, p.riwayah_code AS riwayahCode, p.numbering_system AS numberingSystem,
 p.source_id AS profileSourceId, p.source_revision AS profileSourceRevision,
 p.text_revision AS textRevision, p.text_sha256 AS textFingerprint, p.surah_ayah_counts AS surahAyahCounts,
 p.font_binding_json AS fontBinding, p.approval_json AS profileApproval,
 a.id AS audioSourceId, a.revision AS audioSourceRevision, a.enabled AS audioSourceEnabled, a.review_json AS audioSourceReview,
 t.id AS textSourceId, t.revision AS textSourceRevision, t.enabled AS textSourceEnabled, t.review_json AS textSourceReview,
 c.recording_id AS coverageRecordingId, c.revision AS coverageRevision, c.snapshot_json AS snapshotJson,
 c.snapshot_sha256 AS snapshotSha256, c.approval_actor_id AS approvalActorId,
 DATE_FORMAT(c.approved_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS approvedAtUtc,
 c.approval_evidence_id AS approvalEvidenceId, c.approval_checksum AS approvalChecksum,
 c.revoked_by AS revokedBy, c.revoked_at AS revokedAt, c.revocation_evidence_id AS revocationEvidenceId
 FROM reciter_recordings r
 JOIN reciter_catalog rc ON rc.id = r.reciter_id
 JOIN mushaf_profiles p ON p.id = r.mushaf_profile_id AND p.revision = r.mushaf_profile_revision
 JOIN quran_data_sources a ON a.id = r.source_id AND a.revision = r.source_revision
 JOIN quran_data_sources t ON t.id = p.source_id AND t.revision = p.source_revision
 JOIN recitation_coverage c ON c.recording_id = r.id AND c.revision = r.current_availability_revision
 WHERE r.id = ? AND r.reciter_id = ? AND p.id = ? AND p.riwayah_code = ? AND p.numbering_system = ? LIMIT 2`;
const rowSchema = z.object({
  recordingId: catalogId, reciterId: catalogId, catalogReciterId: catalogId, variant: catalogId, active: z.literal(1),
  currentRevision: catalogId, mushafProfileId: catalogId, mushafProfileRevision: catalogId, sourceId: catalogId, sourceRevision: catalogId,
  profileId: catalogId, profileRevision: catalogId, riwayahCode: catalogId, numberingSystem: catalogId,
  profileSourceId: catalogId, profileSourceRevision: catalogId, textRevision: catalogId, textFingerprint: sha256Schema,
  audioSourceId: catalogId, audioSourceRevision: catalogId, audioSourceEnabled: z.literal(1),
  textSourceId: catalogId, textSourceRevision: catalogId, textSourceEnabled: z.literal(1),
  coverageRecordingId: catalogId, coverageRevision: catalogId, snapshotSha256: sha256Schema,
  approvalActorId: catalogId, approvalEvidenceId: catalogId, approvalChecksum: sha256Schema,
  revokedBy: z.null(), revokedAt: z.null(), revocationEvidenceId: z.null(),
  surahAyahCounts: z.unknown(), fontBinding: z.unknown(), profileApproval: z.unknown(),
  audioSourceReview: z.unknown(), textSourceReview: z.unknown(), snapshotJson: z.unknown(), approvedAtUtc: z.unknown(),
}).strict();
const decode = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
const same = (a: unknown, b: unknown) => catalogSubjectSha256(a) === catalogSubjectSha256(b);
function prepare(row: unknown, requestedScope: unknown, now: number) {
  const r = rowSchema.parse(row);
  const scope = { reciterId: r.reciterId, recordingId: r.recordingId, riwayahCode: r.riwayahCode,
    mushafProfileId: r.mushafProfileId, numberingSystem: r.numberingSystem };
  if (!same(scope, requestedScope) || r.reciterId !== r.catalogReciterId || r.profileId !== r.mushafProfileId
    || r.profileRevision !== r.mushafProfileRevision || r.sourceId !== r.audioSourceId || r.sourceRevision !== r.audioSourceRevision
    || r.profileSourceId !== r.textSourceId || r.profileSourceRevision !== r.textSourceRevision
    || r.coverageRecordingId !== r.recordingId || r.coverageRevision !== r.currentRevision) return null;
  const snapshot = availabilitySnapshotSchema.parse(decode(r.snapshotJson));
  const counts = availabilitySnapshotSchema.innerType().shape.surahAyahCounts.parse(decode(r.surahAyahCounts));
  const fontBinding = profileFontBindingSchema.parse(decode(r.fontBinding));
  const profileApproval = approvalEnvelopeSchema.parse(decode(r.profileApproval));
  const audioReview = sourceReviewSchema.parse(decode(r.audioSourceReview));
  const textReview = sourceReviewSchema.parse(decode(r.textSourceReview));
  const audioSourceSha256 = catalogSubjectSha256({ id: r.audioSourceId, revision: r.audioSourceRevision, policy: audioReview.policy });
  const textSourceSha256 = catalogSubjectSha256({ id: r.textSourceId, revision: r.textSourceRevision, policy: textReview.policy });
  const profileSha256 = catalogSubjectSha256({ id: r.profileId, revision: r.profileRevision, riwayahCode: r.riwayahCode,
    numberingSystem: r.numberingSystem, sourceId: r.profileSourceId, sourceRevision: r.profileSourceRevision,
    textRevision: r.textRevision, textFingerprint: r.textFingerprint, surahAyahCounts: counts, fontBinding });
  const recordingSha256 = catalogSubjectSha256({ id: r.recordingId, reciterId: r.reciterId, mushafProfileId: r.mushafProfileId,
    mushafProfileRevision: r.mushafProfileRevision, sourceId: r.sourceId, sourceRevision: r.sourceRevision, variant: r.variant });
  const approvedAtEpochMs = parseCatalogApprovalUtc(r.approvedAtUtc);
  if (approvedAtEpochMs === null) return null;
  const coverageApproval = approvalEnvelopeSchema.parse({ schemaVersion: 1, subjectKind: 'coverage', subjectId: r.recordingId,
    subjectRevision: r.coverageRevision, subjectSha256: r.snapshotSha256, actorId: r.approvalActorId,
    evidenceId: r.approvalEvidenceId, approvedAtEpochMs });
  if (!Number.isSafeInteger(now) || now < snapshot.issuedAtEpochMs || now >= snapshot.expiresAtEpochMs
    || !same(readerScopeSchema.parse(scope), readerScopeSchema.parse({ reciterId: snapshot.reciterId, recordingId: snapshot.recordingId,
      riwayahCode: snapshot.riwayahCode, mushafProfileId: snapshot.mushafProfileId, numberingSystem: snapshot.numberingSystem }))
    || snapshot.revision !== r.coverageRevision || snapshot.sourceId !== r.sourceId || snapshot.sourceRevision !== r.sourceRevision
    || snapshot.textRevision !== r.textRevision || snapshot.textFingerprint !== r.textFingerprint || !same(snapshot.surahAyahCounts, counts)
    || catalogSubjectSha256(snapshot) !== r.snapshotSha256 || r.approvalChecksum !== r.snapshotSha256
    || !audioReview.policy.allowedUses.includes('audio') || !textReview.policy.allowedUses.includes('text')) return null;
  if (!approvalMatches(audioReview.approval, 'source', r.audioSourceId, r.audioSourceRevision, audioSourceSha256, now)
    || !approvalMatches(textReview.approval, 'source', r.textSourceId, r.textSourceRevision, textSourceSha256, now)
    || !approvalMatches(profileApproval, 'profile', r.profileId, r.profileRevision, profileSha256, now)
    || !approvalMatches(coverageApproval, 'coverage', r.recordingId, r.coverageRevision, r.snapshotSha256, now)) return null;
  // Timing is independently bound to the same bytes, exact text and recording before authority checks.
  for (const interval of snapshot.intervals) {
    const timing = interval.timing;
    if (timing && (!same(readerScopeSchema.strip().parse(timing), scope)
      || timing.audioAssetId !== interval.audioAssetId || timing.audioFingerprint !== interval.audioFingerprint
      || timing.textRevision !== r.textRevision || timing.textFingerprint !== r.textFingerprint
      || timing.surahNumber !== interval.surahNumber || timing.toAyah > counts[String(timing.surahNumber)]
      || timing.fromAyah > interval.toAyah || timing.toAyah < interval.fromAyah)) return null;
  }
  return { snapshot, approvals: [audioReview.approval, textReview.approval, profileApproval, coverageApproval],
    context: { recordingSha256, audioSourceSha256, textSourceSha256, profileSha256 }, snapshotSha256: r.snapshotSha256 };
}

/** Read-only, no caching, pool import, activation bypass, provider fetch or approval mutation. */
export function createRecordingAvailabilityLoader(query: CatalogReadQuery,
  verify: CatalogAuthorityVerifier = denyCatalogAuthority, clock: () => number = Date.now): AvailabilityLoader {
  return async input => {
    const parsed = readerScopeSchema.safeParse(input);
    if (!parsed.success) return null;
    const s = parsed.data;
    const rows = await query(recordingAvailabilityReadSql, [s.recordingId, s.reciterId, s.mushafProfileId, s.riwayahCode, s.numberingSystem]);
    if (rows.length !== 1) return null;
    let prepared: ReturnType<typeof prepare>;
    try { prepared = prepare(rows[0], s, clock()); } catch { return null; }
    if (!prepared) return null;
    const { snapshot, approvals, context, snapshotSha256 } = prepared;
    for (const approval of approvals)
      if (await verify(structuredClone({ kind: 'catalog_approval', approval, context })) !== true) return null;
    for (const interval of snapshot.intervals)
      if (interval.timing && await verify(structuredClone({ kind: 'timing_binding', timing: interval.timing, snapshotSha256, context })) !== true) return null;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < snapshot.issuedAtEpochMs || now >= snapshot.expiresAtEpochMs
      || approvals.some(approval => approval.approvedAtEpochMs > now)) return null;
    return snapshot;
  };
}

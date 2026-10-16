import { z } from 'zod';
import type { AvailabilitySnapshot } from '../../shared/recordingAvailability';
import { sha256Schema } from '../../shared/recordingAvailability';
import { canonicalJson, hashBytes } from '../utils/canonicalIntegrity';

export const catalogId = z.string().min(1).max(200).refine(value => value.trim() === value);
export const approvalEnvelopeSchema = z.object({
  schemaVersion: z.literal(1), subjectKind: z.enum(['source', 'profile', 'coverage', 'timing']),
  subjectId: catalogId, subjectRevision: catalogId, subjectSha256: sha256Schema,
  actorId: catalogId, evidenceId: catalogId, approvedAtEpochMs: z.number().int().nonnegative().safe(),
}).strict();
export type CatalogApprovalEnvelope = z.infer<typeof approvalEnvelopeSchema>;
export const sourceReviewSchema = z.object({ schemaVersion: z.literal(1), policy: z.object({
  allowedUses: z.array(z.enum(['audio', 'text'])).min(1).max(2).refine(uses => new Set(uses).size === uses.length),
  rightsReference: catalogId, attributionReference: catalogId, retentionPolicy: catalogId,
}).strict(), approval: approvalEnvelopeSchema }).strict();
export const profileFontBindingSchema = z.object({ fontAssetId: catalogId,
  fontFingerprint: sha256Schema, licenseReference: catalogId }).strict();
export type CatalogApprovalContext = Readonly<{
  recordingSha256: string; profileSha256: string; audioSourceSha256: string; textSourceSha256: string;
}>;
type TimingBinding = NonNullable<AvailabilitySnapshot['intervals'][number]['timing']>;
export type CatalogAuthorityRequest =
  | { kind: 'catalog_approval'; approval: CatalogApprovalEnvelope; context: CatalogApprovalContext }
  | { kind: 'timing_binding'; timing: TimingBinding; snapshotSha256: string; context: CatalogApprovalContext };
/** Must consult current server authority/evidence on EVERY load. JSON roles/review labels are not authority. */
export type CatalogAuthorityVerifier = (request: CatalogAuthorityRequest) => Promise<boolean>;
export const denyCatalogAuthority: CatalogAuthorityVerifier = async () => false;
export const catalogSubjectSha256 = (value: unknown) => hashBytes(canonicalJson(value));
export function approvalMatches(approval: CatalogApprovalEnvelope, subjectKind: CatalogApprovalEnvelope['subjectKind'],
  subjectId: string, subjectRevision: string, subjectSha256: string, now: number): boolean {
  return approval.subjectKind === subjectKind && approval.subjectId === subjectId
    && approval.subjectRevision === subjectRevision && approval.subjectSha256 === subjectSha256
    && approval.approvedAtEpochMs <= now;
}
/** DATETIME(3) values are stored as UTC by contract; DATE_FORMAT avoids driver/session Date coercion. */
export function parseCatalogApprovalUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:000)?Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    && new Date(milliseconds).toISOString() === value.replace(/(\.\d{3})000Z$/, '$1Z') ? milliseconds : null;
}

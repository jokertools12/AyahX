import {
  resolutionCandidateSchema,
  resolutionLockHashInput,
  validateResolutionCandidate,
  type ResolutionCandidate,
  type ResolutionRequest,
  type SourceFailure,
  type ResolutionProvenance,
} from '../../shared/sourceResolution';
import type { SourceAdapterMap } from './sourceResolutionService';

export type ApprovedSourceRecord = Readonly<{
  sourceId: string;
  sourceRevision: string;
  eligibleLock: ResolutionRequest['lock'];
  candidate: ResolutionCandidate;
  provenance: ResolutionProvenance;
}>;

const sourceKey = (sourceId: string, sourceRevision: string) => `${sourceId}@${sourceRevision}`;

function failureForRecord(record: ApprovedSourceRecord, request: ResolutionRequest): SourceFailure | null {
  if (resolutionLockHashInput(record.eligibleLock) !== resolutionLockHashInput(request.lock)) return 'not_indexed';
  const candidateFailure = validateResolutionCandidate(request.lock, record.candidate, request.purpose);
  if (candidateFailure) return candidateFailure;
  const provenance = resolutionCandidateSchema.parse(record.candidate).provenance;
  if (!provenance) return 'invalid_payload';
  if (provenance.sourceId !== record.sourceId || provenance.sourceRevision !== record.sourceRevision) return 'invalid_payload';
  if (provenance.licenseReference.length === 0 || provenance.contentChecksum.length !== 64) return 'invalid_payload';
  return null;
}

/**
 * Builds server-owned adapters from records that have already passed source
 * review. No network call or provider fallback is performed here.
 */
export function createApprovedSourceAdapters(records: readonly ApprovedSourceRecord[]): SourceAdapterMap<ResolutionCandidate> {
  const adapters: Record<string, (request: ResolutionRequest, source: ResolutionRequest['policy']['sources'][number]) => Promise<ResolutionCandidate | SourceFailure>> = {};
  for (const record of records) {
    const key = sourceKey(record.sourceId, record.sourceRevision);
    adapters[key] = async (request, source) => {
      if (source.sourceId !== record.sourceId || source.sourceRevision !== record.sourceRevision) return 'not_indexed';
      const failure = failureForRecord(record, request);
      if (failure) return failure;
      return {
        ...record.candidate,
        provenance: record.provenance,
      };
    };
  }
  return adapters;
}

export { sourceKey as approvedSourceKey };

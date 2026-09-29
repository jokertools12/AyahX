import { afterEach, describe, expect, it } from 'vitest';
import {
  issueApprovedTimingMapAttestation,
  verifyApprovedTimingMapAttestation,
  type AttestableTimingMap,
} from '../../server/services/alignmentAttestation';

const previousSecret = process.env.ALIGNMENT_ATTESTATION_SECRET;
const previousTtl = process.env.ALIGNMENT_ATTESTATION_TTL_SECONDS;

function approvedMap(): AttestableTimingMap {
  return {
    mapId: 'aln-qf-example',
    audioContentHash: 'a'.repeat(64),
    validationStatus: 'approved',
    sourceId: 'quran_foundation',
    sourceMethod: 'quran_foundation_segments',
    alignment: { provider: 'quran_foundation', providerVersion: 'qdc-v4-segments-v1', requestedGranularity: 'word', availableGranularities: ['word'] },
    words: [{ canonicalWordKey: '1:1:1', occurrenceId: '1:1:1#1', displayWordIndex: 0, displayToken: 'قُلْ', normalizedAlignmentToken: 'قل', startMs: 100, endMs: 400, confidence: 1 }],
    gaps: [],
  };
}

afterEach(() => {
  if (previousSecret === undefined) delete process.env.ALIGNMENT_ATTESTATION_SECRET;
  else process.env.ALIGNMENT_ATTESTATION_SECRET = previousSecret;
  if (previousTtl === undefined) delete process.env.ALIGNMENT_ATTESTATION_TTL_SECONDS;
  else process.env.ALIGNMENT_ATTESTATION_TTL_SECONDS = previousTtl;
});

describe('approved timing map attestation', () => {
  it('binds exact timing evidence to one user and expires it', () => {
    process.env.ALIGNMENT_ATTESTATION_SECRET = 's'.repeat(48);
    process.env.ALIGNMENT_ATTESTATION_TTL_SECONDS = '60';
    const map = approvedMap();
    map.alignment!.providerResultId = issueApprovedTimingMapAttestation(map, 'user-a', 0)!;
    expect(map.alignment!.providerResultId).toMatch(/^a1\./);
    expect(verifyApprovedTimingMapAttestation(map, 'user-a', 1_000)).toEqual({ valid: true });
    expect(verifyApprovedTimingMapAttestation(map, 'user-b', 1_000)).toMatchObject({ valid: false });
    expect(verifyApprovedTimingMapAttestation(map, 'user-a', 61_000)).toMatchObject({ valid: false, code: 'ALIGNMENT_ATTESTATION_EXPIRED' });
  });

  it('invalidates a token when a browser changes one word boundary', () => {
    process.env.ALIGNMENT_ATTESTATION_SECRET = 'k'.repeat(48);
    const map = approvedMap();
    map.alignment!.providerResultId = issueApprovedTimingMapAttestation(map, 'user-a', 1_000)!;
    map.words![0].endMs = 401;
    expect(verifyApprovedTimingMapAttestation(map, 'user-a', 2_000)).toMatchObject({ valid: false, code: 'ALIGNMENT_ATTESTATION_INVALID' });
  });

  it('allows non-approved maps through the static-render path without a token', () => {
    const map = approvedMap();
    map.validationStatus = 'needs_review';
    expect(verifyApprovedTimingMapAttestation(map, 'user-a')).toEqual({ valid: true });
  });
});

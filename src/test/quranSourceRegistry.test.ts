import { describe, expect, it } from 'vitest';
import { getQuranSourceCandidate, isQuranSourceActivationReady, listQuranSourceCandidates } from '../../server/services/quranSourceRegistry';

const expectedIds = [
  'approved-local-cache', 'qul', 'qud-universal-ayahs', 'quran-com-v4', 'cpfair-quran-align',
  'kfgqpc', 'mp3quran-v3', 'qud-phonemizer', 'qud-universal-aligner', 'everyayah',
  'fawazahmed0', 'islamic-network', 'qud-universal-audio',
];

describe('Quran source candidate registry', () => {
  it('covers the plan candidates and keeps IDs unique', () => {
    const rows = listQuranSourceCandidates();
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expectedIds);
  });

  it('keeps every candidate disabled and review-pending', () => {
    for (const row of listQuranSourceCandidates()) {
      expect(row.productionEnabled).toBe(false);
      for (const field of ['endpoint', 'license', 'storage', 'cors', 'rateLimits', 'identity'] as const) {
        expect(['needs_review', 'verified', 'not_applicable']).toContain(row[field].status);
        if (field !== 'cors' && field !== 'rateLimits' || row.id !== 'approved-local-cache') {
          expect(row[field].status).toBe('needs_review');
        }
      }
    }
  });

  it('returns isolated copies and no activation mutation surface', () => {
    const first = listQuranSourceCandidates();
    (first[0].kinds as string[]).push('forged');
    (first[0].license as { status: string }).status = 'verified';
    expect(getQuranSourceCandidate('approved-local-cache')?.kinds).not.toContain('forged');
    expect(getQuranSourceCandidate('approved-local-cache')?.license.status).toBe('needs_review');
    expect(getQuranSourceCandidate('not-a-source')).toBeUndefined();
  });

  it('records pinned existing QUA and cpfair revisions as distinct candidates', () => {
    expect(getQuranSourceCandidate('qud-universal-audio')?.revision).toBe('v3.2.0');
    expect(getQuranSourceCandidate('cpfair-quran-align')?.revision).toBe('quran-align@release-2016-11-24');
    expect(getQuranSourceCandidate('qud-universal-audio')?.id).not.toBe('qud-universal-ayahs');
  });

  it('keeps activation denied until every evidence field is reviewed', () => {
    expect(listQuranSourceCandidates().every((source) => !isQuranSourceActivationReady(source))).toBe(true);
    const reviewed = {
      ...listQuranSourceCandidates()[0],
      productionEnabled: true as const,
      revision: 'local-v1',
      endpoint: { status: 'verified' as const, reference: 'https://internal.example/endpoint' },
      license: { status: 'verified' as const, reference: 'https://internal.example/license' },
      storage: { status: 'verified' as const, reference: 'https://internal.example/storage' },
      cors: { status: 'not_applicable' as const },
      rateLimits: { status: 'not_applicable' as const },
      identity: { status: 'verified' as const, reference: 'https://internal.example/identity' },
    };
    expect(isQuranSourceActivationReady(reviewed)).toBe(true);
    expect(isQuranSourceActivationReady({ ...reviewed, license: { status: 'verified' } })).toBe(false);
  });
});

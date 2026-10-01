import { afterEach, describe, expect, it } from 'vitest';
import {
  issueApprovedTimingMapAttestation,
  attestTimingMapForUser,
  verifyApprovedTimingMapAttestation,
  type AttestableTimingMap,
} from '../../server/services/alignmentAttestation';
import { buildClientRenderManifest } from '../lib/renderManifest';
import { validateRenderManifest } from '../../server/models/renderManifest';

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
  it.each(['verified_dataset', 'quranic_universal_aligner', 'quran_foundation'])('preserves %s proof through browser serialization and server parsing', (provider) => {
    process.env.ALIGNMENT_ATTESTATION_SECRET = 'r'.repeat(48);
    const map = approvedMap();
    map.sourceId = provider;
    map.alignment!.provider = provider;
    map.words![0].flags = ['verified'];
    // Older dataset maps may omit occurrence ids. Serialization must not add
    // evidence which was absent when the server signed the map.
    delete map.words![0].occurrenceId;
    const signed = attestTimingMapForUser(map, 'owner');
    const manifest = buildClientRenderManifest({
      aspectRatio: '9:16', quality: 'medium', fps: 30,
      surah: { number: 1, name: 'الفاتحة' }, ayahRange: { start: 1, end: 1 },
      ayahs: [{ numberInSurah: 1, text: 'قُلْ' }], reciter: { id: 'test', name: 'test' },
      timingMap: { ...signed, createdAt: new Date().toISOString() } as any,
      audio: { sourceMode: 'single_url', audioUrl: 'https://everyayah.com/data/Alafasy_128kbps/001001.mp3', audioContentHash: map.audioContentHash!, durationSeconds: 1 },
      background: { id: 'test', type: 'color', url: '#123456' },
      textSettings: { fontSize: 28, fontFamily: '"Amiri", serif', textColor: '#ffffff', shadowIntensity: 0.5, overlayOpacity: 0.4 },
      displaySettings: {}, renderEngine: 'skia_canvas',
    });
    const parsed = validateRenderManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.errors).toBeUndefined();
    expect(verifyApprovedTimingMapAttestation(parsed.manifest!.timingMap, 'owner')).toEqual({ valid: true });
    expect(verifyApprovedTimingMapAttestation(parsed.manifest!.timingMap, 'other')).toMatchObject({ valid: false });
    parsed.manifest!.timingMap.words[0].endMs += 1;
    expect(verifyApprovedTimingMapAttestation(parsed.manifest!.timingMap, 'owner')).toMatchObject({ valid: false, code: 'ALIGNMENT_ATTESTATION_INVALID' });
  });

  it('keeps guest preview maps unsigned without mutating the source map', () => {
    process.env.ALIGNMENT_ATTESTATION_SECRET = 'r'.repeat(48);
    const map = approvedMap();
    expect(attestTimingMapForUser(map)).toBe(map);
    expect(attestTimingMapForUser(map, 'owner').alignment?.providerResultId).toMatch(/^a1\./);
    expect(map.alignment?.providerResultId).toBeUndefined();
  });
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

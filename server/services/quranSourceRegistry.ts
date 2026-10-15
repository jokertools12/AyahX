/**
 * Task 0.1 inventory only. Candidates are not reviewed source approvals and
 * never activate adapters. Existing legacy providers are intentionally outside
 * this registry's activation path.
 */
export type ReviewStatus = 'needs_review' | 'verified' | 'not_applicable';
export type SourceReview = Readonly<{ status: ReviewStatus; reference?: string }>;
export type QuranSourceCandidate = Readonly<{
  id: string;
  kinds: readonly string[];
  reference?: string;
  revision?: string;
  productionEnabled: false;
  endpoint: SourceReview;
  license: SourceReview;
  storage: SourceReview;
  cors: SourceReview;
  rateLimits: SourceReview;
  identity: SourceReview;
}>;

const evidenceFields = ['endpoint', 'license', 'storage', 'cors', 'rateLimits', 'identity'] as const;

const review = (reference?: string): SourceReview => ({ status: 'needs_review', ...(reference ? { reference } : {}) });
const na: SourceReview = { status: 'not_applicable' };
const candidate = (
  id: string, kinds: string[], reference?: string, revision?: string,
): QuranSourceCandidate => ({
  id, kinds, ...(reference ? { reference } : {}), ...(revision ? { revision } : {}),
  productionEnabled: false,
  endpoint: reference?.startsWith('https://') ? review(reference) : review(),
  license: review(), storage: review(), cors: id === 'approved-local-cache' ? na : review(),
  rateLimits: id === 'approved-local-cache' ? na : review(), identity: review(),
});

// Reference URLs are copied from the plan example or existing source code.
// Names without a concrete URL remain names; endpoint details need review.
const candidates: readonly QuranSourceCandidate[] = Object.freeze([
  candidate('approved-local-cache', ['approved_text', 'approved_alignment'], 'internal-local-or-r2'),
  candidate('qul', ['text', 'font', 'timing'], 'qul.tarteel.ai'),
  candidate('qud-universal-ayahs', ['text', 'word_timing', 'letter_timing', 'font'], 'QUD-Technologies/quranic-universal-ayahs'),
  candidate('quran-com-v4', ['audio', 'timing'], 'https://api.quran.com/api/v4'),
  candidate('cpfair-quran-align', ['timing'], 'cpfair/quran-align', 'quran-align@release-2016-11-24'),
  candidate('kfgqpc', ['text', 'font'], 'King Fahd Quran Printing Complex data/fonts'),
  candidate('mp3quran-v3', ['audio', 'ayah_timing', 'reciter_catalog'], 'MP3Quran API v3'),
  candidate('qud-phonemizer', ['phonemes', 'tajweed', 'estimated_timing'], 'QUD-Technologies/quranic-phonemizer'),
  candidate('qud-universal-aligner', ['ai_alignment'], 'QUD-Technologies / hetchyy quranic-universal-aligner'),
  candidate('everyayah', ['audio'], 'EveryAyah'),
  candidate('fawazahmed0', ['text', 'translation'], 'fawazahmed0/quran-api'),
  candidate('islamic-network', ['audio'], 'Islamic Network / AlQuran Cloud'),
  // Distinct from QUD Universal Ayahs. Existing code pins its package release.
  candidate(
    'qud-universal-audio', ['audio', 'word_timing', 'letter_timing'],
    'https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/v3.2.0',
    'v3.2.0',
  ),
]);

function copy(candidate: QuranSourceCandidate): QuranSourceCandidate {
  return {
    ...candidate,
    kinds: [...candidate.kinds],
    endpoint: { ...candidate.endpoint },
    license: { ...candidate.license },
    storage: { ...candidate.storage },
    cors: { ...candidate.cors },
    rateLimits: { ...candidate.rateLimits },
    identity: { ...candidate.identity },
  };
}

/** Returns detached copies; callers cannot mutate the server's candidate inventory. */
export function listQuranSourceCandidates(): QuranSourceCandidate[] {
  return candidates.map(copy);
}

/** Returns a detached copy for a known source ID. */
export function getQuranSourceCandidate(id: string): QuranSourceCandidate | undefined {
  const found = candidates.find((item) => item.id === id);
  return found ? copy(found) : undefined;
}

/** Inventory presence is not enough to activate a source in production. */
export function isQuranSourceActivationReady(source: QuranSourceCandidate): boolean {
  if (!source.productionEnabled || !source.revision) return false;
  return evidenceFields.every((field) => {
    const evidence = source[field];
    return evidence.status === 'not_applicable'
      || (evidence.status === 'verified' && typeof evidence.reference === 'string' && evidence.reference.length > 0);
  });
}

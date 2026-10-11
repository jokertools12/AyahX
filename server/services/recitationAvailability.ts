import { createHash } from 'node:crypto';
export type AvailabilityState = 'complete' | 'near_complete' | 'partial' | 'unavailable';
export type AyahRun = [number, number];
export interface AvailabilityTiming {
  ayah: number; coverage_words: number; expected_words: number | null;
  review_status: string; review_reasons: string[]; missing_words: Array<[number, string]>;
}
export interface AvailabilityChapter {
  id: string; surah: number; canonical: boolean; expected_ayahs: number | null;
  available_ayahs: number; coverage_mismatch: boolean; ayahs_complete: boolean;
  is_complete: boolean; timing_complete: boolean;
}
export interface ChapterAvailability {
  id: string; surah: number; availability_state: AvailabilityState; available_runs: AyahRun[];
  run_count: number; max_run_ayahs: number; ready_ayahs: number;
  near_complete_missing: Array<{ ayah: number; words: Array<[number, string]>; review_reasons: string[] }>;
  catalog_blocked: boolean; diagnostic_ready_runs: AyahRun[];
}
export function connectedAyahRuns(ayahs: readonly number[]): AyahRun[] {
  const sorted = [...new Set(ayahs)].sort((a,b)=>a-b); const runs: AyahRun[]=[];
  for (const ayah of sorted) {
    if (!Number.isSafeInteger(ayah) || ayah < 1) throw new Error('INVALID_AYAH_RUN');
    const last = runs.at(-1); if (last && ayah === last[1]+1) last[1] = ayah; else runs.push([ayah,ayah]);
  }
  return runs;
}
export function isRangeAvailable(runs: readonly AyahRun[], from: number, to: number): boolean {
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from>=1 && to>=from && runs.some(([a,b])=>from>=a && to<=b);
}
/** Metadata mismatch remains a D2 guard. Never turns timing-only coverage into audio availability. */
export function computeChapterAvailability(chapter: AvailabilityChapter, timings: readonly AvailabilityTiming[], legalWords: ReadonlyMap<number,number>): ChapterAvailability {
  const seen = new Set<number>(); const ready: number[]=[];
  const missing: ChapterAvailability['near_complete_missing']=[];
  for (const timing of timings) {
    if (seen.has(timing.ayah)) throw new Error('DUPLICATE_AYAH_TIMING'); seen.add(timing.ayah);
    if (chapter.canonical && timing.expected_words !== legalWords.get(timing.ayah)) throw new Error('TIMING_LEGAL_WORD_COUNT_MISMATCH');
    if (timing.expected_words !== null && timing.coverage_words+timing.missing_words.length!==timing.expected_words) throw new Error('TIMING_WORD_ACCOUNTING_MISMATCH');
    if (chapter.canonical && timing.expected_words !== null && timing.coverage_words===timing.expected_words && timing.review_status==='ready' && timing.review_reasons.length===0 && timing.missing_words.length===0) ready.push(timing.ayah);
    if (chapter.canonical && (timing.missing_words.length || timing.review_reasons.length)) missing.push({ayah:timing.ayah,words:timing.missing_words,review_reasons:timing.review_reasons});
  }
  if (chapter.canonical) for (const [ayah, words] of legalWords) if (!seen.has(ayah)) {
    missing.push({ayah,words:Array.from({length:words},(_,i)=>[i+1,'MISSING_TIMING_ROW'] as [number,string]),review_reasons:['MISSING_TIMING_ROW']});
  }
  missing.sort((a,b)=>a.ayah-b.ayah);
  const diagnosticRuns=connectedAyahRuns(ready); const blocked=!chapter.canonical || chapter.coverage_mismatch || chapter.available_ayahs===0;
  const runs=blocked?[]:diagnosticRuns;
  const missingCount=missing.reduce((n,a)=>n+a.words.length,0);
  const complete=chapter.canonical && !blocked && ready.length===legalWords.size && chapter.ayahs_complete && chapter.timing_complete && chapter.is_complete;
  const state: AvailabilityState = complete?'complete':!blocked && missingCount>=1 && missingCount<=3 && seen.size===legalWords.size?'near_complete':runs.length?'partial':'unavailable';
  return {id:chapter.id,surah:chapter.surah,availability_state:state,available_runs:runs,run_count:runs.length,
    max_run_ayahs:runs.reduce((n,[a,b])=>Math.max(n,b-a+1),0),ready_ayahs:ready.length,near_complete_missing:missing,
    catalog_blocked:blocked,diagnostic_ready_runs:diagnosticRuns};
}
export function availabilityFingerprint(chapters: readonly ChapterAvailability[]): string {
  return createHash('sha256').update(JSON.stringify([...chapters].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
}

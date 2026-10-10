/** Read-only aggregates avoid a large join of materialized timing and legal-word tables. */
export const chapterTimingVerificationQueries = [
  "SELECT JSON_OBJECT('recitation_id',r.id,'surah',c.surah,'canonical',r.canonical_text_available,'ayahs_complete',c.ayahs_complete,'covered',c.coverage_words,'expected',c.expected_words,'timing_complete',c.timing_complete,'is_complete',c.is_complete) AS record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id",
  "SELECT JSON_OBJECT('recitation_id',recitation_id,'surah',surah,'rows',COUNT(*),'covered',SUM(coverage_words),'missing',SUM(JSON_LENGTH(missing_words)),'review',SUM(review_status<>'ready')) AS record FROM ayah_timings FORCE INDEX(PRIMARY) GROUP BY recitation_id,surah",
  "SELECT JSON_OBJECT('surah',a.surah,'ayahs',COUNT(DISTINCT a.id),'words',COUNT(w.id)) AS record FROM quran_ayahs a LEFT JOIN quran_words w ON w.ayah_id=a.id GROUP BY a.surah",
];
export function reconcileChapterTimingCoverage(chapters: Array<Record<string,unknown>>, timings: Array<Record<string,unknown>>, legal: Array<Record<string,unknown>>): { coverage_errors: number; checked_chapters: number } {
  const source = new Map(timings.map(r => [String(r.recitation_id)+':'+r.surah,r]));
  const canonical = new Map(legal.map(r => [Number(r.surah),r]));
  let errors=0;
  for (const chapter of chapters) {
    const timing=source.get(String(chapter.recitation_id)+':'+chapter.surah);
    const reference=canonical.get(Number(chapter.surah));
    const hasCanonical=Boolean(Number(chapter.canonical));
    const expected=hasCanonical && reference ? Number(reference.words) : null;
    const complete=hasCanonical && reference && timing && Number(timing.rows)===Number(reference.ayahs) && Number(timing.covered)===expected && Number(timing.missing)===0 && Number(timing.review)===0 ? 1 : 0;
    const storedExpected=chapter.expected===null ? null : Number(chapter.expected);
    if (chapter.covered===null || Number(chapter.covered)!==Number(timing?.covered??0) || storedExpected!==expected || chapter.timing_complete===null || Number(chapter.timing_complete)!==complete || Number(chapter.is_complete)!==(Number(chapter.ayahs_complete) && complete ? 1 : 0) || (hasCanonical && !reference)) errors++;
  }
  return {coverage_errors:errors,checked_chapters:chapters.length};
}

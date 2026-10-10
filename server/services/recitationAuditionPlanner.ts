import {catalogHostAllowed} from './catalogAudioSource';
import {youtubeReference} from './catalogYoutubeMetadata';
/** Pure T5 selection; HEAD evidence is supplied by the caller. No timing or offset conversion. */
export interface AuditionChapter { surah: number; audio_url: string; chapter_offset_ms: number | null }
export interface AuditionLinkEvidence { status: string; httpStatus: number | null; contentType?: string; finalUrl?: string }
export interface AuditionPlannerInput {
  recitation_id: string;
  chapters: readonly AuditionChapter[];
  allowed_hosts: readonly string[];
  link_checks: Readonly<Record<string, AuditionLinkEvidence>>;
  youtube_metadata?: Readonly<Record<string,{status:string}>>;
}
export type AuditionUnavailableReason = 'CHAPTER_NOT_IN_CATALOG' | 'AUDIO_URL_INVALID' | 'AUDIO_URL_UNSAFE'
  | 'AUDIO_HOST_NOT_ALLOWED' | 'SIGNED_AUDIO_URL_NOT_PERSISTABLE' | 'LINK_UNCHECKED' | 'LINK_UNAVAILABLE'
  | 'LINK_RESPONSE_NOT_AUDIO' | 'SOURCE_NOT_INDEPENDENT' | 'YOUTUBE_OFFSET_UNAVAILABLE' | 'YOUTUBE_METADATA_UNAVAILABLE';
export interface AuditionSlot {
  recitation_id: string;
  sample_key: 'fatiha_25s' | 'ikhlas_full' | 'yasin_25s';
  surah: number;
  start_ms: number;
  /** Configured preview limit, not a measured duration. NULL plays the entire independent source. */
  duration_ms: number | null;
  selection_details: {
    requested_surah: number;
    status: 'available' | 'unavailable';
    selection_reason: 'REQUESTED_SURAH' | 'NEAREST_AVAILABLE_INDEPENDENT_SURAH' | 'NO_AVAILABLE_INDEPENDENT_SURAH';
    requested_unavailable_reason: AuditionUnavailableReason | null;
    unavailable_reason: AuditionUnavailableReason | null;
    original_url: string | null;
    playback_url: string | null;
    timing_dependency: false;
    offset_used: false;
    playback_kind?: 'youtube_iframe';
    chapter_offset_ms?: number;
  };
}
function safeUrl(raw: string, hosts: readonly string[]): AuditionUnavailableReason | null {
  let url: URL;
  try { url = new URL(raw); } catch { return 'AUDIO_URL_INVALID'; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
    || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) || url.hostname.includes(':')
    || /(?:^|\.)(?:localhost|local)$/iu.test(url.hostname)) return 'AUDIO_URL_UNSAFE';
  if (!catalogHostAllowed(url.hostname,hosts)
    || /(?:^|\.)(?:youtube\.com|youtu\.be)$/iu.test(url.hostname)) return 'AUDIO_HOST_NOT_ALLOWED';
  if ([...url.searchParams.keys()].some(key => /token|signature|credential|expires|x-amz|x-goog|key-pair-id|policy|^sig$|^api[_-]?key$/iu.test(key))) return 'SIGNED_AUDIO_URL_NOT_PERSISTABLE';
  return null;
}
function sourceIdentity(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'drive.google.com') {
    const id = /\/file\/d\/([^/]+)/u.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
    if (id) return `drive:${id}`;
  }
  url.searchParams.sort();
  return url.href;
}
export function planRecitationAuditions(input: AuditionPlannerInput): AuditionSlot[] {
  if (!input.recitation_id.trim()) throw new Error('AUDITION_INVALID_RECITATION_ID');
  if(input.chapters.length&&input.chapters.every(c=>youtubeReference(c.audio_url))){
    return ([['fatiha_25s',1,25000],['ikhlas_full',112,null],['yasin_25s',36,25000]] as const).map(([key,surah,duration])=>{
      const c=input.chapters.find(c=>c.surah===surah);const ref=c?youtubeReference(c.audio_url):null;
      const reason:AuditionUnavailableReason|null=!c?'CHAPTER_NOT_IN_CATALOG':c.chapter_offset_ms===null?'YOUTUBE_OFFSET_UNAVAILABLE':!Number.isSafeInteger(c.chapter_offset_ms)||c.chapter_offset_ms<0?'YOUTUBE_OFFSET_UNAVAILABLE':!ref||input.youtube_metadata?.[ref.videoId]?.status!=='available'?'YOUTUBE_METADATA_UNAVAILABLE':null;
      return {recitation_id:input.recitation_id,sample_key:key,surah,start_ms:reason?0:c!.chapter_offset_ms!,duration_ms:duration,selection_details:{requested_surah:surah,status:reason?'unavailable':'available',selection_reason:reason?'NO_AVAILABLE_INDEPENDENT_SURAH':'REQUESTED_SURAH',requested_unavailable_reason:reason,unavailable_reason:reason,original_url:c?.audio_url??null,playback_url:reason?null:c!.audio_url,timing_dependency:false,offset_used:false,playback_kind:'youtube_iframe',...(reason?{}:{chapter_offset_ms:c!.chapter_offset_ms!})}};
    });
  }
  const chapters = new Map<number, AuditionChapter>();
  const identityChapters = new Map<string, Set<number>>();
  const identities = (chapter: AuditionChapter): string[] => [chapter.audio_url, input.link_checks[chapter.audio_url]?.finalUrl]
    .filter((url): url is string => Boolean(url) && !safeUrl(url!, input.allowed_hosts)).map(sourceIdentity);
  for (const chapter of input.chapters) {
    if (!Number.isSafeInteger(chapter.surah) || chapter.surah < 1 || chapters.has(chapter.surah)
      || (chapter.chapter_offset_ms !== null && (!Number.isSafeInteger(chapter.chapter_offset_ms) || chapter.chapter_offset_ms < 0))) throw new Error('AUDITION_INVALID_CHAPTER_METADATA');
    chapters.set(chapter.surah, chapter);
    for (const key of identities(chapter)) {
      const surahs = identityChapters.get(key) ?? new Set<number>(); surahs.add(chapter.surah); identityChapters.set(key, surahs);
    }
  }
  const reason = (chapter: AuditionChapter | undefined): AuditionUnavailableReason | null => {
    if (!chapter) return 'CHAPTER_NOT_IN_CATALOG';
    const originalFailure = safeUrl(chapter.audio_url, input.allowed_hosts); if (originalFailure) return originalFailure;
    if ((chapter.chapter_offset_ms ?? 0) !== 0 || identities(chapter).some(key => (identityChapters.get(key)?.size ?? 0) > 1)) return 'SOURCE_NOT_INDEPENDENT';
    const evidence = input.link_checks[chapter.audio_url]; if (!evidence) return 'LINK_UNCHECKED';
    if (evidence.status !== 'available' || ![200, 206].includes(evidence.httpStatus ?? 0)) return 'LINK_UNAVAILABLE';
    if (!evidence.contentType || !/^(?:audio\/|application\/octet-stream(?:;|$))/iu.test(evidence.contentType)) return 'LINK_RESPONSE_NOT_AUDIO';
    return evidence.finalUrl ? safeUrl(evidence.finalUrl, input.allowed_hosts) : null;
  };
  const available = input.chapters.filter(chapter => reason(chapter) === null);
  return ([['fatiha_25s', 1, 25000], ['ikhlas_full', 112, null], ['yasin_25s', 36, 25000]] as const).map(([key, requested, duration]) => {
    const requestedFailure = reason(chapters.get(requested));
    const selected = requestedFailure === null ? chapters.get(requested) : [...available]
      .sort((a, b) => Math.abs(a.surah - requested) - Math.abs(b.surah - requested) || a.surah - b.surah)[0];
    return { recitation_id: input.recitation_id, sample_key: key, surah: selected?.surah ?? requested, start_ms: 0, duration_ms: duration,
      selection_details: { requested_surah: requested, status: selected ? 'available' : 'unavailable',
        selection_reason: !selected ? 'NO_AVAILABLE_INDEPENDENT_SURAH' : requestedFailure === null ? 'REQUESTED_SURAH' : 'NEAREST_AVAILABLE_INDEPENDENT_SURAH',
        requested_unavailable_reason: requestedFailure, unavailable_reason: selected ? null : requestedFailure,
        original_url: selected?.audio_url ?? null, playback_url: selected ? input.link_checks[selected.audio_url].finalUrl ?? selected.audio_url : null,
        timing_dependency: false, offset_used: false } };
  });
}

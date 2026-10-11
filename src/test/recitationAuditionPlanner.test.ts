// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planRecitationAuditions, type AuditionChapter, type AuditionPlannerInput } from '../../server/services/recitationAuditionPlanner';
const chapter = (surah: number): AuditionChapter => ({ surah, audio_url: `https://audio.example/${surah}.mp3`, chapter_offset_ms: null });
const input = (chapters: AuditionChapter[]): AuditionPlannerInput => ({ recitation_id: 'unit-recitation', chapters,
  allowed_hosts: ['audio.example'], link_checks: Object.fromEntries(chapters.map(c => [c.audio_url,
    { status: 'available', httpStatus: 200, contentType: 'audio/mpeg' }])) });
describe('pure independent-source audition slots', () => {
  it('selects three original sources with configured limits, no offset and no mutation', () => {
    const source = input([chapter(1), chapter(112), chapter(36)]); const before = JSON.stringify(source);
    const result = planRecitationAuditions(source);
    expect(result.map(r => [r.sample_key, r.surah, r.start_ms, r.duration_ms])).toEqual([
      ['fatiha_25s', 1, 0, 25000], ['ikhlas_full', 112, 0, null], ['yasin_25s', 36, 0, 25000]]);
    expect(result.every(r => r.selection_details.status === 'available' && !r.selection_details.offset_used)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('chooses the nearest healthy independent original source and smaller chapter for a tie', () => {
    const result = planRecitationAuditions(input([chapter(111), chapter(113), chapter(35), chapter(37)]));
    expect(result.map(r => r.surah)).toEqual([35, 111, 35]);
    expect(result.every(r => r.selection_details.requested_unavailable_reason === 'CHAPTER_NOT_IN_CATALOG')).toBe(true);
    expect(result[1].duration_ms).toBeNull();
  });
  it('refuses nonzero offsets and shared original files rather than borrowing timing offsets', () => {
    const first = { ...chapter(1), chapter_offset_ms: 120000 }; const shared = 'https://audio.example/combined.mp3';
    const source = input([first, { ...chapter(112), audio_url: shared }, { ...chapter(36), audio_url: shared }, chapter(37)]);
    const result = planRecitationAuditions(source);
    expect(result.every(r => r.surah === 37 && r.start_ms === 0)).toBe(true);
    expect(result.every(r => r.selection_details.requested_unavailable_reason === 'SOURCE_NOT_INDEPENDENT')).toBe(true);
  });
  it('also rejects distinct original URLs that resolve to one combined source', () => {
    const source = input([chapter(1), chapter(112)]);
    source.link_checks[source.chapters[0].audio_url].finalUrl = 'https://audio.example/combined.mp3';
    source.link_checks[source.chapters[1].audio_url].finalUrl = 'https://audio.example/combined.mp3';
    const result = planRecitationAuditions(source);
    expect(result.every(r => r.selection_details.status === 'unavailable' && r.selection_details.playback_url === null)).toBe(true);
    expect(result[0].selection_details.unavailable_reason).toBe('SOURCE_NOT_INDEPENDENT');
  });
  it('preserves Drive file ID case while recognizing aliases for the same file', () => {
    const same = input([{ ...chapter(1), audio_url: 'https://drive.google.com/file/d/AbC/view' },
      { ...chapter(112), audio_url: 'https://drive.google.com/uc?id=AbC' }]);
    same.allowed_hosts = ['drive.google.com'];
    expect(planRecitationAuditions(same)[0].selection_details.unavailable_reason).toBe('SOURCE_NOT_INDEPENDENT');
    const different = input([{ ...chapter(1), audio_url: 'https://drive.google.com/file/d/AbC/view' },
      { ...chapter(112), audio_url: 'https://drive.google.com/file/d/abc/view' }]);
    different.allowed_hosts = ['drive.google.com'];
    expect(planRecitationAuditions(different).every(r => r.selection_details.status === 'available')).toBe(true);
  });
  it.each([
    ['blob:local-audio', 'AUDIO_URL_UNSAFE'], ['http://audio.example/1.mp3', 'AUDIO_URL_UNSAFE'],
    ['https://127.0.0.1/1.mp3', 'AUDIO_URL_UNSAFE'], ['https://audio.example/1.mp3?X-Amz-Signature=a', 'SIGNED_AUDIO_URL_NOT_PERSISTABLE'],
    ['https://audio.example/1.mp3?sig=a', 'SIGNED_AUDIO_URL_NOT_PERSISTABLE'], ['https://foreign.example/1.mp3', 'AUDIO_HOST_NOT_ALLOWED'],
  ])('records explicit unavailable reason for unsafe source %s', (url, reason) => {
    const result = planRecitationAuditions(input([{ ...chapter(1), audio_url: url }]));
    expect(result[0].selection_details.unavailable_reason).toBe(reason);
    expect(result.every(r => r.selection_details.playback_url === null)).toBe(true);
  });
  it('requires supplied successful audio evidence and rejects unsafe redirects', () => {
    const source = input([chapter(1), chapter(112), chapter(36)]);
    source.link_checks[source.chapters[0].audio_url].status = 'unchecked';
    source.link_checks[source.chapters[1].audio_url].contentType = 'text/html';
    source.link_checks[source.chapters[2].audio_url].finalUrl = 'https://foreign.example/36.mp3';
    expect(planRecitationAuditions(source).map(r => r.selection_details.unavailable_reason))
      .toEqual(['LINK_UNAVAILABLE', 'LINK_RESPONSE_NOT_AUDIO', 'AUDIO_HOST_NOT_ALLOWED']);
  });
  it('does not treat unchecked links or inconsistent HTTP status as a successful source', () => {
    const source = input([chapter(1), chapter(112)]);
    source.link_checks = { [source.chapters[1].audio_url]: { status: 'available', httpStatus: 404, contentType: 'audio/mpeg' } };
    expect(planRecitationAuditions(source)[0].selection_details.unavailable_reason).toBe('LINK_UNCHECKED');
    expect(planRecitationAuditions(source)[1].selection_details.unavailable_reason).toBe('LINK_UNAVAILABLE');
  });
  it('denies YouTube even when listed, signed redirects and redirects to literal IP addresses', () => {
    const youtube = input([{ ...chapter(1), audio_url: 'https://www.youtube.com/watch?v=AbC' }]);
    youtube.allowed_hosts = ['www.youtube.com'];
    expect(planRecitationAuditions(youtube)[0].selection_details.unavailable_reason).toBe('AUDIO_HOST_NOT_ALLOWED');
    const signed = input([chapter(1)]); signed.link_checks[signed.chapters[0].audio_url].finalUrl = 'https://audio.example/1.mp3?token=secret-unit-placeholder';
    expect(planRecitationAuditions(signed)[0].selection_details.unavailable_reason).toBe('SIGNED_AUDIO_URL_NOT_PERSISTABLE');
    const ip = input([chapter(1)]); ip.link_checks[ip.chapters[0].audio_url].finalUrl = 'https://127.0.0.1/1.mp3';
    expect(planRecitationAuditions(ip)[0].selection_details.unavailable_reason).toBe('AUDIO_URL_UNSAFE');
  });
  it('leaves all three slots unavailable for an empty catalog with explicit reasons', () => {
    const result = planRecitationAuditions(input([])); expect(result).toHaveLength(3);
    expect(result.every(r => r.selection_details.status === 'unavailable' && r.selection_details.unavailable_reason === 'CHAPTER_NOT_IN_CATALOG')).toBe(true);
  });
  it('rejects corrupt input instead of silently normalizing duplicates or invalid offsets', () => {
    expect(() => planRecitationAuditions(input([chapter(1), chapter(1)]))).toThrow('AUDITION_INVALID_CHAPTER_METADATA');
    expect(() => planRecitationAuditions(input([{ ...chapter(1), chapter_offset_ms: -1 }]))).toThrow('AUDITION_INVALID_CHAPTER_METADATA');
  });
});

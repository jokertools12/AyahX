// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CatalogLinkCollisionError, audioFileIdentity, catalogLinkReport, catalogLinkSqlPlan, createLinkCheckpoint,
  reportableAudioUrl, runCatalogLinkChecks, type CatalogLinkCheckpoint, type CatalogLinkTarget,
} from '../../server/services/catalogLinkChecker';

const time = Date.parse('2026-10-10T10:00:00Z');
function target(key: string, overrides: Partial<CatalogLinkTarget> = {}): CatalogLinkTarget {
  return { key, kind: 'chapter', id: key, recitationId: 'recording-1', reciterId: 'reader-1', recitationSlug: 'reader-one-recording',
    surah: 1, url: `https://audio.example/${key}.mp3`, allowedHosts: ['audio.example'], ...overrides };
}
const available = (url: string) => ({ status: 'available', httpStatus: 200, checkedAt: new Date(time).toISOString(), finalUrl: url });
async function run(targets: CatalogLinkTarget[], checkLink = vi.fn(async (url: string) => available(url)), checkpoint = createLinkCheckpoint(targets)) {
  const persisted: CatalogLinkCheckpoint[] = [];
  const result = await runCatalogLinkChecks(targets, { checkpoint, checkLink, persist: value => { persisted.push(structuredClone(value)); }, now: () => time });
  return { result, persisted, checkLink };
}
describe('D4 periodic catalog link checker (unit fixtures; no live network)', () => {
  it('keeps Drive case and YouTube video parameters distinct; omits signed URLs from reports', () => {
    expect(audioFileIdentity('https://drive.google.com/file/d/AbC_1/view')).toBe('google_drive_file:AbC_1');
    expect(audioFileIdentity('https://drive.usercontent.google.com/download?id=AbC_1&export=download')).toBe('google_drive_file:AbC_1');
    expect(audioFileIdentity('https://drive.google.com/uc?id=abc_1')).not.toBe(audioFileIdentity('https://drive.google.com/uc?id=AbC_1'));
    expect(audioFileIdentity('https://www.youtube.com/watch?v=one')).toBeNull();
    expect(audioFileIdentity('https://www.youtube.com/watch?v=two')).toBeNull();
    expect(audioFileIdentity('https://audio.example/file.mp3?v=1')).not.toBe(audioFileIdentity('https://audio.example/file.mp3?v=2'));
    expect(reportableAudioUrl('https://audio.example/file.mp3?X-Amz-Signature=secret')).toBeNull();
  });
  it('stops before network on an original same-file source attributed to different reciters', async () => {
    const targets = [target('first'), target('second', { reciterId: 'reader-2', url: 'https://audio.example/first.mp3' })];
    const checkLink = vi.fn(); const persist = vi.fn();
    await expect(runCatalogLinkChecks(targets, { checkpoint: createLinkCheckpoint(targets), checkLink, persist, now: () => time })).rejects.toBeInstanceOf(CatalogLinkCollisionError);
    expect(checkLink).not.toHaveBeenCalled();
    expect(persist.mock.calls[0][0].stopped.collisions[0].evidence).toBe('original_url_file_identity');
  });
  it('stops with persisted evidence on a final redirect collision; SQL generation cannot continue', async () => {
    const targets = [target('first'), target('second', { reciterId: 'reader-2' }), target('third')];
    const checkLink = vi.fn(async () => available('https://cdn.example/shared.mp3'));
    let saved = createLinkCheckpoint(targets);
    await expect(runCatalogLinkChecks(targets, { checkpoint: saved, checkLink, persist: value => { saved = structuredClone(value); }, now: () => time })).rejects.toThrow('CROSS_RECITER_AUDIO_FILE_COLLISION');
    expect(checkLink).toHaveBeenCalledTimes(2);
    expect(saved.stopped?.collisions[0]).toMatchObject({ evidence: 'resolved_url_file_identity', reciterIds: ['reader-1', 'reader-2'] });
    expect(() => catalogLinkSqlPlan(targets, saved)).toThrow('CATALOG_LINK_CHECKPOINT_INVENTORY_CHANGED_OR_STOPPED');
  });
  it('resumes every chapter without network; checks stale rows and rejects changed inventory or damaged checkpoints', async () => {
    const targets = [target('first'), target('second')];
    const first = await run(targets);
    const second = await run(targets, vi.fn(), first.result);
    expect(second.checkLink).not.toHaveBeenCalled();
    expect(second.result).toEqual(first.result);
    const checkLink = vi.fn(async (url: string) => ({ ...available(url), checkedAt: new Date(time + 25 * 60 * 60 * 1000).toISOString() }));
    await runCatalogLinkChecks(targets, { checkpoint: first.result, checkLink, persist: vi.fn(), now: () => time + 25 * 60 * 60 * 1000 });
    expect(checkLink).toHaveBeenCalledTimes(2);
    expect(() => createLinkCheckpoint([target('first', { url: 'https://audio.example/changed.mp3' }), target('second')], first.result)).toThrow('INVENTORY_CHANGED');
    const corrupted = structuredClone(first.result); corrupted.results.first.check.checkedAt = 'invalid';
    expect(() => createLinkCheckpoint(targets, corrupted)).toThrow('CHECKPOINT_CORRUPT');
  });
  it('preserves Retry-After per host across a restart, does not accelerate retries and allows another host', async () => {
    const targets = [target('a'), target('b'), target('c', { url: 'https://other.example/c.mp3', allowedHosts: ['other.example'] })];
    const retryAt = new Date(time + 2 * 60 * 60 * 1000).toISOString();
    const checkLink = vi.fn(async (url: string) => url.includes('/a.mp3') ? { status: 'AUDIO_RATE_LIMITED', httpStatus: 429, checkedAt: new Date(time).toISOString(), retryAt } : available(url));
    const first = await runCatalogLinkChecks(targets, { checkpoint: createLinkCheckpoint(targets), checkLink, persist: vi.fn(), now: () => time });
    expect(checkLink.mock.calls.map(c => c[0])).toEqual(['https://audio.example/a.mp3', 'https://other.example/c.mp3']);
    expect(first.results.b.check.retryAt).toBe(retryAt);
    const resume = vi.fn(async (url: string) => available(url));
    await runCatalogLinkChecks(targets, { checkpoint: first, checkLink: resume, persist: vi.fn(), now: () => time + 60 * 60 * 1000 });
    expect(resume).not.toHaveBeenCalled();
    const afterExpiry = vi.fn(async (url: string) => ({ ...available(url), checkedAt: new Date(time + 2 * 60 * 60 * 1000).toISOString() }));
    await runCatalogLinkChecks(targets, { checkpoint: first, checkLink: afterExpiry, persist: vi.fn(), now: () => time + 2 * 60 * 60 * 1000 });
    expect(afterExpiry).toHaveBeenCalledTimes(2);
  });
  it('deduplicates same-reader shared resources while retaining a checkpoint for every chapter and alternate', async () => {
    const targets = [target('a'), target('b', { surah: 2, url: 'https://audio.example/a.mp3' }), target('c', { kind: 'alternate', url: 'https://audio.example/a.mp3' })];
    const result = await run(targets);
    expect(result.checkLink).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.result.results)).toHaveLength(3);
    expect(result.persisted).toHaveLength(3);
    for (const row of Object.values(result.result.results)) expect(row.evidenceScope).toBe('link_only_not_voice_identity');
  });
  it('does no network in dry-read mode, but still stops an inventory collision', async () => {
    const targets = [target('a')]; const checkLink = vi.fn(); const persist = vi.fn();
    const checkpoint = await runCatalogLinkChecks(targets, { checkpoint: createLinkCheckpoint(targets), checkLink, persist, checkNetwork: false });
    expect(checkLink).not.toHaveBeenCalled(); expect(checkpoint.results).toEqual({}); expect(persist).toHaveBeenCalledOnce();
    const collision = [target('a'), target('b', { reciterId: 'reader-2', url: targets[0].url })];
    await expect(runCatalogLinkChecks(collision, { checkpoint: createLinkCheckpoint(collision), checkLink, persist, checkNetwork: false })).rejects.toThrow('CROSS_RECITER_AUDIO_FILE_COLLISION');
  });
  it('persists a redirect-host Retry-After and blocks that host after restart', async () => {
    const targets = [target('a', { allowedHosts: ['audio.example', 'cdn.example'] }), target('b', { url: 'https://cdn.example/b.mp3', allowedHosts: ['cdn.example'] })];
    const checkpoint = createLinkCheckpoint(targets);
    const retryAt = new Date(time + 60 * 60 * 1000).toISOString();
    let saved = checkpoint;
    await runCatalogLinkChecks(targets, { checkpoint, now: () => time, persist: value => { saved = structuredClone(value); },
      checkLink: vi.fn(async () => ({ status: 'AUDIO_RATE_LIMITED', httpStatus: 429, checkedAt: new Date(time).toISOString(), retryAt, retryHost: 'cdn.example' })) });
    expect(saved.results.a.check.retryHost).toBe('cdn.example');
    // A new target on that host remains blocked even if its own prior check is stale.
    saved.results.b.check.checkedAt = new Date(time - 25 * 60 * 60 * 1000).toISOString();
    const checkLink = vi.fn();
    const resumed = await runCatalogLinkChecks(targets, { checkpoint: saved, now: () => time + 30 * 60 * 1000, persist: vi.fn(), checkLink });
    expect(checkLink).not.toHaveBeenCalled(); expect(resumed.results.b.check.retryAt).toBe(retryAt);
  });
  it('generates deterministic guarded SQL without unsafe URLs, timing, voice, license, or publication writes', async () => {
    const targets = [target('b', { kind: 'alternate' }), target('a', { url: 'https://audio.example/a.mp3?token=secret' })];
    const checked = await run(targets);
    expect(checked.checkLink).toHaveBeenCalledTimes(1);
    const first = catalogLinkSqlPlan(targets, checked.result), second = catalogLinkSqlPlan([...targets].reverse(), checked.result);
    expect(first).toEqual(second);
    expect(first.sql).toContain('last_verified_at='); expect(first.sql).toContain('last_status=');
    expect(first.sql).toContain('SHA2(CONVERT(audio_url USING utf8mb4),256)');
    expect(first.sql).not.toContain('secret');
    expect(first.statements.every(s => s.rowCount === 1 && s.sql.startsWith('UPDATE recitation_'))).toBe(true);
    expect(first.sql).not.toMatch(/SET (?:status|voice_identity_status|license_status|offset_verified|timing_complete)=/u);
    const report = JSON.stringify(catalogLinkReport(targets, checked.result));
    expect(report).not.toContain('secret'); expect(report).toContain('AUDIO_URL_UNSAFE_OR_SIGNED');
  });
  it('skips YouTube entirely and propagates unexpected source failures instead of swallowing errors', async () => {
    const targets = [target('a', { url: 'https://www.youtube.com/watch?v=readerA' })];
    const checked = await run(targets);
    expect(checked.checkLink).not.toHaveBeenCalled();
    expect(checked.result.results.a.check.status).toBe('YOUTUBE_SOURCE_PROHIBITED');
    await expect(run([target('b')], vi.fn(async () => { throw new Error('UNEXPECTED_FIXTURE_FAILURE'); }))).rejects.toThrow('UNEXPECTED_FIXTURE_FAILURE');
    expect(() => catalogLinkSqlPlan([target('b')], createLinkCheckpoint([target('b')]))).toThrow('CHECKS_INCOMPLETE');
  });
});

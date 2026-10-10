// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  audioFileIdentity, catalogLinkReport, catalogLinkSqlPlan, createLinkCheckpoint, migrateStoppedLinkCheckpoint,
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
  it('rejects signed final URLs or redirect evidence imported through checkpoints before SQL/reporting',async()=>{
    const targets=[target('one')],saved=(await run(targets)).result;
    const signed=structuredClone(saved);signed.results.one.check.finalUrl='https://audio.example/one.mp3?sig=private';
    expect(()=>createLinkCheckpoint(targets,signed)).toThrow('CATALOG_LINK_CHECKPOINT_PRIVATE_URL');
    const redirects=structuredClone(saved);redirects.results.one.check.redirectChain=['https://audio.example/one.mp3?X-Amz-Signature=private'];
    expect(()=>createLinkCheckpoint(targets,redirects)).toThrow('CATALOG_LINK_CHECKPOINT_PRIVATE_URL');
    expect(()=>catalogLinkSqlPlan(targets,signed)).toThrow('CATALOG_LINK_CHECKPOINT_PRIVATE_URL');
  });
  it('keeps Drive case and YouTube video parameters distinct; omits signed URLs from reports', () => {
    expect(audioFileIdentity('https://drive.google.com/file/d/AbC_1/view')).toBe('google_drive_file:AbC_1');
    expect(audioFileIdentity('https://drive.usercontent.google.com/download?id=AbC_1&export=download')).toBe('google_drive_file:AbC_1');
    expect(audioFileIdentity('https://drive.google.com/uc?id=abc_1')).not.toBe(audioFileIdentity('https://drive.google.com/uc?id=AbC_1'));
    expect(audioFileIdentity('https://www.youtube.com/watch?v=one')).toBeNull();
    expect(audioFileIdentity('https://www.youtube.com/watch?v=two')).toBeNull();
    expect(audioFileIdentity('https://audio.example/file.mp3?v=1')).not.toBe(audioFileIdentity('https://audio.example/file.mp3?v=2'));
    expect(reportableAudioUrl('https://audio.example/file.mp3?X-Amz-Signature=secret')).toBeNull();
  });
  it('excludes original cross-reciter shared sources and continues unrelated checks', async () => {
    const targets = [target('first'), target('second', { reciterId: 'reader-2', recitationId: 'recording-2', recitationSlug: 'reader-two', url: 'https://audio.example/first.mp3' }), target('third')];
    const checked = await run(targets);
    expect(checked.checkLink.mock.calls.map(c => c[0])).toEqual(['https://audio.example/third.mp3']);
    expect(checked.result.results.first.check.status).toBe('SAME_AUDIO_CONFLICT'); expect(checked.result.results.second.check.status).toBe('SAME_AUDIO_CONFLICT');
    expect(checked.result.stopped).toBeUndefined(); expect(checked.result.conflicts?.[0].evidence).toBe('original_url_file_identity');
    const report = catalogLinkReport(targets, checked.result);
    expect(report.excluded_rule_v1_recitation_ids).toEqual(['recording-1', 'recording-2']);
    expect(report.same_audio_conflicts).toMatchObject([{ type: 'same_audio_conflict', severity: 'critical' }]);
    expect(catalogLinkSqlPlan(targets, checked.result).statements).toHaveLength(1);
  });
  it('retains resolved collision evidence and finishes all remaining targets without stopping', async () => {
    const targets = [target('first'), target('second', { reciterId: 'reader-2' }), target('third')];
    const checkLink = vi.fn(async (url: string) => available(url.includes('third') ? 'https://cdn.example/third.mp3' : 'https://cdn.example/shared.mp3'));
    let saved = createLinkCheckpoint(targets);
    await runCatalogLinkChecks(targets, { checkpoint: saved, checkLink, persist: value => { saved = structuredClone(value); }, now: () => time });
    expect(checkLink).toHaveBeenCalledTimes(3);
    expect(saved.conflicts?.[0]).toMatchObject({ evidence: 'resolved_url_file_identity', reciterIds: ['reader-1', 'reader-2'] });
    expect(saved.results.first.conflictObservation).toEqual(available('https://cdn.example/shared.mp3'));
    expect(saved.results.third.check.status).toBe('available'); expect(saved.stopped).toBeUndefined();
    const plan = catalogLinkSqlPlan(targets, saved); expect(plan.statements).toHaveLength(1); expect(plan.statements[0].targetKey).toBe('third'); expect(plan.sql).not.toContain("id='first'"); expect(plan.sql).not.toContain("id='second'");
    const resume = await run(targets, vi.fn(), saved); expect(resume.checkLink).not.toHaveBeenCalled(); expect(resume.result.conflicts).toEqual(saved.conflicts);
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
  it('does no network in dry-read mode, but records an inventory collision as excluded', async () => {
    const targets = [target('a')]; const checkLink = vi.fn(); const persist = vi.fn();
    const checkpoint = await runCatalogLinkChecks(targets, { checkpoint: createLinkCheckpoint(targets), checkLink, persist, checkNetwork: false });
    expect(checkLink).not.toHaveBeenCalled(); expect(checkpoint.results).toEqual({}); expect(persist).toHaveBeenCalledOnce();
    const collision = [target('a'), target('b', { reciterId: 'reader-2', url: targets[0].url })];
    const checked = await runCatalogLinkChecks(collision, { checkpoint: createLinkCheckpoint(collision), checkLink, persist, checkNetwork: false });
    expect(checked.conflicts).toHaveLength(1); expect(checked.results.a.check.status).toBe('SAME_AUDIO_CONFLICT'); expect(checked.results.b.check.status).toBe('SAME_AUDIO_CONFLICT'); expect(checkLink).not.toHaveBeenCalled();
  });
  it('refuses legacy stopped checkpoints unless explicitly reviewed, then preserves complete stop history', async () => {
    const targets = [target('a'), target('b', { reciterId: 'reader-2', url: 'https://audio.example/a.mp3' }), target('c')];
    const original = createLinkCheckpoint(targets); original.stopped = { code: 'CROSS_RECITER_AUDIO_FILE_COLLISION', collisions: [{ identity: audioFileIdentity(targets[0].url)!, targetKeys: ['a', 'b'], reciterIds: ['reader-1', 'reader-2'], recitationSlugs: ['reader-one-recording'], evidence: 'original_url_file_identity' }] };
    expect(() => createLinkCheckpoint(targets, original)).toThrow('INVENTORY_CHANGED_OR_STOPPED');
    expect(() => migrateStoppedLinkCheckpoint(targets, original, { reviewedBy: '', reason: 'new policy', reviewedAt: new Date(time).toISOString() })).toThrow('MIGRATION_REVIEW_REQUIRED');
    const migrated = migrateStoppedLinkCheckpoint(targets, original, { reviewedBy: 'root-reviewed-latest-user-policy', reason: 'K1–K9 retain critical conflict and continue unrelated requests', reviewedAt: new Date(time).toISOString() });
    expect(original.stopped).toBeDefined(); expect(migrated.stopped).toBeUndefined(); expect(migrated.stoppedHistory?.[0].stopped).toEqual(original.stopped);
    const checked = await run(targets, vi.fn(async (url: string) => available(url)), migrated); expect(checked.checkLink).toHaveBeenCalledTimes(1); expect(checked.result.stoppedHistory).toEqual(migrated.stoppedHistory); expect(checked.result.conflicts).toHaveLength(1);
  });
  it('retains conflicts after stale checkpoints and catches a third attribution to the resolved same file', async () => {
    const targets = [target('a'), target('b', { reciterId: 'reader-2' }), target('c', { reciterId: 'reader-3' }), target('d')];
    const checked = await run(targets, vi.fn(async (url: string) => available(url.includes('/d.') ? 'https://cdn.example/other.mp3' : 'https://cdn.example/shared.mp3')));
    expect(checked.result.conflicts?.[0].targetKeys).toEqual(['a', 'b', 'c']);
    const resumed = vi.fn(async (url: string) => ({ ...available(url), checkedAt: new Date(time + 25 * 60 * 60 * 1000).toISOString() }));
    const next = await runCatalogLinkChecks(targets, { checkpoint: checked.result, checkLink: resumed, persist: vi.fn(), now: () => time + 25 * 60 * 60 * 1000 });
    expect(resumed).toHaveBeenCalledTimes(1); expect(next.results.a.check.status).toBe('SAME_AUDIO_CONFLICT'); expect(next.conflicts?.[0].targetKeys).toEqual(['a', 'b', 'c']);
  });
  it('rejects forged or damaged conflict evidence rather than publishing it', async () => {
    const targets = [target('a'), target('b', { reciterId: 'reader-2', url: 'https://audio.example/a.mp3' })]; const checked = await run(targets);
    const corrupted = structuredClone(checked.result); corrupted.conflicts![0].identity = 'url:https://other.example/unrelated.mp3'; expect(() => createLinkCheckpoint(targets, corrupted)).toThrow('CONFLICT_EVIDENCE_CORRUPT');
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

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogPeriodicLinkChecker, type PeriodicLinkLogger } from '../../server/services/catalogPeriodicLinkChecker';
import type { CatalogDatabase, CatalogRow, CatalogTx } from '../../server/services/catalogContracts';
import type { AudioLinkCheck } from '../../server/services/catalogAudioSource';
import { humanReviewId, validateReviewInput, type ReviewInput } from '../../server/services/humanReviewService';
import { canonicalAuditJson, type CatalogActor } from '../../server/services/catalogAudit';

const date = '2026-10-10T11:00:00.000Z';
function row(id: string, overrides: CatalogRow = {}): CatalogRow {
  return { kind: 'chapter', id, recitation_id: 'recording-1', reciter_id: 'reader-1', slug: 'reader-one-recording',
    surah: 1, url: `https://audio.example/${id}.mp3`, host_allowlist: ['audio.example'], previous_status: 'unverified',
    previous_checked_at: null, status: 'published', source_kind: overrides.kind === 'alternate' ? 'alternate_same_recording' : null, ...overrides };
}
function fixture(rows: CatalogRow[] = [row('first')]) {
  let enabled = true;
  let inventory=rows;
  const audits: CatalogRow[] = [];
  const fresh = new Map(rows.map(r => [String(r.id), { ...r }]));
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const enqueued = new Map<string, ReviewInput>();
  const reviews = { enqueue: vi.fn(async (actor: CatalogActor, input: ReviewInput) => {
    expect(actor.kind).toBe('system'); expect(actor.permissions.has('reviews.enqueue')).toBe(true); validateReviewInput(input);
    const id=humanReviewId(input), old=enqueued.get(id), changed=!old||canonicalAuditJson(old)!==canonicalAuditJson(input);
    if(changed)enqueued.set(id,input);return {id,changed};
  }) };
  const read = vi.fn(async (sql: string, params: unknown[] = []): Promise<CatalogRow[]> => {
    if (sql.includes('FROM system_settings')) return [{ key_name: 'quran_catalog_v2', value_text: enabled ? 'true' : 'false', is_secret: 0 }];
    if (sql.includes('LIMIT 20')) return rows;
    if (sql.startsWith("SELECT 'chapter' kind")) return inventory;
    if (sql.startsWith('SELECT new_values FROM audit_logs')) return audits;
    if (sql.startsWith('SELECT a.hash')) return [];
    if (sql.includes('FOR UPDATE')) return fresh.has(String(params[0])) ? [fresh.get(String(params[0]))!] : [];
    throw new Error('UNEXPECTED_UNIT_SQL');
  });
  const execute = vi.fn(async (sql: string, params: unknown[] = []): Promise<void> => {
    executed.push({ sql, params });
    if(sql.startsWith('INSERT INTO audit_logs'))audits.push({new_values:JSON.parse(String(params[7]))});
  });
  const transactionCalls = vi.fn();
  const transaction = async <T>(work: (tx: CatalogTx) => Promise<T>): Promise<T> => { transactionCalls(); return work(db); };
  const db: CatalogDatabase = { read, execute, transaction };
  const log: PeriodicLinkLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const source = { restoreRateLimit:vi.fn(),checkLink: vi.fn(async (url: string,_hosts?:string[],_signal?:AbortSignal): Promise<AudioLinkCheck> => ({ status: 'available', httpStatus: 200, checkedAt: date, finalUrl: url })) };
  const checker = new CatalogPeriodicLinkChecker(db, log, source,reviews);
  return { checker, db, log, source, rows, audits, fresh, executed, transactionCalls, reviews,enqueued,setInventory:(value:CatalogRow[])=>{inventory=value;},setEnabled: (value: boolean) => { enabled = value; } };
}
afterEach(() => { vi.useRealTimers(); });
describe('periodic catalog links (unit fixtures only; no network or database)', () => {
  it('runs the unref timer every 5 minutes, does no inventory/network/write with the flag off, and closes', async () => {
    vi.useFakeTimers(); const f = fixture(); f.setEnabled(false);
    f.checker.start(); f.checker.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(f.db.read).toHaveBeenCalledTimes(2);
    expect(f.source.checkLink).not.toHaveBeenCalled(); expect(f.transactionCalls).not.toHaveBeenCalled();
    expect(f.checker.status.state).toBe('disabled');
    await f.checker.close(); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); expect(f.db.read).toHaveBeenCalledTimes(2);
    expect((await f.checker.runOnce()).state).toBe('closed');
  });
  it('checks at most 20 links, persists only health columns plus an audit summary and uses a system actor', async () => {
    const f = fixture(Array.from({ length: 20 }, (_, i) => row('source-' + i)));
    const result = await f.checker.runOnce();
    expect(result).toMatchObject({ state: 'checked', checked: 20, updated: 20, unavailable: 0 });
    expect(f.source.checkLink).toHaveBeenCalledTimes(20);
    const selection = vi.mocked(f.db.read).mock.calls.find(c => c[0].includes('LIMIT 20'))![0];
    expect(selection).toContain("r.status='published'"); expect(selection).toContain('INTERVAL 24 HOUR'); expect(selection).toContain('a.is_active=TRUE');
    const updates = f.executed.filter(e => e.sql.startsWith('UPDATE'));
    expect(updates).toHaveLength(20);
    expect(updates.every(e => /^UPDATE recitation_chapters SET audio_status=\?,last_verified_at=FROM_UNIXTIME\(\?\)/u.test(e.sql))).toBe(true);
    expect(updates[0].params[1]).toBe(Date.parse(date) / 1000);
    const audit = f.executed.find(e => e.sql.startsWith('INSERT INTO audit_logs'))!;
    expect(audit.params[1]).toBeNull(); expect(audit.params[2]).toBe('system'); expect(audit.params[3]).toBe('catalog.links.checked');
    expect(JSON.parse(String(audit.params[7]))).toMatchObject({ updated: 20, evidence_scope: 'link_only_not_voice_identity' });
    expect(f.executed.map(e => e.sql).join('\n')).not.toMatch(/SET (?:status|voice_identity_status|license_status|is_public|offset_verified)=/u);
    await f.checker.close();
  });
  it('rejects a malformed batch over 20 before network or health writes', async () => {
    const f = fixture(Array.from({ length: 21 }, (_, i) => row('source-' + i)));
    expect((await f.checker.runOnce()).state).toBe('failed');
    expect(f.source.checkLink).not.toHaveBeenCalled(); expect(f.transactionCalls).not.toHaveBeenCalled();
    expect(f.log.error).toHaveBeenCalledWith('CATALOG_PERIODIC_LINK_CHECK_FAILED', expect.any(Error), expect.any(Object));
  });
  it('prevents overlapping runs and drains an in-flight request before close without further writes', async () => {
    const f = fixture(); let finish!: () => void;
    f.source.checkLink.mockImplementationOnce(async (url: string) => { await new Promise<void>(resolve => { finish = resolve; }); return { status: 'available', httpStatus: 200, checkedAt: date, finalUrl: url }; });
    const running = f.checker.runOnce();
    await vi.waitFor(() => expect(f.source.checkLink).toHaveBeenCalledOnce());
    expect((await f.checker.runOnce()).state).toBe('overlap_skipped');
    let drained = false; const closing = f.checker.close().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false); finish();
    expect((await running).state).toBe('closed'); await closing;
    expect(f.transactionCalls).not.toHaveBeenCalled(); expect(f.executed).toEqual([]);
  });
  it('aborts a stalled request immediately on close, preventing writes and shutdown errors',async()=>{
    const f=fixture();f.source.checkLink.mockImplementationOnce(async(_url,_hosts,signal)=>{await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('ABORTED')),{once:true}));throw new Error('UNREACHABLE');});
    const running=f.checker.runOnce();await vi.waitFor(()=>expect(f.source.checkLink).toHaveBeenCalledOnce());
    await f.checker.close();expect((await running).state).toBe('closed');expect(f.executed).toEqual([]);expect(f.log.error).not.toHaveBeenCalled();
  });
  it('restores a future Retry-After from audit before checking links after restart',async()=>{
    const f=fixture();const future=new Date(Date.now()+10*86400000).toISOString();f.audits.push({new_values:{mutations:[{target_key:'chapter:first',retry_at:future,retry_host:'audio.example'}],resolved_observations:[]}});
    await f.checker.runOnce();expect(f.source.restoreRateLimit).toHaveBeenCalledWith('audio.example',future);
    expect(f.source.restoreRateLimit.mock.invocationCallOrder[0]).toBeLessThan(f.source.checkLink.mock.invocationCallOrder[0]);
  });
  it('logs expected unavailable links as warning summaries, keeping alternate failure detail in audit', async () => {
    const f = fixture([row('alternative', { kind: 'alternate', surah: null, is_active: true })]);
    f.source.checkLink.mockResolvedValue({ status: 'AUDIO_RATE_LIMITED', httpStatus: 429, checkedAt: date,
      finalUrl: 'https://audio.example/alternative.mp3', retryAt: '2026-10-10T13:00:00Z', retryHost: 'audio.example' });
    const result = await f.checker.runOnce();
    expect(result).toMatchObject({ state: 'checked', unavailable: 1, updated: 1 });
    expect(f.executed[0].sql).toContain('UPDATE recitation_source_urls SET last_status=?,last_checked_at=');
    expect(f.executed[0].params[0]).toBe('AUDIO_RATE_LIMITED');
    expect(f.log.warn).toHaveBeenCalledWith('CATALOG_LINK_CHECK_UNAVAILABLE_SUMMARY', expect.objectContaining({ unavailable: 1 }));
    expect(f.log.error).not.toHaveBeenCalled();
    const audit = JSON.parse(String(f.executed.find(e => e.sql.startsWith('INSERT'))!.params[7]));
    expect(audit.mutations[0]).toMatchObject({ retry_at: '2026-10-10T13:00:00Z', http_status: 429 });
  });
  it('retroactively invalidates resolved collisions, queues a critical human review and keeps unrelated checks and the timer running', async () => {
    vi.useFakeTimers(); const f = fixture([row('one'), row('two', { reciter_id: 'reader-2', recitation_id: 'recording-2',slug:'reader-two' }),row('unrelated',{reciter_id:'reader-3',recitation_id:'recording-3',slug:'reader-three'})]);
    f.source.checkLink.mockImplementation(async url => ({ status: 'available', httpStatus: 200, checkedAt: date, finalUrl: url.includes('unrelated')?url:'https://cdn.example/shared.mp3' }));
    f.checker.start(); const result = await f.checker.runOnce();
    expect(result).toMatchObject({state:'checked',checked:3,updated:3,unavailable:2,conflicts:1,conflictedRecitations:2}); expect(f.checker.status.timerActive).toBe(true);
    const updates=f.executed.filter(e=>e.sql.startsWith('UPDATE'));
    expect(updates.map(e=>[e.params[2],e.params[0]])).toEqual([['one','source_unavailable'],['two','source_unavailable'],['unrelated','available']]);
    const [review]=[...f.enqueued.values()];expect(review).toMatchObject({type:'same_audio_conflict',priority:1000,evidence:{recitations:['reader-one-recording','reader-two'],exclude_from_rule_v1:true,evidence:'resolved_url_file_identity'}});
    expect(review).not.toHaveProperty('status');expect(JSON.stringify(review)).not.toContain('https://');
    const audit=f.audits[0].new_values as CatalogRow;
    expect(audit).toMatchObject({critical_review_ids:[humanReviewId(review)]});
    expect((audit.resolved_observations as CatalogRow[]).filter(o=>String(o.finalUrl).includes('shared'))).toHaveLength(2);
    expect(f.executed.map(e=>e.sql).join('\n')).not.toMatch(/SET (?:status|voice_identity_status|license_status|is_public|offset_verified)=/u);
    f.source.checkLink.mockClear();const replay=await f.checker.runOnce();expect(replay.state).toBe('checked');
    expect(f.source.checkLink).toHaveBeenCalledOnce();expect(f.source.checkLink.mock.calls[0][0]).toContain('unrelated');expect(f.enqueued.size).toBe(1);
    expect(f.reviews.enqueue.mock.results.every(r=>r.type==='return')).toBe(true);expect(f.log.error).not.toHaveBeenCalled();await f.checker.close();
  });
  it('restores final URL evidence from audit across restarts and checks it against current source ownership', async () => {
    const f = fixture([row('one'), row('two', { reciter_id: 'reader-2', recitation_id: 'recording-2',slug:'reader-two', url: 'https://cdn.example/shared.mp3' }),row('unrelated',{reciter_id:'reader-3',recitation_id:'recording-3',slug:'reader-three'})]);
    // Exact public URL hash from a past HEAD. It proves link identity, never a human voice review.
    const { createHash } = await import('node:crypto');
    f.audits.push({ new_values: { resolved_observations: [{ targetKey: 'chapter:one', originalSha256: createHash('sha256').update(String(f.rows[0].url)).digest('hex'), finalUrl: 'https://cdn.example/shared.mp3', checkedAt: date }] } });
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',updated:3,unavailable:2});
    expect(f.source.checkLink).toHaveBeenCalledOnce();expect(f.source.checkLink.mock.calls[0][0]).toContain('unrelated');expect(f.enqueued.size).toBe(1);
    expect((f.audits[1].new_values as CatalogRow).resolved_observations).toContainEqual(expect.objectContaining({targetKey:'chapter:one',checkedAt:date}));
  });
  it('detects original file identity conflicts without requesting affected audio, and keeps the next run usable',async()=>{
    const f=fixture([row('one',{url:'https://audio.example/shared.mp3'}),row('two',{url:'https://audio.example/shared.mp3',reciter_id:'reader-2',recitation_id:'recording-2',slug:'reader-two'}),row('unrelated')]);
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',unavailable:2,updated:3});
    expect(f.source.checkLink).toHaveBeenCalledOnce();expect(f.source.checkLink.mock.calls[0][0]).toContain('unrelated');
    expect([...f.enqueued.values()][0].evidence.evidence).toBe('original_url_file_identity');
    expect((await f.checker.runOnce()).state).toBe('checked');expect(f.source.checkLink).toHaveBeenCalledTimes(2);
  });
  it('marks all affected current targets unavailable even when one is outside the scheduled batch, using Drive file identity',async()=>{
    const first=row('one',{url:'https://drive.google.com/file/d/RealCaseSensitiveID/view'});
    const outside=row('outside',{url:'https://drive.usercontent.google.com/download?id=RealCaseSensitiveID',reciter_id:'reader-2',recitation_id:'recording-2',slug:'reader-two'});
    const f=fixture([first,row('unrelated')]);f.setInventory([...f.rows,outside]);f.fresh.set('outside',outside);
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',checked:2,updated:3,unavailable:2,conflictedRecitations:2});
    expect(f.source.checkLink).toHaveBeenCalledOnce();expect(f.source.checkLink.mock.calls[0][0]).toContain('unrelated');
    expect(f.executed.filter(e=>e.sql.startsWith('UPDATE')).find(e=>e.params[2]==='outside')?.params[0]).toBe('source_unavailable');
    expect([...f.enqueued.values()][0].evidence).toMatchObject({target_count:2,recitations:['reader-one-recording','reader-two']});
  });
  it('ignores stale resolved observations when the current original source changes, without creating a false review',async()=>{
    const f=fixture([row('one'),row('two',{url:'https://cdn.example/shared.mp3',reciter_id:'reader-2',recitation_id:'recording-2',slug:'reader-two'})]);
    f.audits.push({new_values:{resolved_observations:[{targetKey:'chapter:one',originalSha256:'0'.repeat(64),finalUrl:'https://cdn.example/shared.mp3',checkedAt:date}]}});
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',unavailable:0,conflicts:0});expect(f.source.checkLink).toHaveBeenCalledTimes(2);expect(f.reviews.enqueue).not.toHaveBeenCalled();
  });
  it('does not select licensed files or provider references, and filters alternate kinds in both inventory queries',async()=>{
    const f=fixture([row('licensed',{kind:'alternate',source_kind:'licensed_file',url:null}),row('original',{kind:'alternate',source_kind:'provider_original'}),row('healthy')]);
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',checked:1,updated:1});expect(f.source.checkLink).toHaveBeenCalledOnce();
    const queries=vi.mocked(f.db.read).mock.calls.map(c=>c[0]).filter(sql=>sql.includes('UNION ALL'));
    expect(queries).toHaveLength(2);expect(queries.every(sql=>sql.includes("a.kind='alternate_same_recording'"))).toBe(true);
  });
  it('rechecks an alternate kind under the fresh row lock and skips a concurrently converted licensed source',async()=>{
    const f=fixture([row('alternate',{kind:'alternate',surah:null,is_active:true})]);
    f.source.checkLink.mockImplementationOnce(async url=>{f.fresh.set('alternate',{...f.rows[0],source_kind:'licensed_file'});return {status:'available',httpStatus:200,checkedAt:date,finalUrl:url};});
    expect(await f.checker.runOnce()).toMatchObject({state:'checked',updated:0,skipped:1});expect(f.executed.filter(e=>e.sql.startsWith('UPDATE'))).toEqual([]);
    expect(vi.mocked(f.db.read).mock.calls.some(([sql])=>sql.includes('x.kind source_kind')&&sql.includes('FOR UPDATE'))).toBe(true);
  });
  it('preserves the actual unexpected error for redacting logger, returns a failed state and emits no fake success', async () => {
    const f = fixture(); const original = new Error('FIXTURE_SOURCE_FAILURE');
    f.source.checkLink.mockRejectedValue(original);
    expect((await f.checker.runOnce()).state).toBe('failed');
    expect(f.log.error).toHaveBeenCalledWith('CATALOG_PERIODIC_LINK_CHECK_FAILED', original, expect.objectContaining({ checker:'catalog-periodic-links' }));
    expect(f.log.info).not.toHaveBeenCalled(); expect(f.executed).toEqual([]);
  });
  it('rechecks the flag and source inside the audit transaction, skipping revoked or changed data', async () => {
    const f = fixture(); f.source.checkLink.mockImplementationOnce(async (url: string) => { f.setEnabled(false); return { status: 'available', httpStatus: 200, checkedAt: date, finalUrl: url }; });
    expect(await f.checker.runOnce()).toMatchObject({ state: 'disabled', updated: 0, skipped: 1 });
    expect(f.executed).toEqual([]);
    const changed = fixture(); changed.source.checkLink.mockImplementationOnce(async (url: string) => { changed.fresh.set('first', { ...changed.rows[0], url: 'https://audio.example/replaced.mp3' }); return { status: 'available', httpStatus: 200, checkedAt: date, finalUrl: url }; });
    expect(await changed.checker.runOnce()).toMatchObject({ state: 'checked', updated: 0, skipped: 1 });
    expect(changed.executed.filter(e => e.sql.startsWith('UPDATE'))).toEqual([]);
    expect(changed.executed.filter(e => e.sql.startsWith('INSERT INTO audit_logs'))).toHaveLength(1);
  });
});

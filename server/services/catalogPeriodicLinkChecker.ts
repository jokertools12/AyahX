import { createHash, randomUUID } from 'node:crypto';
import { logger as applicationLogger } from '../logger';
import { CatalogAudioSource, type AudioLinkCheck } from './catalogAudioSource';
import { appendCatalogAudit, requireCatalogPermission, type CatalogActor } from './catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow } from './catalogContracts';
import { audioFileIdentity, isYoutubeAudioUrl, reportableAudioUrl, type CatalogLinkTarget } from './catalogLinkChecker';
import { readCatalogSettings } from './recitationCatalogService';

const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;
const SYSTEM_ACTOR: CatalogActor = { id: 'catalog-periodic-links', kind: 'system', roleSlug: 'system', permissions: new Set(['catalog.links.check']) };
export interface PeriodicLinkLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}
export interface PeriodicLinkSummary {
  state: 'disabled' | 'idle' | 'checked' | 'overlap_skipped' | 'closed' | 'suspended' | 'failed';
  checked: number; updated: number; unavailable: number; skipped: number; errorCode?: string;
}
interface SelectedLink { target: CatalogLinkTarget; oldStatus: string | null; oldCheckedAt: string | null }
interface ResolvedObservation { targetKey: string; originalSha256: string; finalUrl: string; checkedAt: string }
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const empty = (state: PeriodicLinkSummary['state'], errorCode?: string): PeriodicLinkSummary => ({ state, checked: 0, updated: 0, unavailable: 0, skipped: 0, ...(errorCode ? { errorCode } : {}) });
function selectedLink(row: CatalogRow): SelectedLink {
  const kind = row.kind;
  const allowedHosts: unknown = typeof row.host_allowlist === 'string' ? JSON.parse(row.host_allowlist) : row.host_allowlist;
  if (!['chapter', 'alternate'].includes(String(kind)) || !Array.isArray(allowedHosts) || allowedHosts.some(h => typeof h !== 'string') ||
    [row.id, row.recitation_id, row.reciter_id, row.slug, row.url].some(v => typeof v !== 'string' || !v) ||
    (kind === 'chapter' && (!Number.isSafeInteger(row.surah) || Number(row.surah) < 1))) throw new Error('CATALOG_PERIODIC_LINK_ROW_INVALID');
  return { target: { kind: kind as CatalogLinkTarget['kind'], id: String(row.id), key: String(kind) + ':' + String(row.id),
    recitationId: String(row.recitation_id), reciterId: String(row.reciter_id), recitationSlug: String(row.slug),
    surah: row.surah === null ? null : Number(row.surah), url: String(row.url), allowedHosts: allowedHosts as string[] },
    oldStatus: row.previous_status === null ? null : String(row.previous_status),
    oldCheckedAt: row.previous_checked_at === null ? null : String(row.previous_checked_at) };
}
/** Existing process only. No cron, resource configuration, registration, or production flag changes. */
export class CatalogPeriodicLinkChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<PeriodicLinkSummary> | null = null;
  private closed = false;
  private suspended = false;
  private readonly shutdown = new AbortController();
  private lastSummary: PeriodicLinkSummary = empty('idle');
  // One source object retains host pacing and Retry-After for the life of this checker.
  constructor(private readonly db: CatalogDatabase, private readonly log: PeriodicLinkLogger = applicationLogger,
    private readonly source: Pick<CatalogAudioSource, 'checkLink'> & Partial<Pick<CatalogAudioSource,'restoreRateLimit'>> = new CatalogAudioSource(undefined, 1000)) {}
  start(): void {
    if (this.closed || this.suspended || this.timer) return;
    this.timer = setInterval(() => { void this.runOnce(); }, INTERVAL_MS);
    this.timer.unref();
  }
  get status(): PeriodicLinkSummary & { running: boolean; timerActive: boolean } {
    return { ...this.lastSummary, running: this.inFlight !== null, timerActive: this.timer !== null };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Abort network/pacing immediately; drain a transaction already started before closing the pool.
    if (this.inFlight) await this.inFlight;
  }
  runOnce(): Promise<PeriodicLinkSummary> {
    if (this.closed) return Promise.resolve(empty('closed'));
    if (this.suspended) return Promise.resolve(empty('suspended', 'CROSS_RECITER_AUDIO_FILE_COLLISION'));
    if (this.inFlight) return Promise.resolve(empty('overlap_skipped'));
    const task = this.performRun().catch(error => {
      if(this.closed)return this.lastSummary=empty('closed');
      const collision = error instanceof CatalogError && error.code === 'CROSS_RECITER_AUDIO_FILE_COLLISION';
      if (collision) {
        this.suspended = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
      // Existing logger redacts the original error and stack; context contains no URLs or credentials.
      this.log.error(collision ? 'CATALOG_LINK_CHECK_STOP_CROSS_RECITER_FILE' : 'CATALOG_PERIODIC_LINK_CHECK_FAILED', error,
        { checker: 'catalog-periodic-links', suspended: this.suspended, ...(collision ? { evidence: error.details } : {}) });
      const summary = empty(collision ? 'suspended' : 'failed', collision ? 'CROSS_RECITER_AUDIO_FILE_COLLISION' : 'CATALOG_PERIODIC_LINK_CHECK_FAILED');
      this.lastSummary = summary;
      return summary;
    }).finally(() => { this.inFlight = null; });
    this.inFlight = task;
    return task;
  }
  private async performRun(): Promise<PeriodicLinkSummary> {
    if (!(await readCatalogSettings(this.db)).enabled) return this.lastSummary = empty('disabled');
    if (this.closed) return this.lastSummary = empty('closed');
    const rows = await this.db.read(`SELECT * FROM (
      SELECT 'chapter' kind,c.id,c.recitation_id,r.reciter_id,r.slug,c.surah,c.audio_url url,p.host_allowlist,
        c.audio_status previous_status,c.last_verified_at previous_checked_at
      FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id
      WHERE r.status='published' AND (c.last_verified_at IS NULL OR c.last_verified_at<UTC_TIMESTAMP()-INTERVAL 24 HOUR)
      UNION ALL
      SELECT 'alternate' kind,a.id,a.recitation_id,r.reciter_id,r.slug,a.surah,a.url,p.host_allowlist,
        a.last_status previous_status,a.last_checked_at previous_checked_at
      FROM recitation_source_urls a JOIN recitations r ON r.id=a.recitation_id JOIN audio_providers p ON p.id=r.provider_id
      WHERE r.status='published' AND a.is_active=TRUE AND (a.last_checked_at IS NULL OR a.last_checked_at<UTC_TIMESTAMP()-INTERVAL 24 HOUR)
    ) links ORDER BY previous_checked_at,kind,id LIMIT 20`);
    if (rows.length > BATCH_LIMIT) throw new Error('CATALOG_PERIODIC_BATCH_LIMIT_EXCEEDED');
    const selected = rows.map(selectedLink);
    if (!selected.length) return this.lastSummary = empty('idle');
    const current = (await this.db.read(`SELECT 'chapter' kind,c.id,c.recitation_id,r.reciter_id,r.slug,c.audio_url url
      FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id
      UNION ALL SELECT 'alternate' kind,a.id,a.recitation_id,r.reciter_id,r.slug,a.url
      FROM recitation_source_urls a JOIN recitations r ON r.id=a.recitation_id WHERE a.is_active=TRUE`));
    const currentByKey = new Map(current.map(r => [String(r.kind) + ':' + String(r.id), r]));
    const owners = new Map<string, Set<string>>();
    const observe = (identity: string | null, reciterId: string): void => {
      if (!identity) return;
      const identities = owners.get(identity) ?? new Set<string>(); identities.add(reciterId); owners.set(identity, identities);
      if (identities.size > 1) throw new CatalogError('CROSS_RECITER_AUDIO_FILE_COLLISION', 503,
        { identity_sha256: sha(identity), reciter_ids: [...identities].sort(), evidence: 'same_resource_file_identity' });
    };
    for (const row of current) observe(audioFileIdentity(String(row.url)), String(row.reciter_id));
    // Audited final URLs survive process restarts. Only observations matching the current original URL count.
    const audits = await this.db.read("SELECT new_values FROM audit_logs a WHERE action='catalog.links.checked' AND (created_at>=UTC_TIMESTAMP()-INTERVAL 7 DAY OR EXISTS(SELECT 1 FROM JSON_TABLE(a.new_values,'$.mutations[*]' COLUMNS(retry_at VARCHAR(64) PATH '$.retry_at')) j WHERE j.retry_at>DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')))");
    for (const audit of audits) {
      const value: unknown = typeof audit.new_values === 'string' ? JSON.parse(audit.new_values) : audit.new_values;
      if (!value || typeof value !== 'object' || !('resolved_observations' in value) || !Array.isArray(value.resolved_observations)) throw new Error('CATALOG_PERIODIC_AUDIT_DATA_INVALID');
      if('mutations' in value&&Array.isArray(value.mutations))for(const mutation of value.mutations){
        if(mutation&&typeof mutation==='object'&&'retry_at' in mutation&&typeof mutation.retry_at==='string'&&Date.parse(mutation.retry_at)>Date.now()){
          const original='target_key' in mutation?currentByKey.get(String(mutation.target_key)):undefined;
          const host='retry_host' in mutation?String(mutation.retry_host):original?new URL(String(original.url)).hostname:null;
          if(host)this.source.restoreRateLimit?.(host,mutation.retry_at);
        }
      }
      for (const observation of value.resolved_observations as ResolvedObservation[]) {
        if (!observation || typeof observation.targetKey !== 'string' || !/^[a-f0-9]{64}$/u.test(observation.originalSha256) ||
          !reportableAudioUrl(observation.finalUrl) || !Number.isFinite(Date.parse(observation.checkedAt))) throw new Error('CATALOG_PERIODIC_AUDIT_DATA_INVALID');
        const original = currentByKey.get(observation.targetKey);
        if (original && sha(String(original.url)) === observation.originalSha256) observe(audioFileIdentity(observation.finalUrl), String(original.reciter_id));
      }
    }
    const results: Array<{ link: SelectedLink; check: AudioLinkCheck }> = [];
    for (const link of selected) {
      if (this.closed) return this.lastSummary = empty('closed');
      let check: AudioLinkCheck;
      if (isYoutubeAudioUrl(link.target.url)) check = { status: 'YOUTUBE_SOURCE_PROHIBITED', httpStatus: null, checkedAt: new Date().toISOString() };
      else if (!reportableAudioUrl(link.target.url)) check = { status: 'AUDIO_URL_UNSAFE_OR_SIGNED', httpStatus: null, checkedAt: new Date().toISOString() };
      else check = await this.source.checkLink(link.target.url, link.target.allowedHosts,this.shutdown.signal);
      if (!Number.isFinite(Date.parse(check.checkedAt))) throw new Error('CATALOG_PERIODIC_CHECK_TIMESTAMP_INVALID');
      if (check.status === 'available' && (!check.finalUrl || !reportableAudioUrl(check.finalUrl))) throw new Error('CATALOG_PERIODIC_AVAILABLE_URL_INVALID');
      if (check.status === 'available' && check.finalUrl) observe(audioFileIdentity(check.finalUrl), link.target.reciterId);
      results.push({ link, check });
    }
    if (this.closed) return this.lastSummary = empty('closed');
    requireCatalogPermission(SYSTEM_ACTOR, 'catalog.links.check');
    const summary: PeriodicLinkSummary = { state: 'checked', checked: results.length, updated: 0,
      unavailable: results.filter(r => r.check.status !== 'available').length, skipped: 0 };
    await this.db.transaction(async tx => {
      if (this.closed || !(await readCatalogSettings(tx)).enabled) { summary.state = this.closed ? 'closed' : 'disabled'; summary.skipped = results.length; return; }
      const mutations: CatalogRow[] = [];
      const resolvedObservations: ResolvedObservation[] = [];
      for (const { link, check } of results) {
        const chapter = link.target.kind === 'chapter'; const table = chapter ? 'recitation_chapters' : 'recitation_source_urls';
        const urlColumn = chapter ? 'audio_url' : 'url'; const statusColumn = chapter ? 'audio_status' : 'last_status';
        const timeColumn = chapter ? 'last_verified_at' : 'last_checked_at';
        const fresh = await tx.read(`SELECT x.${urlColumn} url,x.${statusColumn} previous_status,x.${timeColumn} previous_checked_at,r.reciter_id,r.status${chapter ? '' : ',x.is_active'} FROM ${table} x JOIN recitations r ON r.id=x.recitation_id WHERE x.id=? COLLATE utf8mb4_unicode_ci AND x.recitation_id=? COLLATE utf8mb4_unicode_ci FOR UPDATE`, [link.target.id, link.target.recitationId]);
        if (fresh.length !== 1 || fresh[0].url !== link.target.url || fresh[0].reciter_id !== link.target.reciterId || fresh[0].status !== 'published' || (!chapter && !fresh[0].is_active)) { summary.skipped++; continue; }
        const status = chapter ? check.status === 'available' ? 'available' : 'source_unavailable' : check.status;
        // FROM_UNIXTIME renders this UTC instant in MySQL's session zone; TIMESTAMP stores the same instant.
        await tx.execute(`UPDATE ${table} SET ${statusColumn}=?,${timeColumn}=FROM_UNIXTIME(?) WHERE id=? COLLATE utf8mb4_unicode_ci AND recitation_id=? COLLATE utf8mb4_unicode_ci`, [status, Date.parse(check.checkedAt) / 1000, link.target.id, link.target.recitationId]);
        summary.updated++;
        mutations.push({ target_key: link.target.key, recitation_id: link.target.recitationId,
          old_status: fresh[0].previous_status ?? null, old_checked_at: fresh[0].previous_checked_at === null ? null : String(fresh[0].previous_checked_at), new_status: status, checked_at: check.checkedAt,
          link_check_status: check.status, http_status: check.httpStatus, ...(check.retryAt ? { retry_at: check.retryAt,retry_host:check.retryHost??new URL(link.target.url).hostname } : {}) });
        if (check.status === 'available' && check.finalUrl && reportableAudioUrl(check.finalUrl)) resolvedObservations.push({ targetKey: link.target.key,
          originalSha256: sha(link.target.url), finalUrl: reportableAudioUrl(check.finalUrl)!, checkedAt: check.checkedAt });
      }
      await appendCatalogAudit(tx, SYSTEM_ACTOR, 'catalog.links.checked', 'catalog_link_batch', randomUUID(), null,
        { ...summary, mutations, resolved_observations: resolvedObservations, evidence_scope: 'link_only_not_voice_identity' });
    });
    const context = { ...summary, evidence_scope: 'link_only_not_voice_identity' };
    if (summary.unavailable) this.log.warn('CATALOG_LINK_CHECK_UNAVAILABLE_SUMMARY', context);
    else this.log.info('CATALOG_LINK_CHECK_SUMMARY', context);
    return this.lastSummary = summary;
  }
}
/** Root wires start() and await close() into the existing app lifecycle after review. */
export function createCatalogPeriodicLinkChecker(db: CatalogDatabase): CatalogPeriodicLinkChecker {
  return new CatalogPeriodicLinkChecker(db);
}

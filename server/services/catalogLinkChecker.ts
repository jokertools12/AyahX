import { createHash } from 'node:crypto';
import type { AudioLinkCheck } from './catalogAudioSource';
import { sqlLiteral } from './qudCatalogSql';

export interface CatalogLinkTarget {
  key: string; kind: 'chapter' | 'alternate'; id: string; recitationId: string; reciterId: string;
  recitationSlug: string; surah: number | null; url: string; allowedHosts: string[];
}
export interface CatalogLinkResult {
  targetKey: string; inputSha256: string; check: AudioLinkCheck;
  evidenceScope: 'link_only_not_voice_identity';
  /** Preserve the actual request observation when a conflict changes eligibility. */
  conflictObservation?: AudioLinkCheck;
}
export interface CrossReciterFileCollision {
  identity: string; targetKeys: string[]; reciterIds: string[]; recitationSlugs: string[];
  evidence: 'original_url_file_identity' | 'resolved_url_file_identity';
}
export interface CatalogLinkCheckpoint {
  version: 1; inputSha256: string; results: Record<string, CatalogLinkResult>;
  stopped?: { code: 'CROSS_RECITER_AUDIO_FILE_COLLISION'; collisions: CrossReciterFileCollision[] };
  conflicts?: CrossReciterFileCollision[];
  stoppedHistory?: Array<{ stopped: NonNullable<CatalogLinkCheckpoint['stopped']>; reviewedBy: string; reviewedAt: string; reason: string }>;
}
export class CatalogLinkCollisionError extends Error {
  constructor(public readonly collisions: CrossReciterFileCollision[]) { super('CROSS_RECITER_AUDIO_FILE_COLLISION'); }
}
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const signedKey = /token|signature|credential|expires|x-amz|x-goog|key-pair-id|policy|^sig$|^api[_-]?key$/iu;

/** Public persistent sources only. Unsafe/signed input is never included in a report or console. */
export function reportableAudioUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => signedKey.test(k))) return null;
  return url.href;
}
export function isYoutubeAudioUrl(raw: string): boolean {
  try { const host = new URL(raw).hostname.toLowerCase(); return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'); }
  catch { return false; }
}
/** Drive IDs and paths stay case-sensitive. YouTube watch URLs are never collapsed by dropping v=. */
export function audioFileIdentity(raw: string): string | null {
  const safe = reportableAudioUrl(raw);
  if (!safe || isYoutubeAudioUrl(safe)) return null;
  const url = new URL(safe);
  if (['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname.toLowerCase())) {
    const path = /^\/file\/d\/([^/]+)(?:\/|$)/u.exec(url.pathname);
    const id = path?.[1] ?? url.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]+$/u.test(id)) return `google_drive_file:${id}`;
  }
  // The complete normalized URL is evidence of the same resource; query values are retained.
  url.searchParams.sort();
  return `url:${url.href}`;
}
function targetHash(target: CatalogLinkTarget): string {
  return sha(JSON.stringify({ ...target, allowedHosts: [...target.allowedHosts].sort() }));
}
export function linkInventoryFingerprint(targets: readonly CatalogLinkTarget[]): string {
  return sha(JSON.stringify([...targets].sort((a, b) => a.key.localeCompare(b.key)).map(t => [t.key, targetHash(t)])));
}
function validateTargets(targets: readonly CatalogLinkTarget[]): void {
  const keys = new Set<string>();
  for (const t of targets) {
    if (keys.has(t.key) || !t.key || !t.id || !t.recitationId || !t.reciterId || !Array.isArray(t.allowedHosts) ||
      t.allowedHosts.some(h => typeof h !== 'string' || (!/^[a-z0-9.-]+$/iu.test(h)&&h!=='*.us.archive.org')) ||
      (t.kind === 'chapter' && (!Number.isSafeInteger(t.surah) || Number(t.surah) < 1)) ||
      !['chapter', 'alternate'].includes(t.kind)) throw new Error('CATALOG_LINK_INVENTORY_INVALID');
    keys.add(t.key);
  }
}
export function createLinkCheckpoint(targets: readonly CatalogLinkTarget[], previous?: CatalogLinkCheckpoint): CatalogLinkCheckpoint {
  validateTargets(targets);
  const inputSha256 = linkInventoryFingerprint(targets);
  if (previous) {
    if (previous.version !== 1 || previous.inputSha256 !== inputSha256 || !previous.results || previous.stopped) throw new Error('CATALOG_LINK_CHECKPOINT_INVENTORY_CHANGED_OR_STOPPED');
    const current = new Map(targets.map(t => [t.key, t]));
    for (const [key, result] of Object.entries(previous.results)) {
      const target = current.get(key);
      if (!target || result.targetKey !== key || result.inputSha256 !== targetHash(target) ||
        result.evidenceScope !== 'link_only_not_voice_identity' || !Number.isFinite(Date.parse(result.check.checkedAt)) ||
        typeof result.check.status !== 'string' || (result.check.retryAt && !Number.isFinite(Date.parse(result.check.retryAt)))) throw new Error('CATALOG_LINK_CHECKPOINT_CORRUPT');
      for(const observation of [result.check,result.conflictObservation].filter((v):v is AudioLinkCheck=>!!v)){
        if((observation.finalUrl&&!reportableAudioUrl(observation.finalUrl))||(observation.status==='available'&&!observation.finalUrl)||
          observation.redirects?.some(url=>!reportableAudioUrl(url)))throw new Error('CATALOG_LINK_CHECKPOINT_PRIVATE_URL');
      }
    }
    for (const collision of previous.conflicts ?? []) {
      if (!collision.identity || !['original_url_file_identity', 'resolved_url_file_identity'].includes(collision.evidence) || !Array.isArray(collision.targetKeys) || collision.targetKeys.length < 2 || collision.targetKeys.some(key => !current.has(key)) || new Set(collision.targetKeys.map(key => current.get(key)!.reciterId)).size < 2 || !Array.isArray(collision.reciterIds) || !Array.isArray(collision.recitationSlugs) || JSON.stringify([...collision.reciterIds].sort()) !== JSON.stringify([...new Set(collision.targetKeys.map(key => current.get(key)!.reciterId))].sort()) || JSON.stringify([...collision.recitationSlugs].sort()) !== JSON.stringify([...new Set(collision.targetKeys.map(key => current.get(key)!.recitationSlug))].sort()) || collision.targetKeys.some(key => {
        const result = previous.results[key], observation = result?.conflictObservation ?? result?.check;
        const raw = collision.evidence === 'original_url_file_identity' ? current.get(key)!.url : observation?.finalUrl;
        return !raw || audioFileIdentity(raw) !== collision.identity;
      })) throw new Error('CATALOG_LINK_CONFLICT_EVIDENCE_CORRUPT');
    }
    for (const history of previous.stoppedHistory ?? []) if (!history.reviewedBy?.trim() || !history.reason?.trim() || !Number.isFinite(Date.parse(history.reviewedAt)) || history.stopped?.code !== 'CROSS_RECITER_AUDIO_FILE_COLLISION') throw new Error('CATALOG_LINK_STOPPED_HISTORY_CORRUPT');
    return structuredClone(previous);
  }
  return { version: 1, inputSha256, results: {} };
}
/** Explicit reviewed migration only. Generic resume still refuses legacy stopped files. */
export function migrateStoppedLinkCheckpoint(targets: readonly CatalogLinkTarget[], previous: CatalogLinkCheckpoint, review: { reviewedBy: string; reviewedAt: string; reason: string }): CatalogLinkCheckpoint {
  if (!previous.stopped || !review.reviewedBy?.trim() || !review.reason?.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error('CATALOG_LINK_STOPPED_MIGRATION_REVIEW_REQUIRED');
  const migrated = structuredClone(previous); const stopped = migrated.stopped!;
  delete migrated.stopped;
  migrated.stoppedHistory = [...(migrated.stoppedHistory ?? []), { stopped, ...review }];
  migrated.conflicts = mergeConflicts(migrated.conflicts ?? [], stopped.collisions);
  return createLinkCheckpoint(targets, migrated);
}
function mergeConflicts(existing: readonly CrossReciterFileCollision[], added: readonly CrossReciterFileCollision[]): CrossReciterFileCollision[] {
  const indexed = new Map<string, CrossReciterFileCollision>();
  for (const collision of [...existing, ...added]) {
    const key = collision.evidence + ':' + collision.identity, old = indexed.get(key);
    indexed.set(key, { ...collision, targetKeys: [...new Set([...(old?.targetKeys ?? []), ...collision.targetKeys])].sort(), reciterIds: [...new Set([...(old?.reciterIds ?? []), ...collision.reciterIds])].sort(), recitationSlugs: [...new Set([...(old?.recitationSlugs ?? []), ...collision.recitationSlugs])].sort() });
  }
  return [...indexed.values()].sort((a, b) => (a.evidence + ':' + a.identity).localeCompare(b.evidence + ':' + b.identity));
}
export function catalogLinkConflicts(targets: readonly CatalogLinkTarget[], checkpoint: CatalogLinkCheckpoint): CrossReciterFileCollision[] {
  return mergeConflicts(checkpoint.conflicts ?? [], [...collisionsFor(targets), ...collisionsFor(targets, checkpoint.results)]);
}
function collisionsFor(targets: readonly CatalogLinkTarget[], results?: CatalogLinkCheckpoint['results']): CrossReciterFileCollision[] {
  const groups = new Map<string, CatalogLinkTarget[]>();
  for (const target of targets) {
    const result = results?.[target.key];
    const observed = result?.conflictObservation ?? result?.check;
    const raw = results ? observed?.status === 'available' ? observed.finalUrl : undefined : target.url;
    const identity = raw ? audioFileIdentity(raw) : null;
    if (identity) groups.set(identity, [...(groups.get(identity) ?? []), target]);
  }
  return [...groups].flatMap(([identity, rows]) => new Set(rows.map(r => r.reciterId)).size > 1 ? [{
    identity, targetKeys: rows.map(r => r.key).sort(), reciterIds: [...new Set(rows.map(r => r.reciterId))].sort(),
    recitationSlugs: [...new Set(rows.map(r => r.recitationSlug))].sort(),
    evidence: results ? 'resolved_url_file_identity' as const : 'original_url_file_identity' as const,
  }] : []).sort((a, b) => a.identity.localeCompare(b.identity));
}
function publicCheck(check: AudioLinkCheck): AudioLinkCheck {
  const retryHost = check.retryHost;
  return {
    status: check.status, httpStatus: check.httpStatus, checkedAt: check.checkedAt,
    ...(check.retryAt ? { retryAt: check.retryAt } : {}),
    ...(retryHost ? { retryHost } : {}),
    ...(check.finalUrl && reportableAudioUrl(check.finalUrl) ? { finalUrl: reportableAudioUrl(check.finalUrl)! } : {}),
    ...(check.contentType ? { contentType: check.contentType } : {}),
    ...(check.contentLength !== undefined ? { contentLength: check.contentLength } : {}),
    ...(check.redirects ? { redirects: check.redirects.map(reportableAudioUrl).filter((u): u is string => u !== null) } : {}),
  };
}
export interface LinkCheckRunnerOptions {
  checkLink: (url: string, hosts: string[]) => Promise<AudioLinkCheck>;
  checkpoint: CatalogLinkCheckpoint; persist: (checkpoint: CatalogLinkCheckpoint) => void | Promise<void>;
  now?: () => number; refreshAfterMs?: number; checkNetwork?: boolean;
}
/** Sequential requests; CatalogAudioSource enforces 1 s/host. Retry-After is retained across restarts. */
export async function runCatalogLinkChecks(targets: readonly CatalogLinkTarget[], options: LinkCheckRunnerOptions): Promise<CatalogLinkCheckpoint> {
  const checkpoint = createLinkCheckpoint(targets, options.checkpoint);
  const now = options.now ?? Date.now;
  const refreshAfterMs = options.refreshAfterMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(refreshAfterMs) || refreshAfterMs < 1000) throw new Error('CATALOG_LINK_REFRESH_INTERVAL_INVALID');
  const recordConflicts = async (): Promise<Set<string>> => {
    const collisions = catalogLinkConflicts(targets, checkpoint);
    const keys = new Set(collisions.flatMap(c => c.targetKeys));
    if (!collisions.length) return keys;
    checkpoint.conflicts = collisions;
    for (const target of targets) if (keys.has(target.key)) {
      const old = checkpoint.results[target.key];
      const observation = old?.conflictObservation ?? (old && old.check.status !== 'SAME_AUDIO_CONFLICT' ? structuredClone(old.check) : undefined);
      checkpoint.results[target.key] = { targetKey: target.key, inputSha256: targetHash(target), evidenceScope: 'link_only_not_voice_identity', check: { ...(old?.check ?? { httpStatus: null, checkedAt: new Date(now()).toISOString() }), status: 'SAME_AUDIO_CONFLICT' }, ...(observation ? { conflictObservation: observation } : {}) };
    }
    await options.persist(checkpoint); return keys;
  };
  let excluded = await recordConflicts();
  if (options.checkNetwork === false) { await options.persist(checkpoint); return checkpoint; }
  const hostBlockedUntil = new Map<string, number>();
  for (const [key, result] of Object.entries(checkpoint.results)) {
    const target = targets.find(t => t.key === key)!;
    const safe = reportableAudioUrl(target.url);
    const until = result.check.retryAt ? Date.parse(result.check.retryAt) : 0;
    const retryHost = result.check.retryHost ?? (safe ? new URL(safe).hostname : '');
    if (retryHost && until > now()) hostBlockedUntil.set(retryHost, Math.max(until, hostBlockedUntil.get(retryHost) ?? 0));
  }
  const reused = new Map<string, AudioLinkCheck>();
  for (const target of [...targets].sort((a, b) => a.key.localeCompare(b.key))) {
    if (excluded.has(target.key)) continue;
    const existing = checkpoint.results[target.key];
    const checkedMs = existing ? Date.parse(existing.check.checkedAt) : 0;
    if (existing && checkedMs <= now() && now() - checkedMs < refreshAfterMs && (!existing.check.retryAt || Date.parse(existing.check.retryAt) > now())) continue;
    const safe = reportableAudioUrl(target.url);
    const host = safe ? new URL(safe).hostname : '';
    const blockedUntil = hostBlockedUntil.get(host) ?? 0;
    let check: AudioLinkCheck;
    if (isYoutubeAudioUrl(target.url)) check = { status: 'YOUTUBE_SOURCE_PROHIBITED', httpStatus: null, checkedAt: new Date(now()).toISOString() };
    else if (!safe) check = { status: 'AUDIO_URL_UNSAFE_OR_SIGNED', httpStatus: null, checkedAt: new Date(now()).toISOString() };
    else if (blockedUntil > now()) check = { status: 'AUDIO_RATE_LIMITED', httpStatus: 429, checkedAt: new Date(now()).toISOString(), retryAt: new Date(blockedUntil).toISOString() };
    else {
      const reuseKey = JSON.stringify([target.reciterId, target.url, [...target.allowedHosts].sort()]);
      check = reused.get(reuseKey) ?? publicCheck(await options.checkLink(target.url, target.allowedHosts));
      if (check.status === 'available') reused.set(reuseKey, check);
      if (check.retryAt) hostBlockedUntil.set(check.retryHost ?? host, Date.parse(check.retryAt));
    }
    if (!Number.isFinite(Date.parse(check.checkedAt))) throw new Error('CATALOG_LINK_CHECK_TIMESTAMP_INVALID');
    checkpoint.results[target.key] = { targetKey: target.key, inputSha256: targetHash(target), check, evidenceScope: 'link_only_not_voice_identity' };
    await options.persist(checkpoint);
    excluded = await recordConflicts();
  }
  return checkpoint;
}

/** A deterministic review plan only. This module has no database execute capability. */
export function catalogLinkSqlPlan(targets: readonly CatalogLinkTarget[], checkpoint: CatalogLinkCheckpoint): { sql: string; sha256: string; statements: Array<{ sql: string; rowCount: number; targetKey: string }> } {
  createLinkCheckpoint(targets, checkpoint);
  const excluded = new Set(catalogLinkConflicts(targets, checkpoint).flatMap(c => c.targetKeys));
  if (Object.keys(checkpoint.results).length !== targets.length) throw new Error('CATALOG_LINK_CHECKS_INCOMPLETE');
  const statements = [...targets].filter(target => !excluded.has(target.key)).sort((a, b) => a.key.localeCompare(b.key)).map(target => {
    const check = checkpoint.results[target.key].check;
    const timestamp = new Date(check.checkedAt).toISOString().slice(0, 19).replace('T', ' ');
    const table = target.kind === 'chapter' ? 'recitation_chapters' : 'recitation_source_urls';
    const status = target.kind === 'chapter' ? check.status === 'available' ? 'available' : 'source_unavailable' : check.status;
    const fields = target.kind === 'chapter' ? `audio_status=${sqlLiteral(status)},last_verified_at=${sqlLiteral(timestamp)}` : `last_status=${sqlLiteral(status)},last_checked_at=${sqlLiteral(timestamp)}`;
    const urlField = target.kind === 'chapter' ? 'audio_url' : 'url';
    const sql = `UPDATE ${table} SET ${fields} WHERE id=${sqlLiteral(target.id)} COLLATE utf8mb4_unicode_ci AND recitation_id=${sqlLiteral(target.recitationId)} COLLATE utf8mb4_unicode_ci AND BINARY SHA2(CONVERT(${urlField} USING utf8mb4),256)=BINARY ${sqlLiteral(sha(target.url))};`;
    return { sql, rowCount: 1, targetKey: target.key };
  });
  const sql = `-- Link checks only: no voice identity, publication, licensing or timing changes.\nSET time_zone='+00:00';\nSTART TRANSACTION;\n${statements.map(s => s.sql).join('\n')}\nCOMMIT;\n`;
  return { sql, sha256: sha(sql), statements };
}
export function catalogLinkReport(targets: readonly CatalogLinkTarget[], checkpoint: CatalogLinkCheckpoint): Record<string, unknown> {
  const conflicts = catalogLinkConflicts(targets, checkpoint), excluded = new Set(conflicts.flatMap(c => c.targetKeys));
  const counts: Record<string, number> = {};
  const rows = targets.map(target => {
    const result = checkpoint.results[target.key];
    const status = excluded.has(target.key) ? 'SAME_AUDIO_CONFLICT' : result?.check.status ?? 'not_checked'; counts[status] = (counts[status] ?? 0) + 1;
    return { target_key: target.key, kind: target.kind, recitation: target.recitationSlug, surah: target.surah,
      original_url: reportableAudioUrl(target.url), original_url_sha256: sha(target.url), ...result?.check, status, ...(result?.conflictObservation ? { conflict_observation: result.conflictObservation } : {}) };
  });
  return { input_sha256: checkpoint.inputSha256, total: targets.length, counts,
    evidence_scope: 'HEAD/Range checks link availability only; no voice identity, timing or publication approval.',
    last_checks: rows, failed_urls: rows.filter(r => r.status !== 'available'), stopped: checkpoint.stopped ?? null,
    same_audio_conflicts: conflicts.map(c => ({ ...c, severity: 'critical', type: 'same_audio_conflict' })),
    excluded_rule_v1_recitation_ids: [...new Set(targets.filter(t => excluded.has(t.key)).map(t => t.recitationId))].sort(),
    excluded_rule_v1_recitation_slugs: [...new Set(targets.filter(t => excluded.has(t.key)).map(t => t.recitationSlug))].sort(),
    stopped_history: checkpoint.stoppedHistory ?? [], collision_policy: 'record_critical_exclude_affected_continue_others' };
}

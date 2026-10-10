import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { logger } from '../logger';
import { appendCatalogAudit, type CatalogActor } from './catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow, type CatalogTx } from './catalogContracts';
import { audioStorageManifest } from './catalogStorageReconciliation';
import type { AudioObjectStorage } from './catalogStorageContracts';

export const STORAGE_RECONCILIATION_WEEK_MS = 7 * 86400000;
const ACTION = 'storage.weekly_reconciled';
const ACTOR: CatalogActor = { id: 'storage-weekly-reconciliation', kind: 'system', roleSlug: 'system', permissions: new Set() };
/** Deliberately cannot read audio, sign URLs, upload, abort or delete. */
export type StorageInventoryReader = Pick<AudioObjectStorage, 'adapter' | 'bucket' | 'listObjects'> & { close?(): void | Promise<void> };
export interface WeeklyStorageOptions {
  db: CatalogDatabase;
  /** A fresh reader owned by this run; its optional close is always called. */
  storageProvider(input: { adapter: 'r2'; access: 'read_only' }): Promise<StorageInventoryReader> | StorageInventoryReader;
  writeReport(report: StorageWeeklyReport): Promise<void>;
  now?: () => number;
  log?: Pick<typeof logger, 'info' | 'error'>;
}
export interface WeeklyStorageSummary {
  state: 'disabled' | 'not_due' | 'reported' | 'overlap_skipped' | 'closed' | 'failed';
  objects?: number; bytes?: number; orphaned?: number; missing?: number; sizeMismatches?: number;
  errorCode?: 'STORAGE_WEEKLY_RECONCILIATION_FAILED';
}
export interface StorageWeeklyReport extends CatalogRow {
  checkedAt: string; adapter: 'r2'; bucket: string; objects: number; bytes: number;
  orphanedObjectKeyHashes: string[]; missingObjectIds: string[]; sizeMismatchObjectIds: string[];
  manifest: ReturnType<typeof audioStorageManifest>; manifestSha256: string; reportOnly: true;
}
/** Caller supplies a private, untracked directory. Exclusive metadata files; no cleanup. */
export function privateStorageReportWriter(directory: string): (report: StorageWeeklyReport) => Promise<void> {
  if (!isAbsolute(directory)) throw new CatalogError('STORAGE_REPORT_DIRECTORY_INVALID', 503);
  return async report => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'storage-' + randomUUID() + '.json'), JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
  };
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,191}$/u.test(value);
const safeKey = (value: unknown): value is string => typeof value === 'string' && /^licensed\/[a-z0-9][a-z0-9_-]{0,190}\/\d{3}\/[a-f0-9]{64}\.(mp3|m4a|aac|ogg|opus|flac|wav)$/u.test(value);
async function adapter(tx: CatalogTx): Promise<'url_reference' | 'r2'> {
  const rows = await tx.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='storage_adapter'");
  if (!rows.length) return 'url_reference';
  if (rows.length !== 1 || ![0, false].includes(rows[0].is_secret as boolean | number) || !['url_reference', 'r2'].includes(String(rows[0].value_text))) throw new CatalogError('STORAGE_SETTING_INVALID', 503);
  return rows[0].value_text as 'url_reference' | 'r2';
}
async function isDue(tx: CatalogTx, bucket: string | null, now: number): Promise<boolean> {
  const rows = await tx.read("SELECT new_values FROM audit_logs WHERE action=? AND entity_type='storage_adapter' AND entity_id=? ORDER BY created_at DESC LIMIT 1", [ACTION, bucket]);
  if (!rows.length) return true;
  const value: unknown = typeof rows[0].new_values === 'string' ? JSON.parse(rows[0].new_values) : rows[0].new_values;
  const checkedAt = value && typeof value === 'object' && 'checkedAt' in value ? value.checkedAt : null;
  const timestamp = typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now) throw new CatalogError('STORAGE_RECONCILIATION_AUDIT_INVALID', 503);
  return now - timestamp >= STORAGE_RECONCILIATION_WEEK_MS;
}
function manifestRows(rows: readonly CatalogRow[]): CatalogRow[] {
  return rows.map(row => {
    if (!safeId(row.id) || !safeId(row.recitation_id) || !safeKey(row.object_key) || !Number.isSafeInteger(Number(row.size_bytes)) || Number(row.size_bytes) < 1 || !Number.isSafeInteger(Number(row.surah)) || Number(row.surah) < 1 || Number(row.surah) > 114 || !/^[a-f0-9]{64}$/u.test(String(row.sha256)) || !['pending', 'uploaded', 'verified', 'rejected', 'soft_deleted'].includes(String(row.upload_status)) || row.object_key.split('/')[2] !== String(row.surah).padStart(3, '0') || row.object_key.split('/')[3].split('.')[0] !== row.sha256) throw new CatalogError('STORAGE_RECONCILIATION_ROW_INVALID', 503);
    // Explicit projection: no rights files, URLs, evidence, upload IDs, credentials or object bodies.
    return { id: row.id, recitation_id: row.recitation_id, surah: Number(row.surah), object_key: row.object_key, sha256: row.sha256, size_bytes: Number(row.size_bytes), upload_status: row.upload_status };
  });
}

/** Exported lifecycle only: root wires this into the existing server shutdown sequence. */
export class CatalogWeeklyStorageReconciliation {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<WeeklyStorageSummary> | null = null;
  private closed = false;
  private last: WeeklyStorageSummary = { state: 'not_due' };
  constructor(private readonly options: WeeklyStorageOptions) {}
  start(): void {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => { void this.runOnce(); }, STORAGE_RECONCILIATION_WEEK_MS);
    this.timer.unref();
    void this.runOnce();
  }
  get status(): WeeklyStorageSummary & { running: boolean; timerActive: boolean } {
    return { ...this.last, running: !!this.inFlight, timerActive: !!this.timer };
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
  }
  runOnce(): Promise<WeeklyStorageSummary> {
    if (this.closed) return Promise.resolve({ state: 'closed' });
    if (this.inFlight) return Promise.resolve({ state: 'overlap_skipped' });
    const task = this.perform().then(summary => this.last = summary).catch(() => {
      // Never pass an SDK/DB error, stack, endpoint, token or raw response to logs.
      (this.options.log ?? logger).error('STORAGE_WEEKLY_RECONCILIATION_FAILED');
      return this.last = { state: 'failed', errorCode: 'STORAGE_WEEKLY_RECONCILIATION_FAILED' } as WeeklyStorageSummary;
    }).finally(() => { this.inFlight = null; });
    this.inFlight = task;
    return task;
  }
  private async perform(): Promise<WeeklyStorageSummary> {
    const { db } = this.options;
    // This is the first query, before provider construction or environment consultation.
    if (await adapter(db) === 'url_reference') return { state: 'disabled' };
    if (this.closed) return { state: 'closed' };
    const storage = await this.options.storageProvider({ adapter: 'r2', access: 'read_only' });
    try { return await this.performWithStorage(db, storage); }
    finally { await storage.close?.(); }
  }
  private async performWithStorage(db: CatalogDatabase, storage: StorageInventoryReader): Promise<WeeklyStorageSummary> {
    if (storage.adapter !== 'r2' || !storage.bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(storage.bucket)) throw new CatalogError('STORAGE_RECONCILIATION_PROVIDER_INVALID', 503);
    const now = (this.options.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0) throw new CatalogError('STORAGE_RECONCILIATION_CLOCK_INVALID', 503);
    if (!await isDue(db, storage.bucket, now)) return { state: 'not_due' };
    const rows = manifestRows(await db.read("SELECT id,recitation_id,surah,object_key,sha256,size_bytes,upload_status FROM storage_objects WHERE adapter='r2' AND bucket=? AND upload_status<>'deleted' ORDER BY object_key", [storage.bucket]));
    if (this.closed) return { state: 'closed' };
    const objects = await storage.listObjects();
    if (this.closed) return { state: 'closed' };
    const indexed = new Map<string, number>(); let bytes = 0;
    for (const object of objects) {
      if (typeof object.objectKey !== 'string' || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0 || indexed.has(object.objectKey)) throw new CatalogError('STORAGE_RECONCILIATION_INVENTORY_INVALID', 503);
      indexed.set(object.objectKey, object.sizeBytes); bytes += object.sizeBytes;
      if (!Number.isSafeInteger(bytes)) throw new CatalogError('STORAGE_RECONCILIATION_INVENTORY_INVALID', 503);
    }
    const known = new Set(rows.map(row => String(row.object_key)));
    const orphanHashes = [...indexed.keys()].filter(key => !known.has(key)).map(hash).sort();
    const missing = rows.filter(row => !['pending', 'rejected'].includes(String(row.upload_status)) && !indexed.has(String(row.object_key))).map(row => String(row.id)).sort();
    const mismatches = rows.filter(row => indexed.has(String(row.object_key)) && indexed.get(String(row.object_key)) !== row.size_bytes).map(row => String(row.id)).sort();
    const manifest = audioStorageManifest(rows);
    const report: StorageWeeklyReport = { checkedAt: new Date(now).toISOString(), adapter: 'r2', bucket: storage.bucket, objects: objects.length, bytes, orphanedObjectKeyHashes: orphanHashes, missingObjectIds: missing, sizeMismatchObjectIds: mismatches, manifest, manifestSha256: hash(JSON.stringify(manifest)), reportOnly: true };
    const summary = await db.transaction(async tx => {
      if (this.closed) return { state: 'closed' };
      if (await adapter(tx) !== 'r2') return { state: 'disabled' };
      // catalogDatabaseFromPool serializes audit transactions. Recheck after that lock
      // to coalesce a concurrent server replica or a restart; never mutate object rows.
      if (!await isDue(tx, storage.bucket, now)) return { state: 'not_due' };
      await this.options.writeReport(report);
      await appendCatalogAudit(tx, ACTOR, ACTION, 'storage_adapter', storage.bucket!, null, report);
      const summary: WeeklyStorageSummary = { state: 'reported', objects: objects.length, bytes, orphaned: orphanHashes.length, missing: missing.length, sizeMismatches: mismatches.length };
      return summary;
    });
    if (summary.state === 'reported') (this.options.log ?? logger).info('STORAGE_WEEKLY_RECONCILIATION_REPORTED', { objects: objects.length, bytes, orphaned: orphanHashes.length, missing: missing.length, sizeMismatches: mismatches.length });
    return summary as WeeklyStorageSummary;
  }
}

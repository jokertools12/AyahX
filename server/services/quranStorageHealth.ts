import { query } from '../db';
import { logger } from '../logger';

export interface StorageMeasurement { allocated_bytes: number | string; base_bytes: number | string; timing_bytes: number | string }
export function assessQuranStorage(row: StorageMeasurement | undefined, volume: string | undefined, now = Date.now()): Record<string, unknown> {
  const total = Number(volume);
  if (!volume || !Number.isSafeInteger(total) || total <= 0) return { status: 'unavailable', reason: 'volume_size_missing_or_invalid' };
  if (!row) return { status: 'unavailable', reason: 'measurement_missing' };
  const used = Number(row.allocated_bytes), base = Number(row.base_bytes), timing = Number(row.timing_bytes);
  if (![used, base, timing].every((n) => Number.isSafeInteger(n) && n >= 0) || used !== base + timing) return { status: 'unavailable', reason: 'measurement_invalid' };
  const available = Math.max(0, total - used);
  return { status: available / total < 0.2 ? 'warning' : 'ok', totalBytes: total, allocatedTableBytes: used,
    baseTableBytes: base, timingTableBytes: timing, availableBytes: available, freePercent: Math.round(available / total * 10000) / 100,
    observedAt: new Date(now).toISOString(), source: 'information_schema', limitation: 'Table allocation estimate; excludes redo, undo, binlog and other filesystem files.' };
}

const CACHE_MS = 5 * 60 * 1000;
let cached: { volume: string | undefined; expires: number; value: Record<string, unknown> } | undefined;
let pending: Promise<Record<string, unknown>> | undefined;
export async function readQuranStorageHealth(): Promise<Record<string, unknown>> {
  const volume = process.env.STORAGE_VOLUME_BYTES;
  if (cached && cached.volume === volume && cached.expires > Date.now()) return cached.value;
  if (!volume || !Number.isSafeInteger(Number(volume)) || Number(volume) <= 0) return assessQuranStorage(undefined, volume);
  if (pending) return pending;
  pending = (async () => {
    let value: Record<string, unknown>;
    try {
      const rows = await query<StorageMeasurement[]>("SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) AS allocated_bytes,COALESCE(SUM(CASE WHEN TABLE_NAME IN ('ayah_timings','import_jobs','ayah_timing_history') THEN 0 ELSE DATA_LENGTH+INDEX_LENGTH END),0) AS base_bytes,COALESCE(SUM(CASE WHEN TABLE_NAME IN ('ayah_timings','import_jobs','ayah_timing_history') THEN DATA_LENGTH+INDEX_LENGTH ELSE 0 END),0) AS timing_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
      value = assessQuranStorage(rows[0], volume);
    } catch (error) {
      const raw = (error as { code?: string }).code;
      const code = raw && /^[A-Z0-9_]{1,64}$/u.test(raw) ? raw : 'QUERY_FAILED';
      logger.warn('MySQL table allocation measurement unavailable', { code });
      value = { status: 'unavailable', reason: 'measurement_query_failed' };
    }
    cached = { volume, expires: Date.now() + CACHE_MS, value };
    return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}

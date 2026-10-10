import { query } from '../db';
import { logger } from '../logger';

export interface StorageMeasurement { total_bytes: number | string; available_bytes: number | string; observed_at: string }
export function assessQuranStorage(row: StorageMeasurement | undefined, now = Date.now()): Record<string, unknown> {
  if (!row) return { status: 'unavailable', reason: 'measurement_missing' };
  const total = Number(row.total_bytes), available = Number(row.available_bytes);
  const observed = Date.parse(`${row.observed_at.replace(' ', 'T')}Z`);
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(available) || available < 0 || available > total || !Number.isFinite(observed) || observed > now + 60000) return { status: 'unavailable', reason: 'measurement_invalid' };
  if (now - observed > 180000) return { status: 'unavailable', reason: 'measurement_stale', observedAt: new Date(observed).toISOString() };
  return { status: available / total < 0.2 ? 'warning' : 'ok', totalBytes: total, availableBytes: available,
    freePercent: Math.round(available / total * 10000) / 100, observedAt: new Date(observed).toISOString() };
}
export async function readQuranStorageHealth(): Promise<Record<string, unknown>> {
  try {
    const rows = await query<StorageMeasurement[]>('SELECT total_bytes,available_bytes,DATE_FORMAT(observed_at,\'%Y-%m-%d %H:%i:%s\') AS observed_at FROM quran_storage_health WHERE id=1');
    return assessQuranStorage(rows[0]);
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'QUERY_FAILED';
    // Do not turn failed or absent telemetry into a healthy measurement.
    logger.warn('MySQL volume measurement unavailable', { code });
    return { status: 'unavailable', reason: code === 'ER_NO_SUCH_TABLE' ? 'measurement_not_installed' : 'measurement_query_failed' };
  }
}

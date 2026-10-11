/** Pure measurement helper: administrative imports must not instantiate a DB pool. */
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

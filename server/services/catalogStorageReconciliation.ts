import type { AudioObjectStorage } from './catalogStorageContracts';
import { CatalogError, type CatalogRow } from './catalogContracts';

/** Report only: neither orphan detection nor weekly scheduling grants deletion. */
export async function reconcileAudioStorage(storage: AudioObjectStorage, rows: readonly CatalogRow[]): Promise<{ checkedAt: string; adapter: string; bucket: string | null; objects: number; bytes: number; orphanedObjects: string[]; missingObjects: string[]; sizeMismatches: string[] }> {
  const objects = await storage.listObjects(); const indexed = new Map(objects.map(o => [o.objectKey, o]));
  const active = rows.filter(r => r.adapter === storage.adapter && r.bucket === storage.bucket && r.upload_status !== 'deleted'); const known = new Set(active.map(r => String(r.object_key)));
  return { checkedAt: new Date().toISOString(), adapter: storage.adapter, bucket: storage.bucket, objects: objects.length, bytes: objects.reduce((sum, o) => sum + o.sizeBytes, 0), orphanedObjects: objects.filter(o => !known.has(o.objectKey)).map(o => o.objectKey), missingObjects: active.filter(r => !['pending', 'rejected'].includes(String(r.upload_status)) && !indexed.has(String(r.object_key))).map(r => String(r.id)), sizeMismatches: active.filter(r => indexed.has(String(r.object_key)) && indexed.get(String(r.object_key))!.sizeBytes !== Number(r.size_bytes)).map(r => String(r.id)) };
}
export function audioStorageManifest(rows: readonly CatalogRow[]): { objects: Array<{ objectKey: string; sha256: string; sizeBytes: number; recitationId: string; surah: number }> } {
  return { objects: rows.filter(r => r.upload_status === 'verified').map(r => { if (!/^[a-f0-9]{64}$/u.test(String(r.sha256))) throw new CatalogError('STORAGE_MANIFEST_INVALID', 503); return { objectKey: String(r.object_key), sha256: String(r.sha256), sizeBytes: Number(r.size_bytes), recitationId: String(r.recitation_id), surah: Number(r.surah) }; }).sort((a, b) => a.objectKey.localeCompare(b.objectKey)) };
}
export interface StoragePricing { recordedAt: string; sourceUrl: string; freeStorageBytes: number; storageDollarsPerGbMonth: number; freeClassA: number; classADollarsPerMillion: number; freeClassB: number; classBDollarsPerMillion: number }
/** R2 Standard estimate. bytes models average daily-peak bytes over a full month,
 * not a measured invoice; operation counts and allowance are account-wide monthly totals. */
export function estimateAudioStorageCost(bytes: number, classA: number, classB: number, pricing: StoragePricing): { dollars: number; alerts: string[]; billableUnits: { gbMonths: number; classAMillions: number; classBMillions: number } } {
  if (![bytes, classA, classB, pricing.freeStorageBytes, pricing.freeClassA, pricing.freeClassB].every(n => Number.isSafeInteger(n) && n >= 0) || ![pricing.storageDollarsPerGbMonth, pricing.classADollarsPerMillion, pricing.classBDollarsPerMillion].every(n => Number.isFinite(n) && n >= 0)) throw new CatalogError('STORAGE_PRICING_INVALID', 422);
  // Standard free allowance first; any positive excess consumes a whole paid unit.
  // https://developers.cloudflare.com/r2/pricing/#r2-pricing
  const billableUnits = { gbMonths: Math.ceil(Math.max(0, bytes - pricing.freeStorageBytes) / 1_000_000_000), classAMillions: Math.ceil(Math.max(0, classA - pricing.freeClassA) / 1_000_000), classBMillions: Math.ceil(Math.max(0, classB - pricing.freeClassB) / 1_000_000) };
  const dollars = billableUnits.gbMonths * pricing.storageDollarsPerGbMonth + billableUnits.classAMillions * pricing.classADollarsPerMillion + billableUnits.classBMillions * pricing.classBDollarsPerMillion;
  return { dollars, billableUnits, alerts: [...(pricing.freeStorageBytes > 0 && bytes >= pricing.freeStorageBytes * .7 ? ['STORAGE_FREE_TIER_70_PERCENT'] : []), ...(dollars > 1 ? ['STORAGE_ESTIMATE_OVER_ONE_DOLLAR'] : []), ...(dollars > 5 ? ['STORAGE_BUDGET_OVER_FIVE_DOLLARS'] : [])] };
}

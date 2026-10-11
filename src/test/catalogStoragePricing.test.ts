// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateAudioStorageCost, type StoragePricing } from '../../server/services/catalogStorageReconciliation';

// Recorded official Standard tariff, 2026-10-10. These are fixtures, not account usage.
const pricing: StoragePricing = { recordedAt: '2026-10-10', sourceUrl: 'https://developers.cloudflare.com/r2/pricing/', freeStorageBytes: 10_000_000_000, storageDollarsPerGbMonth: .015, freeClassA: 1_000_000, classADollarsPerMillion: 4.5, freeClassB: 10_000_000, classBDollarsPerMillion: .36 };
describe('R2 Standard whole billable units after monthly free allowance', () => {
  it.each([
    [0, 0], [9_999_999_999, 0], [10_000_000_000, 0], [10_000_000_001, 1],
    [10_100_000_000, 1], [11_000_000_000, 1], [11_000_000_001, 2],
  ])('storage %s bytes => %s paid GB-months', (bytes, gbMonths) => {
    const result = estimateAudioStorageCost(bytes, 0, 0, pricing);
    expect(result.billableUnits).toEqual({ gbMonths, classAMillions: 0, classBMillions: 0 }); expect(result.dollars).toBe(gbMonths * .015);
  });
  it.each([[0, 0], [999_999, 0], [1_000_000, 0], [1_000_001, 1], [2_000_000, 1], [2_000_001, 2]])('Class A %s operations => %s paid millions', (operations, paid) => {
    const result = estimateAudioStorageCost(0, operations, 0, pricing);
    expect(result.billableUnits.classAMillions).toBe(paid); expect(result.dollars).toBe(paid * 4.5);
  });
  it.each([[0, 0], [9_999_999, 0], [10_000_000, 0], [10_000_001, 1], [11_000_000, 1], [11_000_001, 2]])('Class B %s operations => %s paid millions', (operations, paid) => {
    const result = estimateAudioStorageCost(0, 0, operations, pricing);
    expect(result.billableUnits.classBMillions).toBe(paid); expect(result.dollars).toBe(paid * .36);
  });
  it('rounds each paid category independently and alerts from the rounded total', () => {
    const result = estimateAudioStorageCost(10_000_000_001, 1_000_001, 11_000_001, pricing);
    expect(result.billableUnits).toEqual({ gbMonths: 1, classAMillions: 1, classBMillions: 2 }); expect(result.dollars).toBeCloseTo(5.235, 12);
    expect(result.alerts).toContain('STORAGE_BUDGET_OVER_FIVE_DOLLARS');
    expect(estimateAudioStorageCost(0, 1_000_001, 0, pricing).alerts).toContain('STORAGE_ESTIMATE_OVER_ONE_DOLLAR');
  });
  it('supports recorded tariffs without hardcoding them in production and does not grant a nonexistent zero-free-tier alert', () => {
    const result = estimateAudioStorageCost(1, 1, 1, { ...pricing, freeStorageBytes: 0, freeClassA: 0, freeClassB: 0, storageDollarsPerGbMonth: .02, classADollarsPerMillion: 2, classBDollarsPerMillion: .1 });
    expect(result.dollars).toBeCloseTo(2.12, 12); expect(result.alerts).not.toContain('STORAGE_FREE_TIER_70_PERCENT');
  });
  it('retains the seventy-percent threshold and rejects invalid usage/prices', () => {
    expect(estimateAudioStorageCost(6_999_999_999, 0, 0, pricing).alerts).not.toContain('STORAGE_FREE_TIER_70_PERCENT');
    expect(estimateAudioStorageCost(7_000_000_000, 0, 0, pricing).alerts).toContain('STORAGE_FREE_TIER_70_PERCENT');
    for (const invalid of [-1, .1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => estimateAudioStorageCost(invalid, 0, 0, pricing)).toThrow('STORAGE_PRICING_INVALID');
    expect(() => estimateAudioStorageCost(0, 0, 0, { ...pricing, classADollarsPerMillion: -1 })).toThrow('STORAGE_PRICING_INVALID');
  });
});

import { describe, expect, it } from 'vitest';
import { availableCpuCores, getRenderCapacity, resolveConcurrencySetting } from '../../server/services/renderCapacity';

describe('Adaptive render capacity', () => {
  it('resolves auto and invalid settings to a safe positive CPU-based value', () => {
    expect(resolveConcurrencySetting('auto')).toBeGreaterThanOrEqual(1);
    expect(resolveConcurrencySetting('not-a-number', 3)).toBe(3);
    expect(resolveConcurrencySetting('4')).toBe(4);
  });

  it('never admits more jobs than the configured resource ceiling', () => {
    const cpuCores = availableCpuCores();
    const capacity = getRenderCapacity(0, 4);
    expect(capacity.targetConcurrency).toBeGreaterThanOrEqual(1);
    expect(capacity.targetConcurrency).toBeLessThanOrEqual(Math.min(4, cpuCores));
  });

  it('does not lower concurrency below jobs already running', () => {
    const capacity = getRenderCapacity(3, 1);
    expect(capacity.targetConcurrency).toBeGreaterThanOrEqual(3);
  });
});

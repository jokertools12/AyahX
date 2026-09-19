import { describe, expect, it } from 'vitest';
import { availableCpuCores, getRenderCapacity, resolveConcurrencySetting } from '../../server/services/renderCapacity';
import { planRenderAutoscale } from '../../server/services/renderAutoscaler';
import { classifyRenderFailure } from '../../server/services/renderJobQueue';

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

  it('scales only the saturated engine and drains one replica at a time', () => {
    expect(planRenderAutoscale({
      currentReplicas: 2, waiting: 7, active: 2, slotsPerReplica: 3,
      minReplicas: 2, maxReplicas: 6, nowMs: 1000, idleWindowMs: 900_000,
    }).desiredReplicas).toBe(3);
    expect(planRenderAutoscale({
      currentReplicas: 4, waiting: 0, active: 0, slotsPerReplica: 3,
      minReplicas: 2, maxReplicas: 6, nowMs: 901_000, idleSinceMs: 1_000, idleWindowMs: 900_000,
    }).desiredReplicas).toBe(3);
    expect(planRenderAutoscale({
      currentReplicas: 4, waiting: 0, active: 0, slotsPerReplica: 3,
      minReplicas: 2, maxReplicas: 6, nowMs: 100_000, idleWindowMs: 900_000,
    }).desiredReplicas).toBe(4);
  });

  it('does not retry permanent asset 404s', () => {
    expect(classifyRenderFailure('Failed to download audio: HTTP 404')).toEqual({ code: 'ASSET', transient: false });
    expect(classifyRenderFailure('audio network connection reset')).toEqual({ code: 'ASSET', transient: true });
  });
});

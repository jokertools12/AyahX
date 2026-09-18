import { describe, expect, it } from 'vitest';
import { availableCpuCores, getRenderCapacity, getRenderMemoryProfile, resolveConcurrencySetting } from '../../server/services/renderCapacity';

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

  it('keeps independent memory profiles for each render engine', () => {
    expect(getRenderMemoryProfile('ffmpeg_ass')).toEqual({ memoryPerJobMb: 128, memoryReserveMb: 256 });
    expect(getRenderMemoryProfile('skia_canvas')).toEqual({ memoryPerJobMb: 256, memoryReserveMb: 256 });
    expect(getRenderMemoryProfile('browser_cloud')).toEqual({ memoryPerJobMb: 650, memoryReserveMb: 350 });
    expect(getRenderCapacity(0, 8, 'browser_cloud').engine).toBe('browser_cloud');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRuntimeInitialization } from '../../server/services/runtimeInitialization';
describe('shared startup/readiness initialization', () => {
  it('does no maintenance after failed readiness and initializes once after recovery', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(undefined);
    const retention = vi.fn(); const maintenance = vi.fn();
    const ensure = createRuntimeInitialization(check, async () => { maintenance(); retention(); });
    await expect(ensure()).rejects.toThrow('not ready'); expect(retention).not.toHaveBeenCalled(); expect(maintenance).not.toHaveBeenCalled();
    await Promise.all([ensure(), ensure(), ensure()]); await ensure();
    expect(retention).toHaveBeenCalledOnce(); expect(maintenance).toHaveBeenCalledOnce(); expect(check).toHaveBeenCalledTimes(5);
  });
  it('retries a failed initialization while continuing to check schema after success', async () => {
    const check = vi.fn(async () => {}); const initialize = vi.fn().mockRejectedValueOnce(new Error('recovery failed')).mockResolvedValue(undefined);
    const ensure = createRuntimeInitialization(check, initialize);
    await expect(ensure()).rejects.toThrow('recovery failed'); await ensure(); await ensure(); expect(initialize).toHaveBeenCalledTimes(2);
    check.mockRejectedValueOnce(new Error('schema removed')); await expect(ensure()).rejects.toThrow('schema removed'); expect(initialize).toHaveBeenCalledTimes(2);
  });
});

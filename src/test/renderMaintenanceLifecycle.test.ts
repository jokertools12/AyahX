// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn(async () => []) }));
vi.mock('../../server/db', () => ({ query }));
vi.mock('fs', () => ({ default: { existsSync: () => true, mkdirSync: vi.fn() } }));
vi.mock('../../server/config', () => ({ config: { queue: { driver: 'database', workerConcurrency: 1 } } }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../server/models/renderManifest', () => ({ validateRenderManifest: vi.fn() }));
vi.mock('../../server/services/assetCatalogResolver', () => ({ validateManifestAssets: vi.fn() }));
vi.mock('../../server/services/deterministicVideoRenderer', () => ({ renderDeterministicVideo: vi.fn() }));
vi.mock('../../server/services/renderQueueBroker', () => ({ enqueueRenderJob: vi.fn(), resolveRenderQueueEngine: vi.fn(), startRenderWorker: vi.fn() }));
vi.mock('../../server/services/objectStorage', () => ({ deleteStoredRender: vi.fn(), isObjectStoragePath: vi.fn(), uploadRender: vi.fn() }));
vi.mock('../../server/services/renderObservability', () => ({ recordRenderAudit: vi.fn(), recordRenderResources: vi.fn(), renderDurationSeconds: { observe: vi.fn() } }));
vi.mock('../../server/services/renderCapacity', () => ({ resolveConcurrencySetting: () => 1, estimateRenderJobProfile: vi.fn(),
  readCgroupCpuUsageMicros: vi.fn(), readMemoryPeakBytes: vi.fn(), readOomKillCount: vi.fn() }));
vi.mock('../../server/services/renderChildRunner', () => ({ runRenderJobInChild: vi.fn(), stopRenderChild: vi.fn() }));
const instances: { stopBackgroundMaintenance(): void }[] = [];
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'true'); });
afterEach(() => {
  for (const queue of instances.splice(0)) queue.stopBackgroundMaintenance();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});
async function fixture() {
  const module = await import('../../server/services/renderJobQueue');
  instances.push(module.renderJobQueue);
  const cleanup = vi.spyOn(module.RenderJobQueue.prototype, 'cleanupExpiredRenders').mockResolvedValue();
  const recover = vi.spyOn(module.RenderJobQueue.prototype, 'recoverStaleJobs').mockResolvedValue();
  return { ...module, cleanup, recover };
}
describe('render queue background maintenance lifecycle', () => {
  it.each(['true', 'false', ''])('import and constructors stay idle regardless of elapsed time when flag=%s', async flag => {
    vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', flag);
    const f = await fixture(); const queue = new f.RenderJobQueue(); instances.push(queue);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(query).not.toHaveBeenCalled(); expect(f.cleanup).not.toHaveBeenCalled(); expect(f.recover).not.toHaveBeenCalled();
  });
  it('starts one unreferenced interval pair with existing cadence and stale-only recovery', async () => {
    const f = await fixture(); const intervals = vi.spyOn(globalThis, 'setInterval');
    f.renderJobQueue.startBackgroundMaintenance(); f.renderJobQueue.startBackgroundMaintenance();
    expect(vi.getTimerCount()).toBe(2); expect(intervals).toHaveBeenCalledTimes(2);
    expect(intervals.mock.calls.map(([, delay]) => delay)).toEqual([30 * 60 * 1000, 60 * 1000]);
    for (const result of intervals.mock.results) if (result.type === 'return') expect(result.value.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(60 * 1000); expect(f.recover).toHaveBeenCalledExactlyOnceWith(true); expect(f.cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000); expect(f.recover).toHaveBeenCalledTimes(30); expect(f.cleanup).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
  it('respects the disabled flag when explicitly asked to start', async () => {
    const f = await fixture(); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
    f.renderJobQueue.startBackgroundMaintenance(); f.renderJobQueue.startBackgroundMaintenance();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(0); expect(f.cleanup).not.toHaveBeenCalled(); expect(f.recover).not.toHaveBeenCalled();
  });
  it('stops idempotently and restarts with exactly one fresh interval pair', async () => {
    const f = await fixture(); f.renderJobQueue.startBackgroundMaintenance();
    await vi.advanceTimersByTimeAsync(60 * 1000); expect(f.recover).toHaveBeenCalledTimes(1);
    f.renderJobQueue.stopBackgroundMaintenance(); f.renderJobQueue.stopBackgroundMaintenance();
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(f.recover).toHaveBeenCalledTimes(1); expect(f.cleanup).not.toHaveBeenCalled();
    f.renderJobQueue.startBackgroundMaintenance(); f.renderJobQueue.startBackgroundMaintenance();
    expect(vi.getTimerCount()).toBe(2); await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(f.recover).toHaveBeenCalledTimes(2);
  });
  it('shutdown stops future ticks and retains active worker cancellation', async () => {
    const f = await fixture(); const controller = new AbortController();
    // Exercise the existing worker-drain state without invoking a renderer or creating a job.
    const active = f.renderJobQueue as unknown as { activeJobAbortControllers: Map<string, AbortController> };
    active.activeJobAbortControllers.set('fixture-job', controller);
    f.renderJobQueue.startBackgroundMaintenance(); f.renderJobQueue.shutdown(); f.renderJobQueue.shutdown();
    expect(controller.signal.aborted).toBe(true); expect(active.activeJobAbortControllers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(f.cleanup).not.toHaveBeenCalled(); expect(f.recover).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
});

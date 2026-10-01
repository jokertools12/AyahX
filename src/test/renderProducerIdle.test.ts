// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn(), disconnect: vi.fn(), created: vi.fn() }));
vi.mock('../../server/config', () => ({ config: { queue: { redisUrl: 'redis://fixture' } } }));
vi.mock('ioredis', () => ({ default: class { on() {} disconnect() { mocks.disconnect(); } } }));
vi.mock('bullmq', () => ({ Queue: class { constructor() { mocks.created(); } add(...args: any[]) { return mocks.add(...args); } close() { return mocks.close(); } }, Worker: class {} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); vi.resetAllMocks(); });
it('closes only idle producers and reconnects for the next job', async () => {
  vi.useFakeTimers(); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
  mocks.add.mockResolvedValue({ id: 'fixture' }); mocks.close.mockResolvedValue(undefined);
  const { enqueueRenderJob } = await import('../../server/services/renderQueueBroker');
  await enqueueRenderJob('first', 'skia_canvas');
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  await enqueueRenderJob('second', 'skia_canvas');
  expect(mocks.created).toHaveBeenCalledTimes(2);
});
it('never closes a producer with a pending enqueue operation', async () => {
  vi.useFakeTimers(); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
  let resolve!: (job: any) => void;
  mocks.add.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { enqueueRenderJob } = await import('../../server/services/renderQueueBroker');
  const pending = enqueueRenderJob('first', 'skia_canvas');
  await vi.advanceTimersByTimeAsync(120000);
  expect(mocks.disconnect).not.toHaveBeenCalled();
  resolve({ id: 'fixture' }); await pending;
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
it('waits for an in-progress close before connecting a new job producer', async () => {
  vi.useFakeTimers(); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
  mocks.add.mockResolvedValue({ id: 'fixture' });
  let finishClose!: () => void;
  mocks.close.mockImplementation(() => new Promise<void>(r => { finishClose = r; }));
  const { enqueueRenderJob } = await import('../../server/services/renderQueueBroker');
  await enqueueRenderJob('first', 'skia_canvas');
  await vi.advanceTimersByTimeAsync(60000);
  const next = enqueueRenderJob('second', 'skia_canvas');
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.add).toHaveBeenCalledOnce();
  finishClose(); await next;
  expect(mocks.created).toHaveBeenCalledTimes(2);
});

// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ created: vi.fn(), incr: vi.fn(), expire: vi.fn(), disconnect: vi.fn() }));
vi.mock('ioredis', () => ({ default: class { constructor() { mocks.created(); } incr(...args: any[]) { return mocks.incr(...args); } expire(...args: any[]) { return mocks.expire(...args); } disconnect() { mocks.disconnect(); } } }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); vi.resetAllMocks(); });
it('releases an idle limiter connection and preserves the next shared rate-limit check', async () => {
  vi.useFakeTimers(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('REDIS_URL', 'redis://fixture'); vi.stubEnv('RENDER_BACKGROUND_MAINTENANCE', 'false');
  mocks.incr.mockResolvedValue(1); mocks.expire.mockResolvedValue(1);
  const { createRateLimiter } = await import('../../server/middleware/rateLimiter');
  const limit = createRateLimiter({ windowMs: 60000, max: 3 });
  const response = { setHeader: vi.fn() } as any;
  const next = vi.fn();
  await limit({ ip: 'fixture' } as any, response, next);
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  await limit({ ip: 'fixture' } as any, response, next);
  expect(mocks.created).toHaveBeenCalledTimes(2);
  expect(next).toHaveBeenCalledTimes(2);
});

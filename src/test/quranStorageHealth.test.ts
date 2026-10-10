import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../server/db', () => ({ query: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { warn: vi.fn() } }));
import { query } from '../../server/db';
import { assessQuranStorage, readQuranStorageHealth } from '../../server/services/quranStorageHealth';
describe('MySQL table allocation advisory', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-10-10T12:00:00Z'); vi.stubEnv('STORAGE_VOLUME_BYTES', '1000'); vi.mocked(query).mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('warns strictly below 20% and labels the filesystem limitation', () => {
    expect(assessQuranStorage({ allocated_bytes: 801, base_bytes: 600, timing_bytes: 201 }, '1000')).toMatchObject({ status: 'warning', freePercent: 19.9, source: 'information_schema' });
    expect(assessQuranStorage({ allocated_bytes: 800, base_bytes: 600, timing_bytes: 200 }, '1000')).toMatchObject({ status: 'ok' });
    expect(assessQuranStorage(undefined, undefined)).toMatchObject({ status: 'unavailable' });
  });
  it('rejects invalid allocation and declares query failure unavailable', async () => {
    expect(assessQuranStorage({ allocated_bytes: 800, base_bytes: 600, timing_bytes: 500 }, '1000')).toMatchObject({ reason: 'measurement_invalid' });
    vi.mocked(query).mockRejectedValueOnce({ code: 'ER_ACCESS_DENIED_ERROR' });
    expect(await readQuranStorageHealth()).toMatchObject({ status: 'unavailable', reason: 'measurement_query_failed' });
  });
  it('caches the on-demand measurement for five minutes and refreshes after expiry', async () => {
    vi.advanceTimersByTime(300001);
    vi.mocked(query).mockResolvedValue([{ allocated_bytes: 500, base_bytes: 400, timing_bytes: 100 }]);
    await Promise.all([readQuranStorageHealth(), readQuranStorageHealth()]);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    await readQuranStorageHealth();
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300001);
    await readQuranStorageHealth();
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(query).mock.calls[0][0]).toContain('information_schema.TABLES');
  });
});

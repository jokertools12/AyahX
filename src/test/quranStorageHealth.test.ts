import { describe, expect, it, vi } from 'vitest';
vi.mock('../../server/db', () => ({ query: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { warn: vi.fn() } }));
import { assessQuranStorage } from '../../server/services/quranStorageHealth';
describe('MySQL volume readiness advisory', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('warns strictly below 20% without changing database readiness', () => {
    expect(assessQuranStorage({ total_bytes: 1000, available_bytes: 199, observed_at: '2026-10-10 12:00:00' }, now)).toMatchObject({ status: 'warning', freePercent: 19.9 });
    expect(assessQuranStorage({ total_bytes: 1000, available_bytes: 200, observed_at: '2026-10-10 12:00:00' }, now)).toMatchObject({ status: 'ok' });
  });
  it('exposes absent, stale or impossible telemetry explicitly', () => {
    expect(assessQuranStorage(undefined, now)).toMatchObject({ status: 'unavailable' });
    expect(assessQuranStorage({ total_bytes: 1000, available_bytes: 2000, observed_at: '2026-10-10 12:00:00' }, now)).toMatchObject({ reason: 'measurement_invalid' });
    expect(assessQuranStorage({ total_bytes: 1000, available_bytes: 200, observed_at: '2026-10-10 11:56:00' }, now)).toMatchObject({ reason: 'measurement_stale' });
  });
});

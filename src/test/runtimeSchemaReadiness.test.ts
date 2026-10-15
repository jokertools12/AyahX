import { describe, expect, it, vi } from 'vitest';
import { runtimeSchemaColumns } from '../../server/db/runtimeSchemaContract';
import { createRuntimeSchemaCheck } from '../../server/db/runtimeSchemaReadiness';
const complete = () => Object.entries(runtimeSchemaColumns).flatMap(([tableName, names]) => names.map(columnName => ({ tableName, columnName })));
describe('runtime schema presence preflight', () => {
  it('only reads metadata and accepts the complete deployed schema', async () => {
    const read = vi.fn(async () => complete()); await createRuntimeSchemaCheck(read)();
    expect(read).toHaveBeenCalledExactlyOnceWith('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
  });
  it.each(['users', 'catalog_role_grants', 'catalog_audit_events', 'alignment_documents', 'render_jobs'])('rejects missing %s without trying to repair it', async table => {
    const read = vi.fn(async () => complete().filter(row => row.tableName !== table));
    await expect(createRuntimeSchemaCheck(read)()).rejects.toThrow('RUNTIME_SCHEMA_INCOMPLETE'); expect(read).toHaveBeenCalledOnce();
  });
  it('rejects a partially upgraded table', async () => {
    await expect(createRuntimeSchemaCheck(async () => complete().filter(row => !(row.tableName === 'payment_requests' && row.columnName === 'currency')))()).rejects.toThrow('RUNTIME_SCHEMA_INCOMPLETE');
  });
  it('coalesces concurrent checks, expires its cache and retries failures', async () => {
    let now = 1000; const read = vi.fn(async () => complete()); const check = createRuntimeSchemaCheck(read, () => now);
    await Promise.all([check(), check(), check()]); expect(read).toHaveBeenCalledOnce();
    now = 10_999; await check(); expect(read).toHaveBeenCalledOnce();
    now = 11_000; read.mockRejectedValueOnce(new Error('unavailable'));
    await expect(check()).rejects.toThrow('unavailable'); await check(); expect(read).toHaveBeenCalledTimes(3);
  });
  it('rechecks on clock rollback and rejects an invalid clock', async () => {
    let now = 1000; const read = vi.fn(async () => complete()); const check = createRuntimeSchemaCheck(read, () => now);
    await check(); now = 999; await check(); expect(read).toHaveBeenCalledTimes(2);
    now = NaN; await expect(check()).rejects.toThrow('RUNTIME_SCHEMA_CLOCK_INVALID');
  });
});

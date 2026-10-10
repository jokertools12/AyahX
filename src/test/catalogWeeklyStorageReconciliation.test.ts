// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogDatabase, CatalogRow, CatalogTx } from '../../server/services/catalogContracts';
import { CatalogWeeklyStorageReconciliation, privateStorageReportWriter, STORAGE_RECONCILIATION_WEEK_MS, type StorageWeeklyReport } from '../../server/services/catalogWeeklyStorageReconciliation';

const now = Date.parse('2026-10-10T16:00:00Z');
const sha = 'a'.repeat(64), key = `licensed/reader/001/${sha}.wav`;
const row = (id = 'one', overrides: CatalogRow = {}): CatalogRow => ({ id, recitation_id: 'recitation-1', surah: 1, sha256: sha, object_key: key, size_bytes: 100, upload_status: 'verified', ...overrides });
function fixture() {
  let selected = 'r2', audit: CatalogRow[] = [], rows = [row()];
  const execute = vi.fn(async (sql: string, params?: unknown[]) => {
    if (!sql.startsWith('INSERT INTO audit_logs')) throw new Error('MUTATION_FORBIDDEN_IN_FIXTURE');
    audit = [{ new_values: params![7] }];
  });
  const read = vi.fn(async (sql: string): Promise<CatalogRow[]> => {
    if (sql.includes('system_settings')) return [{ value_text: selected, is_secret: 0 }];
    if (sql.includes('SELECT new_values')) return audit;
    if (sql.includes('SELECT a.hash')) return [];
    if (sql.includes('FROM storage_objects')) return rows;
    throw new Error('UNEXPECTED_QUERY');
  });
  const db: CatalogDatabase = { read, execute, transaction: async <T>(work: (tx: CatalogTx) => Promise<T>) => work({ read, execute }) };
  const listObjects = vi.fn(async () => [{ objectKey: key, sizeBytes: 100 }]);
  const storageProvider = vi.fn(() => ({ adapter: 'r2' as const, bucket: 'ayahx-private', listObjects }));
  const writeReport = vi.fn(async (_report: StorageWeeklyReport) => {});
  const log = { info: vi.fn(), error: vi.fn() };
  const runner = new CatalogWeeklyStorageReconciliation({ db, storageProvider, writeReport, log, now: () => now });
  return { db, runner, read, execute, listObjects, storageProvider, writeReport, log, setAdapter: (v: string) => { selected = v; }, setAudit: (v: CatalogRow[]) => { audit = v; }, setRows: (v: CatalogRow[]) => { rows = v; } };
}
afterEach(() => vi.useRealTimers());
describe('weekly licensed-storage reconciliation (metadata only; unit DB/storage)', () => {
  it('reads adapter first and stays inactive without provider, credentials, manifest or object-row queries', async () => {
    const f = fixture(); f.setAdapter('url_reference');
    expect(await f.runner.runOnce()).toEqual({ state: 'disabled' });
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.read.mock.calls[0][0]).toContain('system_settings');
    expect(f.storageProvider).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('defaults a missing setting to url_reference and rejects a malformed setting with a fixed observable failure', async () => {
    const f = fixture(); f.read.mockResolvedValueOnce([]);
    expect((await f.runner.runOnce()).state).toBe('disabled'); expect(f.storageProvider).not.toHaveBeenCalled();
    f.setAdapter('unexpected'); expect(await f.runner.runOnce()).toEqual({ state: 'failed', errorCode: 'STORAGE_WEEKLY_RECONCILIATION_FAILED' });
    expect(f.log.error).toHaveBeenCalledWith('STORAGE_WEEKLY_RECONCILIATION_FAILED'); expect(f.storageProvider).not.toHaveBeenCalled();
  });
  it('writes a deterministic manifest and chained audit; reports orphans, missing and size differences without mutating objects', async () => {
    const f = fixture(); f.setRows([row('one', { size_bytes: 101 }), row('missing', { object_key: key.replace('/001/', '/002/'), surah: 2 }), row('pending', { object_key: key.replace('/001/', '/003/'), surah: 3, upload_status: 'pending' })]);
    f.listObjects.mockResolvedValue([{ objectKey: key, sizeBytes: 100 }, { objectKey: 'unknown?token=DO_NOT_EXPORT', sizeBytes: 25 }]);
    expect(await f.runner.runOnce()).toMatchObject({ state: 'reported', objects: 2, bytes: 125, orphaned: 1, missing: 1, sizeMismatches: 1 });
    expect(f.storageProvider).toHaveBeenCalledWith({ adapter: 'r2', access: 'read_only' });
    const report = f.writeReport.mock.calls[0][0];
    expect(report.missingObjectIds).toEqual(['missing']); expect(report.sizeMismatchObjectIds).toEqual(['one']); expect(report.manifest.objects).toHaveLength(2);
    expect(report.manifestSha256).toBe(createHash('sha256').update(JSON.stringify(report.manifest)).digest('hex'));
    expect(JSON.stringify(report)).not.toContain('DO_NOT_EXPORT');
    expect(f.execute).toHaveBeenCalledTimes(1); expect(f.execute.mock.calls[0][0]).toMatch(/^INSERT INTO audit_logs/u);
    expect(JSON.parse(String(f.execute.mock.calls[0][1]![7]))).toEqual(report);
    expect(f.log.info).toHaveBeenCalledWith('STORAGE_WEEKLY_RECONCILIATION_REPORTED', { objects: 2, bytes: 125, orphaned: 1, missing: 1, sizeMismatches: 1 });
  });
  it('retains due status in audit history across restarts and does no inventory or filesystem work before a week', async () => {
    const f = fixture(); await f.runner.runOnce();
    f.listObjects.mockClear(); f.writeReport.mockClear();
    expect((await f.runner.runOnce()).state).toBe('not_due'); expect(f.listObjects).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled();
    f.setAudit([{ new_values: JSON.stringify({ checkedAt: new Date(now - STORAGE_RECONCILIATION_WEEK_MS).toISOString() }) }]);
    expect((await f.runner.runOnce()).state).toBe('reported');
  });
  it('coalesces a concurrent replica audit after entering the shared audit transaction', async () => {
    const f = fixture(); f.db.transaction = async work => { f.setAudit([{ new_values: { checkedAt: new Date(now).toISOString() } }]); return work(f.db); };
    expect((await f.runner.runOnce()).state).toBe('not_due'); expect(f.execute).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled();
  });
  it('rechecks adapter before report writes if an administrator disabled R2 during the scan', async () => {
    const f = fixture(); f.listObjects.mockImplementation(async () => { f.setAdapter('url_reference'); return []; });
    expect((await f.runner.runOnce()).state).toBe('disabled'); expect(f.execute).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled();
  });
  it('makes SDK/DB failures observable without logging their credential values or retrying automatically', async () => {
    const f = fixture(); f.listObjects.mockRejectedValue(new Error('credential=DO_NOT_EXPORT'));
    expect((await f.runner.runOnce()).state).toBe('failed'); expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('DO_NOT_EXPORT'); expect(f.listObjects).toHaveBeenCalledTimes(1); expect(f.execute).not.toHaveBeenCalled();
  });
  it('does not audit or claim success when the private manifest write fails', async () => {
    const f = fixture(); f.writeReport.mockRejectedValue(new Error('private-path=DO_NOT_EXPORT'));
    expect((await f.runner.runOnce()).state).toBe('failed'); expect(f.execute).not.toHaveBeenCalled(); expect(f.log.info).not.toHaveBeenCalled(); expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('DO_NOT_EXPORT');
  });
  it('projects metadata only and never copies arbitrary DB row contents into the manifest or audit', async () => {
    const f = fixture(); f.setRows([row('one', { notes: 'DO_NOT_EXPORT', rights_ref: 'DO_NOT_EXPORT', verification_evidence: { token: 'DO_NOT_EXPORT' }, url: 'https://private.example?token=DO_NOT_EXPORT' })]);
    expect((await f.runner.runOnce()).state).toBe('reported'); expect(JSON.stringify(f.writeReport.mock.calls)).not.toContain('DO_NOT_EXPORT'); expect(JSON.stringify(f.execute.mock.calls)).not.toContain('DO_NOT_EXPORT');
  });
  it('rejects corrupt metadata and duplicate inventory without emitting a manifest', async () => {
    const f = fixture(); f.setRows([row('one', { object_key: 'https://audio.example/file?token=DO_NOT_EXPORT' })]);
    expect((await f.runner.runOnce()).state).toBe('failed'); expect(f.listObjects).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled();
    f.setRows([row()]); f.listObjects.mockResolvedValue([{ objectKey: key, sizeBytes: 100 }, { objectKey: key, sizeBytes: 100 }]);
    expect((await f.runner.runOnce()).state).toBe('failed'); expect(f.writeReport).not.toHaveBeenCalled();
  });
  it('rejects a damaged audit instead of silently resetting its weekly checkpoint', async () => {
    const f = fixture(); f.setAudit([{ new_values: '{}' }]);
    expect((await f.runner.runOnce()).state).toBe('failed'); expect(f.listObjects).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('skips overlapping work and close drains the scan without starting a report transaction', async () => {
    const f = fixture(); let finish!: (objects: Array<{ objectKey: string; sizeBytes: number }>) => void;
    f.listObjects.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const scan = f.runner.runOnce(); await vi.waitFor(() => expect(f.listObjects).toHaveBeenCalled());
    expect(await f.runner.runOnce()).toEqual({ state: 'overlap_skipped' });
    const closing = f.runner.close(); finish([]); expect((await scan).state).toBe('closed'); await closing;
    expect(await f.runner.runOnce()).toEqual({ state: 'closed' }); expect(f.execute).not.toHaveBeenCalled(); expect(f.writeReport).not.toHaveBeenCalled();
  });
  it('starts once, ticks weekly and closes its timer', async () => {
    vi.useFakeTimers(); const f = fixture(); f.setAdapter('url_reference'); f.runner.start(); f.runner.start();
    await vi.advanceTimersByTimeAsync(0); expect(f.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(STORAGE_RECONCILIATION_WEEK_MS - 1); expect(f.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.read).toHaveBeenCalledTimes(2);
    await f.runner.close(); await vi.advanceTimersByTimeAsync(STORAGE_RECONCILIATION_WEEK_MS); expect(f.read).toHaveBeenCalledTimes(2); expect(f.runner.status.timerActive).toBe(false);
  });
  it('exports an actual exclusive JSON metadata file in a private temp directory, retained without cleanup', async () => {
    const f = fixture(); const directory = join(tmpdir(), 'ayahx-k5-weekly-report-' + randomUUID());
    f.writeReport.mockImplementation(privateStorageReportWriter(directory)); await f.runner.runOnce();
    const files = await readdir(directory); expect(files).toHaveLength(1);
    const output = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
    expect(output).toEqual(f.writeReport.mock.calls[0][0]); expect(output.reportOnly).toBe(true); expect(output.manifest.objects[0].sha256).toBe(sha);
    expect(() => privateStorageReportWriter('relative/path')).toThrow('STORAGE_REPORT_DIRECTORY_INVALID');
  });
});

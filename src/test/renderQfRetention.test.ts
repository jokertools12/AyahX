import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({ query: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../server/services/objectStorage', () => ({
  deleteStoredRender: vi.fn(),
  isObjectStoragePath: (value: string | null | undefined) => Boolean(value?.startsWith('s3://')),
  uploadRender: vi.fn(),
}));

import { query } from '../../server/db';
import { deleteStoredRender } from '../../server/services/objectStorage';
import { RenderJobQueue } from '../../server/services/renderJobQueue';

const queryMock = vi.mocked(query);
const deleteStoredRenderMock = vi.mocked(deleteStoredRender);

afterEach(() => vi.resetAllMocks());

describe('Quran Foundation render retention', () => {
  it('fences active workers, scrubs the manifest, then deletes the latest artifact pointer', async () => {
    let path: string | null = 's3://ayahx-test/qf-render.mp4';
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM render_jobs')) return [{ id: 'qf-job-test' }] as never;
      if (sql.includes('SELECT output_path FROM render_jobs')) return [{ output_path: path }] as never;
      if (sql.includes("SET output_path = NULL")) path = null;
      return { affectedRows: 1 } as never;
    });

    const queue = Object.create(RenderJobQueue.prototype) as RenderJobQueue;
    await queue.cleanupExpiredRenders();

    const calls = queryMock.mock.calls.map(([sql]) => String(sql));
    const candidateIndex = calls.findIndex((sql) => sql.includes('SELECT id FROM render_jobs'));
    const fenceIndex = calls.findIndex((sql) => sql.includes("SET status = 'cancelled'") && sql.includes('manifest = JSON_OBJECT()'));
    const pointerIndex = calls.findIndex((sql) => sql.includes('SELECT output_path FROM render_jobs'));
    const finalClearIndex = calls.findIndex((sql) => sql.includes('SET output_path = NULL'));

    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    expect(calls[candidateIndex]).toContain('content_expires_at <= CURRENT_TIMESTAMP()');
    expect(fenceIndex).toBeGreaterThan(candidateIndex);
    expect(calls[fenceIndex]).toContain("SET status = 'cancelled'");
    expect(calls[fenceIndex]).toContain('manifest = JSON_OBJECT()');
    expect(pointerIndex).toBeGreaterThan(fenceIndex);
    expect(deleteStoredRenderMock).toHaveBeenCalledWith('s3://ayahx-test/qf-render.mp4');
    expect(finalClearIndex).toBeGreaterThan(pointerIndex);
    expect(calls[finalClearIndex]).toContain("error_code = 'CONTENT_RETENTION_EXPIRED'");
  });

  it('keeps only a retry marker and artifact pointer when external deletion fails', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM render_jobs')) return [{ id: 'qf-job-test' }] as never;
      if (sql.includes('SELECT output_path FROM render_jobs')) return [{ output_path: 's3://ayahx-test/qf-render.mp4' }] as never;
      if (sql.includes('SELECT id, output_path FROM render_jobs')) return [] as never;
      return { affectedRows: 1 } as never;
    });
    deleteStoredRenderMock.mockRejectedValueOnce(new Error('synthetic storage failure'));

    const queue = Object.create(RenderJobQueue.prototype) as RenderJobQueue;
    await queue.cleanupExpiredRenders();

    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('manifest = JSON_OBJECT()'))).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('SET output_path = NULL'))).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("error_code = 'CONTENT_RETENTION_PURGE_PENDING'"))).toBe(true);
  });
});

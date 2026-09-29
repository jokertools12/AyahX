import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({ query: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { query } from '../../server/db';
import { ensureRenderJobsTable } from '../../server/db/migrations/addRenderJobsTable';

const queryMock = vi.mocked(query);

afterEach(() => vi.resetAllMocks());

describe('render job privacy migration', () => {
  it('backfills QF source expiry and cascades render audit deletion by owner', async () => {
    let orphanRead = false;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("TABLE_NAME = 'render_job_audit'") && sql.includes('REFERENTIAL_CONSTRAINTS')) return [] as never;
      if (sql.includes('LEFT JOIN users u ON u.id = e.user_id')) {
        if (orphanRead) return [] as never;
        orphanRead = true;
        return [{ id: 'orphan-render-audit-test' }] as never;
      }
      if (sql.includes('information_schema.COLUMNS') && sql.includes('EXTRA AS extra')) return [{ extra: '' }] as never;
      if (sql.includes('information_schema.COLUMNS') || sql.includes('information_schema.STATISTICS')) return [{ present: 1 }] as never;
      if (sql.includes('SELECT user_id FROM render_jobs')) return [] as never;
      return { affectedRows: 0 } as never;
    });

    await ensureRenderJobsTable();

    const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
    const createJobs = sqlCalls.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS render_jobs')) || '';
    const auditDdl = sqlCalls.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS render_job_audit')) || '';
    const backfill = sqlCalls.find((sql) => sql.includes('SET content_expires_at = DATE_ADD')) || '';
    const orphanReadIndex = sqlCalls.findIndex((sql) => sql.includes('LEFT JOIN users u ON u.id = e.user_id'));
    const orphanDeleteIndex = sqlCalls.findIndex((sql) => sql.includes('DELETE FROM render_job_audit WHERE id IN'));
    const cascadeIndex = sqlCalls.findIndex((sql) => sql.includes('ADD CONSTRAINT `fk_render_job_audit_user`'));

    expect(createJobs).toContain('content_expires_at TIMESTAMP NULL DEFAULT NULL');
    expect(backfill).toContain("$.timingMap.createdAt");
    expect(backfill).toContain("'quran_foundation'");
    expect(auditDdl).toContain('FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE');
    expect(orphanReadIndex).toBeGreaterThan(-1);
    expect(orphanDeleteIndex).toBeGreaterThan(orphanReadIndex);
    expect(cascadeIndex).toBeGreaterThan(orphanDeleteIndex);
    expect(queryMock.mock.calls[orphanDeleteIndex][1]).toEqual(['orphan-render-audit-test']);
  });

  it('fails closed if render audit account deletion is not cascading', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("TABLE_NAME = 'render_job_audit'") && sql.includes('REFERENTIAL_CONSTRAINTS')) return [{ deleteRule: 'RESTRICT' }] as never;
      if (sql.includes('information_schema.COLUMNS') && sql.includes('EXTRA AS extra')) return [{ extra: '' }] as never;
      if (sql.includes('information_schema.COLUMNS') || sql.includes('information_schema.STATISTICS')) return [{ present: 1 }] as never;
      if (sql.includes('SELECT user_id FROM render_jobs')) return [] as never;
      return { affectedRows: 0 } as never;
    });

    await expect(ensureRenderJobsTable()).rejects.toThrow('RENDER_AUDIT_USER_FOREIGN_KEY_MUST_CASCADE');
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('ADD CONSTRAINT `fk_render_job_audit_user`'))).toBe(false);
  });
});

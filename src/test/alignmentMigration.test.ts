import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({ query: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../server/services/alignmentRetentionService', () => ({
  purgeExpiredAlignmentData: vi.fn().mockResolvedValue({ documentsDeleted: 0, reviewEventsDeleted: 0 }),
}));

import { query } from '../../server/db';
import { ensureAlignmentTables } from '../../server/db/migrations/addAlignmentTables';

const queryMock = vi.mocked(query);

afterEach(() => vi.resetAllMocks());

describe('alignment migration privacy constraints', () => {
  it('removes synthetic ownerless review IDs before adding an account-delete cascade', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('REFERENTIAL_CONSTRAINTS')) return [] as never;
      if (sql.includes('LEFT JOIN users u ON u.id = e.user_id')) return [{ id: 'orphan-event-test' }] as never;
      if (sql.includes('DELETE FROM alignment_review_events WHERE id IN')) return { affectedRows: 1 } as never;
      if (sql.includes('CREATE TABLE IF NOT EXISTS alignment_review_events')) return [] as never;
      return [] as never;
    });

    await ensureAlignmentTables();

    const orphanSelectIndex = queryMock.mock.calls.findIndex(([sql]) => sql.includes('LEFT JOIN users u ON u.id = e.user_id'));
    const orphanDeleteIndex = queryMock.mock.calls.findIndex(([sql]) => sql.includes('DELETE FROM alignment_review_events WHERE id IN'));
    const cascadeIndex = queryMock.mock.calls.findIndex(([sql]) => sql.includes('ADD CONSTRAINT `fk_alignment_review_events_user`'));
    expect(orphanSelectIndex).toBeGreaterThan(-1);
    expect(orphanDeleteIndex).toBeGreaterThan(orphanSelectIndex);
    expect(cascadeIndex).toBeGreaterThan(orphanDeleteIndex);
    expect(queryMock.mock.calls[orphanDeleteIndex][1]).toEqual(['orphan-event-test']);
    const reviewDdl = queryMock.mock.calls.find(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS alignment_review_events'))?.[0];
    expect(reviewDdl).toContain('FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE');
  });

  it('fails closed if the named account-delete constraint is not cascading', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('REFERENTIAL_CONSTRAINTS')) return [{ deleteRule: 'RESTRICT' }] as never;
      return [] as never;
    });

    await expect(ensureAlignmentTables()).rejects.toThrow('ALIGNMENT_REVIEW_USER_FOREIGN_KEY_MUST_CASCADE');
    expect(queryMock.mock.calls.some(([sql]) => sql.includes('ADD CONSTRAINT `fk_alignment_review_events_user`'))).toBe(false);
  });
});

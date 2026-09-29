import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

vi.mock('../../server/db', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

import { transaction } from '../../server/db';
import { deleteAlignmentDocument } from '../../server/services/alignmentRepository';

const transactionMock = vi.mocked(transaction);

afterEach(() => vi.resetAllMocks());

describe('alignment document deletion', () => {
  it('deletes the owner-scoped revision tree and its review events in one transaction', async () => {
    const connectionQuery = vi.fn()
      .mockResolvedValueOnce([[{ id: 'root' }], []])
      .mockResolvedValueOnce([[{ id: 'revision-1' }], []])
      .mockResolvedValueOnce([[{ id: 'revision-2' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 3 }, []])
      .mockResolvedValueOnce([{ affectedRows: 3 }, []]);
    transactionMock.mockImplementation((callback) => callback({ query: connectionQuery } as unknown as PoolConnection));

    await expect(deleteAlignmentDocument('root', 'owner-1')).resolves.toBe(true);

    expect(connectionQuery).toHaveBeenCalledTimes(6);
    expect(connectionQuery.mock.calls[0][0]).toContain('WHERE id = ? AND user_id = ?');
    expect(connectionQuery.mock.calls[0][1]).toEqual(['root', 'owner-1']);
    expect(connectionQuery.mock.calls[4][0]).toContain('DELETE FROM alignment_review_events');
    expect(connectionQuery.mock.calls[4][1]).toEqual(['owner-1', 'root', 'revision-1', 'revision-2', 'root', 'revision-1', 'revision-2']);
    expect(connectionQuery.mock.calls[5][0]).toContain('DELETE FROM alignment_documents WHERE user_id = ?');
    expect(connectionQuery.mock.calls[5][1]).toEqual(['owner-1', 'root', 'revision-1', 'revision-2']);
  });

  it('does not delete another owner\'s document or inspect its child rows', async () => {
    const connectionQuery = vi.fn().mockResolvedValueOnce([[], []]);
    transactionMock.mockImplementation((callback) => callback({ query: connectionQuery } as unknown as PoolConnection));

    await expect(deleteAlignmentDocument('other-owner-doc', 'owner-1')).resolves.toBe(false);

    expect(connectionQuery).toHaveBeenCalledTimes(1);
    expect(connectionQuery.mock.calls[0][1]).toEqual(['other-owner-doc', 'owner-1']);
  });
});

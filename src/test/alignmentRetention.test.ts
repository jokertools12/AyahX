import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

vi.mock('../../server/db', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

import { query, transaction } from '../../server/db';
import type { AlignmentDocument } from '../../server/services/alignmentProvider';
import {
  getAlignmentDocument,
  listAlignmentDocuments,
  saveAlignmentDocument,
  saveReviewEvent,
} from '../../server/services/alignmentRepository';
import { purgeExpiredAlignmentData } from '../../server/services/alignmentRetentionService';

const queryMock = vi.mocked(query);
const transactionMock = vi.mocked(transaction);

function qfDocument(): AlignmentDocument {
  return {
    schemaVersion: '2.0.0',
    documentId: 'qf-document',
    reciterId: 'qf-reciter',
    providerId: 'quran_foundation',
    providerVersion: 'qf-test-v1',
    requestedGranularity: 'word',
    sourceMethod: 'quran_foundation_segments',
    providerVerified: true,
    audio: {
      contentHash: 'sha256-test-audio',
      durationMs: 1_000,
      sampleRate: 44_100,
      channels: 2,
      sourceUrlOrAssetId: 'https://audio.example/test.mp3',
    },
    reference: {
      surahNumber: 1,
      ayahRange: { from: 1, to: 1 },
      ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ' }],
      quranTextVersion: 'uthmani_hafs_v1',
    },
    words: [],
    letters: [],
    phonemes: [],
    gaps: [],
    review: { status: 'unreviewed' },
    validationStatus: 'approved',
    diagnostics: {},
    provenance: {
      providerId: 'quran_foundation',
      providerVersion: 'qf-test-v1',
      sourceMethod: 'quran_foundation_segments',
      audioContentHash: 'sha256-test-audio',
      createdAt: '2026-09-29T00:00:00.000Z',
    },
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('alignment retention', () => {
  it('assigns a five-day expiry to newly persisted Quran Foundation content', async () => {
    queryMock.mockResolvedValue({ affectedRows: 1 } as never);

    await saveAlignmentDocument('user-1', qfDocument());

    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain("CASE WHEN ? = 'quran_foundation'");
    expect(sql).toContain('DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 DAY)');
    expect(values.at(-1)).toBe('quran_foundation');
  });

  it('never returns expired rows, including in admin listings', async () => {
    queryMock.mockResolvedValue([] as never);

    await getAlignmentDocument('expired-qf-document', { userId: 'user-1', isAdmin: false });
    await listAlignmentDocuments({ userId: 'admin-1', isAdmin: true });

    expect(queryMock.mock.calls[0][0]).toContain('expires_at > CURRENT_TIMESTAMP');
    expect(queryMock.mock.calls[1][0]).toContain('expires_at > CURRENT_TIMESTAMP');
  });

  it('inherits the parent expiry for a review revision and its audit event', async () => {
    const connectionQuery = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const mockConnection = { query: connectionQuery } as unknown as PoolConnection;
    transactionMock.mockImplementation((callback) => callback(mockConnection));
    const document = { ...qfDocument(), documentId: 'qf-review-revision', parentDocumentId: 'qf-document' };

    await saveReviewEvent({
      userId: 'reviewer-1',
      document,
      parentDocumentId: 'qf-document',
      revisions: [],
    });

    expect(connectionQuery.mock.calls[0][0]).toContain('expires_at');
    expect(connectionQuery.mock.calls[0][0]).toContain('expires_at > CURRENT_TIMESTAMP');
    expect(connectionQuery.mock.calls[1][0]).toContain('SELECT ?, ?, ?, ?, ?, ?, ?, expires_at');
  });

  it('rejects a review if the source expires between read and transaction', async () => {
    const connectionQuery = vi.fn().mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    const mockConnection = { query: connectionQuery } as unknown as PoolConnection;
    transactionMock.mockImplementation((callback) => callback(mockConnection));

    await expect(saveReviewEvent({
      userId: 'reviewer-1',
      document: { ...qfDocument(), documentId: 'qf-review-revision' },
      parentDocumentId: 'qf-document',
      revisions: [],
    })).rejects.toThrow('ALIGNMENT_PARENT_EXPIRED');
    expect(connectionQuery).toHaveBeenCalledTimes(1);
  });

  it('purges review events before their expired documents', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 'review-event-1' }, { id: 'review-event-2' }] as never)
      .mockResolvedValueOnce({ affectedRows: 2 } as never)
      .mockResolvedValueOnce({ affectedRows: 1 } as never);

    await expect(purgeExpiredAlignmentData()).resolves.toEqual({
      documentsDeleted: 1,
      reviewEventsDeleted: 2,
    });
    expect(queryMock.mock.calls[0][0]).toContain('SELECT e.id FROM alignment_review_events');
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM alignment_review_events WHERE id IN');
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM alignment_documents');
  });
});

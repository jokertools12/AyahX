import { query } from '../db';
import { logger } from '../logger';

const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_INTERVAL_MS = 30 * 60_000;

type DeleteResult = { affectedRows?: number };

/**
 * Deletes Quran Foundation-derived documents and review events after their
 * explicit expiry. API reads also filter expired rows, so a delayed sweep can
 * never make an expired document available again.
 */
export async function purgeExpiredAlignmentData(): Promise<{ documentsDeleted: number; reviewEventsDeleted: number }> {
  let reviewEventsDeleted = 0;
  let documentsDeleted = 0;

  while (true) {
    const expiredEvents = await query<Array<{ id: string }>>(
      `SELECT e.id FROM alignment_review_events e
       LEFT JOIN alignment_documents d ON d.id = e.document_id
       LEFT JOIN alignment_documents p ON p.id = e.parent_document_id
       WHERE (e.expires_at IS NOT NULL AND e.expires_at <= CURRENT_TIMESTAMP)
          OR (d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_TIMESTAMP)
          OR (p.expires_at IS NOT NULL AND p.expires_at <= CURRENT_TIMESTAMP)
       ORDER BY e.created_at ASC
       LIMIT ${CLEANUP_BATCH_SIZE}`,
    );
    if (expiredEvents.length === 0) break;
    const eventIds = expiredEvents.map((event) => event.id);
    const result = await query<DeleteResult>(
      `DELETE FROM alignment_review_events WHERE id IN (${eventIds.map(() => '?').join(', ')})`,
      eventIds,
    );
    const deleted = Number(result?.affectedRows || 0);
    reviewEventsDeleted += deleted;
    if (expiredEvents.length < CLEANUP_BATCH_SIZE) break;
  }

  while (true) {
    const result = await query<DeleteResult>(
      `DELETE FROM alignment_documents
       WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
       LIMIT ${CLEANUP_BATCH_SIZE}`,
    );
    const deleted = Number(result?.affectedRows || 0);
    documentsDeleted += deleted;
    if (deleted < CLEANUP_BATCH_SIZE) break;
  }

  return { documentsDeleted, reviewEventsDeleted };
}

/**
 * Runs an immediate cleanup and a bounded recurring sweep. The five-day TTL
 * leaves two days of operational margin under QF's one-week maximum.
 */
export function startAlignmentRetentionCleanup(): () => void {
  const run = () => {
    purgeExpiredAlignmentData().then(({ documentsDeleted, reviewEventsDeleted }) => {
      if (documentsDeleted > 0 || reviewEventsDeleted > 0) {
        logger.info('Purged expired alignment data.', { documentsDeleted, reviewEventsDeleted });
      }
    }).catch((error) => logger.warn('Alignment retention cleanup failed:', error));
  };

  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

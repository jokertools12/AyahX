import { query } from '../../db';
import { logger } from '../../logger';
import { purgeExpiredAlignmentData } from '../../services/alignmentRetentionService';

const ORPHAN_REVIEW_CLEANUP_BATCH_SIZE = 500;

async function ensureAlignmentColumn(table: string, column: string, definition: string): Promise<void> {
  const existing = await query<Array<{ present: number }>>(
    `SELECT 1 AS present
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  if (existing.length === 0) await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function ensureAlignmentIndex(table: string, index: string, definition: string): Promise<void> {
  const existing = await query<Array<{ present: number }>>(
    `SELECT 1 AS present
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, index],
  );
  if (existing.length === 0) await query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${definition}`);
}

async function ensureAlignmentReviewUserCascade(): Promise<void> {
  const constraints = await query<Array<{ deleteRule: string }>>(
    `SELECT DELETE_RULE AS deleteRule
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'alignment_review_events'
       AND CONSTRAINT_NAME = 'fk_alignment_review_events_user'
     LIMIT 1`,
  );

  if (constraints.length > 0) {
    if (String(constraints[0].deleteRule).toUpperCase() !== 'CASCADE') {
      throw new Error('ALIGNMENT_REVIEW_USER_FOREIGN_KEY_MUST_CASCADE');
    }
    return;
  }

  // A previous account deletion could have left review JSON orphaned because
  // older versions had no user foreign key. Delete only those ownerless event
  // IDs before adding the constraint; never inspect or log the note/revision.
  while (true) {
    const orphanEvents = await query<Array<{ id: string }>>(
      `SELECT e.id FROM alignment_review_events e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE u.id IS NULL
       ORDER BY e.created_at ASC
       LIMIT ${ORPHAN_REVIEW_CLEANUP_BATCH_SIZE}`,
    );
    if (orphanEvents.length === 0) break;

    const eventIds = orphanEvents.map((event) => event.id);
    await query(
      `DELETE FROM alignment_review_events WHERE id IN (${eventIds.map(() => '?').join(', ')})`,
      eventIds,
    );
    if (orphanEvents.length < ORPHAN_REVIEW_CLEANUP_BATCH_SIZE) break;
  }

  await query(
    'ALTER TABLE `alignment_review_events` ADD CONSTRAINT `fk_alignment_review_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE',
  );
}

/**
 * Alignment documents are immutable while retained. Quran Foundation content
 * receives an early expiry and its review history inherits the same deadline.
 */
export async function ensureAlignmentTables(): Promise<void> {
  try {
    await query([
      'CREATE TABLE IF NOT EXISTS alignment_documents (',
      'id VARCHAR(191) NOT NULL,',
      'user_id VARCHAR(36) NOT NULL,',
      'parent_document_id VARCHAR(191) DEFAULT NULL,',
      'provider_id VARCHAR(80) NOT NULL,',
      'validation_status VARCHAR(24) NOT NULL,',
      'review_status VARCHAR(24) NOT NULL DEFAULT \'unreviewed\',',
      'audio_content_hash VARCHAR(256) NOT NULL,',
      'surah_number INT NOT NULL,',
      'start_ayah INT NOT NULL,',
      'end_ayah INT NOT NULL,',
      'document_json JSON NOT NULL,',
      'expires_at TIMESTAMP NULL DEFAULT NULL,',
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
      'PRIMARY KEY (id),',
      'INDEX idx_alignment_user_created (user_id, created_at DESC),',
      'INDEX idx_alignment_audio (audio_content_hash),',
      'INDEX idx_alignment_expires (expires_at),',
      'INDEX idx_alignment_parent (parent_document_id),',
      'CONSTRAINT fk_alignment_documents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));

    await query([
      'CREATE TABLE IF NOT EXISTS alignment_review_events (',
      'id VARCHAR(36) NOT NULL,',
      'document_id VARCHAR(191) NOT NULL,',
      'parent_document_id VARCHAR(191) DEFAULT NULL,',
      'user_id VARCHAR(36) NOT NULL,',
      'status VARCHAR(24) NOT NULL,',
      'note VARCHAR(2000) DEFAULT NULL,',
      'revision_json JSON NOT NULL,',
      'expires_at TIMESTAMP NULL DEFAULT NULL,',
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'PRIMARY KEY (id),',
      'INDEX idx_alignment_review_document (document_id, created_at),',
      'INDEX idx_alignment_review_user (user_id, created_at),',
      'CONSTRAINT fk_alignment_review_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));

    // Older installs already have these tables without retention metadata.
    await ensureAlignmentColumn('alignment_documents', 'expires_at', 'TIMESTAMP NULL DEFAULT NULL AFTER document_json');
    await ensureAlignmentColumn('alignment_review_events', 'expires_at', 'TIMESTAMP NULL DEFAULT NULL AFTER revision_json');
    await ensureAlignmentIndex('alignment_documents', 'idx_alignment_expires', '(expires_at)');
    await ensureAlignmentIndex('alignment_review_events', 'idx_alignment_review_expires', '(expires_at)');
    await ensureAlignmentReviewUserCascade();

    // Backfill provider-derived QF documents from their original creation time;
    // do not grant old rows a new retention window during the migration.
    await query(
      `UPDATE alignment_documents
       SET expires_at = DATE_ADD(created_at, INTERVAL 5 DAY)
       WHERE provider_id = 'quran_foundation' AND expires_at IS NULL`,
    );
    await query(
      `UPDATE alignment_review_events e
       INNER JOIN alignment_documents d ON d.id = e.document_id
       SET e.expires_at = d.expires_at
       WHERE d.provider_id = 'quran_foundation' AND e.expires_at IS NULL`,
    );
    await purgeExpiredAlignmentData();
    logger.info('Database migration: verified alignment document tables.');
  } catch (error) {
    logger.error('Database migration: failed to ensure alignment tables:', error as Error);
    throw error;
  }
}

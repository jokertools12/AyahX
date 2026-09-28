import { query } from '../../db';
import { logger } from '../../logger';

/**
 * Alignment documents are immutable evidence.  A review creates a new
 * document row linked to its parent; the review event table keeps the audit
 * action even when a client later discards a draft revision.
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
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
      'PRIMARY KEY (id),',
      'INDEX idx_alignment_user_created (user_id, created_at DESC),',
      'INDEX idx_alignment_audio (audio_content_hash),',
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
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'PRIMARY KEY (id),',
      'INDEX idx_alignment_review_document (document_id, created_at),',
      'INDEX idx_alignment_review_user (user_id, created_at)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));
    logger.info('Database migration: verified alignment document tables.');
  } catch (error) {
    logger.error('Database migration: failed to ensure alignment tables:', error as Error);
    throw error;
  }
}

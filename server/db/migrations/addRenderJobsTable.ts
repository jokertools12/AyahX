import { query } from '../../db';
import { logger } from '../../logger';

/**
 * Ensures the render_jobs table exists with all required columns and indexes
 */
export async function ensureRenderJobsTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS \`render_jobs\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`user_id\` VARCHAR(36) NOT NULL,
      \`idempotency_key\` VARCHAR(128) DEFAULT NULL,
      \`status\` ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
      \`progress\` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
      \`stage\` VARCHAR(100) NOT NULL DEFAULT 'queued',
      \`manifest\` JSON NOT NULL,
      \`output_path\` TEXT DEFAULT NULL,
      \`output_filename\` VARCHAR(255) DEFAULT NULL,
      \`output_size_bytes\` BIGINT DEFAULT NULL,
      \`duration_seconds\` DECIMAL(7, 2) DEFAULT NULL,
      \`metadata\` JSON DEFAULT NULL,
      \`error_code\` VARCHAR(50) DEFAULT NULL,
      \`error_message\` TEXT DEFAULT NULL,
      \`retry_count\` INT NOT NULL DEFAULT 0,
      \`max_retries\` INT NOT NULL DEFAULT 1,
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`started_at\` TIMESTAMP NULL DEFAULT NULL,
      \`completed_at\` TIMESTAMP NULL DEFAULT NULL,
      \`expires_at\` TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_render_jobs_idempotency\` (\`idempotency_key\`),
      INDEX \`idx_render_jobs_user\` (\`user_id\`, \`created_at\` DESC),
      INDEX \`idx_render_jobs_status\` (\`status\`, \`created_at\` ASC),
      CONSTRAINT \`fk_render_jobs_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
    await query(sql);
    await query(`CREATE TABLE IF NOT EXISTS \`render_job_audit\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`job_id\` VARCHAR(36) NOT NULL,
      \`user_id\` VARCHAR(36) NOT NULL,
      \`event\` VARCHAR(64) NOT NULL,
      \`details\` JSON DEFAULT NULL,
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_render_audit_job\` (\`job_id\`, \`created_at\`),
      INDEX \`idx_render_audit_user\` (\`user_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    logger.info('Database migration: verified `render_jobs` table readiness.');
  } catch (err: any) {
    logger.error('Database migration: failed to ensure `render_jobs` table:', err);
    throw err;
  }
}

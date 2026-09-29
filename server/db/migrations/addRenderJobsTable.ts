import { query } from '../../db';
import { logger } from '../../logger';

const ORPHAN_RENDER_AUDIT_CLEANUP_BATCH_SIZE = 500;

async function ensureRenderAuditUserCascade(): Promise<void> {
  const constraints = await query<Array<{ deleteRule: string }>>(
    `SELECT DELETE_RULE AS deleteRule
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'render_job_audit'
       AND CONSTRAINT_NAME = 'fk_render_job_audit_user'
     LIMIT 1`,
  );
  if (constraints.length > 0) {
    if (String(constraints[0].deleteRule).toUpperCase() !== 'CASCADE') {
      throw new Error('RENDER_AUDIT_USER_FOREIGN_KEY_MUST_CASCADE');
    }
    return;
  }

  // Earlier account deletions could leave audit metadata detached from its
  // owner. Remove only bounded batches of orphan IDs; never read/log details.
  while (true) {
    const orphanEvents = await query<Array<{ id: string }>>(
      `SELECT e.id FROM render_job_audit e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE u.id IS NULL
       ORDER BY e.created_at ASC
       LIMIT ${ORPHAN_RENDER_AUDIT_CLEANUP_BATCH_SIZE}`,
    );
    if (orphanEvents.length === 0) break;
    const ids = orphanEvents.map((event) => event.id);
    await query(`DELETE FROM render_job_audit WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
    if (orphanEvents.length < ORPHAN_RENDER_AUDIT_CLEANUP_BATCH_SIZE) break;
  }

  await query(
    'ALTER TABLE `render_job_audit` ADD CONSTRAINT `fk_render_job_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE',
  );
}

/**
 * Creates the durable render job tables and upgrades installations from the
 * original single-queue schema. active_user_id is intentionally a normal
 * column: Railway may run MySQL or MariaDB and MariaDB cannot reliably add the
 * previous generated version to a table which already has foreign keys.
 */
export async function ensureRenderJobsTable(): Promise<void> {
  const createJobsSql = [
    'CREATE TABLE IF NOT EXISTS render_jobs (',
    'id VARCHAR(36) NOT NULL,',
    'user_id VARCHAR(36) NOT NULL,',
    'idempotency_key VARCHAR(128) DEFAULT NULL,',
    "engine VARCHAR(32) NOT NULL DEFAULT 'ffmpeg_ass',",
    "enqueue_state VARCHAR(16) NOT NULL DEFAULT 'pending',",
    "status ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',",
    'progress DECIMAL(5, 2) NOT NULL DEFAULT 0.00,',
    "stage VARCHAR(100) NOT NULL DEFAULT 'queued',",
    'manifest JSON NOT NULL,',
    'output_path TEXT DEFAULT NULL,',
    'output_filename VARCHAR(255) DEFAULT NULL,',
    'output_size_bytes BIGINT DEFAULT NULL,',
    'duration_seconds DECIMAL(7, 2) DEFAULT NULL,',
    'metadata JSON DEFAULT NULL,',
    'error_code VARCHAR(50) DEFAULT NULL,',
    'error_message TEXT DEFAULT NULL,',
    'retry_count INT NOT NULL DEFAULT 0,',
    'max_retries INT NOT NULL DEFAULT 1,',
    'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
    'heartbeat_at TIMESTAMP NULL DEFAULT NULL,',
    'worker_id VARCHAR(128) DEFAULT NULL,',
    'active_user_id VARCHAR(36) DEFAULT NULL,',
    'started_at TIMESTAMP NULL DEFAULT NULL,',
    'completed_at TIMESTAMP NULL DEFAULT NULL,',
    'expires_at TIMESTAMP NULL DEFAULT NULL,',
    'content_expires_at TIMESTAMP NULL DEFAULT NULL,',
    'PRIMARY KEY (id),',
    'UNIQUE KEY uk_render_jobs_idempotency (idempotency_key),',
    'UNIQUE KEY uq_render_jobs_one_active_user (active_user_id),',
    'INDEX idx_render_jobs_user (user_id, created_at DESC),',
    'INDEX idx_render_jobs_status (status, created_at ASC),',
    'INDEX idx_render_jobs_engine_state (engine, status, created_at ASC),',
    'INDEX idx_render_jobs_content_expiry (content_expires_at),',
    'CONSTRAINT fk_render_jobs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  ].join(' ');

  try {
    await query(createJobsSql);

    const columns: Array<[string, string]> = [
      ['engine', "VARCHAR(32) NOT NULL DEFAULT 'ffmpeg_ass' AFTER idempotency_key"],
      ['enqueue_state', "VARCHAR(16) NOT NULL DEFAULT 'pending' AFTER engine"],
      ['heartbeat_at', 'TIMESTAMP NULL DEFAULT NULL AFTER updated_at'],
      ['worker_id', 'VARCHAR(128) DEFAULT NULL AFTER heartbeat_at'],
      ['content_expires_at', 'TIMESTAMP NULL DEFAULT NULL AFTER expires_at'],
    ];
    for (const [column, definition] of columns) {
      const existing = await query<Array<{ present: number }>>(
        "SELECT 1 AS present FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'render_jobs' AND COLUMN_NAME = ? LIMIT 1",
        [column],
      );
      if (!existing.length) await query('ALTER TABLE render_jobs ADD COLUMN ' + column + ' ' + definition);
    }

    const activeColumn = await query<Array<{ extra: string }>>(
      "SELECT EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'render_jobs' AND COLUMN_NAME = 'active_user_id' LIMIT 1",
    );
    if (activeColumn[0]?.extra?.toUpperCase().includes('GENERATED')) {
      const activeIndex = await query<Array<{ present: number }>>(
        "SELECT 1 AS present FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'render_jobs' AND INDEX_NAME = 'uq_render_jobs_one_active_user' LIMIT 1",
      );
      if (activeIndex.length) await query('ALTER TABLE render_jobs DROP INDEX uq_render_jobs_one_active_user');
      await query('ALTER TABLE render_jobs DROP COLUMN active_user_id');
    }
    if (!activeColumn.length || activeColumn[0]?.extra?.toUpperCase().includes('GENERATED')) {
      await query('ALTER TABLE render_jobs ADD COLUMN active_user_id VARCHAR(36) DEFAULT NULL AFTER worker_id');
    }

    await query(
      "UPDATE render_jobs SET engine = CASE " +
      "WHEN JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')) IN ('skia_canvas', 'skia') THEN 'skia_canvas' " +
      "WHEN JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')) IN ('browser', 'browser_cloud') THEN 'browser_cloud' " +
      "ELSE 'ffmpeg_ass' END " +
      "WHERE engine IS NULL OR engine = 'ffmpeg_ass'",
    );

    // Rebuild the guard from durable state. The oldest active job wins if a
    // legacy deployment already admitted duplicates before the unique index.
    const duplicateUsers = await query<Array<{ user_id: string }>>(
      "SELECT user_id FROM render_jobs WHERE status IN ('queued', 'running') GROUP BY user_id HAVING COUNT(*) > 1",
    );
    for (const duplicate of duplicateUsers) {
      const activeRows = await query<Array<{ id: string }>>(
        "SELECT id FROM render_jobs WHERE user_id = ? AND status IN ('queued', 'running') ORDER BY created_at ASC, id ASC",
        [duplicate.user_id],
      );
      const supersededIds = activeRows.slice(1).map((row) => row.id);
      if (supersededIds.length) {
        await query(
          "UPDATE render_jobs SET status = 'failed', enqueue_state = 'failed', active_user_id = NULL, stage = 'فشل ترحيل مهمة مكررة', error_code = 'ACTIVE_JOB_MIGRATION', error_message = 'تم إيقاف مهمة مكررة لحماية مهمة الإنتاج النشطة للمستخدم' WHERE id IN (" + supersededIds.map(() => '?').join(',') + ')',
          supersededIds,
        );
      }
    }
    await query("UPDATE render_jobs SET active_user_id = CASE WHEN status IN ('queued', 'running') THEN user_id ELSE NULL END");

    const indexes: Array<[string, string]> = [
      ['uq_render_jobs_one_active_user', 'ALTER TABLE render_jobs ADD UNIQUE KEY uq_render_jobs_one_active_user (active_user_id)'],
      ['idx_render_jobs_engine_state', 'ALTER TABLE render_jobs ADD INDEX idx_render_jobs_engine_state (engine, status, created_at ASC)'],
      ['idx_render_jobs_content_expiry', 'ALTER TABLE render_jobs ADD INDEX idx_render_jobs_content_expiry (content_expires_at)'],
    ];
    for (const [index, statement] of indexes) {
      const existing = await query<Array<{ present: number }>>(
        "SELECT 1 AS present FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'render_jobs' AND INDEX_NAME = ? LIMIT 1",
        [index],
      );
      if (!existing.length) await query(statement);
    }

    // Recover the source-map retention deadline from old QF render manifests.
    // Rows without a trustworthy source timestamp stay NULL and are purged by
    // the retention worker rather than receiving an accidentally extended TTL.
    await query(
      `UPDATE render_jobs
       SET content_expires_at = DATE_ADD(
         STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.timingMap.createdAt')), '%Y-%m-%dT%H:%i:%s.%fZ'),
         INTERVAL 5 DAY
       )
       WHERE content_expires_at IS NULL
         AND (
           JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.timingMap.sourceId')) = 'quran_foundation'
           OR JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.timingMap.alignment.provider')) = 'quran_foundation'
           OR JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.audio.sourceMode')) = 'qf'
         )
         AND STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.timingMap.createdAt')), '%Y-%m-%dT%H:%i:%s.%fZ') IS NOT NULL`,
    );

    await query([
      'CREATE TABLE IF NOT EXISTS render_job_audit (',
      'id VARCHAR(36) NOT NULL PRIMARY KEY,',
      'job_id VARCHAR(36) NOT NULL,',
      'user_id VARCHAR(36) NOT NULL,',
      'event VARCHAR(64) NOT NULL,',
      'details JSON DEFAULT NULL,',
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'INDEX idx_render_audit_job (job_id, created_at),',
      'INDEX idx_render_audit_user (user_id, created_at),',
      'CONSTRAINT fk_render_job_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));
    await ensureRenderAuditUserCascade();
    await query([
      'CREATE TABLE IF NOT EXISTS render_engine_capacity (',
      'engine VARCHAR(32) NOT NULL PRIMARY KEY,',
      'replicas INT NOT NULL,',
      'slots_per_replica INT NOT NULL,',
      'waiting_jobs INT NOT NULL DEFAULT 0,',
      'active_jobs INT NOT NULL DEFAULT 0,',
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));
    await query([
      'CREATE TABLE IF NOT EXISTS daily_render_engine_usage (',
      'id VARCHAR(36) NOT NULL,',
      'user_id VARCHAR(36) NOT NULL,',
      'date DATE NOT NULL,',
      'engine VARCHAR(32) NOT NULL,',
      'count INT NOT NULL DEFAULT 0,',
      'background_count INT NOT NULL DEFAULT 0,',
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      'PRIMARY KEY (id),',
      'UNIQUE KEY uq_daily_render_engine_usage (user_id, date, engine),',
      'INDEX idx_daily_render_engine_date (date, engine),',
      'CONSTRAINT fk_daily_render_engine_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    ].join(' '));
    // Existing current-day jobs must count before the new O(1) counter is
    // used for admission. GREATEST keeps this startup-safe across API/worker
    // replicas that run the migration concurrently.
    await query(
      `INSERT INTO daily_render_engine_usage (id, user_id, date, engine, count, background_count)
       SELECT UUID(), user_id, CURDATE(),
              CASE WHEN engine IN ('skia_canvas', 'browser_cloud') THEN engine ELSE 'ffmpeg_ass' END,
              COUNT(*),
              SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.backgroundAsync')) = 'true' THEN 1 ELSE 0 END)
       FROM render_jobs
       WHERE created_at >= CURDATE()
       GROUP BY user_id, CASE WHEN engine IN ('skia_canvas', 'browser_cloud') THEN engine ELSE 'ffmpeg_ass' END
       ON DUPLICATE KEY UPDATE
         count = GREATEST(count, VALUES(count)),
         background_count = GREATEST(background_count, VALUES(background_count))`,
    );
    logger.info('Database migration: verified render_jobs table readiness.');
  } catch (err: any) {
    logger.error('Database migration: failed to ensure render_jobs table:', err);
    throw err;
  }
}

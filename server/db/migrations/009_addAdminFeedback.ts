/** Batch 5b additive storage for internal admin diagnostics only. */
const feedbackTableExists = "information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback'";
const conditional = (source: string, absent: string, present: string) => `SET @ayahx_admin_feedback_ddl=(SELECT IF(COUNT(*)=0,'${absent.replace(/'/gu, "''")}','${present.replace(/'/gu, "''")}') FROM ${source}); PREPARE ayahx_admin_feedback_stmt FROM @ayahx_admin_feedback_ddl; EXECUTE ayahx_admin_feedback_stmt; DEALLOCATE PREPARE ayahx_admin_feedback_stmt`;
export function adminFeedbackMigrationSql(): string[] {
  return [
    "CREATE TABLE IF NOT EXISTS admin_feedback (id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,actor_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,category ENUM('screen_small','font_small','colors_annoying','confusing','not_working') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,viewport_width INT DEFAULT NULL,viewport_height INT DEFAULT NULL,device_pixel_ratio DECIMAL(8,3) DEFAULT NULL,zoom_percent DECIMAL(8,3) DEFAULT NULL,theme VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,language VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,browser VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,density VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,font_scale DECIMAL(4,2) DEFAULT NULL,status ENUM('new','in_progress','done') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),PRIMARY KEY(id),INDEX idx_admin_feedback_actor_created(actor_id,created_at),INDEX idx_admin_feedback_status_created(status,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  ];
}

export async function upAdminFeedback(db: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of adminFeedbackMigrationSql()) await db.query(sql);
}

/** A destructive inverse used only to prove the local rehearsal path. */
export async function downAdminFeedback(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  await db.query('DROP TEMPORARY TABLE IF EXISTS ayahx_admin_feedback_down_guard');
  await db.query('CREATE TEMPORARY TABLE ayahx_admin_feedback_down_guard(ok BOOLEAN NOT NULL CHECK(ok=1))');
  // The CHECK rejects the rollback if any production-like feedback exists.
  await db.query(conditional(feedbackTableExists, 'SELECT 1', 'INSERT INTO ayahx_admin_feedback_down_guard SELECT IF(COUNT(*)=0,1,0) FROM admin_feedback'));
  await db.query('DROP TEMPORARY TABLE ayahx_admin_feedback_down_guard');
  await db.query('DROP TABLE IF EXISTS admin_feedback');
}

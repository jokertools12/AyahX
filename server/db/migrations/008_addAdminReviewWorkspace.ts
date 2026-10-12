/** Batch5 additive DDL, explicit only. No grants and no human decisions. */
const literal = (value: string) => "'" + value.replace(/'/gu, "''") + "'";
const columnExists = (table: string, name: string) => `information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${literal(table)} AND COLUMN_NAME=${literal(name)}`;
const conditional = (source: string, absent: string, present = 'SELECT 1') => `SET @ayahx_a2b_ddl=(SELECT IF(COUNT(*)=0,${literal(absent)},${literal(present)}) FROM ${source}); PREPARE ayahx_a2b_stmt FROM @ayahx_a2b_ddl; EXECUTE ayahx_a2b_stmt; DEALLOCATE PREPARE ayahx_a2b_stmt`;
export const adminReviewColumns = {
  supersedes_id: 'VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  target_subject_type: 'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  target_subject_id: 'VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL',
} as const;
export const draftNullableColumns = {
  basmala_mode: "ENUM('ayah_1_included','separate_clip','absent') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL",
  basmala_reason: 'TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  source_url: 'TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  qud_version: 'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  catalog_sha256: 'CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
} as const;
export function adminReviewWorkspaceMigrationSql(): string[] {
  return [
    ...Object.entries(adminReviewColumns).map(([name, definition]) => conditional(columnExists('human_review_items', name), `ALTER TABLE human_review_items ADD COLUMN ${name} ${definition}`)),
    conditional("information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='human_review_items' AND INDEX_NAME='idx_human_review_supersedes'",'ALTER TABLE human_review_items ADD INDEX idx_human_review_supersedes(supersedes_id)'),
    'CREATE TABLE IF NOT EXISTS admin_preferences (user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,density VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,font_scale DECIMAL(3,2) DEFAULT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),PRIMARY KEY(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    'CREATE TABLE IF NOT EXISTS admin_media_tasks (id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,actor_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,type VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,status VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,request_json JSON DEFAULT NULL,result_json JSON DEFAULT NULL,error_code VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),PRIMARY KEY(id),INDEX idx_media_task_status(status,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    conditional(columnExists('recitations', 'timing_reference_recitation_id'), 'ALTER TABLE recitations ADD COLUMN timing_reference_recitation_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL'),
    ...Object.entries(draftNullableColumns).map(([name, definition]) => `ALTER TABLE recitations MODIFY COLUMN ${name} ${definition}`),
  ];
}
export async function upAdminReviewWorkspace(db: { query(sql: string): Promise<unknown> }): Promise<void> { for (const sql of adminReviewWorkspaceMigrationSql()) await db.query(sql); }
/** Disposable local restore only. The historical audit chain is never removed. */
export async function downAdminReviewWorkspace(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  // A failed guard leaves its temporary table behind in this connection. Clear
  // only these owned scratch guards so a second down/retry is deterministic.
  await db.query('DROP TEMPORARY TABLE IF EXISTS ayahx_a2b_down_guard,ayahx_a2b_draft_down_guard');
  await db.query('CREATE TEMPORARY TABLE ayahx_a2b_down_guard(ok BOOLEAN NOT NULL CHECK(ok=1)); CREATE TEMPORARY TABLE ayahx_a2b_draft_down_guard(ok BOOLEAN NOT NULL CHECK(ok=1))');
  await db.query(conditional(columnExists('human_review_items','supersedes_id'),'SELECT 1','INSERT INTO ayahx_a2b_down_guard SELECT IF(COUNT(*)=0,1,0) FROM human_review_items WHERE supersedes_id IS NOT NULL'));
  await db.query("INSERT INTO ayahx_a2b_draft_down_guard SELECT IF(COUNT(*)=0,1,0) FROM recitations WHERE basmala_mode IS NULL OR basmala_reason IS NULL OR source_url IS NULL OR qud_version IS NULL OR catalog_sha256 IS NULL");
  await db.query(conditional(columnExists('recitations','timing_reference_recitation_id'),'SELECT 1','INSERT INTO ayahx_a2b_draft_down_guard SELECT IF(COUNT(*)=0,1,0) FROM recitations WHERE timing_reference_recitation_id IS NOT NULL'));
  await db.query('DROP TEMPORARY TABLE ayahx_a2b_down_guard,ayahx_a2b_draft_down_guard');
  await db.query('DROP TABLE IF EXISTS admin_preferences');
  await db.query('DROP TABLE IF EXISTS admin_media_tasks');
  await db.query(conditional(columnExists('recitations', 'timing_reference_recitation_id'), 'SELECT 1', 'ALTER TABLE recitations DROP COLUMN timing_reference_recitation_id'));
  for (const [name, definition] of Object.entries(draftNullableColumns)) await db.query(`ALTER TABLE recitations MODIFY COLUMN ${name} ${definition.replace('DEFAULT NULL', 'NOT NULL')}`);
  await db.query(conditional("information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='human_review_items' AND INDEX_NAME='idx_human_review_supersedes'",'SELECT 1','ALTER TABLE human_review_items DROP INDEX idx_human_review_supersedes'));
  for (const name of Object.keys(adminReviewColumns)) await db.query(conditional(columnExists('human_review_items', name), 'SELECT 1', `ALTER TABLE human_review_items DROP COLUMN ${name}`));
}

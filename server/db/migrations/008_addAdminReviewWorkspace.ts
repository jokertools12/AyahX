/** Batch5 additive DDL, explicit only. No grants and no human decisions. */
const literal = (value: string) => "'" + value.replace(/'/gu, "''") + "'";
const columnExists = (table: string, name: string) => `information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${literal(table)} AND COLUMN_NAME=${literal(name)}`;
const conditional = (source: string, absent: string, present = 'SELECT 1') => `SET @ayahx_a2b_ddl=(SELECT IF(COUNT(*)=0,${literal(absent)},${literal(present)}) FROM ${source}); PREPARE ayahx_a2b_stmt FROM @ayahx_a2b_ddl; EXECUTE ayahx_a2b_stmt; DEALLOCATE PREPARE ayahx_a2b_stmt`;
export const adminReviewColumns = {
  supersedes_id: 'VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  target_subject_type: 'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  target_subject_id: 'VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL',
} as const;
export function adminReviewWorkspaceMigrationSql(): string[] {
  return [
    ...Object.entries(adminReviewColumns).map(([name, definition]) => conditional(columnExists('human_review_items', name), `ALTER TABLE human_review_items ADD COLUMN ${name} ${definition}`)),
    'CREATE TABLE IF NOT EXISTS admin_preferences (user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,density VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,font_scale DECIMAL(3,2) DEFAULT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),PRIMARY KEY(user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  ];
}
export async function upAdminReviewWorkspace(db: { query(sql: string): Promise<unknown> }): Promise<void> { for (const sql of adminReviewWorkspaceMigrationSql()) await db.query(sql); }
/** Disposable local restore only. The historical audit chain is never removed. */
export async function downAdminReviewWorkspace(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  await db.query("CREATE TEMPORARY TABLE ayahx_a2b_down_guard(ok BOOLEAN NOT NULL CHECK(ok=1)); INSERT INTO ayahx_a2b_down_guard SELECT IF(COUNT(*)=0,1,0) FROM human_review_items WHERE supersedes_id IS NOT NULL; DROP TEMPORARY TABLE ayahx_a2b_down_guard");
  await db.query('DROP TABLE IF EXISTS admin_preferences');
  for (const name of Object.keys(adminReviewColumns)) await db.query(conditional(columnExists('human_review_items', name), 'SELECT 1', `ALTER TABLE human_review_items DROP COLUMN ${name}`));
}

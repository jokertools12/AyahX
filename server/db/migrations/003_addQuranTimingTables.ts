/** D3 only. Run explicitly, never from application startup. No foreign keys. */
const text = (name: string, type: string, tail = 'NOT NULL'): string => `${name} ${type} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ${tail}`;
const create = (table: string, fields: string[]): string => `CREATE TABLE IF NOT EXISTS ${table} (${fields.join(',\n')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const dates = ['created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'];
export const TIMING_TABLES = ['ayah_timing_history', 'ayah_timings', 'import_jobs'] as const;
export const timingChapterColumns: Readonly<Record<string, string>> = {
  coverage_words: 'INT UNSIGNED NOT NULL DEFAULT 0',
  expected_words: 'INT UNSIGNED DEFAULT NULL',
  coverage_details: 'JSON DEFAULT NULL',
};
export const quranTimingCreateSql = [
  create('import_jobs', [text('id', 'VARCHAR(36)'), text('recitation_id', 'VARCHAR(36)'), text('qud_version', 'VARCHAR(64)'),
    text('source_sha256', 'CHAR(64)'), text('manifest_sha256', 'CHAR(64)'), text('canonical_checksum', 'CHAR(64)'),
    text('importer_version', 'VARCHAR(64)'), text('status', "ENUM('pending','running','interrupted','completed','failed')", "NOT NULL DEFAULT 'pending'"),
    'checkpoint INT UNSIGNED NOT NULL DEFAULT 0', 'total_rows INT UNSIGNED NOT NULL', 'imported_rows INT UNSIGNED NOT NULL DEFAULT 0',
    'review_rows INT UNSIGNED NOT NULL DEFAULT 0', 'error_json JSON DEFAULT NULL', ...dates,
    'PRIMARY KEY(id)', 'UNIQUE KEY uk_import_fingerprint(recitation_id,source_sha256,canonical_checksum,importer_version)']),
  create('ayah_timings', [text('id', 'VARCHAR(36)'), text('recitation_id', 'VARCHAR(36)'), text('ayah_id', 'VARCHAR(36)', 'DEFAULT NULL'),
    'surah SMALLINT UNSIGNED NOT NULL', 'ayah SMALLINT UNSIGNED NOT NULL', text('source', "ENUM('qud','aligner')"),
    text('quality', "ENUM('aligned','verified','estimated')", "NOT NULL DEFAULT 'aligned'"), text('qud_version', 'VARCHAR(64)'),
    text('source_sha256', 'CHAR(64)'), text('canonical_checksum', 'CHAR(64)', 'DEFAULT NULL'), text('coordinate', "ENUM('source_ms','chapter_ms','clip_ms')"),
    'source_offset_ms BIGINT DEFAULT NULL', 'start_ms BIGINT UNSIGNED DEFAULT NULL', 'end_ms BIGINT UNSIGNED DEFAULT NULL',
    'segments JSON NOT NULL', 'words JSON NOT NULL', text('spoken_text', 'MEDIUMTEXT', 'DEFAULT NULL'), 'source_rows JSON NOT NULL',
    text('review_status', "ENUM('ready','needs_review','approved','rejected')", "NOT NULL DEFAULT 'needs_review'"), 'review_reasons JSON NOT NULL',
    'word_highlight_enabled BOOLEAN NOT NULL DEFAULT FALSE', text('repetition_display_mode', "ENUM('canonical','spoken')", "NOT NULL DEFAULT 'canonical'"),
    'coverage_words INT UNSIGNED NOT NULL', 'expected_words INT UNSIGNED DEFAULT NULL', 'missing_words JSON NOT NULL',
    text('version_hash', 'CHAR(64)'), text('import_job_id', 'VARCHAR(36)'), ...dates,
    'PRIMARY KEY(id)', 'UNIQUE KEY uk_timing_ayah(recitation_id,surah,ayah)', 'INDEX idx_timing_review(review_status)',
    'CONSTRAINT chk_timing_interval CHECK(start_ms IS NULL OR (end_ms IS NOT NULL AND end_ms>start_ms))',
    "CONSTRAINT chk_timing_highlight CHECK(word_highlight_enabled=FALSE OR (review_status IN ('ready','approved') AND ayah_id IS NOT NULL AND coverage_words=expected_words AND JSON_LENGTH(missing_words)=0))"]),
  create('ayah_timing_history', [text('id', 'VARCHAR(36)'), text('timing_id', 'VARCHAR(36)'), text('version_hash', 'CHAR(64)'),
    'snapshot JSON NOT NULL', text('reason', 'VARCHAR(191)'), 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'PRIMARY KEY(id)', 'UNIQUE KEY uk_timing_version(timing_id,version_hash)']),
] as const;

/** Same deterministic conditional SQL on both environments and on replay. */
export function timingMigrationSql(): string[] {
  return [...quranTimingCreateSql, ...Object.entries(timingChapterColumns).map(([name, type]) =>
    `SET @ayahx_d3_ddl=(SELECT IF(COUNT(*)=0,'ALTER TABLE recitation_chapters ADD COLUMN ${name} ${type}','SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recitation_chapters' AND COLUMN_NAME='${name}'); PREPARE ayahx_d3_stmt FROM @ayahx_d3_ddl; EXECUTE ayahx_d3_stmt; DEALLOCATE PREPARE ayahx_d3_stmt`)];
}
export async function upQuranTimingTables(db: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of timingMigrationSql()) await db.query(sql);
}
/** MySQL DDL commits implicitly. Only the private local rehearsal may run down. */
export async function downQuranTimingTables(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  for (const table of TIMING_TABLES) await db.query(`DROP TABLE IF EXISTS ${table}`);
  for (const name of Object.keys(timingChapterColumns)) {
    await db.query(`SET @ayahx_d3_ddl=(SELECT IF(COUNT(*)>0,'ALTER TABLE recitation_chapters DROP COLUMN ${name}','SELECT 1') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='recitation_chapters' AND COLUMN_NAME='${name}'); PREPARE ayahx_d3_stmt FROM @ayahx_d3_ddl; EXECUTE ayahx_d3_stmt; DEALLOCATE PREPARE ayahx_d3_stmt`);
  }
  await db.query('UPDATE recitation_chapters SET timing_complete=NULL');
  await db.query('UPDATE recitations SET coverage_words=NULL');
}

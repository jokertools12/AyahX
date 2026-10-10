/** D4/T1 additive only. Explicit execution; never an application startup migration. */
const text = (type: string, tail = 'DEFAULT NULL', collation = 'utf8mb4_unicode_ci'): string =>
  `${type} CHARACTER SET utf8mb4 COLLATE ${collation} ${tail}`;
export const catalogServiceColumns: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  recitations: {
    display_label_ar: text('VARCHAR(255)'), display_label_en: text('VARCHAR(255)'),
    is_public: 'BOOLEAN DEFAULT FALSE', is_default_for_reciter: 'BOOLEAN DEFAULT FALSE', sort_order: 'INT DEFAULT NULL',
    voice_identity_status: text("ENUM('unverified','confirmed','mismatch')", "DEFAULT 'unverified'"),
    voice_confirmed_by: text('VARCHAR(36)'), voice_confirmed_at: 'TIMESTAMP NULL DEFAULT NULL',
    voice_notes: text('TEXT'), quality_note: text('TEXT'), source_note: text('TEXT'),
    verification_method: text("ENUM('v1','v2')"), published_by: text('VARCHAR(64)'), published_at: 'TIMESTAMP NULL DEFAULT NULL',
  },
  recitation_chapters: {
    availability_state: text("ENUM('complete','near_complete','partial','unavailable')"),
    available_runs: 'JSON DEFAULT NULL', run_count: 'INT UNSIGNED DEFAULT NULL', max_run_ayahs: 'INT UNSIGNED DEFAULT NULL',
    ready_ayahs: 'INT UNSIGNED DEFAULT NULL', near_complete_missing: 'JSON DEFAULT NULL',
  },
  audio_providers: {
    license_status: text("ENUM('unreviewed','permitted','restricted')", "DEFAULT 'unreviewed'"),
    terms_url: text('TEXT', 'DEFAULT NULL', 'utf8mb4_bin'),
  },
};
const create = (name: string, columns: string[]): string =>
  `CREATE TABLE IF NOT EXISTS ${name} (${columns.join(',\n')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const field = (name: string, type: string): string => `${name} ${text(type, 'NOT NULL')}`;
export const CATALOG_SERVICE_TABLES = ['recitation_audition_samples', 'recitation_voice_reviews', 'recitation_source_urls'] as const;
export const catalogServiceCreateSql: readonly string[] = [
  create('recitation_audition_samples', [field('id', 'VARCHAR(36)'), field('recitation_id', 'VARCHAR(36)'), field('sample_key', 'VARCHAR(64)'),
    'surah SMALLINT UNSIGNED NOT NULL', 'start_ms BIGINT UNSIGNED NOT NULL', 'duration_ms BIGINT UNSIGNED DEFAULT NULL',
    'selection_details JSON DEFAULT NULL', 'PRIMARY KEY(id)', 'UNIQUE KEY uk_audition_recitation_sample(recitation_id,sample_key)',
    'CONSTRAINT chk_audition_duration CHECK(duration_ms IS NULL OR duration_ms>0)']),
  create('recitation_voice_reviews', [field('id', 'VARCHAR(36)'), field('recitation_id', 'VARCHAR(36)'),
    field('status', "ENUM('unverified','confirmed','mismatch')"), field('reviewer_id', 'VARCHAR(36)'), `notes ${text('TEXT')}`,
    'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'PRIMARY KEY(id)', 'INDEX idx_voice_reviews_recitation(recitation_id,created_at)']),
  create('recitation_source_urls', [field('id', 'VARCHAR(36)'), field('recitation_id', 'VARCHAR(36)'), 'surah SMALLINT UNSIGNED DEFAULT NULL',
    `url ${text('TEXT', 'NOT NULL', 'utf8mb4_bin')}`, 'priority INT NOT NULL DEFAULT 0', 'is_active BOOLEAN NOT NULL DEFAULT FALSE',
    'last_checked_at TIMESTAMP NULL DEFAULT NULL', `last_status ${text('VARCHAR(64)')}`,
    `recording_sha256 ${text('CHAR(64)')}`, 'identity_evidence JSON DEFAULT NULL', `approved_by ${text('VARCHAR(36)')}`,
    'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'PRIMARY KEY(id)', 'INDEX idx_source_recitation_chapter(recitation_id,surah,is_active,priority)']),
];
export const catalogServiceIndexes = [
  { table: 'recitations', name: 'idx_recitation_public_reciter', fields: 'status,is_public,voice_identity_status,reciter_id,sort_order' },
  { table: 'audio_providers', name: 'idx_provider_license', fields: 'license_status,id' },
  { table: 'recitation_chapters', name: 'idx_chapter_availability', fields: 'recitation_id,availability_state,surah' },
  { table: 'ayah_timings', name: 'idx_timing_ready_range', fields: 'recitation_id,surah,review_status,ayah' },
] as const;
function conditional(existsSql: string, whenAbsent: string, whenPresent = 'SELECT 1'): string {
  return `SET @ayahx_d4_ddl=(SELECT IF(COUNT(*)=0,'${whenAbsent}','${whenPresent}') FROM ${existsSql}); PREPARE ayahx_d4_stmt FROM @ayahx_d4_ddl; EXECUTE ayahx_d4_stmt; DEALLOCATE PREPARE ayahx_d4_stmt`;
}
const columnExists = (table: string, column: string): string => `information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${table}' AND COLUMN_NAME='${column}'`;
const indexExists = (table: string, name: string): string => `information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${table}' AND INDEX_NAME='${name}'`;
export function catalogServiceMigrationSql(): string[] {
  return [...catalogServiceCreateSql,
    ...Object.entries(catalogServiceColumns).flatMap(([table, columns]) => Object.entries(columns).map(([name, type]) =>
      conditional(columnExists(table, name), `ALTER TABLE ${table} ADD COLUMN ${name} ${type}`.replace(/'/gu, "''")))),
    ...catalogServiceIndexes.map(i => conditional(indexExists(i.table, i.name), `ALTER TABLE ${i.table} ADD INDEX ${i.name} (${i.fields})`)),
  ];
}
export async function upRecitationCatalogServices(db: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of catalogServiceMigrationSql()) await db.query(sql);
}
/** Only a disposable local rehearsal. Never exports a production down command. */
export async function downRecitationCatalogServices(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  for (const table of CATALOG_SERVICE_TABLES) await db.query(`DROP TABLE IF EXISTS ${table}`);
  for (const i of catalogServiceIndexes) await db.query(conditional(indexExists(i.table, i.name), 'SELECT 1', `ALTER TABLE ${i.table} DROP INDEX ${i.name}`));
  for (const [table, columns] of Object.entries(catalogServiceColumns)) for (const name of Object.keys(columns)) {
    await db.query(conditional(columnExists(table, name), 'SELECT 1', `ALTER TABLE ${table} DROP COLUMN ${name}`));
  }
}

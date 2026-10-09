/** D2 additive DDL. Not attached to app startup. Down is LOCAL ONLY. */
export const QURAN_CATALOG_TABLES = ['recitation_chapters', 'recitations', 'audio_providers', 'reciters'] as const;
const text = (name: string, type: string, tail = 'NOT NULL'): string => `${name} ${type} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ${tail}`;
const times = ['created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'];
const create = (table: string, columns: string[]): string => `CREATE TABLE IF NOT EXISTS ${table} (\n${columns.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export const quranCatalogMigrationSql: readonly string[] = [
  create('reciters', [text('id', 'VARCHAR(36)'), text('source_reciter_id', 'VARCHAR(191)', 'DEFAULT NULL'), text('slug', 'VARCHAR(191)'),
    text('name_ar', 'VARCHAR(255)'), text('name_en', 'VARCHAR(255)'), text('country', 'VARCHAR(255)', 'DEFAULT NULL'),
    text('bio', 'TEXT', 'DEFAULT NULL'), text('photo_url', 'TEXT', 'DEFAULT NULL'), 'is_featured BOOLEAN DEFAULT NULL', 'sort_order INT DEFAULT NULL',
    text('status', "ENUM('imported','needs_review')", "NOT NULL DEFAULT 'imported'"), ...times,
    'PRIMARY KEY (id)', 'UNIQUE KEY uk_reciter_source_id (source_reciter_id)', 'UNIQUE KEY uk_reciter_slug (slug)']),
  create('audio_providers', [text('id', 'VARCHAR(36)'), text('code', 'VARCHAR(64)'), text('name', 'VARCHAR(255)'),
    text('base_url', 'TEXT', 'DEFAULT NULL'), 'host_allowlist JSON NOT NULL', text('adapter_id', 'VARCHAR(64)', 'DEFAULT NULL'),
    'is_active BOOLEAN NOT NULL DEFAULT FALSE', text('health_status', "ENUM('unchecked','healthy','unavailable')", "NOT NULL DEFAULT 'unchecked'"),
    'priority INT DEFAULT NULL', 'last_checked_at TIMESTAMP NULL DEFAULT NULL',
    text('license_text', 'TEXT', 'DEFAULT NULL'), text('attribution_text', 'TEXT', 'DEFAULT NULL'), ...times,
    'PRIMARY KEY (id)', 'UNIQUE KEY uk_provider_code (code)']),
  create('recitations', [text('id', 'VARCHAR(36)'), text('slug', 'VARCHAR(191)'), text('reciter_id', 'VARCHAR(36)'), text('provider_id', 'VARCHAR(36)'),
    // D1 riwayat.id is VARCHAR(36); deliberately NO FK to an existing table.
    text('riwayah_id', 'VARCHAR(36)'), text('riwayah_code', 'VARCHAR(64)'), 'canonical_text_available BOOLEAN NOT NULL DEFAULT FALSE',
    text('style', 'VARCHAR(64)'), text('channel', 'VARCHAR(64)'), text('audio_category', 'VARCHAR(128)'),
    text('audio_mode', "ENUM('unverified_source','surah_slice')", "NOT NULL DEFAULT 'unverified_source'"),
    text('recording_context', 'VARCHAR(191)', 'DEFAULT NULL'), 'recording_year SMALLINT DEFAULT NULL', text('variant_label', 'VARCHAR(255)', 'DEFAULT NULL'),
    text('timing_level', "ENUM('none','ayah','word','letter')", "NOT NULL DEFAULT 'none'"),
    text('timing_quality', "ENUM('unimported','needs_review','aligned','verified')", "NOT NULL DEFAULT 'unimported'"),
    'coverage_ayahs INT UNSIGNED NOT NULL', 'coverage_words INT UNSIGNED DEFAULT NULL', 'ayahs_complete BOOLEAN NOT NULL DEFAULT FALSE',
    text('basmala_mode', "ENUM('ayah_1_included','separate_clip','absent')"), text('basmala_reason', 'TEXT'),
    text('surah_start_basmala_text_status', 'VARCHAR(64)'),
    text('surah_start_basmala_audio_status', "ENUM('unverified','verified','not_applicable')", "NOT NULL DEFAULT 'unverified'"),
    'offset_verified BOOLEAN NOT NULL DEFAULT FALSE', 'offset_check_score DOUBLE DEFAULT NULL', 'offset_correction_ms INT DEFAULT NULL',
    text('verification_status', "ENUM('pending','passed','failed','source_unavailable')", "NOT NULL DEFAULT 'pending'"), 'verification_details JSON NOT NULL',
    text('license_text', 'TEXT', 'DEFAULT NULL'), text('attribution_text', 'TEXT', 'DEFAULT NULL'), text('source_url', 'TEXT'), text('qud_version', 'VARCHAR(64)'),
    text('catalog_sha256', 'CHAR(64)'), 'catalog_raw JSON NOT NULL', 'audit_json JSON NOT NULL',
    text('status', "ENUM('draft','imported','needs_review','published','hidden','deprecated')", "NOT NULL DEFAULT 'imported'"), ...times,
    'PRIMARY KEY (id)', 'UNIQUE KEY uk_recitation_slug (slug)', 'INDEX idx_recitation_reciter (reciter_id)', 'INDEX idx_recitation_status (status)',
    'CONSTRAINT fk_catalog_reciter FOREIGN KEY (reciter_id) REFERENCES reciters(id) ON DELETE RESTRICT',
    'CONSTRAINT fk_catalog_provider FOREIGN KEY (provider_id) REFERENCES audio_providers(id) ON DELETE RESTRICT',
    "CONSTRAINT chk_catalog_slice CHECK (audio_mode <> 'surah_slice' OR (offset_verified=TRUE AND verification_status='passed'))",
    "CONSTRAINT chk_catalog_offset CHECK (offset_verified=FALSE OR (verification_status='passed' AND offset_check_score>=0.95 AND offset_check_score IS NOT NULL))",
    // A reviewed audio claim needs a separate evidence reference. Passing NCC
    // is not an assertion about the spoken content of the chapter prefix.
    "CONSTRAINT chk_catalog_publish CHECK (status <> 'published' OR (canonical_text_available=TRUE AND offset_verified=TRUE AND verification_status='passed' AND timing_quality='verified' AND timing_level IN ('word','letter') AND surah_start_basmala_audio_status IN ('verified','not_applicable') AND JSON_CONTAINS_PATH(verification_details,'one','$.basmala_audio_evidence')=1 AND JSON_TYPE(JSON_EXTRACT(verification_details,'$.basmala_audio_evidence'))='OBJECT'))"]),
  create('recitation_chapters', [text('id', 'VARCHAR(36)'), text('recitation_id', 'VARCHAR(36)'), 'surah SMALLINT UNSIGNED NOT NULL',
    text('audio_url', 'TEXT'), 'chapter_offset_ms INT DEFAULT NULL', 'duration_ms INT UNSIGNED DEFAULT NULL',
    text('audio_status', "ENUM('unverified','available','source_unavailable')", "NOT NULL DEFAULT 'unverified'"), 'last_verified_at TIMESTAMP NULL DEFAULT NULL',
    'expected_ayahs SMALLINT UNSIGNED DEFAULT NULL', 'available_ayahs SMALLINT UNSIGNED NOT NULL', 'missing_verses JSON NOT NULL',
    'coverage_mismatch BOOLEAN DEFAULT NULL', 'ayahs_complete BOOLEAN NOT NULL DEFAULT FALSE', 'timing_complete BOOLEAN DEFAULT NULL',
    'is_complete BOOLEAN GENERATED ALWAYS AS (ayahs_complete AND COALESCE(timing_complete,FALSE)) STORED', ...times,
    'PRIMARY KEY (id)', 'UNIQUE KEY uk_catalog_chapter (recitation_id,surah)',
    'CONSTRAINT fk_catalog_chapter FOREIGN KEY (recitation_id) REFERENCES recitations(id) ON DELETE CASCADE',
    'CONSTRAINT chk_catalog_chapter_number CHECK (surah>=1)',
    'CONSTRAINT chk_catalog_chapter_coverage CHECK (ayahs_complete=FALSE OR (expected_ayahs IS NOT NULL AND available_ayahs=expected_ayahs AND coverage_mismatch=FALSE))']),
];

export async function upQuranCatalogTables(db: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of quranCatalogMigrationSql) await db.query(sql);
}

/** Destructive rehearsal only. DDL implicit commits; backup before rollback. */
export async function downQuranCatalogTables(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  for (const table of QURAN_CATALOG_TABLES) await db.query(`DROP TABLE IF EXISTS ${table}`);
}

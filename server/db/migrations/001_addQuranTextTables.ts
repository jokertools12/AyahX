import { logger } from '../../logger';

/**
 * Migration 001: D1 Quran text schema.
 *
 * MySQL implicitly commits most DDL statements, so `upQuranTextTables` is
 * ordered and idempotent rather than pretending DDL can be rolled back by a
 * normal transaction. `downQuranTextTables` is the documented reverse plan;
 * callers must take a database backup before invoking it.
 */
export const QURAN_TEXT_TABLES = [
  'translation_ayahs',
  'translations',
  'quran_words',
  'quran_ayahs',
  'quran_surahs',
  'quran_text_versions',
  'riwayat',
] as const;

type SqlExecutor = { query(sql: string): Promise<unknown> };

const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS riwayat (
    id VARCHAR(36) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    aligner_code VARCHAR(128) DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_riwayat_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS quran_text_versions (
    id VARCHAR(36) NOT NULL,
    riwayah_id VARCHAR(36) NOT NULL,
    source ENUM('qul', 'qud') NOT NULL,
    script VARCHAR(32) NOT NULL,
    version_label VARCHAR(191) NOT NULL,
    qud_version VARCHAR(64) DEFAULT NULL,
    checksum CHAR(64) NOT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_quran_text_version (riwayah_id, source, version_label, checksum),
    INDEX idx_quran_text_versions_active (riwayah_id, is_active),
    CONSTRAINT fk_quran_text_versions_riwayah FOREIGN KEY (riwayah_id) REFERENCES riwayat (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS quran_surahs (
    id VARCHAR(36) NOT NULL,
    number SMALLINT UNSIGNED NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_translit VARCHAR(255) DEFAULT NULL,
    revelation_place VARCHAR(32) DEFAULT NULL,
    ayah_count SMALLINT UNSIGNED NOT NULL,
    has_basmala BOOLEAN NOT NULL DEFAULT TRUE,
    juz_start SMALLINT UNSIGNED DEFAULT NULL,
    page_start SMALLINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_quran_surahs_number (number),
    CONSTRAINT chk_quran_surahs_number CHECK (number >= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS quran_ayahs (
    id VARCHAR(36) NOT NULL,
    text_version_id VARCHAR(36) NOT NULL,
    surah SMALLINT UNSIGNED NOT NULL,
    ayah SMALLINT UNSIGNED NOT NULL,
    text_uthmani TEXT NOT NULL,
    text_simple TEXT NOT NULL,
    words_count SMALLINT UNSIGNED NOT NULL,
    juz SMALLINT UNSIGNED DEFAULT NULL,
    page SMALLINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_quran_ayah_version_location (text_version_id, surah, ayah),
    INDEX idx_quran_ayah_location (surah, ayah),
    CONSTRAINT fk_quran_ayahs_text_version FOREIGN KEY (text_version_id) REFERENCES quran_text_versions (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS quran_words (
    id VARCHAR(36) NOT NULL,
    ayah_id VARCHAR(36) NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    text_uthmani VARCHAR(255) NOT NULL,
    text_simple VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_quran_word_position (ayah_id, position),
    CONSTRAINT fk_quran_words_ayah FOREIGN KEY (ayah_id) REFERENCES quran_ayahs (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS translations (
    id VARCHAR(36) NOT NULL,
    code VARCHAR(64) NOT NULL,
    lang VARCHAR(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    translator VARCHAR(255) DEFAULT NULL,
    license TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_translations_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS translation_ayahs (
    id VARCHAR(36) NOT NULL,
    translation_id VARCHAR(36) NOT NULL,
    ayah_id VARCHAR(36) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_translation_ayah (translation_id, ayah_id),
    CONSTRAINT fk_translation_ayahs_translation FOREIGN KEY (translation_id) REFERENCES translations (id) ON DELETE CASCADE,
    CONSTRAINT fk_translation_ayahs_ayah FOREIGN KEY (ayah_id) REFERENCES quran_ayahs (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function executeStatements(executor: SqlExecutor, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await executor.query(statement);
}

export async function upQuranTextTables(executor: SqlExecutor): Promise<void> {
  await executeStatements(executor, CREATE_STATEMENTS);
  logger.info('Database migration: verified D1 Quran text tables.');
}

/**
 * Explicit reverse migration. It is intentionally opt-in and never called by
 * application startup. Foreign-key dependants are dropped before parents.
 */
export async function downQuranTextTables(executor: SqlExecutor): Promise<void> {
  const statements = QURAN_TEXT_TABLES.map((table) => `DROP TABLE IF EXISTS \`${table}\``);
  await executeStatements(executor, statements);
  logger.info('Database migration: rolled back D1 Quran text tables.');
}

export const quranTextMigrationSql = CREATE_STATEMENTS;

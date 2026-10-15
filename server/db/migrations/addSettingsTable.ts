import { query } from '../../db';

/** Privileged schema preparation only. Settings reads never import or invoke this migration. */
export async function ensureSettingsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key_name VARCHAR(100) NOT NULL PRIMARY KEY,
      value_text TEXT NOT NULL,
      is_secret BOOLEAN NOT NULL DEFAULT FALSE,
      category VARCHAR(50) NOT NULL DEFAULT 'general',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

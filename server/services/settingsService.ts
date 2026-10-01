import { query } from '../db';
import { logger } from '../logger';
import {
  decryptSettingSecret,
  encryptLegacySettingSecret,
  isEncryptedSetting,
  isSettingsSecretEncryptionConfigured,
} from './secretSettingsCrypto';

let tableInitialized = false;
let attemptedLegacySecretMigration = false;

function decodeSettingValue(value: string, isSecret: boolean, key: string): string {
  if (!isSecret || !isEncryptedSetting(value)) return value;
  try {
    return decryptSettingSecret(value);
  } catch (err: any) {
    // Do not return a ciphertext as a credential.  The caller sees an absent
    // value and the operator gets a safe diagnostic without exposing the key.
    logger.error(`Unable to decrypt secret setting '${key}'`, err);
    return '';
  }
}

async function migrateLegacyPlaintextSecrets(): Promise<void> {
  if (attemptedLegacySecretMigration || !isSettingsSecretEncryptionConfigured()) return;
  attemptedLegacySecretMigration = true;
  try {
    const rows = await query<Array<{ key_name: string; value_text: string }>>(
      'SELECT key_name, value_text FROM system_settings WHERE is_secret = TRUE'
    );
    let migrated = 0;
    for (const row of rows) {
      if (!row.value_text || isEncryptedSetting(row.value_text)) continue;
      const encrypted = encryptLegacySettingSecret(row.value_text);
      if (!encrypted) continue;
      await query(
        'UPDATE system_settings SET value_text = ? WHERE key_name = ? AND value_text = ?',
        [encrypted, row.key_name, row.value_text],
      );
      migrated += 1;
    }
    if (migrated > 0) {
      logger.info('Migrated legacy secret settings to encrypted storage', { migrated });
    }
  } catch (err: any) {
    // A failed migration must not bring down the API; existing rows remain
    // readable for a one-time retry on the next process start.
    attemptedLegacySecretMigration = false;
    logger.error('Failed to migrate legacy secret settings', err);
  }
}

/**
 * Ensures the system_settings table exists in MySQL
 */
export async function ensureSettingsTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key_name VARCHAR(100) NOT NULL PRIMARY KEY,
        value_text TEXT NOT NULL,
        is_secret BOOLEAN NOT NULL DEFAULT FALSE,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    tableInitialized = true;
    await migrateLegacyPlaintextSecrets();
  } catch (err: any) {
    logger.error(`Failed to ensure system_settings table: ${err.message}`);
  }
}

/**
 * Retrieves many raw values in one bounded query. Database values retain the
 * existing stored-settings precedence; process.env remains the safe fallback
 * for Railway-managed deployments and bootstrapping.
 */
export async function getRawSettings(keys: string[]): Promise<Record<string, string>> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const result: Record<string, string> = {};
  for (const key of uniqueKeys) result[key] = process.env[key] || '';
  if (uniqueKeys.length === 0) return result;

  await ensureSettingsTable();
  try {
    const placeholders = uniqueKeys.map(() => '?').join(', ');
    const rows = await query<Array<{ key_name: string; value_text: string; is_secret: boolean }>>(
      `SELECT key_name, value_text, is_secret FROM system_settings WHERE key_name IN (${placeholders})`,
      uniqueKeys,
    );
    for (const row of rows) {
      if (row.value_text !== undefined && row.value_text !== null) {
        result[row.key_name] = decodeSettingValue(row.value_text, Boolean(row.is_secret), row.key_name);
      }
    }
  } catch (err: any) {
    logger.warn(`Could not read settings from DB: ${err.message}`);
  }
  return result;
}

/** Retrieves one raw setting value from encrypted DB storage or process.env. */
export async function getRawSetting(key: string): Promise<string> {
  const settings = await getRawSettings([key]);
  return settings[key] || '';
}

import { query } from '../db';
import { logger } from '../logger';
import {
  decryptSettingSecret,
  encryptLegacySettingSecret,
  encryptSettingSecret,
  isEncryptedSetting,
  isSettingsSecretEncryptionConfigured,
} from './secretSettingsCrypto';

export interface SystemSetting {
  key_name: string;
  value_text: string;
  is_secret: boolean;
  category: string;
  updated_at?: string;
}

export interface SettingsMap {
  [key: string]: {
    value: string;
    is_secret: boolean;
    category: string;
  };
}

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

/** Safe metadata for the settings UI; never contains a credential. */
export function getSecretStorageStatus(): { encryptionConfigured: boolean; storageMode: 'encrypted_database' | 'environment_only' } {
  const encryptionConfigured = isSettingsSecretEncryptionConfigured();
  return {
    encryptionConfigured,
    storageMode: encryptionConfigured ? 'encrypted_database' : 'environment_only',
  };
}

/**
 * Masks a secret string (shows first 3 and last 3 chars if long enough, else asterisks)
 */
export function maskSecret(val: string): string {
  if (!val || val.trim() === '') return '';
  const str = val.trim();
  if (str.length <= 6) return '******';
  return `${str.slice(0, 3)}****${str.slice(-3)}`;
}

/**
 * Retrieves many raw values in one bounded query. Database values retain the
 * existing admin-settings precedence; process.env remains the safe fallback
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

/**
 * Retrieves all settings with secrets masked for safe admin UI display
 */
export async function getAllSettingsMasked(): Promise<Record<string, { value: string; isSecret: boolean; category: string }>> {
  await ensureSettingsTable();
  const result: Record<string, { value: string; isSecret: boolean; category: string }> = {};

  // Default known keys
  const defaultKeys: { key: string; isSecret: boolean; category: string; defaultVal: string }[] = [
    { key: 'AI_PROVIDER', isSecret: false, category: 'ai', defaultVal: process.env.AI_PROVIDER || 'openrouter' },
    { key: 'OPENROUTER_API_KEY', isSecret: true, category: 'ai', defaultVal: process.env.OPENROUTER_API_KEY || '' },
    { key: 'OPENROUTER_TEXT_MODEL', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_TEXT_MODEL || 'qwen/qwen3.8-27b:free' },
    { key: 'OPENROUTER_TEXT_FALLBACK_MODELS', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_TEXT_FALLBACK_MODELS || '' },
    { key: 'OPENROUTER_FREE_ONLY', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_FREE_ONLY || 'true' },
    { key: 'OPENROUTER_MODEL_FALLBACKS_ENABLED', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_MODEL_FALLBACKS_ENABLED || 'false' },
    { key: 'OPENROUTER_ALLOW_PROVIDER_FALLBACKS', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_ALLOW_PROVIDER_FALLBACKS || 'false' },
    { key: 'OPENROUTER_DATA_COLLECTION', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_DATA_COLLECTION || 'deny' },
    { key: 'OPENROUTER_SITE_URL', isSecret: false, category: 'ai', defaultVal: process.env.OPENROUTER_SITE_URL || '' },
    { key: 'AI_IMAGE_PROVIDER', isSecret: false, category: 'ai', defaultVal: process.env.AI_IMAGE_PROVIDER || 'gemini' },
    { key: 'GEMINI_API_KEY', isSecret: true, category: 'ai', defaultVal: process.env.GEMINI_API_KEY || '' },
    { key: 'PEXELS_API_KEY', isSecret: true, category: 'media', defaultVal: process.env.PEXELS_API_KEY || process.env.VITE_PEXELS_API_KEY || '' },
    { key: 'REELS_DEFAULT_QUALITY', isSecret: false, category: 'reels', defaultVal: '1080p' },
    { key: 'REELS_DEFAULT_FPS', isSecret: false, category: 'reels', defaultVal: '30' },
    { key: 'REELS_DEFAULT_GLOW', isSecret: false, category: 'reels', defaultVal: 'golden' },
    { key: 'REELS_AUDIO_BITRATE', isSecret: false, category: 'reels', defaultVal: '192k' },
  ];

  try {
    const rows = await query<any[]>('SELECT key_name, value_text, is_secret, category FROM system_settings');
    const dbMap = new Map<string, { value: string; isSecret: boolean; category: string }>();
    rows.forEach(r => {
      dbMap.set(r.key_name, {
        value: decodeSettingValue(r.value_text, Boolean(r.is_secret), r.key_name),
        isSecret: Boolean(r.is_secret),
        category: r.category || 'general',
      });
    });

    for (const def of defaultKeys) {
      if (dbMap.has(def.key)) {
        const item = dbMap.get(def.key)!;
        result[def.key] = {
          value: item.isSecret ? maskSecret(item.value) : item.value,
          isSecret: item.isSecret,
          category: item.category,
        };
      } else {
        result[def.key] = {
          value: def.isSecret ? maskSecret(def.defaultVal) : def.defaultVal,
          isSecret: def.isSecret,
          category: def.category,
        };
      }
    }

    // Include any additional DB keys
    dbMap.forEach((v, k) => {
      if (!result[k]) {
        result[k] = {
          value: v.isSecret ? maskSecret(v.value) : v.value,
          isSecret: v.isSecret,
          category: v.category,
        };
      }
    });
  } catch (err: any) {
    logger.error(`Failed to get settings: ${err.message}`);
    // Return env defaults
    for (const def of defaultKeys) {
      result[def.key] = {
        value: def.isSecret ? maskSecret(def.defaultVal) : def.defaultVal,
        isSecret: def.isSecret,
        category: def.category,
      };
    }
  }

  return result;
}

/**
 * Saves or updates a setting in the database and updates process.env in-memory.
 * Secrets are AES-256-GCM encrypted before they ever reach MySQL; an operator
 * must configure SETTINGS_ENCRYPTION_KEY or use Railway environment variables.
 */
export async function saveSetting(key: string, value: string, isSecret: boolean, category: string): Promise<void> {
  await ensureSettingsTable();
  const cleanVal = String(value || '').trim();

  // If the user didn't change a masked secret (sent "******" or "sk-***"), don't overwrite!
  if (isSecret && (cleanVal.includes('****') || cleanVal === '******')) {
    return;
  }

  try {
    const valueToStore = isSecret && cleanVal ? encryptSettingSecret(cleanVal) : cleanVal;
    await query(
      `INSERT INTO system_settings (key_name, value_text, is_secret, category)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), is_secret = VALUES(is_secret), category = VALUES(category), updated_at = CURRENT_TIMESTAMP`,
      [key, valueToStore, isSecret, category]
    );

    // Sync to active process.env
    process.env[key] = cleanVal;
    logger.info(`System setting updated: [${key}]`);
  } catch (err: any) {
    logger.error(`Failed to save setting '${key}': ${err.message}`);
    throw err;
  }
}

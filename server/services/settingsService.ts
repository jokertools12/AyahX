import { query } from '../db';
import { logger } from '../logger';

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
  } catch (err: any) {
    logger.error(`Failed to ensure system_settings table: ${err.message}`);
  }
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
 * Retrieves a raw setting value directly from DB or process.env fallback
 */
export async function getRawSetting(key: string): Promise<string> {
  await ensureSettingsTable();
  try {
    const rows = await query<any[]>('SELECT value_text FROM system_settings WHERE key_name = ? LIMIT 1', [key]);
    if (rows.length > 0 && rows[0].value_text !== undefined && rows[0].value_text !== null) {
      return rows[0].value_text;
    }
  } catch (err: any) {
    logger.warn(`Could not read setting '${key}' from DB: ${err.message}`);
  }
  return process.env[key] || '';
}

/**
 * Retrieves all settings with secrets masked for safe admin UI display
 */
export async function getAllSettingsMasked(): Promise<Record<string, { value: string; isSecret: boolean; category: string }>> {
  await ensureSettingsTable();
  const result: Record<string, { value: string; isSecret: boolean; category: string }> = {};

  // Default known keys
  const defaultKeys: { key: string; isSecret: boolean; category: string; defaultVal: string }[] = [
    { key: 'QF_CLIENT_ID', isSecret: false, category: 'quran_foundation', defaultVal: process.env.QF_CLIENT_ID || '' },
    { key: 'QF_CLIENT_SECRET', isSecret: true, category: 'quran_foundation', defaultVal: process.env.QF_CLIENT_SECRET || '' },
    { key: 'QF_PRELIVE_CLIENT_ID', isSecret: false, category: 'quran_foundation', defaultVal: process.env.QF_PRELIVE_CLIENT_ID || process.env.QF_CLIENT_ID || '' },
    { key: 'QF_PRELIVE_CLIENT_SECRET', isSecret: true, category: 'quran_foundation', defaultVal: process.env.QF_PRELIVE_CLIENT_SECRET || process.env.QF_CLIENT_SECRET || '' },
    { key: 'QF_PROD_CLIENT_ID', isSecret: false, category: 'quran_foundation', defaultVal: process.env.QF_PROD_CLIENT_ID || '' },
    { key: 'QF_PROD_CLIENT_SECRET', isSecret: true, category: 'quran_foundation', defaultVal: process.env.QF_PROD_CLIENT_SECRET || '' },
    { key: 'QF_ENV', isSecret: false, category: 'quran_foundation', defaultVal: process.env.QF_ENV || 'prelive' },
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
        value: r.value_text,
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
 * Saves or updates a setting in the database and updates process.env in-memory
 */
export async function saveSetting(key: string, value: string, isSecret: boolean, category: string): Promise<void> {
  await ensureSettingsTable();
  const cleanVal = String(value || '').trim();

  // If the user didn't change a masked secret (sent "******" or "sk-***"), don't overwrite!
  if (isSecret && (cleanVal.includes('****') || cleanVal === '******')) {
    return;
  }

  try {
    await query(
      `INSERT INTO system_settings (key_name, value_text, is_secret, category)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), is_secret = VALUES(is_secret), category = VALUES(category), updated_at = CURRENT_TIMESTAMP`,
      [key, cleanVal, isSecret, category]
    );

    // Sync to active process.env
    process.env[key] = cleanVal;
    logger.info(`System setting updated: [${key}]`);
  } catch (err: any) {
    logger.error(`Failed to save setting '${key}': ${err.message}`);
    throw err;
  }
}

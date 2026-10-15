// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query, logger } = vi.hoisted(() => ({ query: vi.fn(), logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../server/db', () => ({ query }));
vi.mock('../../server/logger', () => ({ logger }));
const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ddl = /\b(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i;
beforeEach(() => { vi.resetModules(); query.mockReset(); vi.clearAllMocks(); vi.stubEnv('SETTINGS_ENCRYPTION_KEY', ''); });
afterEach(() => vi.unstubAllEnvs());

describe('settings runtime database privilege boundary', () => {
  it('uses stored overrides including empty values and env fallback without runtime DDL or secret scans', async () => {
    vi.stubEnv('FIXTURE_SETTING', 'environment'); vi.stubEnv('FIXTURE_EMPTY', 'environment'); vi.stubEnv('FIXTURE_MISSING', 'fallback');
    query.mockResolvedValueOnce([{ key_name: 'FIXTURE_SETTING', value_text: 'database', is_secret: false },
      { key_name: 'FIXTURE_EMPTY', value_text: '', is_secret: false }]);
    const { getRawSettings } = await import('../../server/services/settingsService');
    expect(await getRawSettings(['FIXTURE_SETTING', 'FIXTURE_EMPTY', 'FIXTURE_MISSING', 'FIXTURE_SETTING', ''])).toEqual({
      FIXTURE_SETTING: 'database', FIXTURE_EMPTY: '', FIXTURE_MISSING: 'fallback',
    });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('WHERE key_name IN (?, ?, ?)'), ['FIXTURE_SETTING', 'FIXTURE_EMPTY', 'FIXTURE_MISSING']);
    expect(query.mock.calls.every(([sql]) => !ddl.test(sql))).toBe(true);
  });
  it('returns env fallback if the schema is unavailable without trying to create it', async () => {
    vi.stubEnv('FIXTURE_SETTING', 'fallback'); query.mockRejectedValue(new Error('table unavailable'));
    const { getRawSetting } = await import('../../server/services/settingsService');
    expect(await getRawSetting('FIXTURE_SETTING')).toBe('fallback');
    expect(query.mock.calls.every(([sql]) => !ddl.test(sql))).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
  it('performs no database operation for an empty key list, even with encryption configured', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', encryptionKey);
    const { getRawSettings } = await import('../../server/services/settingsService');
    expect(await getRawSettings([])).toEqual({}); expect(query).not.toHaveBeenCalled();
  });
  it('retains the one-time conditional plaintext encryption DML and decrypts stored secrets', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', encryptionKey); vi.stubEnv('FIXTURE_SECRET', 'env-is-not-the-stored-secret');
    const { decryptSettingSecret, encryptSettingSecret } = await import('../../server/services/secretSettingsCrypto');
    const values = [{ key_name: 'FIXTURE_SECRET', value_text: 'legacy-synthetic-secret', is_secret: true },
      { key_name: 'FIXTURE_EXISTING', value_text: encryptSettingSecret('existing-synthetic-secret'), is_secret: true },
      { key_name: 'FIXTURE_EMPTY_SECRET', value_text: '', is_secret: true }];
    query.mockImplementation(async (sql: string, parameters?: string[]) => {
      if (sql.startsWith('SELECT key_name, value_text FROM')) return values;
      if (sql.startsWith('UPDATE system_settings')) {
        expect(parameters?.[2]).toBe('legacy-synthetic-secret');
        expect(sql).toContain('WHERE key_name = ? AND value_text = ?');
        values[0].value_text = parameters![0]; return { affectedRows: 1 };
      }
      return values;
    });
    const { getRawSettings } = await import('../../server/services/settingsService');
    for (let i = 0; i < 2; i++) expect(await getRawSettings(['FIXTURE_SECRET', 'FIXTURE_EXISTING'])).toMatchObject({
      FIXTURE_SECRET: 'legacy-synthetic-secret', FIXTURE_EXISTING: 'existing-synthetic-secret',
    });
    expect(values[0].value_text).toMatch(/^enc:v1:/); expect(decryptSettingSecret(values[0].value_text)).toBe('legacy-synthetic-secret');
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE '))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('SELECT key_name, value_text FROM'))).toHaveLength(1);
    expect(query.mock.calls.every(([sql]) => !ddl.test(sql))).toBe(true);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('legacy-synthetic-secret');
  });
  it('keeps plaintext readable after a failed encryption transition and retries that DML on later reads', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', encryptionKey); let updates = 0;
    const row = { key_name: 'FIXTURE_SECRET', value_text: 'synthetic-plaintext', is_secret: true };
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE ')) { updates++; if (updates === 1) throw new Error('update unavailable'); return { affectedRows: 1 }; }
      return [row];
    });
    const { getRawSetting } = await import('../../server/services/settingsService');
    expect(await getRawSetting('FIXTURE_SECRET')).toBe('synthetic-plaintext');
    expect(await getRawSetting('FIXTURE_SECRET')).toBe('synthetic-plaintext'); expect(updates).toBe(2);
    expect(query.mock.calls.every(([sql]) => !ddl.test(sql))).toBe(true);
  });
  it('never returns ciphertext or env credentials when stored secret decryption fails', async () => {
    vi.stubEnv('FIXTURE_SECRET', 'fallback-must-not-replace-stored-secret');
    query.mockResolvedValue([{ key_name: 'FIXTURE_SECRET', value_text: 'enc:v1:invalid:invalid:invalid', is_secret: true }]);
    const { getRawSetting } = await import('../../server/services/settingsService');
    expect(await getRawSetting('FIXTURE_SECRET')).toBe(''); expect(logger.error).toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => !ddl.test(sql))).toBe(true);
  });
  it('runs schema preparation only through the privileged migration and propagates failure', async () => {
    const failure = new Error('CREATE privilege denied'); query.mockRejectedValueOnce(failure).mockResolvedValueOnce({});
    const { ensureSettingsTable } = await import('../../server/db/migrations/addSettingsTable');
    await expect(ensureSettingsTable()).rejects.toBe(failure);
    await ensureSettingsTable();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => /CREATE TABLE IF NOT EXISTS system_settings/.test(sql))).toBe(true);
    expect(query.mock.calls[0][0]).toContain('COLLATE=utf8mb4_unicode_ci');
  });
});

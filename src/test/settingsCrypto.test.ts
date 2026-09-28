import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptSettingSecret,
  encryptSettingSecret,
  isEncryptedSetting,
} from '../../server/services/secretSettingsCrypto';

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
});

describe('encrypted system settings', () => {
  it('round-trips an API secret with AES-GCM and never stores plaintext', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const encrypted = encryptSettingSecret('or-sensitive-key');
    expect(isEncryptedSetting(encrypted)).toBe(true);
    expect(encrypted).not.toContain('or-sensitive-key');
    expect(decryptSettingSecret(encrypted)).toBe('or-sensitive-key');
  });

  it('refuses to encrypt when the master key is absent or malformed', () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(() => encryptSettingSecret('secret')).toThrow(/SETTINGS_ENCRYPTION_KEY/);
    process.env.SETTINGS_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSettingSecret('secret')).toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });

  it('fails closed when ciphertext is tampered with', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const encrypted = encryptSettingSecret('or-sensitive-key');
    const parts = encrypted.split(':');
    const tamperedTag = Buffer.from(parts[3], 'base64');
    tamperedTag[0] ^= 0xff;
    parts[3] = tamperedTag.toString('base64');
    const tampered = parts.join(':');
    expect(() => decryptSettingSecret(tampered)).toThrow(/فك تشفير|decrypt/i);
  });
});

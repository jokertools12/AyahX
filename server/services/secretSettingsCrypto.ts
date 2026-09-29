import crypto from 'crypto';

const PREFIX = 'enc:v1';
const IV_BYTES = 12;

export class SettingsSecretError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SettingsSecretError';
    this.code = code;
  }
}

/**
 * Reads a stable 256-bit master key from the server environment.  It accepts
 * either a 64-character hex value or a base64 value that decodes to 32 bytes.
 * A weak/ad-hoc passphrase is deliberately rejected rather than silently
 * hashed, because that makes the deployment's key management ambiguous.
 */
function getMasterKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex');

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to the safe configuration error below.
  }
  return null;
}

export function isSettingsSecretEncryptionConfigured(): boolean {
  return Boolean(getMasterKey());
}

export function isEncryptedSetting(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export function encryptSettingSecret(value: string): string {
  const key = getMasterKey();
  if (!key) {
    throw new SettingsSecretError(
      'SETTINGS_ENCRYPTION_KEY_NOT_CONFIGURED',
      'لا يمكن حفظ مفاتيح API في الإعدادات حتى يُضبط SETTINGS_ENCRYPTION_KEY بطول 32 بايت على الخادم.',
    );
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSettingSecret(value: string): string {
  if (!isEncryptedSetting(value)) return value;
  const key = getMasterKey();
  if (!key) {
    throw new SettingsSecretError(
      'SETTINGS_ENCRYPTION_KEY_NOT_CONFIGURED',
      'تعذر قراءة مفتاح API المخزن لأن SETTINGS_ENCRYPTION_KEY غير مضبوط على هذا الخادم.',
    );
  }

  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new SettingsSecretError('SETTINGS_SECRET_FORMAT_INVALID', 'صيغة المفتاح المشفر غير صالحة.');
  }

  try {
    const [, , ivBase64, tagBase64, ciphertextBase64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SettingsSecretError('SETTINGS_SECRET_DECRYPT_FAILED', 'تعذر فك تشفير مفتاح API المخزن. تحقق من SETTINGS_ENCRYPTION_KEY.');
  }
}

/** Used by the settings service to migrate legacy plaintext rows safely. */
export function encryptLegacySettingSecret(value: string): string | null {
  if (isEncryptedSetting(value)) return value;
  if (!isSettingsSecretEncryptionConfigured()) return null;
  return encryptSettingSecret(value);
}

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AdminError } from './adminContracts';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encodeBase32(value: Buffer): string {
  let bits = 0, buffer = 0, result = '';
  for (const byte of value) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += ALPHABET[(buffer >>> bits) & 31]; } }
  if (bits) result += ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}
export function decodeBase32(value: string): Buffer {
  if (!/^[A-Z2-7]{16,128}$/u.test(value)) throw new AdminError('ADMIN_TOTP_SECRET_INVALID', 503);
  let bits = 0, buffer = 0; const result: number[] = [];
  for (const char of value) { buffer = (buffer << 5) | ALPHABET.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; result.push((buffer >>> bits) & 255); } }
  return Buffer.from(result);
}
/** RFC4226/6238, 64-bit counter, SHA1/6 digits/30s compatible with authenticators. */
export function hotp(key: Buffer, counter: number, digits = 6, algorithm = 'sha1'): string {
  if (!Number.isSafeInteger(counter) || counter < 0 || ![6, 8].includes(digits)) throw new AdminError('ADMIN_TOTP_INPUT_INVALID', 422);
  const moving = Buffer.alloc(8); moving.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(moving).digest(); const offset = digest[digest.length - 1] & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % (10 ** digits)).padStart(digits, '0');
}
export function totp(secret: string, now = Date.now()): string { return hotp(decodeBase32(secret), Math.floor(now / 30000)); }
export function verifyTotp(secret: string, code: string, lastCounter: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const current = Math.floor(now / 30000);
  // Prefer the current window; accepted counters may never be used again.
  for (const offset of [0, -1, 1]) {
    const candidate = current + offset;
    if (candidate < 0 || lastCounter !== null && candidate <= lastCounter) continue;
    if (timingSafeEqual(Buffer.from(hotp(decodeBase32(secret), candidate)), Buffer.from(code))) return candidate;
  }
  return null;
}
function masterKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.ADMIN_2FA_ENC_KEY?.trim() ?? '';
  const key = /^[a-f0-9]{64}$/iu.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new AdminError('ADMIN_2FA_KEY_UNAVAILABLE', 503);
  return key;
}
export function isAdminEncryptionConfigured(env: NodeJS.ProcessEnv = process.env): boolean { try { masterKey(env); return true; } catch { return false; } }
export function encryptAdminSecret(value: string, userId: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', masterKey(env), iv); cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['a1', 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}
export function decryptAdminSecret(value: string, userId: string, env: NodeJS.ProcessEnv = process.env): string {
  const parts = value.split(':'); if (parts.length !== 5 || parts[0] !== 'a1' || parts[1] !== 'v1') throw new AdminError('ADMIN_2FA_CIPHERTEXT_INVALID', 503);
  try { const cipher = createDecipheriv('aes-256-gcm', masterKey(env), Buffer.from(parts[2], 'base64')); cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(Buffer.from(parts[3], 'base64')); return Buffer.concat([cipher.update(Buffer.from(parts[4], 'base64')), cipher.final()]).toString('utf8'); }
  catch (error) { if (error instanceof AdminError) throw error; throw new AdminError('ADMIN_2FA_DECRYPT_FAILED', 503); }
}
export function recoveryHash(userId: string, code: string): string { return createHash('sha256').update(userId + ':' + code.replace(/[-\s]/gu, '').toUpperCase()).digest('hex'); }
export function generateRecoveryCodes(userId: string): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{4}/gu)!.join('-'));
  return { codes, hashes: codes.map(code => recoveryHash(userId, code)) };
}
export function consumeRecoveryCode(userId: string, code: string, hashes: unknown): string[] | null {
  const list: unknown = typeof hashes === 'string' ? JSON.parse(hashes) : hashes;
  if (!Array.isArray(list) || list.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))) throw new AdminError('ADMIN_RECOVERY_DATA_INVALID', 503);
  if (!/^[a-f0-9]{32}$/iu.test(code.replace(/[-\s]/gu, ''))) return null;
  const digest = Buffer.from(recoveryHash(userId, code), 'hex'); let found = -1;
  for (let i = 0; i < list.length; i++) if (timingSafeEqual(digest, Buffer.from(list[i] as string, 'hex'))) found = i;
  return found < 0 ? null : (list as string[]).filter((_, i) => i !== found);
}

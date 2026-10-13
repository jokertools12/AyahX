import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export interface QaBackupProof {
  checked_at: string; mysql_version: string; encryption: string;
  encrypted_path: string; encrypted_sha256: string;
  restored_and_verified: boolean; restored_tables: number;
  row_counts: Record<string, number>; checksums: Record<string, string | null>;
}
export function qaBackupProofPath(args: readonly string[], directory: string): string {
  const index = args.indexOf('--backup');
  if (index < 0) return join(directory, 'batch5-preqa-backup-verified.json');
  const selected = args[index + 1];
  assert.ok(index === args.lastIndexOf('--backup') && selected?.trim() && !selected.startsWith('--'), 'QA_BACKUP_OPTION_INVALID');
  return resolve(selected);
}
export function assertFreshQaBackup(value: unknown, now = Date.now()): QaBackupProof {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'QA_VERIFIED_BACKUP_REQUIRED');
  const proof = value as QaBackupProof;
  assert.equal(proof.restored_and_verified, true, 'QA_VERIFIED_BACKUP_REQUIRED');
  const age = now - Date.parse(proof.checked_at);
  assert.ok(Number.isFinite(age) && age >= 0 && age < 3600000, 'QA_FRESH_BACKUP_REQUIRED');
  assert.equal(proof.mysql_version, '9.7.2', 'QA_RESTORE_MYSQL_VERSION_REQUIRED');
  assert.ok(proof.encryption === 'age X25519' && typeof proof.encrypted_path === 'string' && isAbsolute(proof.encrypted_path) && proof.encrypted_path.endsWith('.age') && /^[a-f0-9]{64}$/u.test(proof.encrypted_sha256), 'QA_ENCRYPTED_BACKUP_REQUIRED');
  assert.ok(proof.row_counts && typeof proof.row_counts === 'object' && !Array.isArray(proof.row_counts) && proof.checksums && typeof proof.checksums === 'object' && !Array.isArray(proof.checksums), 'QA_BACKUP_INVENTORY_REQUIRED');
  const tables = Object.keys(proof.row_counts).sort();
  assert.ok(Number.isSafeInteger(proof.restored_tables) && proof.restored_tables > 0 && tables.length === proof.restored_tables && JSON.stringify(Object.keys(proof.checksums).sort()) === JSON.stringify(tables) && tables.every(table => Number.isSafeInteger(proof.row_counts[table]) && proof.row_counts[table] >= 0 && (proof.checksums[table] === null || typeof proof.checksums[table] === 'string' && /^\d+$/u.test(proof.checksums[table]!))), 'QA_BACKUP_INVENTORY_REQUIRED');
  assert.ok(['users', 'user_roles'].every(table => tables.includes(table) && proof.checksums[table] !== null), 'QA_BACKUP_INVENTORY_REQUIRED');
  return proof;
}
/** Verify encrypted bytes only; never decrypt, read a key or emit backup values. */
export async function readFreshQaBackup(path: string, now: () => number = Date.now): Promise<QaBackupProof> {
  const proof = assertFreshQaBackup(JSON.parse(await readFile(path, 'utf8')), now());
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(proof.encrypted_path)) hash.update(bytes);
  assert.equal(hash.digest('hex'), proof.encrypted_sha256, 'QA_BACKUP_ARCHIVE_SHA_MISMATCH');
  // A large archive read must not carry an almost-expired proof over the limit.
  return assertFreshQaBackup(proof, now());
}

// @vitest-environment node
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { assertFreshQaBackup, qaBackupProofPath, readFreshQaBackup } from '../../scripts/lib/temporaryAdminQaBackup';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node:fs', () => ({ createReadStream: vi.fn() }));

const now = Date.parse('2026-10-13T12:00:00.000Z');
const privateDirectory = join(tmpdir(), 'owned-qa-backup-unit');
const archiveBytes = Buffer.from('owned unit archive boundary only');
const proof = () => ({
  checked_at: new Date(now - 1000).toISOString(), mysql_version: '9.7.2', encryption: 'age X25519',
  encrypted_path: join(privateDirectory, 'backup.sql.age'), encrypted_sha256: createHash('sha256').update(archiveBytes).digest('hex'),
  restored_and_verified: true, restored_tables: 2, row_counts: { users: 1, user_roles: 1 }, checksums: { users: '17', user_roles: '18' },
});

describe('temporary admin QA verified backup selection', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserves the private default while accepting an explicit fresh proof path', () => {
    expect(qaBackupProofPath(['create', '--confirm-production', '--apply'], privateDirectory)).toBe(join(privateDirectory, 'batch5-preqa-backup-verified.json'));
    const selected = join(privateDirectory, 'new-preqa-proof.json');
    expect(qaBackupProofPath(['create', '--backup', selected, '--confirm-production', '--apply'], privateDirectory)).toBe(resolve(selected));
  });

  it('rejects missing, flag-shaped or ambiguous explicit backup option values', () => {
    for (const args of [['create', '--backup'], ['create', '--backup', '--apply'], ['create', '--backup', 'one.json', '--backup', 'two.json']]) {
      expect(() => qaBackupProofPath(args, privateDirectory)).toThrow('QA_BACKUP_OPTION_INVALID');
    }
  });

  it('accepts a freshly restored encrypted MySQL 9.7.2 proof', () => {
    expect(assertFreshQaBackup(proof(), now)).toMatchObject({ restored_and_verified: true, mysql_version: '9.7.2' });
  });

  it('rejects stale, future and invalid freshness timestamps', () => {
    for (const checked_at of [new Date(now - 3600000).toISOString(), new Date(now + 1).toISOString(), 'invalid']) {
      expect(() => assertFreshQaBackup({ ...proof(), checked_at }, now)).toThrow('QA_FRESH_BACKUP_REQUIRED');
    }
  });

  it('rejects unverified, plaintext and malformed archive proof metadata', () => {
    for (const changed of [{ restored_and_verified: false }, { mysql_version: '8.0' }, { encryption: 'none' }, { encrypted_path: 'relative.sql.age' }, { encrypted_path: join(privateDirectory, 'plaintext.sql') }, { encrypted_sha256: 'invalid' }]) {
      expect(() => assertFreshQaBackup({ ...proof(), ...changed }, now)).toThrow();
    }
  });

  it('requires the complete restored row-count and checksum inventory', () => {
    for (const changed of [{ restored_tables: 3 }, { checksums: { users: '17' } }, { row_counts: { users: -1, user_roles: 1 } }, { checksums: { users: null, user_roles: '18' } }]) {
      expect(() => assertFreshQaBackup({ ...proof(), ...changed }, now)).toThrow('QA_BACKUP_INVENTORY_REQUIRED');
    }
  });

  it('streams the explicitly selected archive to bind its bytes to the verified proof', async () => {
    const expected = proof(), selected = join(privateDirectory, 'new-preqa-proof.json');
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(expected));
    vi.mocked(createReadStream).mockReturnValue(Readable.from([archiveBytes.subarray(0, 5), archiveBytes.subarray(5)]) as ReturnType<typeof createReadStream>);
    await expect(readFreshQaBackup(selected, () => now)).resolves.toMatchObject({ encrypted_sha256: expected.encrypted_sha256 });
    expect(readFile).toHaveBeenCalledWith(selected, 'utf8');
    expect(createReadStream).toHaveBeenCalledWith(expected.encrypted_path);
  });

  it('rejects a replaced encrypted archive instead of trusting a previous proof boolean', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(proof()));
    vi.mocked(createReadStream).mockReturnValue(Readable.from([Buffer.from('different owned bytes')]) as ReturnType<typeof createReadStream>);
    await expect(readFreshQaBackup(join(privateDirectory, 'proof.json'), () => now)).rejects.toThrow('QA_BACKUP_ARCHIVE_SHA_MISMATCH');
  });

  it('rechecks freshness after reading the archive and rejects expiry during verification', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(proof()));
    vi.mocked(createReadStream).mockReturnValue(Readable.from([archiveBytes]) as ReturnType<typeof createReadStream>);
    const clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now + 3600000);
    await expect(readFreshQaBackup(join(privateDirectory, 'proof.json'), clock)).rejects.toThrow('QA_FRESH_BACKUP_REQUIRED');
  });
});

// @vitest-environment node
// Clock/archive/session doubles only. No SSH, MySQL, browser or service calls.
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFreshQaBackup } from '../../scripts/lib/temporaryAdminQaBackup';
import { executeAdminWorkspaceMigration } from '../../scripts/lib/adminWorkspaceMigrationProof';
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node:fs', () => ({ createReadStream: vi.fn() }));
const now = Date.parse('2026-10-13T12:00:00Z'), bytes = Buffer.from('owned unit archive bytes, not a database dump');
function fixture(ageMs = 3599000) {
  const proof = { checked_at: new Date(now - ageMs).toISOString(), mysql_version: '9.7.2', encryption: 'age X25519', encrypted_path: join(tmpdir(), 'owned-backup-unit.age'), encrypted_sha256: createHash('sha256').update(bytes).digest('hex'), restored_and_verified: true, restored_tables: 2, row_counts: { users: 1, user_roles: 1 }, checksums: { users: '17', user_roles: '18' } };
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(proof)); vi.mocked(createReadStream).mockReturnValue(Readable.from([bytes]) as ReturnType<typeof createReadStream>);
  const session = { executeStatements: vi.fn(async () => {}), commit: vi.fn(async () => {}) };
  return { proof, session, sql: ['ALTER TABLE owned_unit ADD COLUMN nullable_value INT DEFAULT NULL'] };
}
describe('migration008 backup freshness at the actual write boundary', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects a backup that crosses one hour during archive verification before any DDL', async () => {
    const f = fixture(), clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now + 2000);
    const operation = async () => { const proof = await readFreshQaBackup('/private/owned-proof.json', clock); await executeAdminWorkspaceMigration(f.session, f.sql, proof, () => now + 2000); };
    await expect(operation()).rejects.toThrow('QA_FRESH_BACKUP_REQUIRED'); expect(clock).toHaveBeenCalledTimes(2); expect(f.session.executeStatements).not.toHaveBeenCalled(); expect(f.session.commit).not.toHaveBeenCalled();
  });
  it('rejects a backup that was fresh after hashing but expired during read-only inventory/projection preflight', async () => {
    const f = fixture(), proof = await readFreshQaBackup('/private/owned-proof.json', () => now);
    await expect(executeAdminWorkspaceMigration(f.session, f.sql, proof, () => now + 2000)).rejects.toThrow('QA_FRESH_BACKUP_REQUIRED'); expect(f.session.executeStatements).not.toHaveBeenCalled(); expect(f.session.commit).not.toHaveBeenCalled();
  });
  it('preserves the deterministic DDL and commit when both archive verification and the write boundary are fresh', async () => {
    const f = fixture(1000), proof = await readFreshQaBackup('/private/owned-proof.json', () => now);
    await executeAdminWorkspaceMigration(f.session, f.sql, proof, () => now + 10000);
    expect(f.session.executeStatements).toHaveBeenCalledExactlyOnceWith([{ sql: f.sql[0] + ';', rowCount: 0 }]); expect(f.session.commit).toHaveBeenCalledOnce();
  });
});

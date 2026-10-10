/** Reuse an existing encrypted, verified backup. Never writes to Railway. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { identifier } from './lib/railwayQuranOps';

const option = (name: string): string => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`OPTION_REQUIRED:${name}`);
  return process.argv[i + 1];
};
const database = option('--db-name');
assert.match(database, /^ayahx_d2_[a-z0-9_]+$/u);
const backup = JSON.parse(await readFile(option('--backup'), 'utf8')) as {
  encrypted_path: string; encrypted_sha256: string; plaintext_sha256: string;
  restored_and_verified: boolean; mysql_version: string;
  row_counts: Record<string, number>; checksums: Record<string, string | null>;
};
assert.equal(backup.restored_and_verified, true);
assert.equal(backup.mysql_version, '9.7.2');
assert.equal(createHash('sha256').update(await readFile(backup.encrypted_path)).digest('hex'), backup.encrypted_sha256);
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', charset: 'utf8mb4' });
const complete = (child: ReturnType<typeof spawn>, label: string): Promise<void> => {
  child.stderr?.resume();
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(`${label}_START_FAILED`)));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${label}_EXIT_${code}`)));
  });
};
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() AS version, @@datadir AS datadir');
  assert.equal(version[0].version, '9.7.2');
  const [existing] = await db.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  assert.equal(existing.length, 0, 'LOCAL_RESTORE_NAME_COLLISION');
  await db.query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const decrypt = spawn(option('--age'), ['-d', '-i', option('--key'), backup.encrypted_path], { stdio: ['ignore', 'pipe', 'pipe'] });
  const restore = spawn(option('--mysql'), ['--host=127.0.0.1', '--port=33319', '--user=root', '--default-character-set=utf8mb4', database], { stdio: ['pipe', 'ignore', 'pipe'] });
  const hash = createHash('sha256');
  let streamFailed = false;
  restore.stdin.on('error', () => { streamFailed = true; });
  decrypt.stdout.on('data', (bytes: Buffer) => hash.update(bytes));
  decrypt.stdout.pipe(restore.stdin);
  await Promise.all([complete(decrypt, 'AGE_DECRYPT'), complete(restore, 'MYSQL_RESTORE')]);
  assert.equal(streamFailed, false, 'LOCAL_RESTORE_STREAM_FAILED');
  assert.equal(hash.digest('hex'), backup.plaintext_sha256, 'DECRYPTED_BACKUP_HASH_MISMATCH');
  await db.query(`USE ${identifier(database)}`);
  const rowCounts: Record<string, number> = {};
  const checksums: Record<string, string | null> = {};
  for (const table of Object.keys(backup.row_counts)) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${identifier(table)}`);
    const [sums] = await db.query<RowDataPacket[]>(`CHECKSUM TABLE ${identifier(table)}`);
    rowCounts[table] = Number(rows[0].count);
    checksums[table] = sums[0].Checksum === null ? null : String(sums[0].Checksum);
    assert.equal(rowCounts[table], backup.row_counts[table], `RESTORE_COUNT_MISMATCH:${table}`);
    assert.equal(checksums[table], backup.checksums[table], `RESTORE_CHECKSUM_MISMATCH:${table}`);
  }
  const report = { checked_at: new Date().toISOString(), existing_archive_reused: true, mysql_version: version[0].version,
    datadir: version[0].datadir, database, restored_and_verified: true, restored_tables: Object.keys(rowCounts).length,
    encrypted_sha256: backup.encrypted_sha256, plaintext_sha256: backup.plaintext_sha256, row_counts: rowCounts, checksums,
    plaintext_written_to_disk: false, railway_writes: 0 };
  await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ restored_and_verified: true, restored_tables: report.restored_tables, mysql_version: report.mysql_version, railway_writes: 0 }));
} finally { await db.end(); }

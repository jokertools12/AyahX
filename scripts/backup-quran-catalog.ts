import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { railwayBinary, railwayEnv, sshArgs, ENVIRONMENTS, identifier, type Inventory } from './lib/railwayQuranOps';

const option = (name: string): string => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`REQUIRED_OPTION:${name}`);
  return process.argv[index + 1];
};
const age = option('--age');
const key = resolve(option('--key'));
const archive = resolve(option('--archive'));
const localMysql = option('--mysql');
const database = option('--db-name');
const root = resolve(process.cwd()).toLowerCase();
if (!isAbsolute(archive) || archive.toLowerCase().startsWith(root) || key.toLowerCase().startsWith(root) || !database.startsWith('ayahx_d2_')) throw new Error('PRIVATE_BACKUP_PATH_AND_LOCAL_DATABASE_REQUIRED');
const existingArchive = await stat(archive).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
if (existingArchive) throw new Error('BACKUP_ARCHIVE_EXISTS; choose a new path to preserve the verified copy');
const inventory = JSON.parse(await readFile(option('--inventory'), 'utf8')) as Inventory;
if (inventory.environment_id !== ENVIRONMENTS.production || inventory.mysql_version !== '9.7.2') throw new Error('VERIFIED_PRODUCTION_INVENTORY_REQUIRED');

function completion(child: ReturnType<typeof spawn>, label: string): Promise<void> {
  child.stderr?.resume();
  return new Promise((accept, reject) => {
    child.once('error', () => reject(new Error(`${label}_START_FAILED`)));
    child.once('close', (code) => code === 0 ? accept() : reject(new Error(`${label}_EXIT_${code}`)));
  });
}
// Official age recipient/identity workflow: https://github.com/FiloSottile/age#usage
const recipientProcess = spawn(age.replace(/age\.exe$/u, 'age-keygen.exe'), ['-y', key], { stdio: ['ignore', 'pipe', 'pipe'] });
const recipientParts: Buffer[] = [];
recipientProcess.stdout.on('data', (data: Buffer) => recipientParts.push(data));
await completion(recipientProcess, 'AGE_RECIPIENT');
const recipient = Buffer.concat(recipientParts).toString('utf8').trim();
const dump = spawn(railwayBinary, sshArgs(ENVIRONMENTS.production,
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --triggers --events --no-tablespaces --skip-comments --hex-blob --set-gtid-purged=OFF "$MYSQL_DATABASE"'), { env: railwayEnv, stdio: ['ignore', 'pipe', 'pipe'] });
const encrypted = spawn(age, ['-r', recipient, '-o', archive], { stdio: ['pipe', 'ignore', 'pipe'] });
let streamFailed = false;
encrypted.stdin.on('error', () => { streamFailed = true; });
const hash = createHash('sha256');
let bytes = 0;
dump.stdout.on('data', (data: Buffer) => { hash.update(data); bytes += data.length; });
dump.stdout.pipe(encrypted.stdin);
await Promise.all([completion(dump, 'MYSQLDUMP'), completion(encrypted, 'AGE_ENCRYPT')]);
if (streamFailed || bytes < 1000) throw new Error('ENCRYPTED_BACKUP_STREAM_INCOMPLETE');
const plaintextHash = hash.digest('hex');

const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', charset: 'utf8mb4' });
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() AS version');
  if (version[0].version !== '9.7.2') throw new Error('LOCAL_MYSQL_9_7_2_REQUIRED');
  await db.query(`CREATE DATABASE IF NOT EXISTS ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const decrypt = spawn(age, ['-d', '-i', key, archive], { stdio: ['ignore', 'pipe', 'pipe'] });
  const restore = spawn(localMysql, ['--host=127.0.0.1', '--port=33319', '--user=root', '--default-character-set=utf8mb4', database], { stdio: ['pipe', 'ignore', 'pipe'] });
  const restoredHash = createHash('sha256');
  restore.stdin.on('error', () => { streamFailed = true; });
  decrypt.stdout.on('data', (data: Buffer) => restoredHash.update(data));
  decrypt.stdout.pipe(restore.stdin);
  await Promise.all([completion(decrypt, 'AGE_DECRYPT'), completion(restore, 'MYSQL_RESTORE')]);
  if (streamFailed || restoredHash.digest('hex') !== plaintextHash) throw new Error('BACKUP_DECRYPTION_HASH_MISMATCH');
  await db.query(`USE ${identifier(database)}`);
  const counts: Record<string, number> = {};
  const checksums: Record<string, string | null> = {};
  for (const { name } of inventory.tables) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${identifier(name)}`);
    counts[name] = Number(rows[0].count);
    const [sums] = await db.query<RowDataPacket[]>(`CHECKSUM TABLE ${identifier(name)}`);
    checksums[name] = sums[0].Checksum === null ? null : String(sums[0].Checksum);
    if (counts[name] !== inventory.row_counts[name] || checksums[name] !== inventory.checksums[name]) throw new Error(`RESTORE_COUNT_OR_CHECKSUM_MISMATCH:${name}`);
  }
  const report = { checked_at: new Date().toISOString(), mysql_version: '9.7.2', encrypted_path: archive, encryption: 'age X25519', plaintext_bytes: bytes, plaintext_sha256: plaintextHash,
    encrypted_sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), restored_and_verified: true, restored_tables: inventory.tables.length, row_counts: counts, checksums, database };
  await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ restored_and_verified: true, tables: inventory.tables.length, encryption: report.encryption, bytes }));
} finally {
  await db.end();
}

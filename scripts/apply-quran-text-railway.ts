import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { QURAN_TEXT_TABLES } from '../server/db/migrations/001_addQuranTextTables';
import { checksumText, type QuranTextCorpus } from '../server/services/quranTextImport';
import { generateQuranTextSql } from '../server/services/quranTextSql';

interface Inventory {
  scope: string; project_id: string; environment_id: string; service_id: string;
  settings: { database_name: string; server_uuid: string; mysql_version: string };
  critical_counts: Record<string, number | null>;
}
interface Snapshot {
  database: string; server_uuid: string; version: string;
  critical: Record<string, number | null>; existing: string[];
  columns: Array<{ table: string; column: string; charset: string; collation: string }>;
}
const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const load = async <T>(name: string): Promise<T> => {
  const path = option(name);
  if (!path) throw new Error(`REQUIRED_OPTION:${name}`);
  return JSON.parse(await readFile(path, 'utf8')) as T;
};
const identifier = (value: string): string => {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error('UNSAFE_SQL_IDENTIFIER');
  return `\`${value}\``;
};

async function ssh(inventory: Inventory, command: string, input?: string): Promise<string> {
  const binary = process.platform === 'win32'
    ? join(process.env.APPDATA || '', 'npm/node_modules/@railway/cli/bin/railway.exe') : 'railway';
  const child = spawn(binary, ['ssh', '--project', inventory.project_id, '--environment', inventory.environment_id,
    '--service', inventory.service_id, '--', command], {
    env: { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.2.6', RAILWAY_AGENT_SESSION: 'ayahx-d1-d2-20261009' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output: Buffer[] = [];
  // CLI diagnostics can contain SQL values: never print secret-bearing stderr.
  const errors: Buffer[] = [];
  child.stdout.on('data', (data: Buffer) => output.push(data));
  child.stderr.on('data', (data: Buffer) => errors.push(data));
  let stdinFailed = false;
  child.stdin.on('error', () => { stdinFailed = true; });
  const completed = new Promise<void>((accept, reject) => {
    child.once('error', () => reject(new Error('RAILWAY_SSH_PROCESS_FAILED')));
    child.once('close', (code) => code === 0 ? accept() : reject(new Error(`RAILWAY_SSH_EXIT_${code}`)));
  });
  child.stdin.end(input);
  await completed;
  if (stdinFailed) throw new Error('RAILWAY_SSH_STDIN_WRITE_FAILED');
  const text = Buffer.concat(output).toString('utf8');
  if (text.includes('ERROR ')) throw new Error('REMOTE_MYSQL_REPORTED_ERROR');
  return text;
}

function mysqlCommand(inventory: Inventory): string {
  identifier(inventory.settings.database_name);
  return `test "$MYSQL_DATABASE" = '${inventory.settings.database_name}' && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --default-character-set=utf8mb4 --batch --raw --skip-column-names -u root "$MYSQL_DATABASE"`;
}
async function readSql(inventory: Inventory, sql: string): Promise<string> {
  const payload = Buffer.from(sql, 'utf8').toString('base64');
  return ssh(inventory, `set -o pipefail; printf %s '${payload}' | base64 -d | (${mysqlCommand(inventory)})`);
}

async function snapshot(inventory: Inventory): Promise<Snapshot> {
  const critical = Object.entries(inventory.critical_counts).map(([table, count]) =>
    `'${table}',${count === null ? 'NULL' : `(SELECT COUNT(*) FROM ${identifier(table)})`}`).join(',');
  const tables = QURAN_TEXT_TABLES.map((table) => `'${table}'`).join(',');
  const result = await readSql(inventory, `SELECT JSON_OBJECT('database',DATABASE(),'server_uuid',@@server_uuid,'version',VERSION(),
    'critical',JSON_OBJECT(${critical}),
    'existing',(SELECT COALESCE(JSON_ARRAYAGG(TABLE_NAME),JSON_ARRAY()) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables})),
    'columns',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME)),JSON_ARRAY())
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables}) AND CHARACTER_SET_NAME IS NOT NULL));`);
  const line = result.split(/\r?\n/u).find((value) => value.startsWith('{'));
  if (!line) throw new Error('REMOTE_SNAPSHOT_MISSING');
  return JSON.parse(line) as Snapshot;
}

async function main(): Promise<void> {
  const target = option('--target');
  if (!['railway-production', 'railway-staging'].includes(target)) throw new Error('EXPLICIT_RAILWAY_TARGET_REQUIRED');
  const apply = process.argv.includes('--apply');
  if (apply && target === 'railway-production' && !process.argv.includes('--confirm-production')) throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
  const inventory = await load<Inventory>('--inventory');
  const expectedEnvironment = target === 'railway-production' ? 'c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6' : 'e726848b-49ec-45ab-bce8-a1462dd85bc8';
  if (inventory.project_id !== '6394b364-57bc-4736-8ce1-10dcf382c1e5' || inventory.service_id !== '2b03e60f-d2fc-446c-b278-f340d472dfd4'
    || inventory.environment_id !== expectedEnvironment) throw new Error('RAILWAY_CONTEXT_NOT_APPROVED');
  const corpus = await load<QuranTextCorpus>('--corpus');
  const plan = generateQuranTextSql(corpus);
  const sqlPath = option('--sql');
  if (!sqlPath || checksumText(await readFile(sqlPath, 'utf8')) !== plan.sha256) throw new Error('SQL_FILE_DIFFERS_FROM_DETERMINISTIC_PLAN');
  const backup = await load<{ restored_and_verified: boolean }>('--backup-verification');
  const rehearsal = await load<{ mysql: string; existingTableJoin: boolean; corruptionRejected: boolean; reapplyAfterRollback: boolean }>('--rehearsal-report');
  if (!backup.restored_and_verified || rehearsal.mysql !== '9.7.2' || !rehearsal.existingTableJoin || !rehearsal.corruptionRejected || !rehearsal.reapplyAfterRollback) throw new Error('BACKUP_AND_REHEARSAL_EVIDENCE_REQUIRED');
  if (target === 'railway-staging') {
    const production = await load<Inventory>('--production-inventory');
    if (production.settings.server_uuid === inventory.settings.server_uuid) throw new Error('STAGING_IS_NOT_SEPARATE_FROM_PRODUCTION');
  }
  const before = await snapshot(inventory);
  if (before.database !== inventory.settings.database_name || before.server_uuid !== inventory.settings.server_uuid
    || before.version !== inventory.settings.mysql_version || !/^9\.7\./u.test(before.version)) throw new Error('LIVE_DATABASE_IDENTITY_CHANGED');
  for (const [table, count] of Object.entries(inventory.critical_counts)) {
    if (before.critical[table] !== count) throw new Error(`PRE_APPLY_CRITICAL_COUNT_CHANGED:${table}`);
  }
  if (before.existing.length && !(target === 'railway-staging' && process.argv.includes('--replay-verified-staging'))) throw new Error('D1_TABLE_NAME_COLLISION_STOP');
  const report = { target, database: before.database, mysql: before.version, dryRun: !apply, creates: QURAN_TEXT_TABLES.length,
    ...plan.counts, checksum: corpus.checksum, sql_sha256: plan.sha256, batch_size: plan.batchSize, statements: plan.statements };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  // One mysql process/connection consumes the complete stdin plan. The source
  // password is resolved inside the service and never reaches this process.
  const applied = await ssh(inventory, mysqlCommand(inventory), `SELECT DATABASE();\n${plan.sql}`);
  if (applied.split(/\r?\n/u)[0] !== before.database) throw new Error('APPLIED_DATABASE_CONFIRMATION_FAILED');
  const after = await snapshot(inventory);
  for (const [table, count] of Object.entries(before.critical)) {
    if (after.critical[table] !== count) throw new Error(`POST_APPLY_CRITICAL_COUNT_CHANGED:${table}`);
  }
  if (after.existing.length !== QURAN_TEXT_TABLES.length || after.columns.length !== 35) throw new Error('D1_SCHEMA_INCOMPLETE');
  for (const column of after.columns) {
    if (column.charset !== 'utf8mb4' || column.collation !== (column.column === 'text_uthmani' ? 'utf8mb4_bin' : 'utf8mb4_unicode_ci')) throw new Error(`POST_APPLY_COLLATION_MISMATCH:${column.table}.${column.column}`);
  }
  const text = await readSql(inventory, 'SELECT surah,ayah,text_uthmani FROM quran_ayahs ORDER BY surah,ayah;');
  const textLines = text.trimEnd().split(/\r?\n/u).map((line) => {
    const [surah, ayah, ...words] = line.split('\t');
    return `${surah}:${ayah}\t${words.join('\t')}`;
  });
  if (checksumText(textLines.join('\n')) !== corpus.checksum) throw new Error('POST_APPLY_CANONICAL_CHECKSUM_MISMATCH');
  const wordText = await readSql(inventory, `SELECT a.surah,a.ayah,w.position,w.text_uthmani FROM quran_words w JOIN quran_ayahs a ON a.id=w.ayah_id ORDER BY a.surah,a.ayah,w.position;`);
  const wordLines = wordText.trimEnd().split(/\r?\n/u).map((line) => {
    const [surah, ayah, position, ...words] = line.split('\t');
    return `${surah}:${ayah}:${position}\t${words.join('\t')}`;
  });
  const expectedWords = corpus.ayahs.flatMap((row) => row.words.map((word, index) => `${row.surah}:${row.ayah}:${index + 1}\t${word}`));
  if (wordLines.length !== corpus.wordCount || checksumText(wordLines.join('\n')) !== checksumText(expectedWords.join('\n'))) throw new Error('POST_APPLY_WORDS_CHECKSUM_MISMATCH');
  const countsRaw = await readSql(inventory, 'SELECT JSON_OBJECT(\'surahs\',(SELECT COUNT(*) FROM quran_surahs),\'ayahs\',(SELECT COUNT(*) FROM quran_ayahs),\'words\',(SELECT COUNT(*) FROM quran_words));');
  const counts = JSON.parse(countsRaw.trim()) as typeof plan.counts;
  if (counts.surahs !== plan.counts.surahs || counts.ayahs !== plan.counts.ayahs || counts.words !== plan.counts.words) throw new Error('POST_APPLY_COUNTS_MISMATCH');
  const final = { ...report, verified: true, counts, canonical_checksum_verified: true, words_checksum_verified: true,
    critical_counts_before: before.critical, critical_counts_after: after.critical, collations: after.columns, checked_at: new Date().toISOString() };
  if (option('--out')) await writeFile(resolve(option('--out')), JSON.stringify(final, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ verified: true, counts, critical_counts_unchanged: true, canonical_checksum_verified: true }));
}

main().catch((error: unknown) => {
  // Fixed operational messages above contain no credentials or personal rows.
  console.error(error instanceof Error ? error.message : 'RAILWAY_OPERATION_FAILED');
  process.exitCode = 1;
});

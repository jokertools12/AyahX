import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { checksumText } from '../../server/services/quranTextImport';

export const PROJECT = '6394b364-57bc-4736-8ce1-10dcf382c1e5';
export const MYSQL_SERVICE = '2b03e60f-d2fc-446c-b278-f340d472dfd4';
export const ENVIRONMENTS = { production: 'c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6', staging: 'e726848b-49ec-45ab-bce8-a1462dd85bc8' };
export const railwayBinary = process.platform === 'win32' ? join(process.env.APPDATA || '', 'npm/node_modules/@railway/cli/bin/railway.exe') : 'railway';
export const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.6.1', RAILWAY_AGENT_SESSION: 'ayahx-d2-20261009' };
export function identifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error('UNSAFE_SQL_IDENTIFIER');
  return `\`${value}\``;
}
export function sshArgs(environment: string, command: string): string[] {
  if (!Object.values(ENVIRONMENTS).includes(environment)) throw new Error('ENVIRONMENT_NOT_APPROVED');
  return ['ssh', '--project', PROJECT, '--environment', environment, '--service', MYSQL_SERVICE, '--', command];
}
export async function ssh(environment: string, command: string, input?: string): Promise<string> {
  const child = spawn(railwayBinary, sshArgs(environment, command), { env: railwayEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const output: Buffer[] = [];
  child.stdout.on('data', (bytes: Buffer) => output.push(bytes));
  // Keep only a bounded in-memory diagnostic. Never print raw SQL, URLs,
  // credentials or service output; expose fixed connection/MySQL error codes.
  let diagnostic = '';
  child.stderr.on('data', (bytes: Buffer) => { diagnostic = (diagnostic + bytes.toString('utf8')).slice(0, 8192); });
  let stdinError = false;
  child.stdin.on('error', () => { stdinError = true; });
  const done = new Promise<void>((accept, reject) => {
    child.once('error', () => reject(new Error('RAILWAY_SSH_START_FAILED')));
    child.once('close', (code) => {
      if (code === 0) { accept(); return; }
      const mysqlError = /ERROR (\d+) \(([A-Z0-9]+)\)/u.exec(diagnostic);
      const reason = diagnostic.includes('Maximum SSH connections reached for this service') ? ':SSH_CONNECTION_LIMIT'
        : mysqlError ? `:MYSQL_ERROR_${mysqlError[1]}_${mysqlError[2]}` : '';
      reject(new Error(`RAILWAY_SSH_EXIT_${code}${reason}`));
    });
  });
  child.stdin.end(input);
  await done;
  if (stdinError) throw new Error('RAILWAY_STDIN_FAILED');
  return Buffer.concat(output).toString('utf8');
}
export const mysqlCommand = 'test "$MYSQL_DATABASE" = railway && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --default-character-set=utf8mb4 --batch --raw --skip-column-names -u root "$MYSQL_DATABASE"';
export async function readSql(environment: string, sql: string): Promise<string> {
  // Read helpers never accept DDL/DML. Encoded transport is quoting, not secrecy.
  if (!/^\s*(SELECT|SHOW|CHECKSUM)\b/iu.test(sql) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|RENAME|TRUNCATE|INTO\s+OUTFILE)\b/iu.test(sql)) throw new Error('READ_ONLY_SQL_REQUIRED');
  return ssh(environment, `set -o pipefail; printf %s '${Buffer.from(sql).toString('base64')}' | base64 -d | (${mysqlCommand})`);
}
export interface Inventory {
  environment_id: string; database: string; server_uuid: string; mysql_version: string;
  settings: Record<string, unknown>;
  tables: Array<{ name: string; collation: string; engine: string; row_format: string }>;
  columns: Array<{ table: string; column: string; type: string; charset: string | null; collation: string | null }>;
  foreign_keys: Array<{ table: string; column: string; referenced: string }>;
  triggers: unknown[]; events: unknown[]; critical_counts: Record<string, number | null>;
  row_counts: Record<string, number>; checksums: Record<string, string | null>;
  canonical_checksum: string; d1_counts: { surahs: number; ayahs: number; words: number }; checked_at: string;
}
export async function captureInventory(environment: string): Promise<Inventory> {
  const raw = await readSql(environment, `SELECT JSON_OBJECT('database',DATABASE(),'server_uuid',@@server_uuid,'mysql_version',VERSION(),
    'settings',JSON_OBJECT('sql_mode',@@sql_mode,'collation_server',@@collation_server,'character_set_server',@@character_set_server,'max_connections',@@max_connections,'max_allowed_packet',@@max_allowed_packet,'time_zone',@@time_zone,'system_time_zone',@@system_time_zone),
    'tables',(SELECT JSON_ARRAYAGG(JSON_OBJECT('name',TABLE_NAME,'collation',TABLE_COLLATION,'engine',ENGINE,'row_format',ROW_FORMAT)) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()),
    'columns',(SELECT JSON_ARRAYAGG(JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'type',COLUMN_TYPE,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME)) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()),
    'foreign_keys',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'referenced',REFERENCED_TABLE_NAME)),JSON_ARRAY()) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL),
    'triggers',(SELECT COALESCE(JSON_ARRAYAGG(TRIGGER_NAME),JSON_ARRAY()) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()),
    'events',(SELECT COALESCE(JSON_ARRAYAGG(EVENT_NAME),JSON_ARRAY()) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()));`);
  const inventory = JSON.parse(raw.trim()) as Inventory;
  if (inventory.database !== 'railway' || inventory.mysql_version !== '9.7.2') throw new Error('DATABASE_IDENTITY_OR_VERSION_MISMATCH');
  const counts = await readSql(environment, inventory.tables.map(({ name }) => `SELECT '${name}',COUNT(*) FROM ${identifier(name)}`).join(' UNION ALL ') + ';');
  inventory.row_counts = Object.fromEntries(counts.trim().split(/\r?\n/u).map((line) => { const [name, count] = line.split('\t'); return [name, Number(count)]; }));
  const checksums = await readSql(environment, `CHECKSUM TABLE ${inventory.tables.map(({ name }) => identifier(name)).join(',')};`);
  inventory.checksums = Object.fromEntries(checksums.trim().split(/\r?\n/u).map((line) => { const [name, sum] = line.split('\t'); return [name.split('.').pop(), sum === 'NULL' ? null : sum]; }));
  inventory.critical_counts = Object.fromEntries(['users', 'subscriptions', 'plans', 'payment_requests', 'videos', 'saved_videos', 'render_jobs', 'system_settings', 'user_roles', 'notifications'].map((name) => [name, inventory.row_counts[name] ?? null]));
  const text = await readSql(environment, 'SELECT surah,ayah,text_uthmani FROM quran_ayahs ORDER BY surah,ayah;');
  inventory.canonical_checksum = checksumText(text.trimEnd().split(/\r?\n/u).map((line) => { const [surah, ayah, ...words] = line.split('\t'); return `${surah}:${ayah}\t${words.join('\t')}`; }).join('\n'));
  inventory.d1_counts = { surahs: inventory.row_counts.quran_surahs, ayahs: inventory.row_counts.quran_ayahs, words: inventory.row_counts.quran_words };
  inventory.environment_id = environment;
  inventory.checked_at = new Date().toISOString();
  return inventory;
}

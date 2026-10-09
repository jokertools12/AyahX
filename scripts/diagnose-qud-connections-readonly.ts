/** Read-only snapshots; no KILL, configuration changes, or database writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ENVIRONMENTS, readSql } from './lib/railwayQuranOps';

const option = (name: string): string => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`OPTION_REQUIRED:${name}`);
  return process.argv[index + 1];
};
const target = option('--target');
if (target !== 'staging' && target !== 'production') throw new Error('EXPLICIT_ENVIRONMENT_REQUIRED');
const environment = ENVIRONMENTS[target];
const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');
const sql = `SELECT JSON_OBJECT('database',DATABASE(),'mysql_version',VERSION(),'server_uuid',@@server_uuid,'connection_id',CONNECTION_ID());
SELECT 'D2_PROCESSLIST';
SHOW PROCESSLIST;
SELECT 'D2_STATUS';
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Max_used_connections','Aborted_clients','Aborted_connects','Connection_errors_max_connections');`;

async function snapshot() {
  const rows = (await readSql(environment, sql)).trim().split(/\r?\n/u);
  const identity = JSON.parse(rows.shift()!) as { database: string; mysql_version: string; server_uuid: string; connection_id: number };
  assert.equal(identity.database, 'railway');
  assert.equal(identity.mysql_version, '9.7.2');
  assert.equal(rows.shift(), 'D2_PROCESSLIST');
  const marker = rows.indexOf('D2_STATUS');
  assert.ok(marker >= 0, 'PROCESSLIST_SECTION_MISSING');
  const processes = rows.splice(0, marker).map((line) => {
    const [id, user, host, database, command, time, state, ...info] = line.split('\t');
    const text = info.join('\t');
    return {
      id: Number(id), own_diagnostic: Number(id) === identity.connection_id,
      user_category: ['root', 'event_scheduler', 'system user'].includes(user) ? user : 'other',
      host_category: /^localhost(?::|$)/u.test(host) ? 'local' : 'remote', host_fingerprint: fingerprint(host),
      database_category: database === 'railway' ? 'railway' : database === 'NULL' ? null : 'other',
      command, idle_or_running_seconds: Number(time), state_fingerprint: fingerprint(state),
      operation: text === 'NULL' ? null : /^(SELECT|SHOW|INSERT|UPDATE|DELETE|CREATE|ALTER|CHECKSUM)\b/iu.exec(text.trim())?.[1].toUpperCase() ?? 'other',
      mentions_d2_tables: /\b(reciters|recitations|recitation_chapters|audio_providers)\b/iu.test(text),
    };
  });
  assert.equal(rows.shift(), 'D2_STATUS');
  const status = Object.fromEntries(rows.map((line) => {
    const [key, value] = line.split('\t');
    assert.ok(Number.isFinite(Number(value)), 'INVALID_STATUS_VALUE');
    return [key, Number(value)];
  })) as Record<string, number>;
  assert.ok(status.max_connections > 0);
  return { checked_at: new Date().toISOString(), identity, status, processes,
    local_root_other_than_diagnostic: processes.filter((row) => row.user_category === 'root' && row.host_category === 'local' && !row.own_diagnostic).length,
    d2_operations_other_than_diagnostic: processes.filter((row) => row.mentions_d2_tables && !row.own_diagnostic).length };
}

// Awaiting readSql also awaits CLI exit and closes that mysql session before
// the second one opens. Never overlap diagnostic/database connections.
const first = await snapshot();
const second = await snapshot();
assert.equal(second.identity.server_uuid, first.identity.server_uuid);
assert.notEqual(second.identity.connection_id, first.identity.connection_id);
assert.ok(!second.processes.some((row) => row.id === first.identity.connection_id), 'PREVIOUS_DIAGNOSTIC_CONNECTION_STILL_PRESENT');
const report = { target, read_only: true, sql_commands: ['SHOW PROCESSLIST', "SHOW STATUS LIKE 'Threads_connected'", "SHOW VARIABLES LIKE 'max_connections'"],
  snapshots: [first, second], maximum_concurrent_connections_opened_by_this_command: 1,
  first_diagnostic_closed_verified: true, second_client_exited: true, writes: 0, kill_statements: 0,
  privacy: 'Host, state and SQL text are not saved; only categories/fingerprints/operation type.',
  historical_connection_ownership: 'Old connection IDs were not recorded; no attribution or termination of other sessions.' };
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ target, counts: report.snapshots.map(({ status }) => ({ connected: status.Threads_connected, maximum: status.max_connections })),
  local_root_others: report.snapshots.map((row) => row.local_root_other_than_diagnostic), first_diagnostic_closed_verified: true, writes: 0 }));

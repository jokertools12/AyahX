/** Root-only, one setting. Never changes public flag, reviews, credentials or schema. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { sha256 } from './lib/d4AuditSqlPlan';
import { openRailwayMysqlSession, type RailwayMysqlSession } from './lib/railwayMysqlSession';
import { captureInventory, ENVIRONMENTS, identifier, type Inventory } from './lib/railwayQuranOps';
import { checksumText } from '../server/services/quranTextImport';
import { assertProtectedInventory, protectedInventoryFingerprint, planR2Activation, verifyActivationArtifacts, settingsRowsFingerprint, type ActivationArtifacts, type AdapterSetting } from './lib/d4R2Activation';

const option = (name: string, optional = false): string | undefined => { const i = process.argv.indexOf(name); if (i < 0 && optional) return undefined; assert.ok(i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), 'R2_REQUIRED_OPTION:' + name); return process.argv[i + 1]; };
const jsonFile = async (file: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8'));
const outsideGit = (file: string): string => { const full = resolve(file), rel = relative(process.cwd(), full); assert.ok(rel.startsWith('..') || isAbsolute(rel), 'R2_PRIVATE_SQL_OUTSIDE_GIT_REQUIRED'); return full; };
export async function activateR2Command(): Promise<Record<string, unknown>> {
  const target = option('--target')!, apply = process.argv.includes('--apply'); assert.ok(['local', 'production'].includes(target));
  assert.ok(!(apply && process.argv.includes('--dry-run')), 'R2_APPLY_AND_DRY_RUN_EXCLUSIVE');
  if (target === 'production' && apply) assert.ok(process.argv.includes('--confirm-production'), 'R2_PRODUCTION_CONFIRM_REQUIRED');
  const reportPath = resolve(option('--report')!), sqlPath = outsideGit(option('--sql-output')!);
  const names = { acceptance: '--acceptance', logScan: '--log-scan', browser: '--browser', variables: '--variables', budget: '--budget' };
  const artifacts = {} as ActivationArtifacts;
  for (const [name, flag] of Object.entries(names)) { const raw = await readFile(option(flag)!); artifacts[name as keyof ActivationArtifacts] = { value: JSON.parse(raw.toString('utf8')), sha256: sha256(raw) }; }
  const hashes = verifyActivationArtifacts(artifacts);
  const report: Record<string, unknown> = { target, applied: apply, started_at: new Date().toISOString(), artifact_hashes: hashes, adapter_only: true, public_flag_or_human_state_changed: false };
  let local: mysql.Connection | null = null, remote: RailwayMysqlSession | null = null;
  try {
    if (target === 'local') { const database = option('--local-db')!; assert.match(database, /^ayahx_d4_[a-z0-9_]+$/u); local = await mysql.createConnection({ host: '127.0.0.1', port: Number(option('--local-port', true) ?? 33319), user: 'root', password: process.env.MYSQL_LOCAL_PASSWORD ?? '', database, charset: 'utf8mb4', multipleStatements: true }); }
    else remote = await openRailwayMysqlSession(ENVIRONMENTS.production, { allowWrites: apply });
    const read = async (sql: string): Promise<string> => {
      if (remote) return remote.read(sql);
      const [rows] = await local!.query<RowDataPacket[]>(sql); return rows.map(row => Object.values(row).map(v => v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\t')).join('\n');
    };
    const inventory = async (): Promise<Inventory> => {
      if (remote) return captureInventory(ENVIRONMENTS.production, read);
      const meta = JSON.parse(await read("SELECT JSON_OBJECT('database',DATABASE(),'server_uuid',@@server_uuid,'mysql_version',VERSION()) record;")); assert.equal(meta.mysql_version, '9.7.2');
      const tables = JSON.parse(await read("SELECT JSON_ARRAYAGG(JSON_OBJECT('name',TABLE_NAME,'collation',TABLE_COLLATION,'engine',ENGINE,'row_format',ROW_FORMAT)) record FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE();")) as Inventory['tables'];
      const counts = await read(tables.map(t => `SELECT '${t.name}',COUNT(*) FROM ${identifier(t.name)}`).join(' UNION ALL ') + ';');
      const row_counts = Object.fromEntries(counts.split('\n').map(line => { const [name, count] = line.split('\t'); return [name, Number(count)]; }));
      const sums = await read(`CHECKSUM TABLE ${tables.map(t => identifier(t.name)).join(',')};`), checksums = Object.fromEntries(sums.split('\n').map(line => { const [name, sum] = line.split('\t'); return [name.split('.').pop(), sum === 'NULL' ? null : sum]; }));
      const text = await read('SELECT surah,ayah,text_uthmani FROM quran_ayahs ORDER BY surah,ayah;');
      const canonical_checksum = checksumText(text.trimEnd().split('\n').map(line => { const [surah, ayah, ...words] = line.split('\t'); return `${surah}:${ayah}\t${words.join('\t')}`; }).join('\n'));
      return { ...meta, tables, row_counts, checksums, canonical_checksum, d1_counts: { surahs: row_counts.quran_surahs, ayahs: row_counts.quran_ayahs, words: row_counts.quran_words }, environment_id: 'local-scratch', critical_counts: {}, settings: {}, columns: [], foreign_keys: [], triggers: [], events: [], checked_at: new Date().toISOString() };
    };
    const before = await inventory(); assert.ok(before.row_counts.ayah_timings > 0 && before.row_counts.users >= 0 && before.row_counts.user_roles >= 0, 'R2_D1_D3_ADMIN_TABLES_REQUIRED');
    const baselinePath = option('--baseline', target === 'local'), baseline = baselinePath ? await jsonFile(baselinePath) as unknown as Inventory : before;
    report.baseline_file_sha256 = baselinePath ? sha256(await readFile(baselinePath)) : null; report.protected_inventory_sha256 = protectedInventoryFingerprint(before);
    assertProtectedInventory(baseline, before); report.baseline_d1 = before.d1_counts; report.baseline_d3 = before.row_counts.ayah_timings; report.canonical_checksum = before.canonical_checksum;
    const settingSql = "SELECT JSON_OBJECT('value_text',value_text,'is_secret',is_secret,'category',category,'updated_at',CAST(UNIX_TIMESTAMP(updated_at) AS CHAR)) record FROM system_settings WHERE key_name='storage_adapter';";
    const settingRaw = (await read(settingSql)).trim(), setting = settingRaw ? JSON.parse(settingRaw) as AdapterSetting : null;
    const otherSettings = async () => settingsRowsFingerprint((await read("SELECT SHA2(CAST(JSON_ARRAY(key_name,value_text,is_secret,category,CAST(UNIX_TIMESTAMP(updated_at) AS CHAR)) AS CHAR),256) row_hash FROM system_settings WHERE key_name<>'storage_adapter' ORDER BY key_name;")).trim().split('\n').filter(Boolean));
    const otherBefore = await otherSettings(); report.other_settings_sha256 = otherBefore;
    const tails = (await read('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL;')).trim().split('\n').filter(Boolean); assert.ok(tails.length <= 1, 'R2_AUDIT_CHAIN_CORRUPT');
    const plan = planR2Activation(setting, tails[0] ?? '0'.repeat(64), hashes), { sql, ...proof } = plan;
    Object.assign(report, proof, { setting_before: setting?.value_text ?? null });
    if (apply && target === 'production') {
      const dry = await jsonFile(option('--approved-dry-run')!); assert.equal(dry.target, 'production'); assert.equal(dry.passed, true); assert.equal(dry.applied, false); assert.equal(dry.sql_sha256, plan.sql_sha256); assert.deepEqual(dry.artifact_hashes, hashes); assert.equal(dry.other_settings_sha256, otherBefore); assert.equal(dry.baseline_file_sha256, report.baseline_file_sha256, 'R2_BASELINE_FILE_CHANGED'); assert.equal(dry.protected_inventory_sha256, report.protected_inventory_sha256, 'R2_DRY_PROTECTED_STATE_CHANGED');
      assert.equal(sha256(await readFile(sqlPath)), plan.sql_sha256, 'R2_APPROVED_SQL_CHANGED');
    } else await writeFile(sqlPath, sql, { flag: 'wx', mode: 0o600 });
    const limits = async () => { const threads = Number((await read("SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Threads_connected';")).trim()), max = Number((await read('SELECT @@max_connections;')).trim()); assert.ok(Number.isSafeInteger(threads) && threads >= 1 && Number.isSafeInteger(max) && max > threads, 'R2_CONNECTION_LIMIT_STOP'); return { threads_connected: threads, max_connections: max }; };
    report.connections_before = await limits();
    if (remote) { const disk = await remote.storage(); assert.ok(disk.available_bytes / disk.total_bytes >= .2, 'R2_SPACE_GUARD'); report.disk_before = disk; }
    if (apply) {
      const packet = Number((await read('SELECT @@max_allowed_packet;')).trim()); assert.ok(Buffer.byteLength(sql) < packet / 4 && Buffer.byteLength(sql) <= 256 * 1024, 'R2_PACKET_GUARD');
      if (local) await local.query(sql);
      else { await remote!.executeStatements([{ sql, rowCount: plan.changed ? 2 : 0 }], async () => { const disk = await remote!.storage(); assert.ok(disk.available_bytes / disk.total_bytes >= .2, 'R2_SPACE_GUARD'); }); await remote!.commit(); }
    }
    const after = apply ? await inventory() : before; assertProtectedInventory(before, after, apply ? plan.settings_row_delta : 0); assert.equal(await otherSettings(), otherBefore, 'R2_OTHER_SETTINGS_CHANGED');
    if (apply) { const actual = JSON.parse((await read(settingSql)).trim()) as AdapterSetting; assert.equal(actual.value_text, 'r2'); assert.equal(actual.is_secret, 0); assert.equal((await read('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL;')).trim() || '0'.repeat(64), plan.audit_tail, 'R2_AUDIT_TAIL_CHANGED'); }
    report.connections_after = await limits(); if (remote) report.disk_after = await remote.storage(); report.protected_checksums_unchanged = true; report.other_settings_unchanged = true; report.passed = true;
  } catch (error) { if (local) await local.rollback(); report.passed = false; const guard = error instanceof Error ? /^(R2_[A-Z0-9_]+)/u.exec(error.message)?.[1] : null; report.failure_code = guard ?? (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code) ? error.code : 'R2_ACTIVATION_GUARD_OR_EXECUTION_FAILED'); }
  finally { if (local) await local.end(); if (remote) { try { report.serial = await remote.close(); } catch { report.passed = false; report.close_failure_code = 'R2_SERIAL_CLOSE_FAILED'; } } report.finished_at = new Date().toISOString(); await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }); }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const r = await activateR2Command(); console.log(JSON.stringify({ passed: r.passed, applied: r.applied, sql_sha256: r.sql_sha256, changed: r.changed, failure_code: r.failure_code ?? null })); if (!r.passed) process.exitCode = 1; }
  catch { console.log(JSON.stringify({ passed: false, failure_code: 'R2_ACTIVATION_INPUT_OR_EVIDENCE_REJECTED' })); process.exitCode = 1; }
}

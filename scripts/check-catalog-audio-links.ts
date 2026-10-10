/** Read-only CLI. Network is opt-in; SQL is private output for a separate root-owned apply. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
import {
  CatalogLinkCollisionError, catalogLinkReport, catalogLinkSqlPlan, createLinkCheckpoint, runCatalogLinkChecks,
  type CatalogLinkCheckpoint, type CatalogLinkTarget,
} from '../server/services/catalogLinkChecker';
import { sqlLiteral } from '../server/services/qudCatalogSql';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
import { ENVIRONMENTS } from './lib/railwayQuranOps';

function option(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) { if (required) throw new Error('REQUIRED_OPTION:' + name); return undefined; }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('REQUIRED_OPTION_VALUE:' + name);
  return value;
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function privatePath(path: string): string {
  const absolute = resolve(path);
  const remainder = relative(repositoryRoot, absolute);
  if (!remainder || (!remainder.startsWith('..') && !isAbsolute(remainder))) throw new Error('PRIVATE_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  // Also reject another checkout/worktree, rather than merely this CLI's checkout.
  for (let directory = dirname(absolute); ; directory = dirname(directory)) {
    if (existsSync(resolve(directory, '.git'))) throw new Error('PRIVATE_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
    if (dirname(directory) === directory) break;
  }
  return absolute;
}
const target = option('--target')!;
assert.ok(['local', 'production'].includes(target), 'EXPLICIT_TARGET_REQUIRED');
if (process.argv.includes('--apply')) throw new Error('READ_ONLY_CLI_NO_APPLY');
const out = privatePath(option('--out')!);
const checkpointPath = privatePath(option('--checkpoint')!);
const sqlPath = option('--sql-output', false);
if (sqlPath) privatePath(sqlPath);
const selectedRecitation = option('--recitation', false);
const network = process.argv.includes('--check-network');
const refreshValue = option('--refresh-after-ms', false);
const refreshAfterMs = refreshValue ? Number(refreshValue) : 24 * 60 * 60 * 1000;
assert.ok(Number.isSafeInteger(refreshAfterMs) && refreshAfterMs >= 1000, 'CATALOG_LINK_REFRESH_INTERVAL_INVALID');
const database = target === 'local' ? option('--local-db')! : null;
if (database) assert.match(database, /^ayahx_d4_[a-z0-9_]+$/u);
const local = database ? await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database, charset: 'utf8mb4' }) : null;
const remote = target === 'production' ? await openRailwayMysqlSession(ENVIRONMENTS.production, { allowWrites: false }) : null;
const read = async (sql: string): Promise<Record<string, unknown>[]> => {
  if (local) return (await local.query<RowDataPacket[]>(sql))[0].map(row => JSON.parse(String(row.record)) as Record<string, unknown>);
  return (await remote!.read(sql + ';')).trim().split('\n').filter(Boolean).map(row => JSON.parse(row) as Record<string, unknown>);
};
try {
  const version = await read("SELECT JSON_OBJECT('mysql_version',VERSION()) AS record");
  assert.equal(version[0]?.mysql_version, '9.7.2', 'MYSQL_9_7_2_REQUIRED');
  const condition = selectedRecitation ? ` WHERE r.slug=${sqlLiteral(selectedRecitation)}` : '';
  const chapters = await read(`SELECT JSON_OBJECT('id',c.id,'recitationId',r.id,'reciterId',r.reciter_id,'recitationSlug',r.slug,'surah',c.surah,'url',c.audio_url,'allowedHosts',p.host_allowlist) AS record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id${condition} ORDER BY r.slug,c.surah`);
  const alternates = await read(`SELECT JSON_OBJECT('id',a.id,'recitationId',r.id,'reciterId',r.reciter_id,'recitationSlug',r.slug,'surah',a.surah,'url',a.url,'allowedHosts',p.host_allowlist) AS record FROM recitation_source_urls a JOIN recitations r ON r.id=a.recitation_id JOIN audio_providers p ON p.id=r.provider_id${condition} ORDER BY r.slug,a.surah,a.priority,a.id`);
  const targets = [...chapters.map(row => ({ ...row, kind: 'chapter', key: 'chapter:' + String(row.id) })),
    ...alternates.map(row => ({ ...row, kind: 'alternate', key: 'alternate:' + String(row.id) }))] as CatalogLinkTarget[];
  if (selectedRecitation && targets.length === 0) throw new Error('RECITATION_NOT_FOUND');
  const previous = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) as CatalogLinkCheckpoint : undefined;
  let checkpoint = createLinkCheckpoint(targets, previous);
  const save = (value: CatalogLinkCheckpoint): void => { writeFileSync(checkpointPath, JSON.stringify(value, null, 2) + '\n'); };
  const source = new CatalogAudioSource(undefined, 1000);
  try { checkpoint = await runCatalogLinkChecks(targets, { checkpoint, persist: save, checkLink: (url, hosts) => source.checkLink(url, hosts), refreshAfterMs, checkNetwork: network }); }
  catch (error) {
    if (error instanceof CatalogLinkCollisionError) {
      checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as CatalogLinkCheckpoint;
      writeFileSync(out, JSON.stringify({ ...catalogLinkReport(targets, checkpoint), target, mode: 'read_only', network_checks_enabled: network }, null, 2) + '\n');
    }
    throw error;
  }
  let sqlEvidence: Record<string, unknown> | null = null;
  if (sqlPath) {
    const plan = catalogLinkSqlPlan(targets, checkpoint);
    writeFileSync(privatePath(sqlPath), plan.sql);
    sqlEvidence = { sha256: plan.sha256, bytes: Buffer.byteLength(plan.sql), statements: plan.statements.length, applied: false };
  }
  const report = { ...catalogLinkReport(targets, checkpoint), target, mode: 'read_only', network_checks_enabled: network,
    refresh_after_ms: refreshAfterMs, sql_plan: sqlEvidence, checked_at: new Date().toISOString() };
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ target, mode: 'read_only', network_checks_enabled: network, targets: targets.length,
    results: Object.keys(checkpoint.results).length, sql_plan: sqlEvidence }));
} finally {
  if (local) await local.end();
  if (remote) await remote.close();
}

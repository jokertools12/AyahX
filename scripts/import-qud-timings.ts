/** Explicit D3 operation. BullMQ is local orchestration; production SQL uses private Railway SSH only. */
import { Queue, QueueEvents, Worker } from 'bullmq';
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTimingPlan } from '../server/services/qudTimingSql';
import { chapterCoverageSql, defectiveAuditSql, importTimingRecitation, loadPreparedTimings, recitationCoverageSql, type PreparationManifest, type TimingDatabase } from '../server/services/qudTimingImport';
import type { QuranTextCorpus } from '../server/services/quranTextImport';
import { timingMigrationSql } from '../server/db/migrations/003_addQuranTimingTables';
import { ENVIRONMENTS } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';

const option = (name: string): string => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`REQUIRED_OPTION:${name}`);
  return process.argv[i + 1];
};
const target = option('--target');
if (!['local','production'].includes(target)) throw new Error('EXPLICIT_TARGET_REQUIRED');
const apply = process.argv.includes('--apply');
if (apply && target === 'production' && !process.argv.includes('--confirm-production')) throw new Error('PRODUCTION_CONFIRM_REQUIRED');
if (target === 'production' && process.argv.includes('--pause-after-first-batch')) throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
const manifest = JSON.parse(readFileSync(option('--manifest'), 'utf8')) as PreparationManifest;
const corpus = JSON.parse(readFileSync(option('--corpus'), 'utf8')) as QuranTextCorpus;
if (manifest.canonical_checksum !== corpus.checksum) throw new Error('CANONICAL_PIN_MISMATCH');
const preflight = JSON.parse(readFileSync(option('--preflight'), 'utf8')) as { size_gate_passed: boolean; margin_gate_passed: boolean };
if (!preflight.size_gate_passed || !preflight.margin_gate_passed) throw new Error('MANDATORY_PREFLIGHT_REQUIRED');
const directory = option('--input-dir');
const sqlPath = resolve(option('--sql'));
if (sqlPath.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase())) throw new Error('PRIVATE_SQL_PATH_REQUIRED');
const selected = process.argv.includes('--one') ? manifest.results.filter((r) => r.slug === option('--one')) : manifest.results;
if (!selected.length) throw new Error('IMPORT_SOURCE_MISSING');
const session = target === 'production' ? await openRailwayMysqlSession(ENVIRONMENTS.production, { allowWrites: apply }) : null;
const local = target === 'local' ? await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database: option('--local-db'), charset: 'utf8mb4', multipleStatements: true }) : null;
if (target === 'local' && !option('--local-db').startsWith('ayahx_d2_')) throw new Error('PRIVATE_REHEARSAL_DATABASE_REQUIRED');
const db: TimingDatabase = {
  read: async (sql) => {
    if (session) { const text = await session.read(`${sql};`); return text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>) : []; }
    const [rows] = await local!.query(sql);
    return (rows as Array<{ record: string | Record<string, unknown> }>).map((r) => typeof r.record === 'string' ? JSON.parse(r.record) as Record<string, unknown> : r.record);
  },
  execute: async (sql, rowCount) => {
    if (session) return session.executeStatements([{ sql, rowCount }]);
    const [raw] = await local!.query("SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections'");
    const arrays = raw as unknown as Array<Array<{ Variable_name: string; Value: string }>>;
    if (Number(arrays[0][0].Value) >= Number(arrays[1][0].Value)) throw new Error('MYSQL_CONNECTION_LIMIT_REACHED');
    if (rowCount > 1000) throw new Error('SQL_BATCH_LIMIT_EXCEEDED');
    await local!.query(sql);
  },
};
const report: { target: string; sql_sha256: string; dry_run: boolean; results: unknown[]; elapsed_ms?: number; serial?: unknown } = { target, sql_sha256: '', dry_run: !apply, results: [] };
let queue: Queue | undefined, events: QueueEvents | undefined, worker: Worker | undefined;
try {
  const [settings] = await db.read("SELECT JSON_OBJECT('version',VERSION(),'packet',@@max_allowed_packet,'database',DATABASE()) AS record");
  if (settings.version !== '9.7.2' || (target === 'production' && settings.database !== 'railway')) throw new Error('DATABASE_IDENTITY_MISMATCH');
  const hash = createHash('sha256');
  writeFileSync(sqlPath, '');
  const addSql = (sql: string): void => { const text = `${sql.replace(/;\s*$/u, '')};\n\n`; appendFileSync(sqlPath, text); hash.update(text); };
  for (const sql of timingMigrationSql()) addSql(sql);
  const auditSql = defectiveAuditSql(option('--audit-cache'), 'docs/data/d1-defective-timing-rows.json');
  addSql(auditSql);
  for (const input of selected) {
    const rows = loadPreparedTimings(directory, input);
    const { plan } = buildTimingPlan([{ slug: input.slug, rows }], manifest.manifest_sha256, corpus.checksum);
    addSql(plan.jobs[0].insert_sql);
    for (const batch of plan.jobs[0].batches) for (const sql of batch.statements) addSql(sql);
    const chapters = await db.read(`SELECT JSON_OBJECT('surah',surah) AS record FROM recitation_chapters WHERE recitation_id='${rows[0].recitation_id}' ORDER BY surah`);
    addSql(chapterCoverageSql(rows, chapters.map((r) => Number(r.surah)), corpus));
    addSql(recitationCoverageSql(rows));
  }
  addSql('ANALYZE TABLE ayah_timings,import_jobs,recitation_chapters');
  report.sql_sha256 = hash.digest('hex');
  if (process.argv.includes('--expected-sql-sha') && report.sql_sha256 !== option('--expected-sql-sha')) throw new Error('APPROVED_SQL_SHA_MISMATCH');
  if (!apply) {
    report.results = selected.map((r) => ({ slug: r.slug, insert_rows: r.rows }));
    writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ dry_run: true, jobs: selected.length, rows: selected.reduce((n, r) => n + r.rows, 0), sql_sha256: report.sql_sha256 }));
  } else {
    const started = Date.now();
    for (const sql of timingMigrationSql()) await db.execute(`${sql};`, 0);
    await db.execute(auditSql, 7);
    const connection = { host: '127.0.0.1', port: 36379 };
    const name = `qud-timing-import-${target}`;
    queue = new Queue(name, { connection }); events = new QueueEvents(name, { connection });
    worker = new Worker(name, async (job) => {
      const input = selected.find((r) => r.slug === job.data.slug);
      if (!input) throw new Error('QUEUED_SOURCE_NOT_IN_PINNED_IMPORT');
      const result = await importTimingRecitation(db, { rows: loadPreparedTimings(directory, input), slug: input.slug, manifest, corpus, maxPacket: Number(settings.packet),
        onCheckpoint: async (checkpoint) => {
          if (process.argv.includes('--pause-after-first-batch')) {
            writeFileSync(process.env.TEMP + '/ayahx-d3-kill-probe.json', JSON.stringify({ pid: process.pid, target, checkpoint, slug: input.slug }));
            await new Promise<void>(() => { /* parent performs actual process termination */ });
          }
        },
      });
      report.results.push(result); writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(result));
      return result;
    }, { connection, concurrency: 1, lockDuration: target === 'local' ? 2000 : 120000, stalledInterval: 1000 });
    worker.on('error', (error) => { console.error(`IMPORT_WORKER_ERROR:${error.name}`); });
    await events.waitUntilReady();
    for (const input of selected) {
      const job = await queue.add('recitation', { slug: input.slug }, { jobId: `d3-${loadPreparedTimings(directory, input)[0].import_job_id}`, removeOnComplete: true, removeOnFail: true });
      await job.waitUntilFinished(events, 4 * 60 * 60 * 1000);
    }
    await db.execute('ANALYZE TABLE ayah_timings,import_jobs,recitation_chapters;', 0);
    if (session) await session.commit();
    report.elapsed_ms = Date.now() - started;
  }
} finally {
  await worker?.close(); await events?.close(); await queue?.close();
  if (session) report.serial = await session.close();
  await local?.end();
  writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n');
}

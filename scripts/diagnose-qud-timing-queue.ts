/** Isolated local BullMQ proof; CLI import is independent and this is not an A3 route. */
import { Queue, QueueEvents, Worker } from 'bullmq';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const option = (name: string): string => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error('REQUIRED_OPTION:' + name); return process.argv[i + 1]; };
const database = option('--local-db');
if (!/^ayahx_d2_[a-z0-9_]+$/u.test(database)) throw new Error('LOCAL_REHEARSAL_ONLY');
const manifest = JSON.parse(readFileSync(option('--manifest'), 'utf8')) as { results: Array<{ slug: string; rows: number }> };
const connection = { host: '127.0.0.1', port: 36379 };
const name = 'qud-d3-proof-' + Date.now();
const queue = new Queue(name, { connection }); const events = new QueueEvents(name, { connection });
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const report: { queue: string; lock_duration_ms: number; lock_renew_time_ms: number; stalled: string[]; renewal_failures: string[][]; renewed_locks: number; worker_errors: string[]; results: unknown[]; passed?: boolean; elapsed_ms?: number; event_loop_delay_ms?: unknown; queue_counts?: unknown; failure?: string } = { queue: name, lock_duration_ms: 120000, lock_renew_time_ms: 1000, stalled: [], renewal_failures: [], renewed_locks: 0, worker_errors: [], results: [] };
const started = Date.now();
const worker = new Worker(name, async (job) => {
  const input = manifest.results.find((r) => r.slug === job.data.slug);
  if (!input) throw new Error('PINNED_SOURCE_MISSING');
  const childReport = join(process.env.TEMP!, 'ayahx-d3-queue-' + input.slug + '.json');
  const sql = join(process.env.TEMP!, 'ayahx-d3-queue-' + input.slug + '.sql');
  const args = ['--import','tsx','scripts/import-qud-timings.ts','--target','local','--apply','--local-db',database,'--one',input.slug,'--report',childReport,'--sql',sql];
  for (const key of ['--manifest','--corpus','--input-dir','--preflight']) args.push(key, option(key));
  const child = spawn(process.execPath, args, { stdio: ['ignore','pipe','pipe'] });
  child.stdout.resume(); child.stderr.resume();
  const code = await new Promise<number | null>((accept, reject) => { child.once('error', () => reject(new Error('CHILD_START_FAILED'))); child.once('close', accept); });
  const result = JSON.parse(readFileSync(childReport, 'utf8')) as { completed?: boolean; failure?: string; results: unknown[]; event_loop_delay_ms: unknown };
  if (code !== 0 || !result.completed) throw new Error(result.failure ?? 'CHILD_IMPORT_FAILED');
  report.results.push({ slug: input.slug, rows: input.rows, child_event_loop_delay_ms: result.event_loop_delay_ms, result: result.results[0] });
  console.log(JSON.stringify({ slug: input.slug, rows: input.rows }));
  writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n');
  return input.rows;
}, { connection, concurrency: 1, lockDuration: 120000, lockRenewTime: 1000 });
worker.on('stalled', (jobId) => { report.stalled.push(jobId); });
worker.on('lockRenewalFailed', (ids) => { report.renewal_failures.push(ids); });
worker.on('locksRenewed', (data) => { report.renewed_locks += data.count; });
worker.on('error', (error) => { report.worker_errors.push(error.name); });
try {
  await events.waitUntilReady();
  for (const input of manifest.results) {
    const job = await queue.add('recitation', { slug: input.slug }, { jobId: input.slug });
    await job.waitUntilFinished(events, 10 * 60 * 1000);
  }
  report.queue_counts = await queue.getJobCounts();
  report.passed = report.results.length === manifest.results.length && report.stalled.length === 0 && report.renewal_failures.length === 0 && report.worker_errors.length === 0 && report.renewed_locks > 0;
  if (!report.passed) throw new Error('QUEUE_PROOF_FAILED');
} catch (error) { report.failure = error instanceof Error ? error.message : 'QUEUE_FAILED'; report.passed = false; process.exitCode = 1; }
finally {
  await worker.close(); await events.close(); await queue.close();
  loop.disable(); report.elapsed_ms = Date.now() - started;
  report.event_loop_delay_ms = { p50: loop.percentile(50)/1e6, p99: loop.percentile(99)/1e6, max: loop.max/1e6, samples: loop.count };
  writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n');
}

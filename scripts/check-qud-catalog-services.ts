/** Approved production READS only. Never persists raw logs or response bodies. */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { ENVIRONMENTS, MYSQL_SERVICE, PROJECT, railwayBinary, railwayEnv } from './lib/railwayQuranOps';

const option = (name: string): string => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`OPTION_REQUIRED:${name}`);
  return process.argv[i + 1];
};
if (!process.argv.includes('--production-read-only')) throw new Error('EXPLICIT_READ_ONLY_SCOPE_REQUIRED');
const since = option('--since');
if (!/^\d{4}-\d{2}-\d{2}T/u.test(since) || !Number.isFinite(Date.parse(since))) throw new Error('EXPLICIT_ISO_WINDOW_REQUIRED');
const health: Array<{ path: string; http_status: number; status: string; database?: string }> = [];
for (const path of ['/api/health', '/api/health/ready']) {
  const response = await fetch(`https://ayahx.com${path}`, { signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) throw new Error(`HEALTH_HTTP_${response.status}:${path}`);
  let body: { status?: string; database?: { status?: string } | string };
  try { body = await response.json() as typeof body; }
  catch { throw new Error(`HEALTH_JSON_MALFORMED:${path}`); }
  const status = body.status === 'ok' || body.status === 'ready' ? body.status : 'unexpected';
  const database = typeof body.database === 'object' ? body.database?.status : body.database;
  health.push({ path, http_status: response.status, status, ...(database === 'connected' ? { database } : {}) });
  if (status === 'unexpected' || (path.endsWith('/ready') && database !== 'connected')) throw new Error(`HEALTH_NOT_READY:${path}`);
}
const until = new Date().toISOString();
const logs: Array<{ service: string; since: string; until: string; lines: number; errors: number; error_timestamps: string[] }> = [];
for (const [service, id] of [['AyahX', '1ff57ef9-b793-4130-ae60-ce8392172cf8'], ['MySQL', MYSQL_SERVICE]]) {
  const child = spawn(railwayBinary, ['logs', '--project', PROJECT, '--environment', ENVIRONMENTS.production,
    '--service', id, '--since', since, '--until', until, '--lines', '500', '--json'], { env: railwayEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const output: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  child.stderr.resume(); // Never emit raw provider diagnostics containing user data.
  await new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('LOG_CLI_START_FAILED')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`LOG_CLI_EXIT_${code}`)));
  });
  const lines = Buffer.concat(output).toString('utf8').trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length >= 500) throw new Error('LOG_WINDOW_TRUNCATED; narrow the window before acceptance');
  const errorTimes: string[] = [];
  for (const line of lines) {
    // Malformed output throws instead of claiming a clean log window.
    let entry: { timestamp?: string; severity?: string; level?: string; message?: string };
    try { entry = JSON.parse(line) as typeof entry; }
    catch { throw new Error('LOG_JSON_MALFORMED; raw content withheld'); }
    const severity = String(entry.severity || entry.level || '').toLowerCase();
    const message = String(entry.message || '');
    if (['error', 'fatal', 'critical'].includes(severity) || /\b(?:uncaught|fatal|exception|ECONNREFUSED|ER_[A-Z_]+)\b|\[ERROR\]|\berror\s*:/iu.test(message)) {
      errorTimes.push(typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : 'timestamp_unavailable');
    }
  }
  logs.push({ service, since, until, lines: lines.length, errors: errorTimes.length, error_timestamps: errorTimes });
}
const report = { checked_at: new Date().toISOString(), health, logs, passed: logs.every((log) => log.errors === 0), read_only: true };
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.passed) throw new Error('PRODUCTION_LOG_ERRORS_STOP; no DB repair or deploy authorized');

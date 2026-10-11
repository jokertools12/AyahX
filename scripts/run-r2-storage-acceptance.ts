import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CatalogError } from '../server/services/catalogContracts';

/** Keeps split writes/UTF-8 intact. Never exposes captured SDK/error text. */
export class AcceptanceLogSecretScanner {
  private tail = ''; private readonly decoder = new StringDecoder('utf8'); private readonly retain: number;
  bytes = 0; violated = false;
  constructor(private readonly secrets: readonly string[]) { this.retain = Math.max(4096, ...secrets.map(s => s.length + 16)); }
  consume(chunk: Buffer): void { this.bytes += chunk.length; this.inspect(this.decoder.write(chunk)); }
  finish(): void { this.inspect(this.decoder.end()); }
  private inspect(value: string): void {
    const text = this.tail + value;
    if (this.secrets.some(s => s && text.includes(s)) || /X-Amz-(?:Signature|Credential|Security-Token)|r2\.cloudflarestorage\.com/iu.test(text)) this.violated = true;
    this.tail = text.slice(-this.retain);
  }
}
export function acceptanceCredentialValues(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'string' && /^(?:accessKeyId|secretAccessKey|accessKey|secretKey|token|accountId|endpoint)$/u.test(key) ? [item] : acceptanceCredentialValues(item));
}
/** Foreground child only; no service launch, detached helper, or filesystem cleanup. */
export async function runCapturedR2Acceptance(): Promise<Record<string, unknown>> {
  const file = process.env.R2_ACCEPTANCE_CREDENTIAL_FILE, reportPath = process.env.R2_ACCEPTANCE_REPORT;
  if (process.env.RUN_REAL_R2_ACCEPTANCE !== '1' || !file || !reportPath || !process.env.R2_ACCEPTANCE_SCRATCH) throw new CatalogError('R2_ACCEPTANCE_EXPLICIT_OPT_IN_REQUIRED', 422);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!path.isAbsolute(file) || path.resolve(file).toLowerCase().startsWith((repo + path.sep).toLowerCase())) throw new CatalogError('STORAGE_TEST_CREDENTIALS_MUST_BE_OUTSIDE_GIT', 422);
  const secrets = acceptanceCredentialValues(JSON.parse(await readFile(file, 'utf8')));
  if (secrets.length < 6) throw new CatalogError('STORAGE_TEST_CREDENTIALS_INVALID', 422);
  const stdout = new AcceptanceLogSecretScanner(secrets), stderr = new AcceptanceLogSecretScanner(secrets);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/test-licensed-audio-storage.ts')], { cwd: repo, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1200000);
    child.stdout.on('data', (b: Buffer) => { stdout.consume(b); if (stdout.bytes > 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', (b: Buffer) => { stderr.consume(b); if (stderr.bytes > 1024 * 1024) child.kill('SIGKILL'); });
    child.once('error', () => { clearTimeout(timer); reject(new CatalogError('R2_ACCEPTANCE_CHILD_UNAVAILABLE', 503)); });
    child.once('close', code => { clearTimeout(timer); stdout.finish(); stderr.finish(); resolve(code ?? -1); });
  });
  const result = { status: exitCode === 0 && !stdout.violated && !stderr.violated && stdout.bytes <= 1024 * 1024 && stderr.bytes <= 1024 * 1024 ? 'PASSED_STORAGE_ACCEPTANCE_1_TO_7_AND_LOG_SECRET_SCAN' : 'FAILED_OR_PENDING_EXTERNAL_EVIDENCE', child_exit_code: exitCode, secret_scan_passed: !stdout.violated && !stderr.violated, stdout_bytes: stdout.bytes, stderr_bytes: stderr.bytes, logs_retained: false, checked_at: new Date().toISOString() };
  await writeFile(reportPath + '.captured-log-scan.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const report = await runCapturedR2Acceptance(); process.stdout.write(JSON.stringify(report) + '\n'); if (report.status !== 'PASSED_STORAGE_ACCEPTANCE_1_TO_7_AND_LOG_SECRET_SCAN') process.exitCode = 1; }
  catch (error) { process.stdout.write(JSON.stringify({ status: 'FAILED', failure_code: error instanceof CatalogError ? error.code : 'STORAGE_TEST_FAILURE' }) + '\n'); process.exitCode = 1; }
}

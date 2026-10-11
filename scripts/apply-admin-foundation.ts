/** ROOT EXECUTES ONLY. Explicit production target; read-only dry-run is default. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRailwayMysqlSession, type SerialSessionEvidence } from './lib/railwayMysqlSession';
import { ENVIRONMENTS } from './lib/railwayQuranOps';
import { runAdminFoundationMigration, validateAdminMigrationPrerequisites, type AdminMigrationOptions, type AdminBackupProof } from './lib/adminFoundationAcceptance';

const parse = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const failureCode = (error: unknown): string => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
  return /^[A-Z0-9_:]{1,120}$/u.test(code) ? code : 'ADMIN_FOUNDATION_MIGRATION_FAILED';
};
export function writeAdminProofAtomically(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const temp = resolve(path) + '.pending-' + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, resolve(path));
}
export async function mainAdminFoundation(argv = process.argv.slice(2)): Promise<void> {
  const value = (name: string, fallback?: string): string => {
    const i = argv.indexOf(name); if (i === -1 && fallback !== undefined) return fallback;
    if (i === -1 || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('REQUIRED_OPTION'); return argv[i + 1];
  };
  const apply = argv.includes('--apply');
  if (apply && !argv.includes('--confirm-production')) throw new Error('PRODUCTION_WRITE_ACK_REQUIRED');
  const options: AdminMigrationOptions = {
    target: value('--target'), apply,
    rehearsal: parse(value('--rehearsal', 'docs/data/a1-migration-local-proof.json')),
    baseline: argv.includes('--baseline') ? parse(value('--baseline')) : undefined,
    dryRun: apply ? parse(value('--dry-run')) : undefined,
    backup: argv.includes('--backup') ? parse<AdminBackupProof>(value('--backup')) : undefined,
  };
  // No SSH connection is opened unless proof gates already pass.
  validateAdminMigrationPrerequisites(options);
  if (options.backup && createHash('sha256').update(readFileSync(options.backup.encrypted_path)).digest('hex') !== options.backup.encrypted_sha256) throw new Error('ENCRYPTED_BACKUP_SHA_MISMATCH');
  const reportPath = value('--report', apply ? 'docs/data/a1-production-migration-proof.json' : 'docs/data/a1-production-migration-dry-run.json');
  if (apply && resolve(reportPath) === resolve(value('--dry-run'))) throw new Error('APPROVED_DRY_RUN_REPORT_OVERWRITE_FORBIDDEN');
  const session = await openRailwayMysqlSession(ENVIRONMENTS.production, { allowWrites: apply });
  let report: Record<string, unknown> | undefined, failure: string | undefined, serial: SerialSessionEvidence | undefined;
  try { report = await runAdminFoundationMigration(session, options); }
  catch (error) { failure = failureCode(error); }
  finally {
    try { serial = await session.close(); }
    catch (error) { failure ??= failureCode(error); }
  }
  if (failure) {
    writeAdminProofAtomically(reportPath, { ...(report ?? {}), target: 'production', applied: apply, passed: false, failure, serial, finished_at: new Date().toISOString() });
    throw new Error(failure);
  }
  if (!report || !serial || serial.ssh_exit_code !== 0 || !serial.mysql_close_acknowledged || apply && !serial.commit_acknowledged) throw new Error('SERIAL_COMPLETION_REQUIRED');
  report.serial = serial; report.finished_at = new Date().toISOString();
  writeAdminProofAtomically(reportPath, report);
  console.log(JSON.stringify({ applied: apply, passed: true, sql_sha256: report.sql_sha256, planned: report.planned, d1: report.d1, d3: report.d3 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) mainAdminFoundation().catch(error => { console.error(failureCode(error)); process.exitCode = 1; });

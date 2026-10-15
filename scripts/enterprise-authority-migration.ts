import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { additiveTargetSchema } from '../server/db/migrations/additiveMigrationRunner';
import { runEnterpriseAuthorityMigration } from '../server/db/migrations/enterpriseAuthority';

// --target <identity.json> [--rehearse --restoration <restore.json> | --apply --rehearsal <receipt.json>] --out <private-new-report.json>
// Default dry-run. Backup/restore are external verified prerequisites. Failed FIRST rehearsal requires a fresh restored scratch.
// Never commit receipts/reports. There is no owner bootstrap or grant seed in this command.
export async function main(args = process.argv.slice(2)) {
  const values: Record<string, string> = {};
  let mode: 'dry-run' | 'rehearse' | 'apply' = 'dry-run';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply' || arg === '--rehearse') {
      if (mode !== 'dry-run') throw new Error('CHOOSE_ONE_MUTATION_MODE');
      mode = arg === '--apply' ? 'apply' : 'rehearse';
    } else if (['--target', '--restoration', '--rehearsal', '--out'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (values[arg]) throw new Error('DUPLICATE_ARGUMENT');
      values[arg] = args[++i];
    } else throw new Error('UNKNOWN_OR_MISSING_ARGUMENT');
  }
  if (!values['--target']) throw new Error('EXPLICIT_TARGET_REQUIRED');
  if (mode !== 'dry-run' && !values['--out']) throw new Error('PRIVATE_REPORT_PATH_REQUIRED');
  const read = (name: string) => values[name] ? JSON.parse(readFileSync(values[name], 'utf8')) : undefined;
  const target = additiveTargetSchema.parse(read('--target'));
  const restoration = read('--restoration');
  const rehearsalReport = read('--rehearsal');
  if (mode === 'rehearse' && !restoration) throw new Error('RESTORATION_RECEIPT_REQUIRED');
  if (mode === 'apply' && !rehearsalReport) throw new Error('REHEARSAL_RECEIPT_REQUIRED');
  const uri = process.env.ENTERPRISE_AUTHORITY_DATABASE_URL;
  if (!uri) throw new Error('ENTERPRISE_AUTHORITY_DATABASE_URL_REQUIRED');
  // Reserve before connecting or DDL; failures leave an empty file rather than a success receipt.
  const fd = values['--out'] ? openSync(values['--out'], 'wx', 0o600) : undefined;
  try {
    const connection = await createConnection(uri);
    try {
      const report = await runEnterpriseAuthorityMigration(connection, { target, mode, restoration, rehearsal: rehearsalReport?.receipt ?? rehearsalReport });
      const json = JSON.stringify(report, null, 2) + '\n';
      if (fd === undefined) process.stdout.write(json); else writeFileSync(fd, json);
    } finally { await connection.end(); }
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function authorityMigrationErrorMessage(error: unknown): string {
  return error instanceof Error && /^[A-Z_]+(?::[a-z_]+)?$/.test(error.message) ? error.message : 'ENTERPRISE_AUTHORITY_MIGRATION_FAILED';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(authorityMigrationErrorMessage(error) + '\n'); process.exitCode = 1; });
}

import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { runEnterpriseCatalogMigration } from '../server/db/migrations/enterpriseCatalog';

// Example: ENTERPRISE_CATALOG_DATABASE_URL=<server-only URI> npx tsx scripts/enterprise-catalog-migration.ts
// --target <identity.json> [--rehearse --restoration <restore.json> | --apply --rehearsal <receipt.json>] --out <private-report.json>
// Default is read-only dry-run. Restore/backup evidence must be captured independently;
// this command neither backs up nor restores a database. Never commit its receipts/reports.
// Interrupted FIRST rehearsal needs a fresh restore and updated restoration receipt; only receipt-backed apply supports partial resume.
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
  // Validate local input before establishing a connection. mysql2 has multipleStatements disabled by default.
  const target = read('--target');
  const restoration = read('--restoration');
  const rehearsalReport = read('--rehearsal');
  if (mode === 'rehearse' && !restoration) throw new Error('RESTORATION_RECEIPT_REQUIRED');
  if (mode === 'apply' && !rehearsalReport) throw new Error('REHEARSAL_RECEIPT_REQUIRED');
  const uri = process.env.ENTERPRISE_CATALOG_DATABASE_URL;
  if (!uri) throw new Error('ENTERPRISE_CATALOG_DATABASE_URL_REQUIRED');
  // Reserve a fresh report path before any DDL; a failed run leaves an empty file, never a success receipt.
  const reportFd = values['--out'] ? openSync(values['--out'], 'wx', 0o600) : undefined;
  try {
    const connection = await createConnection(uri);
    try {
      const report = await runEnterpriseCatalogMigration(connection, { target, mode, restoration,
        rehearsal: rehearsalReport?.receipt ?? rehearsalReport });
      const json = JSON.stringify(report, null, 2) + '\n';
      if (reportFd !== undefined) writeFileSync(reportFd, json);
      else process.stdout.write(json);
    } finally { await connection.end(); }
  } finally { if (reportFd !== undefined) closeSync(reportFd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // No connection URI, credentials, rows or raw mysql diagnostics in CLI logs.
    const message = error instanceof Error && /^[A-Z_]+(?::[a-z_]+)?$/.test(error.message)
      ? error.message : 'ENTERPRISE_CATALOG_MIGRATION_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

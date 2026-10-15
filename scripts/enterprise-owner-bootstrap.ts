import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { createCatalogGrantService } from '../server/services/catalogGrantService';

// Explicit privileged CLI only. Input/report contain private account identity and stay outside Git.
// --input <private-owner-and-database-target.json> --out <private-new-report.json>
export async function main(args = process.argv.slice(2), environment = process.env) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--input', '--out'].includes(name) || values[name] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_BOOTSTRAP_ARGUMENTS');
    values[name] = args[++i];
  }
  if (!values['--input'] || !values['--out']) throw new Error('PRIVATE_INPUT_AND_REPORT_REQUIRED');
  const platform = environment.RAILWAY_ENVIRONMENT_NAME;
  const configured = environment.ENTERPRISE_AUTHORITY_ENVIRONMENT;
  if (platform && !['staging', 'production'].includes(platform)) throw new Error('UNSUPPORTED_PLATFORM_ENVIRONMENT');
  if (platform && configured && platform !== configured) throw new Error('BOOTSTRAP_ENVIRONMENT_CONFLICT');
  const trusted = platform ?? configured;
  if (trusted !== 'local' && trusted !== 'staging' && trusted !== 'production') throw new Error('EXPLICIT_BOOTSTRAP_ENVIRONMENT_REQUIRED');
  if (!environment.ENTERPRISE_AUTHORITY_DATABASE_URL) throw new Error('ENTERPRISE_AUTHORITY_DATABASE_URL_REQUIRED');
  const body: unknown = JSON.parse(readFileSync(values['--input'], 'utf8'));
  // Refuse overwriting reports, including the input itself, before any database mutation.
  const fd = openSync(values['--out'], 'wx', 0o600);
  try {
    const connection = await createConnection(environment.ENTERPRISE_AUTHORITY_DATABASE_URL);
    try {
      const service = createCatalogGrantService(async () => Object.assign(connection, { release() { /* CLI owns connection lifetime. */ } }), Date.now, { environment: trusted });
      const result = await service.bootstrapOwner(body);
      writeFileSync(fd, JSON.stringify({ operation: 'owner_bootstrap', environment: trusted, result, completedAt: Date.now() }, null, 2) + '\n');
    } finally { await connection.end(); }
  } finally { closeSync(fd); }
}
export const bootstrapErrorMessage = (error: unknown) => error instanceof Error && /^[A-Z_]+$/.test(error.message)
  ? error.message : 'ENTERPRISE_OWNER_BOOTSTRAP_FAILED';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(bootstrapErrorMessage(error) + '\n'); process.exitCode = 1; });
}

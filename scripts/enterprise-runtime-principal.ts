import { closeSync, openSync, readFileSync, writeFileSync, ftruncateSync, writeSync, fsyncSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { z } from 'zod';
import { databaseTargetSchema, inspectDatabaseIdentity } from '../server/db/databaseIdentity';
import { runtimeDatabaseServiceSchema } from '../server/db/runtimePrivilegePlan';
import { provisionRuntimePrincipal } from '../server/db/provisionRuntimePrincipal';
import { verifyRuntimeGrants } from '../server/db/runtimeGrantVerification';
import { canonicalJson } from '../server/utils/canonicalIntegrity';

const inputSchema = z.object({ target: databaseTargetSchema, user: z.string().regex(/^[A-Za-z0-9_]{1,32}$/),
  service: runtimeDatabaseServiceSchema, reason: z.string().trim().min(1).max(1000), requestId: z.string().trim().min(1).max(200),
  authorizationReferenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const runtimePrincipalError = (error: unknown) => error instanceof Error && /^[A-Z_]+$/.test(error.message)
  ? error.message : 'ENTERPRISE_RUNTIME_PRINCIPAL_FAILED';
/** Operator-only: no app pool, automatic startup, credential fallback or existing-account mutation. */
export async function main(args = process.argv.slice(2), environment = process.env) {
  const values: Record<string, string> = {}; let apply = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--apply') { if (apply) throw new Error('DUPLICATE_APPLY'); apply = true; }
    else if (['--input', '--out', '--credentials'].includes(name) && !values[name] && args[i + 1] && !args[i + 1].startsWith('--')) values[name] = args[++i];
    else throw new Error('INVALID_RUNTIME_PRINCIPAL_ARGUMENTS');
  }
  if (!values['--input'] || !values['--out'] || apply && !values['--credentials'] || !apply && values['--credentials']) throw new Error('PRIVATE_INPUT_AND_REPORT_REQUIRED');
  const platform = environment.RAILWAY_ENVIRONMENT_NAME; const configured = environment.ENTERPRISE_RUNTIME_ENVIRONMENT;
  if (platform && !['staging', 'production'].includes(platform) || platform && configured && platform !== configured) throw new Error('RUNTIME_PRINCIPAL_ENVIRONMENT_CONFLICT');
  const trusted = platform ?? configured;
  if (!trusted || !['local', 'staging', 'production'].includes(trusted)) throw new Error('EXPLICIT_RUNTIME_ENVIRONMENT_REQUIRED');
  const body = inputSchema.parse(JSON.parse(readFileSync(values['--input'], 'utf8')));
  if (body.target.environment !== trusted) throw new Error('RUNTIME_PRINCIPAL_ENVIRONMENT_CONFLICT');
  const uri = environment.ENTERPRISE_RUNTIME_DATABASE_URL;
  if (!uri) throw new Error('ENTERPRISE_RUNTIME_DATABASE_URL_REQUIRED');
  // Reserve every private artifact before connecting; never replace credentials, receipts or input.
  const reportFd = openSync(values['--out'], 'wx', 0o600); let credentialsFd: number | undefined;
  const base = { operation: 'runtime_principal', mode: apply ? 'apply' : 'inspect', target: body.target,
    user: body.user, service: body.service, reason: body.reason, requestId: body.requestId,
    authorizationReferenceSha256: body.authorizationReferenceSha256, startedAt: Date.now() };
  function writeReport(value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value, null, 2)); ftruncateSync(reportFd, 0);
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(reportFd, bytes, offset, bytes.length - offset, offset);
      if (written <= 0) throw new Error('PRIVATE_REPORT_WRITE_FAILED'); offset += written;
    }
    fsyncSync(reportFd);
  }
  try {
    if (apply) credentialsFd = openSync(values['--credentials'], 'wx', 0o600);
    const operator = await createConnection(uri);
    let terminal: unknown;
    try {
      const inspection = await provisionRuntimePrincipal(operator, { target: body.target, user: body.user, service: body.service, mode: 'inspect' });
      if (!apply) terminal = { ...base, status: 'inspected', result: inspection };
      else {
        const password = randomBytes(32).toString('base64url');
        writeFileSync(credentialsFd!, JSON.stringify({ user: body.user, password, schema: body.target.schema,
          service: body.service, environment: trusted, purpose: 'new_runtime_principal', preparedAt: Date.now() }, null, 2));
        const result = await provisionRuntimePrincipal(operator, { target: body.target, user: body.user, service: body.service, mode: 'apply', password });
        const login = new URL(uri); login.username = body.user; login.password = password;
        const runtime = await createConnection(login.toString());
        try {
          if (canonicalJson(await inspectDatabaseIdentity(runtime, body.target.environment)) !== canonicalJson(body.target)) throw new Error('RUNTIME_LOGIN_TARGET_MISMATCH');
          const [rows] = await runtime.query('SELECT CURRENT_USER() AS currentUser, CURRENT_ROLE() AS activeRoles, @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks');
          const identity = (rows as { currentUser: string; activeRoles: string; sqlMode: string; foreignKeyChecks: number }[])[0];
          if (!identity || Number(identity.foreignKeyChecks) !== 1 || !identity.sqlMode.split(',').some(mode => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode))) throw new Error('UNSAFE_RUNTIME_SESSION');
          const [grantRows] = await runtime.query('SHOW GRANTS FOR CURRENT_USER');
          const grants = (grantRows as Record<string, unknown>[]).map(row => {
            const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') throw new Error('RUNTIME_EFFECTIVE_GRANTS_MISMATCH'); return values[0];
          });
          const effective = verifyRuntimeGrants(result.plan, { ...identity, grants });
          terminal = { ...base, status: 'applied', result, effective, completedAt: Date.now() };
        } finally { await runtime.end(); }
      }
    } finally { await operator.end(); }
    // Connection cleanup is part of acceptance and precedes the single terminal receipt.
    writeReport(terminal);
  } catch (error) {
    // Account DDL auto-commits. A partial failure requires inspection, never blind retry or automatic DROP.
    writeReport({ ...base, status: 'incomplete', code: runtimePrincipalError(error), inspectBeforeRetry: true });
    throw error;
  } finally { if (credentialsFd !== undefined) closeSync(credentialsFd); closeSync(reportFd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(runtimePrincipalError(error) + '\n'); process.exitCode = 1; });
}

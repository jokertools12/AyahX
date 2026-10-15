import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { provisionRuntimePrincipal } from '../../server/db/provisionRuntimePrincipal';
import { buildRuntimePrivilegePlan } from '../../server/db/runtimePrivilegePlan';
import { main, runtimePrincipalError } from '../../scripts/enterprise-runtime-principal';
vi.mock('mysql2/promise', () => ({ createConnection: vi.fn() }));
vi.mock('../../server/db/provisionRuntimePrincipal', () => ({ provisionRuntimePrincipal: vi.fn() }));
const target = { environment: 'staging', host: 'fixture', port: 3306, serverUuid: 'fixture-uuid', schema: 'railway', version: '9.7.2' };
const body = { target, user: 'fixture_runtime', service: 'api', reason: 'isolated fixture', requestId: 'request-1', authorizationReferenceSha256: 'a'.repeat(64) };
const plan = buildRuntimePrivilegePlan({ schema: 'railway', user: body.user, service: 'api' });
const environment = () => ({ ENTERPRISE_RUNTIME_DATABASE_URL: 'mysql://operator:fixture@fixture/railway', ENTERPRISE_RUNTIME_ENVIRONMENT: 'staging' });
let directory: string; let input: string; let output: string; let credentials: string;
let runtimeIdentity: typeof target;
const operatorEnd = vi.fn(); const runtimeEnd = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); directory = mkdtempSync(join(tmpdir(), 'ayahx-principal-'));
  input = join(directory, 'input.json'); output = join(directory, 'report.json'); credentials = join(directory, 'credentials.json');
  writeFileSync(input, JSON.stringify(body));
  runtimeIdentity = { ...target };
  const runtimeQuery = vi.fn(async (sql: string) => sql.startsWith('SELECT CURRENT_USER')
    ? [[{ currentUser: 'fixture_runtime@%', activeRoles: 'NONE', sqlMode: 'STRICT_TRANS_TABLES', foreignKeyChecks: 1 }]]
    : sql.startsWith('SELECT DATABASE()') ? [[{ ...runtimeIdentity, schemaName: runtimeIdentity.schema }]]
    : [plan.statements.map(statement => ({ grant: statement.sql.replace('?@?', '`fixture_runtime`@`%`') }))]);
  vi.mocked(createConnection).mockResolvedValueOnce({ end: operatorEnd } as unknown as Awaited<ReturnType<typeof createConnection>>)
    .mockResolvedValueOnce({ end: runtimeEnd, query: runtimeQuery } as unknown as Awaited<ReturnType<typeof createConnection>>);
  vi.mocked(provisionRuntimePrincipal).mockImplementation(async (_connection, options) => ({ status: options.mode === 'inspect' ? 'inspected' : 'applied', plan }));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const inspect = () => ['--input', input, '--out', output];
const apply = () => [...inspect(), '--apply', '--credentials', credentials];
describe('runtime principal operator CLI', () => {
  it('defaults to inspection without credentials or account mutation', async () => {
    await main(inspect(), environment());
    expect(provisionRuntimePrincipal).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ mode: 'inspect' }));
    expect(JSON.parse(readFileSync(output, 'utf8')).status).toBe('inspected'); expect(operatorEnd).toHaveBeenCalledOnce();
  });
  it('reserves private credentials, reinspects on apply, and verifies a separate runtime login', async () => {
    await main(apply(), environment()); const secret = JSON.parse(readFileSync(credentials, 'utf8')); const report = readFileSync(output, 'utf8');
    expect(secret.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(vi.mocked(provisionRuntimePrincipal).mock.calls.map(call => call[1].mode)).toEqual(['inspect', 'apply']);
    expect(JSON.parse(report)).toMatchObject({ status: 'applied', effective: { tableCount: 33 } });
    expect(report).not.toContain(secret.password); expect(runtimeEnd).toHaveBeenCalledOnce(); expect(operatorEnd).toHaveBeenCalledOnce();
  });
  it('cannot infer trusted environment from the input target', async () => {
    await expect(main(inspect(), { ENTERPRISE_RUNTIME_DATABASE_URL: environment().ENTERPRISE_RUNTIME_DATABASE_URL })).rejects.toThrow('EXPLICIT_RUNTIME_ENVIRONMENT_REQUIRED');
    expect(createConnection).not.toHaveBeenCalled();
  });
  it('rejects conflicting Railway environment and missing operator credential before connecting', async () => {
    await expect(main(inspect(), { ...environment(), RAILWAY_ENVIRONMENT_NAME: 'production' })).rejects.toThrow('RUNTIME_PRINCIPAL_ENVIRONMENT_CONFLICT');
    await expect(main(inspect(), { ENTERPRISE_RUNTIME_ENVIRONMENT: 'staging' })).rejects.toThrow('ENTERPRISE_RUNTIME_DATABASE_URL_REQUIRED');
    expect(createConnection).not.toHaveBeenCalled();
  });
  it('requires a new credentials output before connecting or changing anything', async () => {
    writeFileSync(credentials, 'preserved'); await expect(main(apply(), environment())).rejects.toThrow();
    expect(createConnection).not.toHaveBeenCalled(); expect(readFileSync(credentials, 'utf8')).toBe('preserved');
  });
  it('marks partial DDL failure incomplete and preserves credentials for operator inspection', async () => {
    vi.mocked(provisionRuntimePrincipal).mockResolvedValueOnce({ status: 'inspected', plan }).mockRejectedValueOnce(new Error('SQL containing a credential must not escape'));
    await expect(main(apply(), environment())).rejects.toThrow();
    const report = JSON.parse(readFileSync(output, 'utf8')); expect(report).toMatchObject({ status: 'incomplete', inspectBeforeRetry: true, code: 'ENTERPRISE_RUNTIME_PRINCIPAL_FAILED' });
    expect(JSON.parse(readFileSync(credentials, 'utf8')).password).toHaveLength(43); expect(operatorEnd).toHaveBeenCalledOnce();
  });
  it('does not replace a receipt or emit connection secrets in error messages', async () => {
    writeFileSync(output, 'preserved'); await expect(main(apply(), environment())).rejects.toThrow(); expect(createConnection).not.toHaveBeenCalled();
    expect(readFileSync(output, 'utf8')).toBe('preserved');
    expect(runtimePrincipalError(new Error('mysql://operator:secret@fixture/railway'))).toBe('ENTERPRISE_RUNTIME_PRINCIPAL_FAILED');
  });
  it.each(['runtime', 'operator'])('keeps one valid incomplete receipt when %s cleanup fails', async connection => {
    (connection === 'runtime' ? runtimeEnd : operatorEnd).mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(main(apply(), environment())).rejects.toThrow('cleanup failed');
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ status: 'incomplete', inspectBeforeRetry: true });
  });
  it('keeps inspection evidence valid when operator cleanup fails', async () => {
    operatorEnd.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(main(inspect(), environment())).rejects.toThrow('cleanup failed');
    expect(JSON.parse(readFileSync(output, 'utf8')).status).toBe('incomplete');
  });
  it.each([{ serverUuid: 'different-server' }, { schema: 'different-schema' }])('rejects a separate-login physical target mismatch %j', async changed => {
    runtimeIdentity = { ...runtimeIdentity, ...changed };
    await expect(main(apply(), environment())).rejects.toThrow('RUNTIME_LOGIN_TARGET_MISMATCH');
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ status: 'incomplete', code: 'RUNTIME_LOGIN_TARGET_MISMATCH' });
    expect(runtimeEnd).toHaveBeenCalledOnce(); expect(operatorEnd).toHaveBeenCalledOnce();
  });
});

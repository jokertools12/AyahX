// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { provisionRuntimePrincipal, type RuntimePrincipalOptions } from '../../server/db/provisionRuntimePrincipal';
import { runtimeSchemaColumns } from '../../server/db/runtimeSchemaContract';
import { hashBytes } from '../../server/utils/canonicalIntegrity';

const target = { environment: 'staging' as const, host: 'fixture-mysql', port: 3306, serverUuid: 'fixture-uuid', schema: 'fixture_ayahx', version: '9.7.0' };
const password = 'fixture-only-generated-password-for-mocked-sql';
const options: RuntimePrincipalOptions = { target, user: 'fixture_api', service: 'api', mode: 'inspect' };
const fullColumns = Object.entries(runtimeSchemaColumns).flatMap(([tableName, columns]) => columns.map(columnName => ({ tableName, columnName })));
function fixture(overrides: { identity?: Record<string, unknown>; mandatoryRoles?: unknown; accounts?: unknown[];
  acquired?: unknown; columns?: unknown[]; fail?: (sql: string) => boolean } = {}) {
  const mutations: string[] = [];
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (overrides.fail?.(sql)) throw new Error('fixture query failure');
    if (sql.startsWith('SELECT DATABASE()')) return [[{ schemaName: target.schema, ...target, ...overrides.identity }]];
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: overrides.acquired ?? 1 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SELECT @@GLOBAL.mandatory_roles')) return [[{ mandatoryRoles: Object.prototype.hasOwnProperty.call(overrides, 'mandatoryRoles') ? overrides.mandatoryRoles : '' }]];
    if (sql.startsWith('SELECT User AS user')) return [overrides.accounts ?? []];
    if (sql.includes('FROM information_schema.COLUMNS')) return [overrides.columns ?? fullColumns];
    if (sql.startsWith('CREATE USER') || sql.startsWith('GRANT ')) { mutations.push(sql); return [{ affectedRows: 0 }]; }
    throw new Error('unexpected fixture query');
  });
  return { connection: { query } as unknown as Pick<Connection, 'query'>, query, mutations };
}
describe('new runtime MySQL principal provisioning core', () => {
  it('inspects exact target, all-host account absence and31-table columns without account/application mutation', async () => {
    const f = fixture(); const result = await provisionRuntimePrincipal(f.connection, options);
    expect(result.status).toBe('inspected'); expect(result.plan.statements).toHaveLength(31); expect(f.mutations).toEqual([]);
    expect(f.query).toHaveBeenCalledWith('SELECT GET_LOCK(?, 0) AS acquired', [`ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`]);
    expect(f.query).toHaveBeenCalledWith('SELECT User AS user, Host AS host FROM mysql.user WHERE BINARY User = BINARY ?', ['fixture_api']);
    expect(f.query.mock.calls.at(-1)).toEqual(['SELECT RELEASE_LOCK(?)', [`ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`]]);
    expect(f.query.mock.calls.some(([sql]) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b|\bALTER\b|\bDROP\b/.test(sql))).toBe(false);
  });
  it.each(['api', 'skia', 'control'] as const)('creates the new %s account before applying exactly its31 fixed grants', async service => {
    const f = fixture(); const result = await provisionRuntimePrincipal(f.connection, { ...options, service, mode: 'apply', password });
    expect(result.status).toBe('applied'); expect(f.mutations).toHaveLength(32);
    expect(f.query).toHaveBeenCalledWith('CREATE USER ?@? IDENTIFIED BY ?', ['fixture_api', '%', password]);
    expect(f.mutations[0]).toBe('CREATE USER ?@? IDENTIFIED BY ?');
    expect(f.mutations.slice(1)).toEqual(result.plan.statements.map(statement => statement.sql));
    for (const statement of result.plan.statements) expect(f.query).toHaveBeenCalledWith(statement.sql, ['fixture_api', '%']);
    expect(JSON.stringify(result)).not.toContain(password); expect(result).not.toHaveProperty('password');
    expect(f.query.mock.calls.every(([sql]) => !sql.includes(password))).toBe(true);
  });
  it.each(['host', 'port', 'serverUuid', 'schemaName', 'version'])('rejects physical target mismatch %s before locking or DDL', async field => {
    const f = fixture({ identity: { [field]: field === 'port' ? 3307 : 'other' } });
    await expect(provisionRuntimePrincipal(f.connection, options)).rejects.toThrow('RUNTIME_PRINCIPAL_TARGET_MISMATCH');
    expect(f.mutations).toEqual([]); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed inputs/system schemas/user injection/unknown service before SQL', async () => {
    const inputs = [{ ...options, target: { ...target, schema: 'mysql' } }, { ...options, user: "bad'@'%'" },
      { ...options, service: 'worker' }, { ...options, mode: 'other' }, { ...options, host: 'arbitrary' }];
    for (const input of inputs) {
      const f = fixture(); await expect(provisionRuntimePrincipal(f.connection, input as RuntimePrincipalOptions)).rejects.toThrow();
      expect(f.query).not.toHaveBeenCalled();
    }
  });
  it.each(['%', 'localhost', '127.0.0.1', '10.%'])('refuses an existing same-username principal on host %s without widening it', async host => {
    const f = fixture({ accounts: [{ user: 'fixture_api', host }] });
    await expect(provisionRuntimePrincipal(f.connection, { ...options, mode: 'apply', password })).rejects.toThrow('RUNTIME_PRINCIPAL_ALREADY_EXISTS');
    expect(f.mutations).toEqual([]); expect(f.query.mock.calls.at(-1)?.[0]).toBe('SELECT RELEASE_LOCK(?)');
  });
  it.each(['role@%', '`role`@`%`', null, false, 0])('denies mandatory roles or malformed mandatory_roles metadata %j', async mandatoryRoles => {
    const f = fixture({ mandatoryRoles });
    await expect(provisionRuntimePrincipal(f.connection, options)).rejects.toThrow('RUNTIME_PRINCIPAL_MANDATORY_ROLES_PRESENT');
    expect(f.mutations).toEqual([]);
  });
  it('accepts whitespace-only mandatory_roles as empty but does not modify global settings', async () => {
    const f = fixture({ mandatoryRoles: ' \t ' }); expect((await provisionRuntimePrincipal(f.connection, options)).status).toBe('inspected');
    expect(f.query.mock.calls.some(([sql]) => /\bSET\b/.test(sql))).toBe(false);
  });
  it('checks metadata completeness before CREATE USER and does not cache readiness across attempts', async () => {
    const f = fixture({ columns: fullColumns.filter(row => !(row.tableName === 'catalog_role_grants' && row.columnName === 'revocation_audit_event_id')) });
    await expect(provisionRuntimePrincipal(f.connection, { ...options, mode: 'apply', password })).rejects.toThrow('RUNTIME_SCHEMA_INCOMPLETE');
    expect(f.mutations).toEqual([]); expect(f.query.mock.calls.at(-1)?.[0]).toBe('SELECT RELEASE_LOCK(?)');
    const valid = fixture(); await provisionRuntimePrincipal(valid.connection, options); await provisionRuntimePrincipal(valid.connection, options);
    expect(valid.query.mock.calls.filter(([sql]) => sql.includes('information_schema.COLUMNS'))).toHaveLength(2);
  });
  it.each([undefined, '', 'x'.repeat(31), 'x'.repeat(257)])('requires32..256 password characters for apply before SQL', async invalidPassword => {
    const f = fixture(); await expect(provisionRuntimePrincipal(f.connection, { ...options, mode: 'apply', password: invalidPassword })).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([32, 256])('accepts the password length boundary %s without returning the password', async length => {
    const f = fixture(); const result = await provisionRuntimePrincipal(f.connection, { ...options, mode: 'apply', password: 'x'.repeat(length) });
    expect(result.status).toBe('applied'); expect(JSON.stringify(result)).not.toContain('x'.repeat(length));
  });
  it('does not release an unacquired lock or issue mutations when the lock is busy', async () => {
    const f = fixture({ acquired: 0 });
    await expect(provisionRuntimePrincipal(f.connection, options)).rejects.toThrow('RUNTIME_PRINCIPAL_LOCK_UNAVAILABLE');
    expect(f.mutations).toEqual([]); expect(f.query.mock.calls.some(([sql]) => sql.includes('RELEASE_LOCK'))).toBe(false);
  });
  it.each(['CREATE USER', 'GRANT SELECT, INSERT ON'])('preserves incomplete auto-committed state on %s failure without retry/cleanup/rollback', async failurePrefix => {
    const f = fixture({ fail: sql => sql.startsWith(failurePrefix) });
    await expect(provisionRuntimePrincipal(f.connection, { ...options, mode: 'apply', password })).rejects.toThrow('fixture query failure');
    expect(f.query.mock.calls.filter(([sql]) => sql.startsWith(failurePrefix))).toHaveLength(1);
    expect(f.query.mock.calls.some(([sql]) => /IF NOT EXISTS|ALTER USER|DROP USER|ROLLBACK|START TRANSACTION|COMMIT/.test(sql))).toBe(false);
    expect(f.query.mock.calls.at(-1)?.[0]).toBe('SELECT RELEASE_LOCK(?)');
    if (failurePrefix.startsWith('GRANT')) expect(f.mutations[0]).toBe('CREATE USER ?@? IDENTIFIED BY ?');
  });
  it('releases the schema lock if schema/role/account metadata inspection fails', async () => {
    for (const fragment of ['SELECT @@GLOBAL.mandatory_roles', 'SELECT User AS user', 'SELECT TABLE_NAME']) {
      const f = fixture({ fail: sql => sql.startsWith(fragment) });
      await expect(provisionRuntimePrincipal(f.connection, options)).rejects.toThrow('fixture query failure');
      expect(f.mutations).toEqual([]); expect(f.query.mock.calls.at(-1)?.[0]).toBe('SELECT RELEASE_LOCK(?)');
    }
  });
});

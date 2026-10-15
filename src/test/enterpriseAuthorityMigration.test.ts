// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection } from 'mysql2/promise';
import { hashBytes } from '../../server/utils/canonicalIntegrity';
import { additiveShapeSha256 as digest, inspectAdditiveShapes, type AdditiveRehearsalReceipt, type AdditiveTarget, type TriggerShape } from '../../server/db/migrations/additiveMigrationRunner';
import { authorityInspectors, authorityMigrationDefinition as definition, runEnterpriseAuthorityMigration } from '../../server/db/migrations/enterpriseAuthority';
import { authorityMigrationErrorMessage, main } from '../../scripts/enterprise-authority-migration';
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('mysql2/promise', () => ({ createConnection: connect }));

const now = Date.now();
const target: AdditiveTarget = { environment: 'staging', host: 'fixture-mysql', port: 3306, serverUuid: 'fixture-uuid', schema: 'ayahx', version: '9.7.0' };
const restored: AdditiveTarget = { ...target, environment: 'local', schema: 'ayahx_rehearsal_authority_fixture' };
const settings = { sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', foreignKeyChecks: 1 as const };
const originalTables = Object.fromEntries(definition.requiredTables.map(name => [name, `CREATE TABLE \`${name}\` (id int)`]));
const baseGrant = 'CREATE TABLE `catalog_role_grants` (\n  `id` varchar(200),\n  KEY `idx_catalog_grant_created_event` (`granting_audit_event_id`),\n  KEY `idx_catalog_grant_revoked_event` (`revocation_audit_event_id`)\n) ENGINE=InnoDB COLLATE=utf8mb4_bin';
const createdFk = '  CONSTRAINT `fk_catalog_grant_created_event` FOREIGN KEY (`granting_audit_event_id`) REFERENCES `catalog_audit_events` (`id`)';
const revokedFk = '  CONSTRAINT `fk_catalog_grant_revoked_event` FOREIGN KEY (`revocation_audit_event_id`) REFERENCES `catalog_audit_events` (`id`)';
const finalGrant = baseGrant.replace('\n)', ',\n' + createdFk + ',\n' + revokedFk + '\n)');
const ownTables = { catalog_role_grants: finalGrant, catalog_audit_events: 'CREATE TABLE `catalog_audit_events` (id varchar(200), CHECK (id <> \'\')) COLLATE=utf8mb4_bin' };
const trigger = (name: string): TriggerShape => ({ Trigger: name, sql_mode: settings.sqlMode,
  'SQL Original Statement': `CREATE DEFINER=\`fixture\`@\`%\` TRIGGER \`${name}\` BEFORE ${name.endsWith('delete') ? 'DELETE' : 'UPDATE'} ON \`catalog_audit_events\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CATALOG_AUDIT_APPEND_ONLY'`,
  character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_unicode_ci', 'Database Collation': 'utf8mb4_unicode_ci' });
const ownTriggers = Object.fromEntries(definition.triggers.map(name => [name, trigger(name)]));
const originalTriggers = { legacy_trigger: { ...trigger('legacy_trigger'), 'SQL Original Statement': 'CREATE DEFINER=`fixture`@`%` TRIGGER `legacy_trigger` BEFORE UPDATE ON `users` FOR EACH ROW SET NEW.id = NEW.id' } };
const baselineSha = digest({ tables: originalTables, triggers: originalTriggers });
const restoration = () => ({ migrationId: definition.id, migrationSha256: hashBytes(definition.sql), backup: { source: target,
  sha256: 'a'.repeat(64), capturedAt: now - 3000, baselineSha256: baselineSha }, restored, restoredAt: now - 2000,
  verificationEvidenceSha256: 'b'.repeat(64), verifiedBaselineSha256: baselineSha });
const receipt = (): AdditiveRehearsalReceipt => ({ ...restoration(), completedAt: now - 1000,
  ownShapes: { tables: { ...ownTables }, triggers: structuredClone(ownTriggers) }, ownShapesSha256: digest({ tables: ownTables, triggers: ownTriggers }), sessionSettings: settings });
function fake(tables: Record<string, string> = originalTables, triggers: Record<string, TriggerShape> = originalTriggers,
  identity = target, session: { sqlMode: string; foreignKeyChecks: number } = settings) {
  const state = { tables: { ...tables }, triggers: structuredClone(triggers) };
  const mutations: string[] = [];
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE()')) return [[{ ...identity, schemaName: identity.schema }]];
    if (sql.startsWith('SELECT @@SESSION.sql_mode')) return [[session]];
    if (sql === 'SHOW FULL TABLES') return [Object.keys(state.tables).map(name => ({ name, type: 'BASE TABLE' }))];
    if (sql.startsWith('SHOW CREATE TABLE ')) { const name = sql.slice(18).replace(/`/g, ''); return [[{ Table: name, 'Create Table': state.tables[name] }]]; }
    if (sql === 'SHOW TRIGGERS') return [Object.keys(state.triggers).map(Trigger => ({ Trigger }))];
    if (sql.startsWith('SHOW CREATE TRIGGER ')) { const name = sql.slice(20).replace(/`/g, ''); return [[{ ...state.triggers[name], Created: '2026-10-15 10:00:00.00' }]]; }
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    mutations.push(sql);
    if (sql.startsWith('CREATE TABLE catalog_role_grants')) state.tables.catalog_role_grants = baseGrant;
    else if (sql.startsWith('CREATE TABLE catalog_audit_events')) state.tables.catalog_audit_events = ownTables.catalog_audit_events;
    else if (sql.startsWith('ALTER TABLE catalog_role_grants')) state.tables.catalog_role_grants = finalGrant;
    else if (sql.startsWith('CREATE TRIGGER ')) { const name = sql.split(/\s+/)[2]; state.triggers[name] = ownTriggers[name]; }
    else throw new Error('UNEXPECTED_MUTATION');
    return [{}];
  });
  const connection = { query, end: vi.fn(async () => undefined) } as unknown as Connection;
  return { connection, query, mutations, state };
}
const apply = (db: ReturnType<typeof fake>, rehearsal: unknown = receipt()) => runEnterpriseAuthorityMigration(db.connection, { target, mode: 'apply', rehearsal, now });
const temporaryFiles: string[] = [];
let directory: string | undefined;
function file(name: string, value: unknown) {
  directory ??= mkdtempSync(join(tmpdir(), 'ayahx-authority-test-'));
  const path = join(directory, name); writeFileSync(path, JSON.stringify(value)); temporaryFiles.push(path); return path;
}
beforeEach(() => { connect.mockReset(); });
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporaryFiles.splice(0)) { try { unlinkSync(path); } catch { /* absent test output */ } }
  if (directory) { rmdirSync(directory); directory = undefined; }
});

describe('002 additive authority migration runner', () => {
  it('defaults to read-only dry-run with complete raw table/trigger evidence and no lock', async () => {
    const db = fake(); const report = await runEnterpriseAuthorityMigration(db.connection, { target, now });
    expect(report.mode).toBe('dry-run'); expect(report.pending).toHaveLength(5); expect(db.mutations).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('GET_LOCK'))).toBe(false);
    expect(report.before.raw.triggers.legacy_trigger.Created).toBeDefined();
    expect(report.before.shapes.triggers.legacy_trigger).not.toHaveProperty('Created');
    expect(report.baselineSha256).toBe(baselineSha);
  });
  it.each(['host', 'port', 'serverUuid', 'schema', 'version', 'environment'] as const)('binds target and receipt to exact %s', async field => {
    const changed = { ...target, [field]: field === 'port' ? 3307 : field === 'environment' ? 'production' : 'different' };
    const db = fake();
    await expect(runEnterpriseAuthorityMigration(db.connection, { target: changed, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow();
    expect(db.mutations).toEqual([]);
  });
  it('rejects missing/tampered/wrong-migration/expired/unrestored receipts without DDL', async () => {
    for (const r of [undefined, {}, { ...receipt(), migrationId: '001-enterprise-catalog' }, { ...receipt(), migrationSha256: 'c'.repeat(64) },
      { ...receipt(), ownShapesSha256: 'c'.repeat(64) }, { ...receipt(), completedAt: now + 1 },
      { ...receipt(), backup: { ...receipt().backup, capturedAt: now - 86400001 } },
      { ...receipt(), verifiedBaselineSha256: 'c'.repeat(64) }, { ...receipt(), restored: { ...restored, schema: 'unsafe' } }]) {
      const db = fake();
      await expect(runEnterpriseAuthorityMigration(db.connection, { target, mode: 'apply', rehearsal: r, now })).rejects.toThrow();
      expect(db.mutations).toEqual([]);
    }
    const db = fake(); const production = { ...target, environment: 'production' as const };
    const productionDb = fake(originalTables, originalTriggers, production);
    await expect(runEnterpriseAuthorityMigration(productionDb.connection, { target: production, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow('REHEARSAL_RECEIPT_MISMATCH');
    expect(db.mutations).toEqual([]); expect(productionDb.mutations).toEqual([]);
  });
  it.each([{ sqlMode: 'NO_ENGINE_SUBSTITUTION', foreignKeyChecks: 1 }, { ...settings, foreignKeyChecks: 0 }])('rejects unsafe session %j before any DDL', async session => {
    for (const mode of ['rehearse', 'apply'] as const) {
      const db = fake(originalTables, originalTriggers, target, session);
      await expect(runEnterpriseAuthorityMigration(db.connection, { target, mode, rehearsal: receipt(), now })).rejects.toThrow('UNSAFE_SESSION_SETTINGS');
      expect(db.mutations).toEqual([]);
    }
    const db = fake(originalTables, originalTriggers, target, session);
    expect((await runEnterpriseAuthorityMigration(db.connection, { target, now })).sessionSafe).toBe(false);
  });
  it('rejects changed safe session settings and original table or trigger baseline drift', async () => {
    for (const db of [fake({ ...originalTables, users: originalTables.users + ' changed' }),
      fake(originalTables, { legacy_trigger: { ...originalTriggers.legacy_trigger, sql_mode: 'STRICT_ALL_TABLES' } }),
      fake(originalTables, originalTriggers, target, { ...settings, sqlMode: 'STRICT_ALL_TABLES' })]) {
      await expect(apply(db)).rejects.toThrow(); expect(db.mutations).toEqual([]);
    }
  });
  it('runs five ordered DDL steps and preserves every pre-existing table and trigger', async () => {
    const db = fake(); const report = await apply(db);
    expect(db.mutations).toEqual(definition.steps.map(step => step.sql));
    expect(report.after?.shapes.tables).toEqual({ ...originalTables, ...ownTables });
    expect(report.after?.shapes.triggers).toEqual({ ...originalTriggers, ...ownTriggers });
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('GET_LOCK'))[0][0]).toContain(`ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`);
  });
  it('resumes each exact completed prefix including missing BOTH final FKs and individual triggers', async () => {
    const states = [fake({ ...originalTables, catalog_role_grants: baseGrant }),
      fake({ ...originalTables, ...ownTables, catalog_role_grants: baseGrant }), fake({ ...originalTables, ...ownTables }),
      fake({ ...originalTables, ...ownTables }, { ...originalTriggers, catalog_audit_no_update: ownTriggers.catalog_audit_no_update }),
      fake({ ...originalTables, ...ownTables }, { ...originalTriggers, ...ownTriggers })];
    for (const [index, db] of states.entries()) { await apply(db); expect(db.mutations).toEqual(definition.steps.slice(index + 1).map(step => step.sql)); }
  });
  it('rejects single/wrong final FK, lost explicit index and nonprefix states before writes', async () => {
    for (const changed of [baseGrant.replace('\n)', ',\n' + createdFk + '\n)'), finalGrant.replace('FOREIGN KEY (`granting_audit_event_id`)', 'FOREIGN KEY (`id`)'),
      baseGrant.replace('  KEY `idx_catalog_grant_created_event` (`granting_audit_event_id`),\n', '')]) {
      const db = fake({ ...originalTables, ...ownTables, catalog_role_grants: changed });
      await expect(apply(db)).rejects.toThrow('ADDITIVE_TABLE_MISMATCH'); expect(db.mutations).toEqual([]);
    }
    const db = fake({ ...originalTables, ...ownTables, catalog_role_grants: baseGrant }, { ...originalTriggers, ...ownTriggers });
    await expect(apply(db)).rejects.toThrow('NONPREFIX_PARTIAL_MIGRATION'); expect(db.mutations).toEqual([]);
  });
  it.each(['SQL Original Statement', 'sql_mode', 'character_set_client', 'collation_connection', 'Database Collation'] as const)('preserves exact trigger %s metadata', async field => {
    const changed = { ...ownTriggers.catalog_audit_no_update, [field]: ownTriggers.catalog_audit_no_update[field] + ' changed' };
    const db = fake({ ...originalTables, ...ownTables }, { ...originalTriggers, ...ownTriggers, catalog_audit_no_update: changed });
    await expect(apply(db)).rejects.toThrow('ADDITIVE_TRIGGER_MISMATCH'); expect(db.mutations).toEqual([]);
  });
  it('ignores ONLY trigger Created, retaining a different definer as a mismatch', async () => {
    const db = fake(); const a = await inspectAdditiveShapes(db.connection, authorityInspectors);
    const implementation = db.query.getMockImplementation()!;
    db.query.mockImplementation(async sql => sql.startsWith('SHOW CREATE TRIGGER')
      ? [[{ ...originalTriggers.legacy_trigger, Created: 'later' }]] : implementation(sql));
    const b = await inspectAdditiveShapes(db.connection, authorityInspectors);
    expect(digest(a.shapes)).toBe(digest(b.shapes)); expect(a.raw.triggers).not.toEqual(b.raw.triggers);
    const changed = { ...ownTriggers.catalog_audit_no_update, 'SQL Original Statement': ownTriggers.catalog_audit_no_update['SQL Original Statement'].replace('`fixture`@`%`', '`other`@`%`') };
    await expect(apply(fake({ ...originalTables, ...ownTables }, { ...originalTriggers, ...ownTriggers, catalog_audit_no_update: changed }))).rejects.toThrow('ADDITIVE_TRIGGER_MISMATCH');
  });
  it('rehearses fresh restored scratch and refuses interrupted first rehearsal without a new restore', async () => {
    const db = fake(originalTables, originalTriggers, restored);
    const report = await runEnterpriseAuthorityMigration(db.connection, { target: restored, mode: 'rehearse', restoration: restoration(), now });
    expect(report.receipt?.ownShapes).toEqual({ tables: ownTables, triggers: ownTriggers });
    expect(report.receipt?.sessionSettings).toEqual(settings);
    const interrupted = fake({ ...originalTables, catalog_role_grants: baseGrant }, originalTriggers, restored);
    await expect(runEnterpriseAuthorityMigration(interrupted.connection, { target: restored, mode: 'rehearse', restoration: restoration(), now })).rejects.toThrow('FRESH_RESTORED_REHEARSAL_REQUIRED');
    expect(interrupted.mutations).toEqual([]);
  });
  it('detects missing or changed post-DDL triggers and protected schema changes', async () => {
    for (const change of ['missing', 'changed', 'protected']) {
      const db = fake(); const implementation = db.query.getMockImplementation()!;
      db.query.mockImplementation(async sql => {
        const result = await implementation(sql);
        if (sql.startsWith('CREATE TRIGGER catalog_audit_no_delete')) {
          if (change === 'missing') delete db.state.triggers.catalog_audit_no_delete;
          if (change === 'changed') db.state.triggers.catalog_audit_no_delete = { ...ownTriggers.catalog_audit_no_delete, sql_mode: 'changed' };
          if (change === 'protected') db.state.tables.users += ' changed';
        }
        return result;
      });
      await expect(apply(db)).rejects.toThrow(change === 'protected' ? 'PROTECTED_SCHEMA_CHANGED' : 'POST_MIGRATION_SCHEMA_MISMATCH');
    }
  });
  it('leaves completed DDL intact on failure, releases lock and never pretends rollback', async () => {
    const db = fake(); const implementation = db.query.getMockImplementation()!;
    db.query.mockImplementation(async sql => { if (sql.startsWith('CREATE TRIGGER')) throw new Error('DDL failed'); return implementation(sql); });
    await expect(apply(db)).rejects.toThrow('DDL failed');
    expect(db.state.tables.catalog_role_grants).toBe(finalGrant);
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('RELEASE_LOCK');
    expect(db.query.mock.calls.some(([sql]) => /ROLLBACK|DROP TABLE|INSERT INTO/.test(sql))).toBe(false);
  });
  it('requires new private output reservation before connecting, and validates CLI modes locally', async () => {
    vi.stubEnv('ENTERPRISE_AUTHORITY_DATABASE_URL', 'mysql://fixture:fixture@invalid/fixture');
    await expect(main(['--apply'])).rejects.toThrow('EXPLICIT_TARGET_REQUIRED');
    await expect(main(['--apply', '--rehearse'])).rejects.toThrow('CHOOSE_ONE_MUTATION_MODE');
    const identity = file('target.json', target); const evidence = file('receipt.json', receipt()); const output = file('existing.json', {});
    await expect(main(['--target', identity, '--apply', '--rehearsal', evidence, '--out', output])).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled(); expect(readFileSync(output, 'utf8')).toBe('{}');
    const next = join(directory!, 'next.json'); temporaryFiles.push(next);
    const db = fake(); connect.mockImplementationOnce(async () => { expect(readFileSync(next, 'utf8')).toBe(''); return db.connection; });
    await main(['--target', identity, '--apply', '--rehearsal', evidence, '--out', next]);
    expect(JSON.parse(readFileSync(next, 'utf8')).migrationId).toBe(definition.id);
    expect(db.connection.end).toHaveBeenCalledOnce();
  });
  it('sanitizes connection/SQL errors instead of logging raw credentials or SQL', () => {
    expect(authorityMigrationErrorMessage(new Error('mysql://private:secret@host SQL invalid'))).toBe('ENTERPRISE_AUTHORITY_MIGRATION_FAILED');
    expect(authorityMigrationErrorMessage(new Error('TARGET_IDENTITY_MISMATCH'))).toBe('TARGET_IDENTITY_MISMATCH');
  });
});

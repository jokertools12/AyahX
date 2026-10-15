// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { canonicalJson, catalogTables, hashBytes, migrationSha256, migrationSql, normalizeSchemaShape, inspectShapes,
  runEnterpriseCatalogMigration, validatedSnapshot, type RehearsalReceipt, type TargetIdentity } from '../../server/db/migrations/enterpriseCatalog';

const now = Date.now();
const target: TargetIdentity = { environment: 'staging', host: 'mysql-fixture', port: 3306,
  serverUuid: 'fixture-uuid', schema: 'ayahx', version: '8.0.40' };
const restored: TargetIdentity = { ...target, environment: 'local', schema: 'ayahx_rehearsal_fixture' };
const original = Object.fromEntries(['users', 'user_roles', 'render_jobs', 'saved_videos', 'alignment_documents', 'system_settings']
  .map(name => [name, `CREATE TABLE \`${name}\` (id int)`]));
const baseHash = hashBytes(canonicalJson(original));
const settings = { sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', foreignKeyChecks: 1 as const };
const circular = '\n  CONSTRAINT `fk_catalog_current_coverage` FOREIGN KEY (`id`, `current_availability_revision`) REFERENCES `recitation_coverage` (`recording_id`, `revision`)';
const shapes = Object.fromEntries(catalogTables.map(name => [name, `CREATE TABLE \`${name}\` (\n  id varchar(200)${name === 'reciter_recordings' ? ',' + circular : ''}\n) COLLATE=utf8mb4_bin`]));
const receipt = (): RehearsalReceipt => ({ backup: { source: target, sha256: 'a'.repeat(64), capturedAt: now - 3000,
  baselineSha256: baseHash }, restored, restoredAt: now - 2000, verificationEvidenceSha256: 'b'.repeat(64),
  verifiedBaselineSha256: baseHash, migrationSha256, completedAt: now - 1000,
  shapes: { ...shapes }, shapesSha256: hashBytes(canonicalJson(shapes)), sessionSettings: settings });
function fake(initial: Record<string, string> = original, identity = target, session: { sqlMode: string; foreignKeyChecks: number } = settings) {
  const state = { ...initial };
  const mutations: string[] = [];
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE()')) return [[{ ...identity, schemaName: identity.schema }]];
    if (sql.startsWith('SELECT @@SESSION.sql_mode')) return [[session]];
    if (sql === 'SHOW FULL TABLES') return [Object.keys(state).map(name => ({ tableName: name, tableType: 'BASE TABLE' }))];
    if (sql.startsWith('SHOW CREATE TABLE')) { const name = sql.slice(18).replace(/`/g, ''); return [[{ Table: name, 'Create Table': state[name] }]]; }
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    mutations.push(sql);
    if (sql.startsWith('CREATE TABLE')) {
      const name = sql.split(/\s+/)[2];
      state[name] = shapes[name].replace(',' + circular, '');
    } else if (sql.startsWith('ALTER TABLE reciter_recordings')) state.reciter_recordings = shapes.reciter_recordings;
    else throw new Error('UNEXPECTED_MUTATION');
    return [{}];
  });
  return { connection: { query } as unknown as Connection, query, mutations, state };
}
describe('inactive enterprise catalog migration', () => {
  it('canonicalizes only redundant column charset from restored SHOW CREATE, retaining raw evidence', async () => {
    const source = 'CREATE TABLE `users` (\n  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    const restoredShape = source.replace('varchar(36) COLLATE', 'varchar(36) CHARACTER SET utf8mb4 COLLATE');
    const db = fake({ ...original, users: restoredShape });
    const raw: Record<string, string> = {};
    expect((await inspectShapes(db.connection, raw)).users).toBe(source);
    expect(raw.users).toBe(restoredShape);
    expect(hashBytes(normalizeSchemaShape(restoredShape))).toBe(hashBytes(source));
    for (const different of [restoredShape.replace('CHARACTER SET utf8mb4', 'CHARACTER SET latin1'),
      restoredShape.replace('utf8mb4_unicode_ci NOT NULL', 'utf8mb4_bin NOT NULL'), restoredShape.replace('varchar(36)', 'varchar(37)'),
      restoredShape.replace('NOT NULL', "NOT NULL DEFAULT 'x'"), restoredShape.replace('PRIMARY KEY', 'UNIQUE KEY')])
      expect(normalizeSchemaShape(different)).not.toBe(source);
    const literal = "  `kind` enum('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin') COLLATE utf8mb4_bin DEFAULT ' AUTO_INCREMENT=7'";
    expect(normalizeSchemaShape(literal)).toBe(literal);
    expect(normalizeSchemaShape(literal.replace(') COLLATE', ') CHARACTER SET utf8mb4 COLLATE'))).toBe(literal);
  });
  it('defaults to dry-run with no lock or DDL/DML mutation', async () => {
    const db = fake();
    const report = await runEnterpriseCatalogMigration(db.connection, { target, now });
    expect(report.mode).toBe('dry-run');
    expect(report.pending).toHaveLength(6);
    expect(db.mutations).toEqual([]);
    expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT ') || sql.startsWith('SHOW '))).toBe(true);
  });
  it.each(['schema', 'host', 'port', 'serverUuid', 'environment', 'version'] as const)('binds apply receipt to exact target %s', async key => {
    const db = fake();
    const modified = { ...target, [key]: key === 'port' ? 3307 : key === 'environment' ? 'production' : 'changed' };
    await expect(runEnterpriseCatalogMigration(db.connection, { target: modified, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow();
    expect(db.mutations).toEqual([]);
  });
  it('requires a complete receipt and rejects source/environment substitution', async () => {
    for (const rehearsal of [undefined, {}, { ...receipt(), migrationSha256: 'c'.repeat(64) },
      { ...receipt(), shapesSha256: 'c'.repeat(64) }, { ...receipt(), completedAt: now + 1 },
      { ...receipt(), backup: { ...receipt().backup, baselineSha256: 'c'.repeat(64) } },
      { ...receipt(), backup: { ...receipt().backup, capturedAt: now - 86400001 } }]) {
      const db = fake();
      await expect(runEnterpriseCatalogMigration(db.connection, { target, mode: 'apply', rehearsal, now })).rejects.toThrow();
      expect(db.mutations).toEqual([]);
    }
  });
  it('fails on changed restored baseline or existing incompatible catalog before mutation', async () => {
    for (const state of [{ ...original, users: 'CREATE TABLE users (changed int)' },
      { ...original, quran_data_sources: 'CREATE TABLE quran_data_sources (unexpected int)' }]) {
      const db = fake(state);
      await expect(runEnterpriseCatalogMigration(db.connection, { target, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow();
      expect(db.mutations).toEqual([]);
    }
  });
  it('applies six additive DDL statements, inspects after and resumes missing final FK only', async () => {
    const db = fake();
    await runEnterpriseCatalogMigration(db.connection, { target, mode: 'apply', rehearsal: receipt(), now });
    expect(db.mutations).toHaveLength(6);
    expect(Object.fromEntries(Object.keys(original).map(name => [name, db.state[name]]))).toEqual(original);
    const interrupted = fake({ ...original, ...shapes, reciter_recordings: shapes.reciter_recordings.replace(',' + circular, '') });
    await runEnterpriseCatalogMigration(interrupted.connection, { target, mode: 'apply', rehearsal: receipt(), now });
    expect(interrupted.mutations).toHaveLength(1);
    expect(interrupted.mutations[0]).toMatch(/^ALTER TABLE reciter_recordings ADD CONSTRAINT/);
    const complete = fake({ ...original, ...shapes });
    await runEnterpriseCatalogMigration(complete.connection, { target, mode: 'apply', rehearsal: receipt(), now });
    expect(complete.mutations).toHaveLength(0);
  });
  it('rehearses only a fresh restored named scratch with verified source baseline', async () => {
    const { migrationSha256: _, shapes: __, shapesSha256: ___, completedAt: ____, sessionSettings: _____, ...restoration } = receipt();
    const db = fake(original, restored);
    const report = await runEnterpriseCatalogMigration(db.connection, { target: restored, mode: 'rehearse', restoration, now });
    expect(report.receipt?.migrationSha256).toBe(migrationSha256);
    expect(report.receipt?.shapesSha256).toBe(hashBytes(canonicalJson(shapes)));
    expect(report.receipt?.sessionSettings).toEqual(settings);
    const live = fake();
    await expect(runEnterpriseCatalogMigration(live.connection, { target, mode: 'rehearse', restoration, now })).rejects.toThrow('FRESH_RESTORED_REHEARSAL_REQUIRED');
    expect(live.mutations).toEqual([]);
    const interrupted = fake({ ...original, quran_data_sources: shapes.quran_data_sources }, restored);
    await expect(runEnterpriseCatalogMigration(interrupted.connection, { target: restored, mode: 'rehearse', restoration, now })).rejects.toThrow('FRESH_RESTORED_REHEARSAL_REQUIRED');
    expect(interrupted.mutations).toEqual([]);
  });
  it.each([{ ...settings, sqlMode: 'NO_ENGINE_SUBSTITUTION' }, { ...settings, foreignKeyChecks: 0 }])('rejects unsafe session before rehearsal/apply DDL: %j', async session => {
    for (const mode of ['rehearse', 'apply'] as const) {
      const db = fake(original, target, session);
      await expect(runEnterpriseCatalogMigration(db.connection, { target, mode, rehearsal: receipt(), now })).rejects.toThrow('UNSAFE_SESSION_SETTINGS');
      expect(db.mutations).toEqual([]);
    }
    const db = fake(original, target, session);
    expect((await runEnterpriseCatalogMigration(db.connection, { target, now })).sessionSafe).toBe(false);
    expect(db.mutations).toEqual([]);
  });
  it('rejects changed or unsafe receipt session settings without DDL', async () => {
    for (const sessionSettings of [{ ...settings, sqlMode: 'STRICT_ALL_TABLES' }, { ...settings, sqlMode: '' }]) {
      const db = fake();
      await expect(runEnterpriseCatalogMigration(db.connection, { target, mode: 'apply', rehearsal: { ...receipt(), sessionSettings }, now })).rejects.toThrow('REHEARSAL_RECEIPT_MISMATCH');
      expect(db.mutations).toEqual([]);
    }
  });
  it('releases lock after an interrupted DDL failure without pretending rollback', async () => {
    const db = fake();
    db.query.mockRejectedValueOnce(new Error('identity failure'));
    await expect(runEnterpriseCatalogMigration(db.connection, { target, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow('identity failure');
    expect(db.mutations).toEqual([]);
    const failing = fake();
    const run = failing.query.getMockImplementation()!;
    failing.query.mockImplementation(async sql => { if (sql.startsWith('CREATE TABLE mushaf_profiles')) throw new Error('DDL failure'); return run(sql); });
    await expect(runEnterpriseCatalogMigration(failing.connection, { target, mode: 'apply', rehearsal: receipt(), now })).rejects.toThrow('DDL failure');
    expect(failing.state.quran_data_sources).toBeDefined();
    expect(failing.query.mock.calls.at(-1)?.[0]).toContain('RELEASE_LOCK');
    expect(failing.query.mock.calls.some(([sql]) => /ROLLBACK|DROP|DELETE|UPDATE|INSERT/.test(sql))).toBe(false);
  });
  it('defines only the five new tables, inactive checks, binary IDs and no existing table alteration', () => {
    expect([...migrationSql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1])).toEqual(catalogTables);
    expect(migrationSql.match(/COLLATE=utf8mb4_bin/g)).toHaveLength(5);
    expect(migrationSql).toContain('VARCHAR(200)');
    expect(migrationSql).toContain('CHECK (enabled = FALSE)');
    expect(migrationSql).toContain('CHECK (active = FALSE)');
    expect(migrationSql).not.toMatch(/IF NOT EXISTS|INSERT INTO|UPDATE |DELETE FROM|DROP TABLE/);
  });
  it('sorts JSON keys deterministically and preserves identifier case and exact text bytes', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(canonicalJson({ a: { b: 3, y: 2 }, z: 1 }));
    expect(hashBytes(canonicalJson({ id: 'Reader' }))).not.toBe(hashBytes(canonicalJson({ id: 'reader' })));
    expect(hashBytes('é')).not.toBe(hashBytes('e\u0301'));
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson(new Array(2))).toThrow();
    const snapshot = { reciterId: 'Reader', recordingId: 'R'.repeat(200), riwayahCode: 'fixture', mushafProfileId: 'fixture',
      numberingSystem: 'fixture', revision: 'r1', sourceId: 'fixture', sourceRevision: 's1', state: 'unknown',
      issuedAtEpochMs: 1, expiresAtEpochMs: 2, textRevision: 't1', textFingerprint: 'a'.repeat(64), surahAyahCounts: { 1: 7 }, intervals: [] };
    expect(validatedSnapshot(snapshot).snapshot.recordingId).toHaveLength(200);
    expect(validatedSnapshot({ ...snapshot }).sha256).toBe(validatedSnapshot(snapshot).sha256);
    expect(() => validatedSnapshot({ ...snapshot, recordingId: 'R'.repeat(201) })).toThrow();
    expect(() => validatedSnapshot({ ...snapshot, recordingId: ' R' })).toThrow();
  });
});

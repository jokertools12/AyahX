// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ADMIN_ROLES, ADMIN_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../../server/admin/adminPermissions';
import { adminFoundationColumns } from '../../server/db/migrations/006_addAdminFoundation';
import { adminFoundationPlan, runAdminFoundationMigration, validateAdminMigrationPrerequisites, type AdminMigrationOptions, type AdminMigrationSession } from '../../scripts/lib/adminFoundationAcceptance';
import type { Inventory } from '../../scripts/lib/railwayQuranOps';

const fixture = vi.hoisted(() => ({ before: undefined as unknown, after: undefined as unknown, applied: false }));
vi.mock('../../scripts/lib/railwayQuranOps', async original => ({ ...await original<typeof import('../../scripts/lib/railwayQuranOps')>(), captureInventory: vi.fn(async () => fixture.applied ? fixture.after : fixture.before) }));
const now = Date.parse('2026-10-11T12:00:00Z');
function options(): AdminMigrationOptions {
  return { target: 'production', apply: false, now: () => now, rehearsal: { mysql_version: '9.7.2', sql_sha256: adminFoundationPlan().sql_sha256, up_twice_identical: true, down_restored_protected_data: true, reapplied: true, production_writes: 0 } };
}
function buildSession({ connections = 2, corrupt = false, badIndex = false }: { connections?: number; corrupt?: boolean; badIndex?: boolean } = {}) {
  const originalColumns = Object.keys(adminFoundationColumns).flatMap(table => [{ table, column: table === 'admin_roles' ? 'slug' : table === 'admin_user_extensions' ? 'user_id' : 'id', type: 'varchar(36)', nullable: 'NO', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }]);
  originalColumns.push({ table: 'user_roles', column: 'role', type: "enum('admin','moderator','user')", nullable: 'NO', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' });
  const row_counts = Object.fromEntries(['users', 'profiles', 'subscriptions', 'payment_requests', 'saved_videos', 'render_jobs', 'system_settings', 'user_roles', 'notifications', ...Object.keys(adminFoundationColumns)].map(table => [table, 2]));
  Object.assign(row_counts, { quran_surahs: 114, quran_ayahs: 6236, quran_words: 77433, ayah_timings: 422463, admin_roles: 6, admin_permissions: 1 });
  const before = { database: 'railway', mysql_version: '9.7.2', server_uuid: 'fixture-server', columns: originalColumns, tables: Object.keys(row_counts).map(name => ({ name, collation: 'utf8mb4_unicode_ci', engine: 'InnoDB', row_format: 'Dynamic' })), row_counts, checksums: Object.fromEntries(Object.keys(row_counts).map(name => [name, '17'])), critical_counts: Object.fromEntries(['users', 'profiles', 'subscriptions', 'payment_requests', 'saved_videos', 'render_jobs', 'system_settings', 'user_roles', 'notifications'].map(name => [name, row_counts[name]])), d1_counts: { surahs: 114, ayahs: 6236, words: 77433 }, canonical_checksum: 'eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4', triggers: [], events: [], foreign_keys: [] } as unknown as Inventory;
  const addedColumns = Object.entries(adminFoundationColumns).flatMap(([table, fields]) => Object.entries(fields).map(([column, definition]) => ({ table, column, type: /^(ENUM\([^)]*\)|VARCHAR\(\d+\)|BIGINT UNSIGNED|DATETIME\(3\)|BOOLEAN|TEXT|JSON)/iu.exec(definition)![0].toLowerCase().replace('boolean', 'tinyint(1)'), nullable: 'YES', charset: definition.includes('CHARACTER SET') ? 'utf8mb4' : null, collation: definition.includes('CHARACTER SET') ? 'utf8mb4_unicode_ci' : null })));
  const after = structuredClone(before);
  after.columns.push(...addedColumns);
  after.columns.find(c => c.table === 'user_roles' && c.column === 'role')!.type = 'enum(' + [...ADMIN_ROLES, 'user'].map(role => "'" + role + "'").join(',') + ')';
  for (const name of ['permissions', 'admin_auth_attempts', 'admin_catalog_tasks']) after.tables.push({ name, collation: 'utf8mb4_unicode_ci', engine: 'InnoDB', row_format: 'Dynamic' });
  Object.assign(after.row_counts, { permissions: Object.keys(ADMIN_PERMISSIONS).length, admin_auth_attempts: 0, admin_catalog_tasks: 0, admin_roles: 7, admin_permissions: 1 + ADMIN_ROLES.reduce((n, role) => n + DEFAULT_ROLE_PERMISSIONS[role].length, 0) });
  fixture.before = before; fixture.after = after; fixture.applied = false;
  const indexes = [
    ['permissions', 'PRIMARY', 'permission_key'], ['admin_auth_attempts', 'PRIMARY', 'account_hash'], ['admin_auth_attempts', 'idx_admin_attempt_window', 'window_started_at'], ['admin_catalog_tasks', 'PRIMARY', 'id'],
    ['admin_catalog_tasks', 'idx_admin_catalog_task_recitation', 'recitation_id,created_at'], ['admin_catalog_tasks', 'idx_admin_catalog_task_lease', 'status,lease_until,created_at'], ['admin_permissions', 'idx_a1_permission_role', 'role_slug,permission_key'], ['admin_sessions', 'idx_a1_session_user', 'user_id,is_revoked,expires_at'],
    ['audit_logs', 'idx_audit_request', 'request_id'], ['audit_logs', 'idx_audit_entity_time', 'entity_type,entity_id,created_at,id'], ['audit_logs', 'idx_audit_actor_time', 'user_id,created_at,id'],
  ].flatMap(([table, name, fields]) => fields.split(',').map((column, i) => ({ table, name, column, position: i + 1, non_unique: name === 'PRIMARY' ? 0 : 1 })));
  const json = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const session: AdminMigrationSession = {
    read: vi.fn(async sql => {
      if (sql.includes('information_schema.COLUMNS')) return json((fixture.applied ? after.columns : before.columns).map(c => ({ ...c, nullable: 'nullable' in c ? c.nullable : 'NO' })));
      if (sql.includes('information_schema.STATISTICS')) return json(fixture.applied ? indexes.map((row, i) => badIndex && i === 0 ? { ...row, column: 'wrong' } : row) : []);
      if (sql.includes('information_schema.TRIGGERS')) return json(fixture.applied ? ['update', 'delete'].map(event => ({ name: 'ayahx_audit_immutable_' + event, table: 'audit_logs', event: event.toUpperCase(), timing: 'BEFORE', statement: "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_LOG_IMMUTABLE'" })) : []);
      if (sql.startsWith('SHOW GLOBAL')) return `Threads_connected\t${connections}\nmax_connections\t20\nmax_allowed_packet\t67108864\nUptime\t1000\n`;
      if (sql.includes("'slug',slug")) return json((fixture.applied ? ADMIN_ROLES : ADMIN_ROLES.filter(role => role !== 'support')).map(slug => ({ slug, ...(fixture.applied ? { seeded_at: '2026-10-11 12:00:00.000' } : {}) })));
      if (sql.includes("COUNT(*) FROM user_roles")) return '2\n';
      if (sql.includes("'id',id,'role',role_slug")) return json([{ id: 'legacy-permission', role: 'developer', resource: 'legacy', action: 'read' }]);
      if (sql.startsWith('SELECT SHA2')) return ((fixture.applied && corrupt ? 'b' : 'a').repeat(64)) + '\n';
      if (sql.includes("key_name='quran_catalog_v2'")) return 'false\t0\n';
      if (sql.includes("'role',role_slug,'permission',permission_key")) return json(ADMIN_ROLES.flatMap(role => DEFAULT_ROLE_PERMISSIONS[role].map(permission => ({ role, permission }))));
      if (sql.includes("'key',permission_key")) return json(Object.keys(ADMIN_PERMISSIONS).map(key => ({ key })));
      throw new Error('UNEXPECTED_MOCK_SQL');
    }),
    storage: vi.fn(async () => ({ total_bytes: 5000000000, used_bytes: 1000000000, available_bytes: 4000000000 })),
    executeStatements: vi.fn(async (statements, beforeBatch) => {
      for (const [i, statement] of statements.entries()) await beforeBatch?.({ ordinal: i + 1, row_count: statement.rowCount, sql_sha256: 'a'.repeat(64), threads_connected: connections, max_connections: 20 });
      fixture.applied = true;
    }),
    commit: vi.fn(async () => {}), close: vi.fn(),
  };
  return { session, before, after };
}
describe('006 deterministic root-only acceptance with mocked transport', () => {
  it('requires actual rehearsal flags and the exact deterministic SQL hash before transport', () => {
    const o = options(); expect(() => validateAdminMigrationPrerequisites(o)).not.toThrow();
    expect(adminFoundationPlan().sql_sha256).toBe(adminFoundationPlan().sql_sha256);
    for (const field of ['up_twice_identical', 'down_restored_protected_data', 'reapplied'] as const) expect(() => validateAdminMigrationPrerequisites({ ...o, rehearsal: { ...o.rehearsal, [field]: false } })).toThrow('REAL_006_REHEARSAL_REQUIRED');
    expect(() => validateAdminMigrationPrerequisites({ ...o, target: 'staging' })).toThrow('PRODUCTION_TARGET_REQUIRED');
    expect(() => validateAdminMigrationPrerequisites({ ...o, rehearsal: { ...o.rehearsal, sql_sha256: 'wrong' } })).toThrow('REHEARSAL_SQL_CHANGED');
    expect(() => validateAdminMigrationPrerequisites({ ...o, apply: true })).toThrow('VERIFIED_BACKUP_REQUIRED');
  });
  it('dry-runs without a write and publishes hashes rather than original identities or credentials', async () => {
    const { session } = buildSession(), result = await runAdminFoundationMigration(session, options());
    expect(result.passed).toBe(true); expect(session.executeStatements).not.toHaveBeenCalled(); expect(session.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('legacy-permission'); expect(JSON.stringify(result)).not.toContain('encrypted_path');
    expect(result.planned).toMatchObject({ role_upgrades: 2, role_seeds: ['support'], permission_catalog_rows_to_insert: 30 });
    expect(vi.mocked(session.read).mock.calls.filter(([sql]) => sql.startsWith('SELECT SHA2')).every(([sql]) => sql.includes('SHA2(CAST(JSON_OBJECT'))).toBe(true);
  });
  it('stops before writes on connection saturation, missing D1, or disk shortage', async () => {
    const saturated = buildSession({ connections: 20 }); await expect(runAdminFoundationMigration(saturated.session, options())).rejects.toThrow('MYSQL_PREFLIGHT_INVALID');
    const corrupted = buildSession(); corrupted.before.canonical_checksum = 'wrong'; await expect(runAdminFoundationMigration(corrupted.session, options())).rejects.toThrow('D1_PROTECTED_STOP');
    const disk = buildSession(); vi.mocked(disk.session.storage).mockResolvedValue({ total_bytes: 5000, used_bytes: 4500, available_bytes: 500 }); await expect(runAdminFoundationMigration(disk.session, options())).rejects.toThrow('006_SPACE_GUARD');
    for (const s of [saturated.session, corrupted.session, disk.session]) expect(s.executeStatements).not.toHaveBeenCalled();
  });
  it('applies the exact dry-run plan with guarded per-statement batches and validates all schema objects', async () => {
    const { session, before } = buildSession(), o = options();
    const backup = { mysql_version: '9.7.2', checked_at: new Date(now).toISOString(), restored_and_verified: true, encrypted_sha256: 'a'.repeat(64), encrypted_path: 'private.age', row_counts: structuredClone(before.row_counts), checksums: structuredClone(before.checksums) };
    const dry = await runAdminFoundationMigration(session, { ...o, backup });
    const result = await runAdminFoundationMigration(session, { ...o, backup, apply: true, dryRun: dry });
    expect(result.passed).toBe(true); expect(result.collation_nullability_indexes_triggers_verified).toBe(true); expect(session.commit).toHaveBeenCalledOnce();
    const statements = vi.mocked(session.executeStatements).mock.calls[0][0];
    expect(statements.every(row => row.rowCount <= 1000 && row.sql.endsWith(';') && Buffer.byteLength(row.sql) < 256 * 1024)).toBe(true);
    expect(statements.map(row => row.sql).join('\n') + '\n').toBe(adminFoundationPlan().sql);
  });
  it.each([{ corrupt: true, code: 'ORIGINAL_COLUMN_OR_ROLE_PROJECTION_CHANGED' }, { badIndex: true, code: '006_INDEX_MISMATCH' }])('fails closed after simulated apply: $code', async ({ code, ...flags }) => {
    const { session, before } = buildSession(flags), o = options(), backup = { mysql_version: '9.7.2', checked_at: new Date(now).toISOString(), restored_and_verified: true, encrypted_sha256: 'a'.repeat(64), encrypted_path: 'private.age', row_counts: structuredClone(before.row_counts), checksums: structuredClone(before.checksums) };
    const dry = await runAdminFoundationMigration(session, { ...o, backup });
    await expect(runAdminFoundationMigration(session, { ...o, backup, apply: true, dryRun: dry })).rejects.toThrow(code);
  });
  it('rejects changed dry-run state and stale backup before writing', async () => {
    const { session, before } = buildSession(), o = options(), backup = { mysql_version: '9.7.2', checked_at: new Date(now).toISOString(), restored_and_verified: true, encrypted_sha256: 'a'.repeat(64), encrypted_path: 'private.age', row_counts: structuredClone(before.row_counts), checksums: structuredClone(before.checksums) };
    const dry = await runAdminFoundationMigration(session, { ...o, backup });
    await expect(runAdminFoundationMigration(session, { ...o, backup, apply: true, dryRun: { ...dry, planned: {} } })).rejects.toThrow('DRY_RUN_STATE_CHANGED');
    expect(session.executeStatements).not.toHaveBeenCalled();
    expect(() => validateAdminMigrationPrerequisites({ ...o, backup: { ...backup, checked_at: new Date(now - 86400001).toISOString() } })).toThrow('FRESH_VERIFIED_BACKUP_REQUIRED');
  });
});

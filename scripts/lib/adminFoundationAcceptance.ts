import { createHash } from 'node:crypto';
import { ADMIN_FOUNDATION_TABLES, adminFoundationColumns, adminFoundationMigrationSql } from '../../server/db/migrations/006_addAdminFoundation';
import { ADMIN_PERMISSIONS, ADMIN_ROLES, DEFAULT_ROLE_PERMISSIONS } from '../../server/admin/adminPermissions';
import { canonicalAuditJson } from '../../server/services/catalogAudit';
import { captureInventory, ENVIRONMENTS, identifier, type Inventory } from './railwayQuranOps';
import type { SerialSessionEvidence, SerialSqlStatement, SerialBatchEvidence } from './railwayMysqlSession';

const SHA = 'eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4';
const D1 = { surahs: 114, ayahs: 6236, words: 77433 };
const protectedTables = ['users', 'profiles', 'subscriptions', 'payment_requests', 'saved_videos', 'render_jobs', 'system_settings', 'user_roles', 'notifications'] as const;
const lit = (value: string) => "'" + value.replace(/'/gu, "''") + "'";
export const adminSqlDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const check = (ok: unknown, code: string): void => { if (!ok) throw new Error(code); };
const lines = (value: string): string[] => value.trim().split(/\r?\n/u).filter(Boolean);
const jsonRows = <T>(value: string): T[] => lines(value).map(row => JSON.parse(row) as T);
const stable = (value: unknown): string => canonicalAuditJson(value);
export function adminFoundationPlan() {
  const sql = adminFoundationMigrationSql().map(statement => statement + ';').join('\n') + '\n';
  return { sql, sql_sha256: adminSqlDigest(sql), statements: adminFoundationMigrationSql().map(sql => ({ sql: sql + ';', rowCount: 0 })) };
}
export interface AdminMigrationSession {
  read(sql: string): Promise<string>;
  storage(): Promise<{ total_bytes: number; used_bytes: number; available_bytes: number }>;
  executeStatements(statements: readonly SerialSqlStatement[], before?: (row: SerialBatchEvidence) => Promise<void>): Promise<void>;
  commit(): Promise<void>;
  close(): Promise<SerialSessionEvidence>;
}
export interface AdminRehearsalProof { mysql_version: string; up_twice_identical: boolean; down_restored_protected_data: boolean; reapplied: boolean; production_writes: number; sql_sha256: string }
export interface AdminBackupProof { mysql_version: string; checked_at: string; restored_and_verified: boolean; encrypted_sha256: string; encrypted_path: string; row_counts: Record<string, number>; checksums: Record<string, string | null> }
export interface AdminMigrationOptions {
  target: string; apply: boolean; rehearsal: AdminRehearsalProof; backup?: AdminBackupProof;
  baseline?: Pick<Inventory, 'row_counts' | 'checksums' | 'server_uuid'>;
  dryRun?: Record<string, unknown>; now?: () => number;
}
export function validateAdminMigrationPrerequisites(options: AdminMigrationOptions): void {
  const plan = adminFoundationPlan(), r = options.rehearsal;
  check(options.target === 'production', 'PRODUCTION_TARGET_REQUIRED');
  check(r?.mysql_version === '9.7.2' && r.up_twice_identical && r.down_restored_protected_data && r.reapplied && r.production_writes === 0, 'REAL_006_REHEARSAL_REQUIRED');
  check(r.sql_sha256 === plan.sql_sha256, 'REHEARSAL_SQL_CHANGED');
  if (options.backup) {
    const age = (options.now ?? Date.now)() - Date.parse(options.backup.checked_at);
    check(options.backup.restored_and_verified && options.backup.mysql_version === '9.7.2' && age >= 0 && age < 86400000 && /^[a-f0-9]{64}$/u.test(options.backup.encrypted_sha256), 'FRESH_VERIFIED_BACKUP_REQUIRED');
  }
  if (options.apply) {
    check(options.backup, 'VERIFIED_BACKUP_REQUIRED');
    check(options.dryRun?.passed === true && options.dryRun.applied === false && options.dryRun.target === 'production', 'APPROVED_DRY_RUN_REQUIRED');
    check(options.dryRun?.sql_sha256 === plan.sql_sha256, 'DRY_RUN_SQL_CHANGED');
    check(options.dryRun?.encrypted_backup_sha256 === options.backup?.encrypted_sha256, 'DRY_RUN_BACKUP_CHANGED');
  }
}

interface Column { table: string; column: string; type: string; nullable: string; charset: string | null; collation: string | null }
interface Index { table: string; name: string; column: string; position: number; non_unique: number }
interface Trigger { name: string; table: string; event: string; timing: string; statement: string }
const indexes: Record<string, Record<string, string[]>> = {
  permissions: { PRIMARY: ['permission_key'] },
  admin_auth_attempts: { PRIMARY: ['account_hash'], idx_admin_attempt_window: ['window_started_at'] },
  admin_catalog_tasks: { PRIMARY: ['id'], idx_admin_catalog_task_recitation: ['recitation_id', 'created_at'], idx_admin_catalog_task_lease: ['status', 'lease_until', 'created_at'] },
  admin_permissions: { idx_a1_permission_role: ['role_slug', 'permission_key'] },
  admin_sessions: { idx_a1_session_user: ['user_id', 'is_revoked', 'expires_at'] },
  audit_logs: { idx_audit_request: ['request_id'], idx_audit_entity_time: ['entity_type', 'entity_id', 'created_at', 'id'], idx_audit_actor_time: ['user_id', 'created_at', 'id'] },
};
const triggerEvents: Record<string, string> = { ayahx_audit_immutable_update: 'UPDATE', ayahx_audit_immutable_delete: 'DELETE' };
async function schema(session: AdminMigrationSession) {
  const columns = jsonRows<Column>(await session.read("SELECT JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;"));
  const actualIndexes = jsonRows<Index>(await session.read("SELECT JSON_OBJECT('table',TABLE_NAME,'name',INDEX_NAME,'column',COLUMN_NAME,'position',SEQ_IN_INDEX,'non_unique',NON_UNIQUE) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;"));
  const triggers = jsonRows<Trigger>(await session.read("SELECT JSON_OBJECT('name',TRIGGER_NAME,'table',EVENT_OBJECT_TABLE,'event',EVENT_MANIPULATION,'timing',ACTION_TIMING,'statement',ACTION_STATEMENT) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME;"));
  return { columns, indexes: actualIndexes, triggers };
}
function validateSchema(s: Awaited<ReturnType<typeof schema>>, complete: boolean): void {
  for (const [table, fields] of Object.entries(adminFoundationColumns)) for (const [name, definition] of Object.entries(fields)) {
    const c = s.columns.find(c => c.table === table && c.column === name);
    if (!c && !complete) continue;
    check(c, '006_COLUMN_MISSING'); check(c!.nullable === 'YES', '006_COLUMN_NOT_NULLABLE');
    const type = /^(ENUM\([^)]*\)|VARCHAR\(\d+\)|BIGINT UNSIGNED|DATETIME\(3\)|BOOLEAN|TEXT|JSON)/iu.exec(definition)?.[0].toLowerCase().replace('boolean', 'tinyint(1)');
    check(c!.type.toLowerCase() === type, '006_COLUMN_TYPE_MISMATCH');
    if (definition.includes('CHARACTER SET')) check(c!.charset === 'utf8mb4' && c!.collation === 'utf8mb4_unicode_ci', '006_COLUMN_COLLATION_MISMATCH');
  }
  for (const [table, entries] of Object.entries(indexes)) for (const [name, fields] of Object.entries(entries)) {
    const actual = s.indexes.filter(row => row.table === table && row.name === name).sort((a, b) => a.position - b.position);
    if (!actual.length && !complete) continue;
    check(stable(actual.map(row => row.column)) === stable(fields) && actual.every(row => row.non_unique === (name === 'PRIMARY' ? 0 : 1)), '006_INDEX_MISMATCH');
  }
  for (const [name, event] of Object.entries(triggerEvents)) {
    const trigger = s.triggers.find(t => t.name === name);
    if (!trigger && !complete) continue;
    check(trigger?.table === 'audit_logs' && trigger.event === event && trigger.timing === 'BEFORE' && /^SIGNAL\s+SQLSTATE\s+'45000'\s+SET\s+MESSAGE_TEXT\s*=\s*'AUDIT_LOG_IMMUTABLE'\s*$/iu.test(trigger.statement), '006_AUDIT_TRIGGER_MISMATCH');
  }
  if (complete) {
    for (const c of s.columns.filter(c => (ADMIN_FOUNDATION_TABLES as readonly string[]).includes(c.table) && c.charset !== null)) check(c.charset === 'utf8mb4' && c.collation === 'utf8mb4_unicode_ci', '006_TABLE_TEXT_COLLATION_MISMATCH');
    const role = s.columns.find(c => c.table === 'user_roles' && c.column === 'role');
    check(role?.collation === 'utf8mb4_unicode_ci' && role.charset === 'utf8mb4' && role.type === "enum(" + [...ADMIN_ROLES, 'user'].map(lit).join(',') + ')', '006_ROLE_ENUM_MISMATCH');
  }
}
const orderKeys: Record<string, string> = { user_roles: 'id', audit_logs: 'id', reciters: 'id', recitation_chapters: 'id', admin_roles: 'slug', admin_permissions: 'id', admin_sessions: 'id', admin_user_extensions: 'user_id' };
async function projections(session: AdminMigrationSession, before: Inventory, selectors: Record<string, string>, promote: boolean, post: boolean): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of Object.keys(adminFoundationColumns)) {
    const fields = before.columns.filter(c => c.table === table).map(c => c.column);
    check(fields.length, 'ORIGINAL_PROJECTION_MISSING');
    const values = fields.filter(f => table !== 'user_roles' || f !== 'a1_previous_role').flatMap(name => [lit(name), table === 'user_roles' && name === 'role' && promote && !post ? "IF(role='admin','super_admin',role)" : identifier(name)]);
    if (table === 'user_roles') values.push("'a1_previous_role'", post ? 'a1_previous_role' : fields.includes('a1_previous_role') ? promote ? "IF(role='admin','admin',a1_previous_role)" : 'a1_previous_role' : promote ? "IF(role='admin','admin',NULL)" : 'NULL');
    // Hash on the server. No user identities, password hashes, encrypted TOTP
    // secrets, session capabilities or profile values enter the SSH output.
    const raw = await session.read(`SELECT SHA2(CAST(JSON_OBJECT(${values.join(',')}) AS CHAR CHARACTER SET utf8mb4),256) FROM ${identifier(table)} ${selectors[table] ?? ''} ORDER BY ${identifier(orderKeys[table])};`);
    check(lines(raw).every(hash => /^[a-f0-9]{64}$/u.test(hash)), 'ORIGINAL_PROJECTION_INVALID'); result[table] = adminSqlDigest(raw);
  }
  return result;
}
function validateCatalog(inventory: Inventory): void {
  check(stable(inventory.d1_counts) === stable(D1) && inventory.canonical_checksum === SHA, 'D1_PROTECTED_STOP');
  check(inventory.row_counts.ayah_timings === 422463, 'D3_PROTECTED_STOP');
  for (const name of protectedTables) check(Number.isSafeInteger(inventory.row_counts[name]) && inventory.checksums[name] !== undefined && inventory.checksums[name] !== null, 'PROTECTED_BASELINE_MISSING');
}
export async function runAdminFoundationMigration(session: AdminMigrationSession, options: AdminMigrationOptions): Promise<Record<string, unknown>> {
  validateAdminMigrationPrerequisites(options);
  const started = (options.now ?? Date.now)(), plan = adminFoundationPlan();
  const report: Record<string, unknown> = { target: 'production', applied: options.apply, sql_sha256: plan.sql_sha256, sql_bytes: Buffer.byteLength(plan.sql), statement_count: plan.statements.length, started_at: new Date(started).toISOString(), encrypted_backup_sha256: options.backup?.encrypted_sha256 ?? null };
  const before = await captureInventory(ENVIRONMENTS.production, sql => session.read(sql)); validateCatalog(before);
  if (options.baseline) {
    check(before.server_uuid === options.baseline.server_uuid, 'BASELINE_SERVER_CHANGED');
    check(stable(before.row_counts) === stable(options.baseline.row_counts), 'BASELINE_COUNTS_CHANGED');
    check(stable(before.checksums) === stable(options.baseline.checksums), 'BASELINE_CHECKSUMS_CHANGED');
  }
  if (options.backup) {
    const names = before.tables.map(t => t.name).sort();
    check(stable(Object.keys(options.backup.row_counts).sort()) === stable(names) && stable(Object.keys(options.backup.checksums).sort()) === stable(names), 'FULL_BACKUP_TABLE_COVERAGE_REQUIRED');
    for (const [name, count] of Object.entries(options.backup.row_counts)) {
      check(before.row_counts[name] === count, 'BACKUP_COUNTS_CHANGED'); check(before.checksums[name] === options.backup.checksums[name], 'BACKUP_CHECKSUMS_CHANGED');
    }
  }
  const resources = Object.fromEntries(lines(await session.read("SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections'; SHOW GLOBAL VARIABLES LIKE 'max_allowed_packet'; SHOW GLOBAL STATUS LIKE 'Uptime';")).map(line => line.split('\t')));
  const threads = Number(resources.Threads_connected), max = Number(resources.max_connections), packet = Number(resources.max_allowed_packet);
  check(Number.isSafeInteger(threads) && threads >= 1 && Number.isSafeInteger(max) && threads < max && Number.isSafeInteger(packet) && packet >= 8192 && Number(resources.Uptime) > 0, 'MYSQL_PREFLIGHT_INVALID');
  const diskBefore = await session.storage(); check(diskBefore.available_bytes / diskBefore.total_bytes >= .2, '006_SPACE_GUARD');
  const originalSchema = await schema(session); validateSchema(originalSchema, false);
  const hasSeed = before.columns.some(c => c.table === 'admin_roles' && c.column === 'seeded_at');
  const roles = jsonRows<{ slug: string; seeded_at?: string | null }>(await session.read(`SELECT JSON_OBJECT('slug',slug${hasSeed ? ",'seeded_at',seeded_at" : ''}) FROM admin_roles ORDER BY slug;`));
  const promote = !roles.find(r => r.slug === 'super_admin')?.seeded_at;
  const [admins] = lines(await session.read("SELECT COUNT(*) FROM user_roles WHERE role='admin';"));
  const promoteCount = promote ? Number(admins) : 0; check(Number.isSafeInteger(promoteCount) && promoteCount <= 1000, 'ADMIN_UPGRADE_BATCH_LIMIT');
  const hasGrantKey = before.columns.some(c => c.table === 'admin_permissions' && c.column === 'permission_key');
  const oldPermissionIds = jsonRows<{ id: string; role: string; resource: string; action: string; permission?: string | null }>(await session.read(`SELECT JSON_OBJECT('id',id,'role',role_slug,'resource',resource,'action',action${hasGrantKey ? ",'permission',permission_key" : ''}) FROM admin_permissions ORDER BY id;`));
  check(oldPermissionIds.every(r => typeof r.id === 'string' && r.id.length <= 36), 'PERMISSION_ID_INVALID');
  const selectors = { admin_roles: roles.length ? 'WHERE slug IN (' + roles.map(r => lit(r.slug)).join(',') + ')' : 'WHERE 1=0', admin_permissions: oldPermissionIds.length ? 'WHERE id IN (' + oldPermissionIds.map(r => lit(r.id)).join(',') + ')' : 'WHERE 1=0' };
  const beforeProjection = await projections(session, before, selectors, promote, false);
  const oldCatalog = before.tables.some(t => t.name === 'permissions') ? jsonRows<{ key: string }>(await session.read("SELECT JSON_OBJECT('key',permission_key) FROM permissions ORDER BY permission_key;")) : [];
  // Migration007 owns render.test; the approved 006 plan remains frozen.
  const foundationPermissions = Object.keys(ADMIN_PERMISSIONS).filter(key => key !== 'render.test');
  const newPermissions = foundationPermissions.filter(key => !oldCatalog.some(p => p.key === key));
  const newRoles = ADMIN_ROLES.filter(role => !roles.some(r => r.slug === role));
  const newGrants = ADMIN_ROLES.flatMap(role => roles.find(r => r.slug === role)?.seeded_at ? [] : DEFAULT_ROLE_PERMISSIONS[role].filter(key => key !== 'render.test').filter(key => { const dot = key.indexOf('.'); return !oldPermissionIds.some(g => g.role === role && (g.permission === key || g.resource === key.slice(0, dot) && g.action === key.slice(dot + 1))); }));
  const catalogFlag = await session.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='quran_catalog_v2';");
  check(catalogFlag.trim() === 'false\t0' || catalogFlag.trim() === '0\t0' || !catalogFlag.trim(), 'CATALOG_FLAG_MUST_REMAIN_OFF');
  Object.assign(report, { server_uuid: before.server_uuid, mysql_version: before.mysql_version, row_counts_before: before.row_counts, checksums_before: before.checksums, critical_before: before.critical_counts, original_column_sha256_before: beforeProjection, disk_before: diskBefore, connection_preflight: { threads_connected: threads, max_connections: max, max_allowed_packet: packet, uptime_seconds: Number(resources.Uptime) }, planned: { tables: [...ADMIN_FOUNDATION_TABLES], nullable_columns: Object.fromEntries(Object.entries(adminFoundationColumns).map(([table, fields]) => [table, Object.keys(fields)])), role_upgrades: promoteCount, role_seeds: newRoles, permission_catalog_rows_to_insert: newPermissions.length, grant_rows_to_insert: newGrants.length } });
  if (options.apply) {
    for (const field of ['server_uuid', 'row_counts_before', 'checksums_before', 'original_column_sha256_before', 'planned']) check(stable(options.dryRun?.[field]) === stable(report[field]), 'DRY_RUN_STATE_CHANGED');
    const statements = plan.statements.map(row => ({ ...row, rowCount: row.sql.startsWith('UPDATE user_roles SET') ? promoteCount : /^(INSERT|UPDATE)\b/u.test(row.sql) ? 1 : 0 }));
    check(statements.every(s => Buffer.byteLength(s.sql) < Math.min(256 * 1024, packet / 8)), '006_PACKET_MARGIN');
    await session.executeStatements(statements, async () => { const d = await session.storage(); check(d.available_bytes / d.total_bytes >= .2, '006_SPACE_GUARD'); });
    await session.commit();
  }
  const after = options.apply ? await captureInventory(ENVIRONMENTS.production, sql => session.read(sql)) : before; validateCatalog(after);
  if (options.apply) {
    const addedOrSeeded = new Set<string>([...ADMIN_FOUNDATION_TABLES, 'admin_roles', 'admin_permissions']);
    for (const [name, count] of Object.entries(before.row_counts)) if (!addedOrSeeded.has(name)) check(after.row_counts[name] === count, 'ORIGINAL_ROW_COUNT_CHANGED');
    for (const name of Object.keys(before.row_counts)) if (!(name in adminFoundationColumns) && !addedOrSeeded.has(name)) check(after.checksums[name] === before.checksums[name], 'ORIGINAL_CHECKSUM_CHANGED');
    check(stable(after.critical_counts) === stable(before.critical_counts), 'CRITICAL_COUNTS_CHANGED');
    check(after.row_counts.admin_roles === before.row_counts.admin_roles + newRoles.length && after.row_counts.admin_permissions === before.row_counts.admin_permissions + newGrants.length && after.row_counts.permissions === (before.row_counts.permissions ?? 0) + newPermissions.length, 'SEED_ROW_COUNTS_MISMATCH');
    check(stable(after.tables.map(t => t.name).sort()) === stable([...new Set([...before.tables.map(t => t.name), ...ADMIN_FOUNDATION_TABLES])].sort()), 'UNEXPECTED_TABLE_CHANGE');
    for (const key of ['foreign_keys', 'events'] as const) check(stable(after[key].map(row => stable(row)).sort()) === stable(before[key].map(row => stable(row)).sort()), 'UNEXPECTED_SCHEMA_OBJECT_CHANGE');
    check(stable(await projections(session, before, selectors, promote, true)) === stable(beforeProjection), 'ORIGINAL_COLUMN_OR_ROLE_PROJECTION_CHANGED');
    check(await session.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='quran_catalog_v2';") === catalogFlag, 'CATALOG_FLAG_CHANGED');
    const afterSchema = await schema(session); validateSchema(afterSchema, true);
    for (const c of originalSchema.columns) if (!(c.table === 'user_roles' && c.column === 'role')) check(stable(afterSchema.columns.find(n => n.table === c.table && n.column === c.column)) === stable(c), 'ORIGINAL_COLUMN_SCHEMA_CHANGED');
    for (const trigger of originalSchema.triggers) check(stable(afterSchema.triggers.find(t => t.name === trigger.name)) === stable(trigger), 'ORIGINAL_TRIGGER_CHANGED');
    check(afterSchema.triggers.every(t => originalSchema.triggers.some(old => old.name === t.name) || t.name in triggerEvents), 'UNEXPECTED_TRIGGER_CHANGE');
    for (const table of ADMIN_FOUNDATION_TABLES) check(after.tables.some(t => t.name === table && t.collation === 'utf8mb4_unicode_ci'), '006_TABLE_COLLATION_MISMATCH');
    for (const table of ['admin_auth_attempts', 'admin_catalog_tasks']) check(after.row_counts[table] === (before.row_counts[table] ?? 0), 'UNEXPECTED_RUNTIME_ROWS');
    const grants = jsonRows<{ role: string; permission: string }>(await session.read("SELECT JSON_OBJECT('role',role_slug,'permission',permission_key) FROM admin_permissions WHERE permission_key IS NOT NULL ORDER BY role_slug,permission_key;"));
    const seededRoles = jsonRows<{ slug: string; seeded_at: string | null }>(await session.read("SELECT JSON_OBJECT('slug',slug,'seeded_at',seeded_at) FROM admin_roles ORDER BY slug;"));
    for (const role of ADMIN_ROLES) check(Boolean(seededRoles.find(row => row.slug === role)?.seeded_at), 'ROLE_SEED_MARKER_MISSING');
    for (const role of ADMIN_ROLES) if (!roles.find(r => r.slug === role)?.seeded_at) for (const permission of DEFAULT_ROLE_PERMISSIONS[role].filter(key => key !== 'render.test')) check(grants.some(g => g.role === role && g.permission === permission), 'DEFAULT_GRANT_SEED_MISSING');
    const permissions = jsonRows<{ key: string }>(await session.read("SELECT JSON_OBJECT('key',permission_key) FROM permissions ORDER BY permission_key;"));
    for (const key of foundationPermissions) check(permissions.some(p => p.key === key), 'PERMISSION_CATALOG_SEED_MISSING');
    report.collation_nullability_indexes_triggers_verified = true;
  }
  Object.assign(report, { passed: true, protected_columns_unchanged: true, settings_unchanged: true, allowed_user_role_upgrade_only: true, d1: after.d1_counts, d3: after.row_counts.ayah_timings, canonical_checksum: after.canonical_checksum, row_counts_after: after.row_counts, checksums_after: after.checksums, critical_after: after.critical_counts, disk_after: await session.storage(), elapsed_ms: (options.now ?? Date.now)() - started });
  return report;
}

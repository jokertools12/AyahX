/** A1/A2a: explicit, additive migration; never attached to application startup. */
import { ADMIN_ROLES, ADMIN_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../../admin/adminPermissions';
import { createHash } from 'node:crypto';
const text = (type: string, tail = 'DEFAULT NULL') => `${type} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ${tail}`;
const field = (name: string, type: string, tail = 'NOT NULL') => `${name} ${text(type, tail)}`;
const create = (name: string, fields: string[]) => `CREATE TABLE IF NOT EXISTS ${name} (${fields.join(',')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const lit = (value: string) => "'" + value.replace(/'/gu, "''") + "'";
const conditional = (source: string, absent: string, present = 'SELECT 1') =>
  `SET @ayahx_a1_ddl=(SELECT IF(COUNT(*)=0,${lit(absent)},${lit(present)}) FROM ${source}); PREPARE ayahx_a1_stmt FROM @ayahx_a1_ddl; EXECUTE ayahx_a1_stmt; DEALLOCATE PREPARE ayahx_a1_stmt`;
const column = (table: string, name: string) => `information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND COLUMN_NAME=${lit(name)}`;
const index = (table: string, name: string) => `information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND INDEX_NAME=${lit(name)}`;
export const ADMIN_FOUNDATION_TABLES = ['permissions', 'admin_auth_attempts', 'admin_catalog_tasks'] as const;
export const adminFoundationColumns = {
  user_roles: { a1_previous_role: text("ENUM('admin')") },
  audit_logs: { request_id: text('VARCHAR(128)') },
  reciters: { is_visible: 'BOOLEAN DEFAULT TRUE' },
  recitation_chapters: { is_enabled: 'BOOLEAN DEFAULT TRUE' },
  admin_roles: { seeded_at: 'DATETIME(3) NULL DEFAULT NULL' },
  admin_permissions: { permission_key: text('VARCHAR(128)') },
  admin_sessions: { two_factor_verified: 'BOOLEAN DEFAULT FALSE', revoked_at: 'DATETIME(3) NULL DEFAULT NULL' },
  admin_user_extensions: { pending_secret_encrypted: text('TEXT'), pending_expires_at: 'DATETIME(3) NULL DEFAULT NULL', recovery_code_hashes: 'JSON DEFAULT NULL', last_totp_counter: 'BIGINT UNSIGNED DEFAULT NULL' },
} as const;
export const adminPermissionId = (role: string, permission: string): string => 'a1:' + createHash('sha256').update(role + ':' + permission).digest('hex').slice(0, 32);
const rolesEnum = "ENUM(" + [...ADMIN_ROLES, 'user'].map(lit).join(',') + ')';
export function adminFoundationMigrationSql(): string[] {
  const sql: string[] = [
    create('permissions', [field('permission_key', 'VARCHAR(128)'), field('description', 'VARCHAR(255)'), 'PRIMARY KEY(permission_key)']),
    create('admin_auth_attempts', [field('account_hash', 'CHAR(64)'), 'failures SMALLINT UNSIGNED NOT NULL DEFAULT 0', 'window_started_at DATETIME(3) NOT NULL', 'locked_until DATETIME(3) NULL DEFAULT NULL', 'PRIMARY KEY(account_hash)', 'INDEX idx_admin_attempt_window(window_started_at)']),
    create('admin_catalog_tasks', [field('id', 'VARCHAR(36)'), field('recitation_id', 'VARCHAR(36)'), field('type', "ENUM('recalculate_availability','check_links')"), field('status', "ENUM('pending','running','completed','failed')", "NOT NULL DEFAULT 'pending'"), field('actor_id', 'VARCHAR(36)'), field('request_id', 'VARCHAR(128)', 'DEFAULT NULL'), 'progress INT UNSIGNED NOT NULL DEFAULT 0', 'total INT UNSIGNED DEFAULT NULL', 'result_json JSON DEFAULT NULL', field('error_code', 'VARCHAR(191)', 'DEFAULT NULL'), field('lease_token', 'VARCHAR(36)', 'DEFAULT NULL'), 'lease_until DATETIME(3) NULL DEFAULT NULL', 'created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)', 'updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)', 'PRIMARY KEY(id)', 'INDEX idx_admin_catalog_task_recitation(recitation_id,created_at)', 'INDEX idx_admin_catalog_task_lease(status,lease_until,created_at)']),
    ...Object.entries(adminFoundationColumns).flatMap(([table, fields]) => Object.entries(fields).map(([name, definition]) => conditional(column(table, name), `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`))),
    `ALTER TABLE user_roles MODIFY COLUMN role ${text(rolesEnum, "NOT NULL DEFAULT 'user'")}`,
    conditional(index('admin_permissions', 'idx_a1_permission_role'), 'ALTER TABLE admin_permissions ADD INDEX idx_a1_permission_role(role_slug,permission_key)'),
    conditional(index('admin_sessions', 'idx_a1_session_user'), 'ALTER TABLE admin_sessions ADD INDEX idx_a1_session_user(user_id,is_revoked,expires_at)'),
    conditional(index('audit_logs', 'idx_audit_request'), 'ALTER TABLE audit_logs ADD INDEX idx_audit_request(request_id)'),
    conditional(index('audit_logs', 'idx_audit_entity_time'), 'ALTER TABLE audit_logs ADD INDEX idx_audit_entity_time(entity_type,entity_id,created_at,id)'),
    conditional(index('audit_logs', 'idx_audit_actor_time'), 'ALTER TABLE audit_logs ADD INDEX idx_audit_actor_time(user_id,created_at,id)'),
    // Prepared statements do not support CREATE TRIGGER. MySQL9.7.2 supports
    // IF NOT EXISTS directly; root rehearses these exact statements locally.
    "CREATE TRIGGER IF NOT EXISTS ayahx_audit_immutable_update BEFORE UPDATE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_LOG_IMMUTABLE'",
    "CREATE TRIGGER IF NOT EXISTS ayahx_audit_immutable_delete BEFORE DELETE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_LOG_IMMUTABLE'",
  ];
  const names: Record<string, [string, string]> = { super_admin: ['المدير الأعلى', 'Super administrator'], admin: ['مدير', 'Administrator'], content_manager: ['مدير المحتوى', 'Content manager'], moderator: ['مشرف', 'Moderator'], support: ['الدعم', 'Support'], finance: ['المالية', 'Finance'], analyst: ['محلل', 'Analyst'] };
  for (const role of ADMIN_ROLES) sql.push(`INSERT IGNORE INTO admin_roles(slug,name_ar,name_en,is_system) VALUES(${lit(role)},${lit(names[role][0])},${lit(names[role][1])},1)`);
  // Preserve row IDs and permissions. A replay cannot promote newly assigned
  // admin roles after the first seed, or restore deliberately removed grants.
  sql.push("UPDATE user_roles SET role='super_admin',a1_previous_role='admin' WHERE role='admin' AND (SELECT seeded_at FROM admin_roles WHERE slug='super_admin') IS NULL");
  // D7 owns render.test. Keep the already approved migration006 SQL identical
  // when the live permission registry grows; migration007 seeds this grant.
  for (const [permission, description] of Object.entries(ADMIN_PERMISSIONS).filter(([key]) => key !== 'render.test')) sql.push(`INSERT IGNORE INTO permissions(permission_key,description) VALUES(${lit(permission)},${lit(description)})`);
  for (const role of ADMIN_ROLES) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role].filter(key => key !== 'render.test')) {
      const dot = permission.indexOf('.'), resource = permission.slice(0, dot), action = permission.slice(dot + 1);
      // Reuse matching historical rows without granting unrelated legacy APIs.
      sql.push(`UPDATE admin_permissions SET permission_key=${lit(permission)} WHERE role_slug=${lit(role)} AND resource=${lit(resource)} AND action=${lit(action)} AND (SELECT seeded_at FROM admin_roles WHERE slug=${lit(role)}) IS NULL`);
      sql.push(`INSERT IGNORE INTO admin_permissions(id,role_slug,resource,action,permission_key) SELECT ${lit(adminPermissionId(role, permission))},${lit(role)},${lit(resource)},${lit(action)},${lit(permission)} FROM admin_roles WHERE slug=${lit(role)} AND seeded_at IS NULL AND NOT EXISTS(SELECT 1 FROM admin_permissions p WHERE p.role_slug=${lit(role)} AND p.permission_key=${lit(permission)})`);
    }
    sql.push(`UPDATE admin_roles SET seeded_at=UTC_TIMESTAMP(3) WHERE slug=${lit(role)} AND seeded_at IS NULL`);
  }
  return sql;
}
export async function upAdminFoundation(db: { query(sql: string): Promise<unknown> }): Promise<void> { for (const sql of adminFoundationMigrationSql()) await db.query(sql); }
/** Disposable local restore only. Never exports a production down command. */
export async function downAdminFoundation(db: { query(sql: string): Promise<unknown> }, scope: 'local-rehearsal'): Promise<void> {
  if (scope !== 'local-rehearsal') throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  await db.query("CREATE TEMPORARY TABLE ayahx_a1_down_guard(ok BOOLEAN NOT NULL CHECK(ok=1)); INSERT INTO ayahx_a1_down_guard SELECT IF(COUNT(*)=0,1,0) FROM user_roles WHERE role NOT IN ('admin','moderator','user') AND IFNULL((role='super_admin' AND a1_previous_role='admin'),0)=0; DROP TEMPORARY TABLE ayahx_a1_down_guard");
  await db.query("UPDATE user_roles SET role='admin' WHERE role='super_admin' AND a1_previous_role='admin'");
  await db.query("ALTER TABLE user_roles MODIFY COLUMN role ENUM('admin','moderator','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user'");
  for (const name of ['ayahx_audit_immutable_update', 'ayahx_audit_immutable_delete']) await db.query(`DROP TRIGGER IF EXISTS ${name}`);
  for (const name of ['idx_audit_request', 'idx_audit_entity_time', 'idx_audit_actor_time']) await db.query(conditional(index('audit_logs', name), 'SELECT 1', `ALTER TABLE audit_logs DROP INDEX ${name}`));
  await db.query("DELETE FROM admin_permissions WHERE id LIKE 'a1:%'");
  // support is the sole new role in the verified 8-role production inventory.
  await db.query("DELETE FROM admin_roles WHERE slug='support' AND seeded_at IS NOT NULL");
  await db.query(conditional(index('admin_permissions', 'idx_a1_permission_role'), 'SELECT 1', 'ALTER TABLE admin_permissions DROP INDEX idx_a1_permission_role'));
  await db.query(conditional(index('admin_sessions', 'idx_a1_session_user'), 'SELECT 1', 'ALTER TABLE admin_sessions DROP INDEX idx_a1_session_user'));
  for (const table of [...ADMIN_FOUNDATION_TABLES].reverse()) await db.query(`DROP TABLE IF EXISTS ${table}`);
  for (const [table, fields] of Object.entries(adminFoundationColumns)) for (const name of Object.keys(fields)) await db.query(conditional(column(table, name), 'SELECT 1', `ALTER TABLE ${table} DROP COLUMN ${name}`));
}

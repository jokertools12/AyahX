import { randomUUID } from 'node:crypto';
import type { CatalogDatabase } from '../services/catalogContracts';
import { appendCatalogAudit } from '../services/catalogAudit';
import { adminPermissionId } from '../db/migrations/006_addAdminFoundation';
import { AdminError, type AdminRequestContext } from './adminContracts';
import { ADMIN_ROLES, ADMIN_PERMISSIONS, isAdminRole, isAdminPermission, type AdminPermission } from './adminPermissions';
export class AdminRoleService {
  constructor(private readonly db: CatalogDatabase) {}
  async roles() {
    const rows = await this.db.read(`SELECT slug,name_ar,name_en FROM admin_roles WHERE slug IN (${ADMIN_ROLES.map(() => '?').join(',')})`, [...ADMIN_ROLES]);
    const grants = await this.db.read('SELECT role_slug,permission_key FROM admin_permissions WHERE permission_key IS NOT NULL ORDER BY permission_key');
    return rows.map(row => ({ slug: row.slug, nameAr: row.name_ar, nameEn: row.name_en, permissions: grants.filter(p => p.role_slug === row.slug).map(p => p.permission_key).filter(isAdminPermission) }));
  }
  permissions() { return Object.entries(ADMIN_PERMISSIONS).map(([key, description]) => ({ key, resource: key.split('.')[0], description })); }
  async update(ctx: AdminRequestContext) {
    const role = ctx.params.slug, permissions = [...new Set(ctx.body.permissions as AdminPermission[])];
    if (!isAdminRole(role)) throw new AdminError('ADMIN_ROLE_NOT_FOUND', 404);
    if (ctx.body.confirmation !== role) throw new AdminError('ADMIN_CONFIRMATION_REQUIRED', 422);
    if (role === 'super_admin' && Object.keys(ADMIN_PERMISSIONS).some(key => !permissions.includes(key as AdminPermission))) throw new AdminError('ADMIN_SUPER_ADMIN_PROTECTED', 409);
    await this.db.transaction(async tx => {
      const before = await tx.read('SELECT permission_key FROM admin_permissions WHERE role_slug=? AND permission_key IS NOT NULL FOR UPDATE', [role]);
      // Retain historical grants; only the explicit active mapping changes.
      await tx.execute('UPDATE admin_permissions SET permission_key=NULL WHERE role_slug=? AND permission_key IS NOT NULL', [role]);
      for (const key of permissions) {
        const [resource, ...action] = key.split('.');
        await tx.execute('INSERT INTO admin_permissions(id,role_slug,resource,action,permission_key) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE permission_key=VALUES(permission_key)', [adminPermissionId(role, key), role, resource, action.join('.'), key]);
      }
      await appendCatalogAudit(tx, ctx.actor, 'admin.role.permissions', 'admin_role', role, { permissions: before.map(row => row.permission_key) }, { permissions });
    });
    return { slug: role, permissions };
  }
  async users(query: Record<string, unknown>) {
    const page = Number(query.page), limit = Number(query.limit), q = String(query.q || ''), sort = query.sort === 'email' ? 'u.email' : 'u.created_at', direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const filter = 'WHERE (?=\'\' OR u.email LIKE ? OR p.display_name LIKE ?)';
    const params = [q, '%' + q + '%', '%' + q + '%'];
    const [count] = await this.db.read('SELECT COUNT(*) total FROM users u LEFT JOIN profiles p ON p.user_id=u.id ' + filter, params);
    const users = await this.db.read(`SELECT u.id,u.email,p.display_name,u.created_at FROM users u LEFT JOIN profiles p ON p.user_id=u.id ${filter} ORDER BY ${sort} ${direction},u.id LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    const ids = users.map(row => String(row.id));
    const roles = ids.length ? await this.db.read(`SELECT user_id,role FROM user_roles WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids) : [];
    return { data: users.map(row => ({ id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at, roles: roles.filter(role => role.user_id === row.id).map(role => role.role) })), meta: { page, limit, total: Number(count?.total || 0) } };
  }
  async assign(ctx: AdminRequestContext) {
    const id = ctx.params.id, desired = [...new Set(ctx.body.roles as string[])];
    if (ctx.body.confirmation !== id) throw new AdminError('ADMIN_CONFIRMATION_REQUIRED', 422);
    await this.db.transaction(async tx => {
      const [user] = await tx.read('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
      if (!user) throw new AdminError('ADMIN_USER_NOT_FOUND', 404);
      const before = await tx.read('SELECT id,role FROM user_roles WHERE user_id=? FOR UPDATE', [id]);
      // Existing administrators remain protected after the one-time upgrade.
      if (before.some(row => row.role === 'super_admin') && !desired.includes('super_admin')) throw new AdminError('ADMIN_SUPER_ADMIN_PROTECTED', 409);
      for (const row of before) if (!desired.includes(String(row.role))) await tx.execute('DELETE FROM user_roles WHERE id=?', [row.id]);
      for (const role of desired) if (!before.some(row => row.role === role)) await tx.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)', [randomUUID(), id, role]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.user.roles', 'user_roles', id, { roles: before.map(row => row.role) }, { roles: desired });
    });
    return { id, roles: desired };
  }
}

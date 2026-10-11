import { randomBytes } from 'node:crypto';
import type { CatalogDatabase, CatalogRow } from '../services/catalogContracts';
import { appendCatalogAudit } from '../services/catalogAudit';
import type { AdminRequestContext } from './adminContracts';
import { AdminError } from './adminContracts';
import { AdminAccessService, readAdminSecuritySettings, requiresAdmin2fa, sqlUtcDate, utcMillis } from './adminAccessService';
import { decryptAdminSecret, encodeBase32, encryptAdminSecret, generateRecoveryCodes, isAdminEncryptionConfigured, verifyTotp } from './adminTotp';
export class AdminSecurityService {
  constructor(private readonly db: CatalogDatabase, private readonly access: AdminAccessService, private readonly env: NodeJS.ProcessEnv = process.env, private readonly now: () => number = Date.now) {}
  async status(ctx: AdminRequestContext): Promise<CatalogRow> {
    const [row] = await this.db.read('SELECT two_factor_enabled,recovery_code_hashes,pending_expires_at FROM admin_user_extensions WHERE user_id=?', [ctx.user.id]);
    const hashes: unknown = typeof row?.recovery_code_hashes === 'string' ? JSON.parse(row.recovery_code_hashes) : row?.recovery_code_hashes;
    const settings = await readAdminSecuritySettings(this.db);
    return { enabled: Number(row?.two_factor_enabled) === 1, required: requiresAdmin2fa(ctx.user.roles, settings.policy), encryptionConfigured: isAdminEncryptionConfigured(this.env), recoveryCodesRemaining: Array.isArray(hashes) ? hashes.length : 0, pendingExpiresAt: row?.pending_expires_at ?? null };
  }
  async enroll(ctx: AdminRequestContext): Promise<CatalogRow> {
    const secret = encodeBase32(randomBytes(20)), encrypted = encryptAdminSecret(secret, ctx.user.id, this.env), expires = this.now() + 600000;
    await this.db.transaction(async tx => {
      const [old] = await tx.read('SELECT two_factor_enabled FROM admin_user_extensions WHERE user_id=? FOR UPDATE', [ctx.user.id]);
      if (Number(old?.two_factor_enabled) === 1) throw new AdminError('ADMIN_TOTP_ALREADY_ENABLED', 409);
      await tx.execute('INSERT INTO admin_user_extensions(user_id,role_slug,pending_secret_encrypted,pending_expires_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE pending_secret_encrypted=VALUES(pending_secret_encrypted),pending_expires_at=VALUES(pending_expires_at)', [ctx.user.id, ctx.user.roles[0], encrypted, sqlUtcDate(expires)]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.totp_enroll', 'admin_security', ctx.user.id, { enabled: false }, { pending: true, expires_at: sqlUtcDate(expires) });
    });
    // Protocol provisioning is owner-only and returned once, never logged or
    // persisted in audit. Settings APIs never return credential values.
    return { secret, otpauthUri: `otpauth://totp/${encodeURIComponent('AyahX:' + ctx.user.email)}?secret=${secret}&issuer=AyahX&algorithm=SHA1&digits=6&period=30`, expiresAt: new Date(expires).toISOString() };
  }
  async confirm(ctx: AdminRequestContext, code: string): Promise<CatalogRow> {
    const recovery = generateRecoveryCodes(ctx.user.id);
    await this.db.transaction(async tx => {
      const [row] = await tx.read('SELECT * FROM admin_user_extensions WHERE user_id=? FOR UPDATE', [ctx.user.id]);
      if (!row || Number(row.two_factor_enabled) === 1 || typeof row.pending_secret_encrypted !== 'string' || !Number.isFinite(utcMillis(row.pending_expires_at)) || utcMillis(row.pending_expires_at) <= this.now()) throw new AdminError('ADMIN_TOTP_ENROLLMENT_EXPIRED', 409);
      const secret = decryptAdminSecret(row.pending_secret_encrypted, ctx.user.id, this.env), counter = verifyTotp(secret, code, null, this.now());
      if (counter === null) throw new AdminError('ADMIN_TOTP_CODE_INVALID', 422);
      await tx.execute('UPDATE admin_user_extensions SET two_factor_secret_encrypted=pending_secret_encrypted,pending_secret_encrypted=NULL,pending_expires_at=NULL,two_factor_enabled=1,recovery_code_hashes=?,last_totp_counter=? WHERE user_id=?', [JSON.stringify(recovery.hashes), counter, ctx.user.id]);
      await tx.execute('UPDATE admin_sessions SET two_factor_verified=1 WHERE id=? AND user_id=? AND revoked_at IS NULL', [ctx.sessionId, ctx.user.id]);
      await tx.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP(3),is_revoked=1 WHERE user_id=? AND id<>? AND is_revoked=0', [ctx.user.id, ctx.sessionId]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.two_factor_enabled', 'admin_security', ctx.user.id, { enabled: false }, { enabled: true, recovery_codes: recovery.hashes.length, other_sessions_revoked: true });
    });
    return { enabled: true, recoveryCodes: recovery.codes };
  }
  async disable(ctx: AdminRequestContext, code: string): Promise<CatalogRow> {
    const settings = await readAdminSecuritySettings(this.db);
    if (requiresAdmin2fa(ctx.user.roles, settings.policy)) throw new AdminError('ADMIN_TOTP_POLICY_REQUIRED', 409);
    await this.db.transaction(async tx => {
      const [row] = await tx.read('SELECT * FROM admin_user_extensions WHERE user_id=? FOR UPDATE', [ctx.user.id]);
      if (!row || Number(row.two_factor_enabled) !== 1) throw new AdminError('ADMIN_TOTP_NOT_ENABLED', 409);
      if (!(await this.access.verifyFactor(tx, ctx.user.id, row, code))) throw new AdminError('ADMIN_TOTP_CODE_INVALID', 422);
      await tx.execute('UPDATE admin_user_extensions SET two_factor_enabled=0,two_factor_secret_encrypted=NULL,pending_secret_encrypted=NULL,pending_expires_at=NULL,recovery_code_hashes=NULL,last_totp_counter=NULL WHERE user_id=?', [ctx.user.id]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.totp_disabled', 'admin_security', ctx.user.id, { enabled: true }, { enabled: false });
    }); return { enabled: false };
  }
  async regenerateRecovery(ctx: AdminRequestContext, code: string): Promise<CatalogRow> {
    const recovery = generateRecoveryCodes(ctx.user.id);
    await this.db.transaction(async tx => {
      const [row] = await tx.read('SELECT * FROM admin_user_extensions WHERE user_id=? FOR UPDATE', [ctx.user.id]);
      if (!row || Number(row.two_factor_enabled) !== 1) throw new AdminError('ADMIN_TOTP_NOT_ENABLED', 409);
      if (!(await this.access.verifyFactor(tx, ctx.user.id, row, code))) throw new AdminError('ADMIN_TOTP_CODE_INVALID', 422);
      await tx.execute('UPDATE admin_user_extensions SET recovery_code_hashes=? WHERE user_id=?', [JSON.stringify(recovery.hashes), ctx.user.id]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.recovery_regenerated', 'admin_security', ctx.user.id, { recovery_codes_replaced: true }, { recovery_codes: recovery.hashes.length });
    }); return { recoveryCodes: recovery.codes };
  }
  async sessions(ctx: AdminRequestContext, all = false): Promise<CatalogRow[]> {
    if (all && (!ctx.user.roles.includes('super_admin') || !ctx.user.permissions.includes('security.sessions.manage'))) throw new AdminError('ADMIN_FORBIDDEN', 403);
    const rows = await this.db.read(`SELECT id,user_id,ip_address,user_agent,two_factor_verified,created_at,last_active_at,expires_at,revoked_at,is_revoked FROM admin_sessions ${all ? '' : 'WHERE user_id=?'} ORDER BY created_at DESC LIMIT 100`, all ? [] : [ctx.user.id]);
    return rows.map(row => ({ ...row, current: row.id === ctx.sessionId, active: Number(row.is_revoked) !== 1 && !row.revoked_at && utcMillis(row.expires_at) > this.now() }));
  }
  async revoke(ctx: AdminRequestContext, id: string): Promise<CatalogRow> {
    await this.db.transaction(async tx => {
      const [row] = await tx.read('SELECT id,user_id,revoked_at,is_revoked FROM admin_sessions WHERE id=? FOR UPDATE', [id]);
      if (!row) throw new AdminError('ADMIN_SESSION_NOT_FOUND', 404);
      if (row.user_id !== ctx.user.id && (!ctx.user.roles.includes('super_admin') || !ctx.user.permissions.includes('security.sessions.manage'))) throw new AdminError('ADMIN_FORBIDDEN', 403);
      await tx.execute('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)),is_revoked=1 WHERE id=?', [id]);
      await appendCatalogAudit(tx, ctx.actor, 'admin.session_revoked', 'admin_session', id, { revoked: Boolean(row.revoked_at)||Number(row.is_revoked)===1, user_id: row.user_id }, { revoked: true, user_id: row.user_id });
    }); return { revoked: true, current: id === ctx.sessionId };
  }
}

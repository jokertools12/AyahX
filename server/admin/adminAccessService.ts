import { createHash, createHmac, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { CatalogDatabase, CatalogRow, CatalogTx } from '../services/catalogContracts';
import { appendCatalogAudit, type CatalogActor } from '../services/catalogAudit';
import { config } from '../config';
import { ADMIN_ROLES, isAdminPermission, isAdminRole, servicePermissions } from './adminPermissions';
import { AdminError, type AdminIdentity } from './adminContracts';
import { consumeRecoveryCode, decryptAdminSecret, verifyTotp } from './adminTotp';
export type Admin2faPolicy = 'optional' | 'required_for_super_admin' | 'required_for_all';
export interface AdminSecuritySettings { policy: Admin2faPolicy; idleMs: number; durationMs: number }
export const sqlUtcDate = (time: number): string => new Date(time).toISOString().replace('T', ' ').replace('Z', '');
export const utcMillis = (value: unknown): number => value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const DUMMY_PASSWORD_HASH = '$2b$10$9MI3o/QV3Cmo68Mcvxl3bOrVkMBDZnVKqyyxsbz/OvwjTdyE./ISm';
export function requiresAdmin2fa(roles: readonly string[], policy: Admin2faPolicy): boolean { return policy === 'required_for_all' || policy === 'required_for_super_admin' && roles.includes('super_admin'); }
export async function readAdminSecuritySettings(db: Pick<CatalogDatabase, 'read'>): Promise<AdminSecuritySettings> {
  const rows = await db.read("SELECT key_name,value_text,is_secret FROM system_settings WHERE key_name IN ('admin_2fa_policy','admin_idle_timeout_ms','admin_session_duration_ms')");
  const values = new Map(rows.map(row => [String(row.key_name), String(row.value_text)]));
  if (rows.some(row => Number(row.is_secret) !== 0)) throw new AdminError('ADMIN_SETTING_INVALID', 503);
  const policy = values.get('admin_2fa_policy') ?? 'optional';
  const idleMs = Number(values.get('admin_idle_timeout_ms') ?? 1800000), durationMs = Number(values.get('admin_session_duration_ms') ?? 28800000);
  if (!['optional', 'required_for_super_admin', 'required_for_all'].includes(policy) || !Number.isSafeInteger(idleMs) || idleMs < 60000 || idleMs > 86400000 || !Number.isSafeInteger(durationMs) || durationMs < 300000 || durationMs > 604800000) throw new AdminError('ADMIN_SETTING_INVALID', 503);
  return { policy: policy as Admin2faPolicy, idleMs, durationMs };
}
export class AdminAccessService {
  constructor(readonly db: CatalogDatabase, private readonly env: NodeJS.ProcessEnv = process.env, private readonly now: () => number = Date.now) {}
  private jwtSecret(): string { const value = this.env.JWT_SECRET || config.jwtSecret; if (this.env.NODE_ENV === 'production' && (!value || value === 'quran_reels_jwt_secret_key_2026_default')) throw new AdminError('ADMIN_JWT_KEY_UNAVAILABLE', 503); return value; }
  async identityForUser(userId: string): Promise<AdminIdentity> {
    const [user] = await this.db.read('SELECT u.id,u.email,p.display_name FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=? LIMIT 1', [userId]);
    if (!user) throw new AdminError('ADMIN_FORBIDDEN', 403);
    const grants = await this.db.read('SELECT role FROM user_roles WHERE user_id=? ORDER BY role', [userId]);
    const roles = grants.map(row => row.role).filter(isAdminRole);
    if (!roles.length) throw new AdminError('ADMIN_FORBIDDEN', 403);
    const rows = await this.db.read(`SELECT DISTINCT p.permission_key FROM admin_permissions p JOIN permissions d ON d.permission_key=p.permission_key WHERE p.role_slug IN (${roles.map(() => '?').join(',')}) ORDER BY p.permission_key`, roles);
    const permissions = rows.map(row => row.permission_key);
    if (permissions.some(value => !isAdminPermission(value))) throw new AdminError('ADMIN_PERMISSION_UNDEFINED', 503);
    return { id: String(user.id), email: String(user.email), displayName: user.display_name === null ? null : String(user.display_name), roles, permissions: permissions.filter(isAdminPermission) };
  }
  async actorForUser(userId: string, context?: { requestId?: string; ipAddress?: string }): Promise<CatalogActor> {
    const user = await this.identityForUser(userId);
    return { id: user.id, kind: 'human', roleSlug: ADMIN_ROLES.find(role => user.roles.includes(role)), permissions: servicePermissions(user.permissions, user.roles), ...context };
  }
  async authenticate(token: string): Promise<{ user: AdminIdentity; actor: CatalogActor; sessionId: string; enrollmentRequired: boolean }> {
    let claims: { id: string; adminSessionId: string };
    try { const value = jwt.verify(token, this.jwtSecret()); if (!value || typeof value === 'string' || typeof value.id !== 'string' || typeof value.adminSessionId !== 'string') throw new Error('INVALID'); claims = { id: value.id, adminSessionId: value.adminSessionId }; }
    catch (error) { if (error instanceof AdminError) throw error; throw new AdminError('ADMIN_UNAUTHENTICATED', 401); }
    const [session] = await this.db.read('SELECT id,user_id,last_active_at last_seen_at,expires_at,revoked_at,is_revoked,two_factor_verified FROM admin_sessions WHERE id=? AND token_hash=? LIMIT 1', [claims.adminSessionId, hash(token)]);
    const settings = await readAdminSecuritySettings(this.db), now = this.now();
    if (!session || session.user_id !== claims.id || session.revoked_at || Number(session.is_revoked) === 1 || !Number.isFinite(utcMillis(session.expires_at)) || utcMillis(session.expires_at) <= now || !Number.isFinite(utcMillis(session.last_seen_at)) || utcMillis(session.last_seen_at) + settings.idleMs <= now) throw new AdminError('ADMIN_SESSION_EXPIRED', 401);
    const user = await this.identityForUser(claims.id);
    const [credentials] = await this.db.read('SELECT two_factor_enabled totp_enabled FROM admin_user_extensions WHERE user_id=?', [user.id]);
    const enabled = Number(credentials?.totp_enabled) === 1;
    if (enabled && Number(session.two_factor_verified) !== 1) throw new AdminError('ADMIN_TOTP_REQUIRED', 401);
    const enrollmentRequired = requiresAdmin2fa(user.roles, settings.policy) && !enabled;
    if (now - utcMillis(session.last_seen_at) >= 10000) await this.db.execute('UPDATE admin_sessions SET last_active_at=UTC_TIMESTAMP(3) WHERE id=? AND is_revoked=0', [session.id]);
    const actor = { id: user.id, kind: 'human' as const, roleSlug: ADMIN_ROLES.find(role => user.roles.includes(role)), permissions: servicePermissions(user.permissions, user.roles) };
    return { user, actor, sessionId: String(session.id), enrollmentRequired };
  }
  private accountHash(email: string): string { return createHmac('sha256', this.jwtSecret()).update(email).digest('hex'); }
  private async recordFailure(accountHash: string, requestId: string, ipAddress: string): Promise<void> {
    await this.db.transaction(async tx => {
      const now = this.now();
      await tx.execute('INSERT IGNORE INTO admin_auth_attempts(account_hash,failures,window_started_at) VALUES(?,0,?)', [accountHash, sqlUtcDate(now)]);
      const [old] = await tx.read('SELECT failures,window_started_at FROM admin_auth_attempts WHERE account_hash=? FOR UPDATE', [accountHash]);
      const expired = utcMillis(old.window_started_at) + 900000 <= now, failures = (expired ? 0 : Number(old.failures)) + 1;
      await tx.execute('UPDATE admin_auth_attempts SET failures=?,window_started_at=?,locked_until=? WHERE account_hash=?', [failures, expired ? sqlUtcDate(now) : old.window_started_at, failures >= 5 ? sqlUtcDate(now + 900000) : null, accountHash]);
      await appendCatalogAudit(tx, { id: 'admin_auth', kind: 'system', permissions: new Set(), requestId, ipAddress }, 'admin.login_failed', 'admin_auth_attempt', accountHash, { failures: expired ? 0 : Number(old.failures) }, { failures, locked: failures >= 5 });
    });
  }
  async verifyFactor(tx: CatalogTx, userId: string, credentials: CatalogRow, code: string): Promise<boolean> {
    if (typeof credentials.two_factor_secret_encrypted !== 'string') throw new AdminError('ADMIN_2FA_DATA_INVALID', 503);
    const secret = decryptAdminSecret(credentials.two_factor_secret_encrypted, userId, this.env);
    const counter = verifyTotp(secret, code, credentials.last_totp_counter == null ? null : Number(credentials.last_totp_counter), this.now());
    if (counter !== null) { await tx.execute('UPDATE admin_user_extensions SET last_totp_counter=? WHERE user_id=?', [counter, userId]); return true; }
    const remaining = consumeRecoveryCode(userId, code, credentials.recovery_code_hashes ?? []);
    if (!remaining) return false;
    await tx.execute('UPDATE admin_user_extensions SET recovery_code_hashes=? WHERE user_id=?', [JSON.stringify(remaining), userId]); return true;
  }
  async login(input: { email: string; password: string; code?: string }, context: { requestId: string; ipAddress: string; userAgent: string }): Promise<{ token: string; user: AdminIdentity; sessionId: string; durationMs: number; enrollmentRequired: boolean }> {
    const email = input.email.trim().toLowerCase(), accountHash = this.accountHash(email), now = this.now();
    const [attempt] = await this.db.read('SELECT locked_until FROM admin_auth_attempts WHERE account_hash=?', [accountHash]);
    if (attempt?.locked_until && utcMillis(attempt.locked_until) > now) throw new AdminError('ADMIN_LOGIN_LOCKED', 429, { retryAfterMs: utcMillis(attempt.locked_until) - now });
    const [candidate] = await this.db.read('SELECT id,password_hash FROM users WHERE email=? LIMIT 1', [email]);
    const match = await bcrypt.compare(input.password, typeof candidate?.password_hash === 'string' ? candidate.password_hash : DUMMY_PASSWORD_HASH);
    if (!candidate || !match) { await this.recordFailure(accountHash, context.requestId, context.ipAddress); throw new AdminError('ADMIN_CREDENTIALS_INVALID', 401); }
    let user: AdminIdentity;
    try { user = await this.identityForUser(String(candidate.id)); } catch (error) { if (!(error instanceof AdminError) || error.status !== 403) throw error; await this.recordFailure(accountHash, context.requestId, context.ipAddress); throw new AdminError('ADMIN_CREDENTIALS_INVALID', 401); }
    const settings = await readAdminSecuritySettings(this.db);
    const sessionId = randomUUID(), token = jwt.sign({ id: user.id, email: user.email, adminSessionId: sessionId }, this.jwtSecret(), { expiresIn: Math.ceil(settings.durationMs / 1000) });
    const result = await this.db.transaction(async tx => {
      const [credentials] = await tx.read('SELECT e.*,two_factor_enabled totp_enabled,two_factor_secret_encrypted totp_secret_encrypted FROM admin_user_extensions e WHERE user_id=? FOR UPDATE', [user.id]);
      const enabled = Number(credentials?.totp_enabled) === 1;
      if (enabled && !input.code) return { needsCode: true, invalidCode: false, enrollmentRequired: false };
      if (enabled && !(await this.verifyFactor(tx, user.id, credentials, input.code!))) return { needsCode: false, invalidCode: true, enrollmentRequired: false };
      await tx.execute('INSERT INTO admin_sessions(id,user_id,token_hash,ip_address,user_agent,two_factor_verified,expires_at,last_active_at,created_at,is_revoked) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),0)', [sessionId, user.id, hash(token), context.ipAddress, context.userAgent.slice(0, 512), enabled, sqlUtcDate(now + settings.durationMs)]);
      await tx.execute('DELETE FROM admin_auth_attempts WHERE account_hash=?', [accountHash]);
      await appendCatalogAudit(tx, { id: user.id, kind: 'human', roleSlug: user.roles[0], permissions: servicePermissions(user.permissions, user.roles), requestId: context.requestId, ipAddress: context.ipAddress }, 'admin.login', 'admin_session', sessionId, null, { user_id: user.id, two_factor_verified: enabled });
      return { needsCode: false, invalidCode: false, enrollmentRequired: requiresAdmin2fa(user.roles, settings.policy) && !enabled };
    });
    if (result.needsCode) throw new AdminError('ADMIN_TOTP_REQUIRED', 401);
    if (result.invalidCode) { await this.recordFailure(accountHash, context.requestId, context.ipAddress); throw new AdminError('ADMIN_CREDENTIALS_INVALID', 401); }
    return { token, user, sessionId, durationMs: settings.durationMs, enrollmentRequired: result.enrollmentRequired };
  }
}

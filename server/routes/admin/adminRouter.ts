import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { CatalogDatabase } from '../../services/catalogContracts';
import { CatalogError } from '../../services/catalogContracts';
import { config } from '../../config';
import { logger } from '../../logger';
import { AdminAccessService } from '../../admin/adminAccessService';
import { AdminError, ADMIN_COOKIE, type AdminEndpointDefinition, type AdminRegister, type AdminRequestContext } from '../../admin/adminContracts';
import { actorWithContext, isAdminPermission } from '../../admin/adminPermissions';
import { RedisAdminRateGate, type AdminRateGate } from '../../admin/adminRateGate';
export interface AdminRouterOptions { db: CatalogDatabase; access?: AdminAccessService; rate?: AdminRateGate; origins?: readonly string[]; env?: NodeJS.ProcessEnv; register?: (register: AdminRegister, access: AdminAccessService) => void }
export const ADMIN_LIST_QUERY = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().max(255).default(''), sort: z.string().max(64).default('created_at'), direction: z.enum(['asc', 'desc']).default('desc') });
export function readAdminCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) { const [name, ...values] = part.trim().split('='); if (name === ADMIN_COOKIE) { try { return decodeURIComponent(values.join('=')); } catch { return null; } } }
  return null;
}
export function assertAdminOrigin(req: Pick<Request, 'headers' | 'method'>, origins: readonly string[]): void {
  const origin = req.headers.origin;
  if (!origin && ['GET', 'HEAD'].includes(req.method)) return;
  if (typeof origin !== 'string' || origin === 'null' || !origins.includes(origin)) throw new AdminError('ADMIN_ORIGIN_DENIED', 403);
  let url: URL; try { url = new URL(origin); } catch { throw new AdminError('ADMIN_ORIGIN_DENIED', 403); }
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new AdminError('ADMIN_ORIGIN_DENIED', 403);
}
const messages: Record<string, string> = {
  ADMIN_UNAUTHENTICATED: 'يجب تسجيل الدخول إلى لوحة الإدارة.', ADMIN_SESSION_EXPIRED: 'انتهت الجلسة. سجّل الدخول مجددًا؛ تبقى تغييرات النموذج محفوظة.',
  ADMIN_FORBIDDEN: 'لا تملك صلاحية هذا الإجراء.', ADMIN_ORIGIN_DENIED: 'مصدر الطلب غير مسموح.', ADMIN_INPUT_INVALID: 'تحقق من الحقول المحددة ثم أعد المحاولة.',
  ADMIN_CREDENTIALS_INVALID: 'بيانات الدخول أو رمز التحقق غير صحيحة.', ADMIN_TOTP_REQUIRED: 'أدخل رمز تطبيق المصادقة أو رمز الاسترداد.',
  ADMIN_LOGIN_LOCKED: 'توقفت محاولات الدخول مؤقتًا. أعد المحاولة بعد المهلة.', ADMIN_RATE_LIMITED: 'طلبات كثيرة؛ انتظر ثم أعد المحاولة.',
  ADMIN_RATE_STORE_UNAVAILABLE: 'تعذر التحقق من حد الطلبات. أعد المحاولة لاحقًا.', ADMIN_TOTP_ENROLLMENT_REQUIRED: 'سياسة الأمان تتطلب تفعيل المصادقة الثنائية قبل المتابعة.',
  ADMIN_TOTP_CODE_INVALID: 'رمز التحقق غير صحيح أو استُخدم من قبل.', ADMIN_TOTP_ENROLLMENT_EXPIRED: 'انتهت مهلة إعداد المصادقة الثنائية؛ ابدأ الإعداد مجددًا.',
  ADMIN_TOTP_POLICY_REQUIRED: 'لا يمكن تعطيل المصادقة الثنائية وفق السياسة الحالية.', ADMIN_SETTING_READ_ONLY: 'هذا الإعداد للقراءة فقط؛ لا يملك مستهلكًا قابلًا للتعديل في هذه الدفعة.',
  ADMIN_2FA_KEY_UNAVAILABLE: 'مفتاح تشفير المصادقة الثنائية غير متاح على الخادم؛ لا يمكن إعدادها أو جعلها إلزامية.',
  ADMIN_CONFIRMATION_REQUIRED: 'التأكيد المكتوب لا يطابق المورد.', ADMIN_SUPER_ADMIN_PROTECTED: 'لا يمكن تقليل صلاحيات المدير الأعلى أو إلغاء وصوله.',
};
export function adminErrorResponse(res: Response, error: unknown, requestId: string): void {
  const known = error instanceof AdminError || error instanceof CatalogError;
  const code = known ? error.code : 'ADMIN_UNAVAILABLE', status = known ? error.status : 503;
  const detail = error instanceof AdminError ? error.detail : error instanceof CatalogError ? error.details : {};
  if (!known) { const raw=error&&typeof error==='object'&&'code' in error?String(error.code):'';const causeCode=/^[A-Z0-9_]{1,64}$/u.test(raw)?raw:'ADMIN_UNKNOWN_CAUSE';logger.error('Admin operation unavailable', { code: causeCode, name: error instanceof Error ? error.name : 'UnknownError' }, { requestId, responseCode:'ADMIN_UNAVAILABLE' }); }
  if (status === 429 && typeof detail.retryAfterMs === 'number') res.set('Retry-After', String(Math.max(1, Math.ceil(detail.retryAfterMs / 1000))));
  res.status(status).set('Cache-Control', 'no-store').json({ code, message: messages[code] ?? (status === 503 ? 'تعذر تنفيذ العملية الآن. استخدم معرّف الطلب للمراجعة.' : 'لم تُنفّذ العملية؛ راجع شروطها وأعد المحاولة.'), detail: { ...detail, requestId } });
}
export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router(), env = options.env ?? process.env, access = options.access ?? new AdminAccessService(options.db, env), rate = options.rate ?? new RedisAdminRateGate(env), origins = options.origins ?? config.corsOrigin.filter(origin => origin !== '*');
  const definitions: AdminEndpointDefinition[] = [];
  router.use((req, res, next) => { const requestId = (req as Request & { requestId?: string }).requestId ?? randomUUID(); res.locals.adminRequestId = requestId; res.set('X-Request-Id', requestId).set('Cache-Control', 'no-store'); next(); });
  router.post('/auth/login', async (req, res) => {
    const requestId = String(res.locals.adminRequestId), ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    try {
      assertAdminOrigin(req, origins); await rate.check(ipAddress, 'login');
      const parsed = z.object({ email: z.string().trim().email().max(191), password: z.string().min(1).max(72), code: z.string().trim().min(6).max(128).optional() }).strict().safeParse(req.body);
      if (!parsed.success) throw new AdminError('ADMIN_INPUT_INVALID', 422, { fields: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: 'قيمة غير صالحة' })) });
      const result = await access.login({ email: parsed.data.email!, password: parsed.data.password!, code: parsed.data.code }, { requestId, ipAddress, userAgent: String(req.headers['user-agent'] ?? '') });
      res.cookie(ADMIN_COOKIE, result.token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/admin', maxAge: result.durationMs });
      res.json({ data: { user: result.user, sessionId: result.sessionId, enrollmentRequired: result.enrollmentRequired }, meta: { requestId } });
    } catch (error) { adminErrorResponse(res, error, requestId); }
  });
  const register: AdminRegister = definition => {
    if (!isAdminPermission(definition.permission)) throw new Error('ADMIN_PERMISSION_UNDEFINED');
    if (definition.method !== 'get' && definition.writes !== true) throw new Error('ADMIN_WRITE_AUDIT_CONTRACT_REQUIRED');
    if (definitions.some(row => row.method === definition.method && row.path === definition.path)) throw new Error('ADMIN_ENDPOINT_DUPLICATE');
    definitions.push(definition);
    router[definition.method](definition.path, async (req, res) => {
      const requestId = String(res.locals.adminRequestId), ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      try {
        const token = readAdminCookie(req.headers.cookie); if (!token) throw new AdminError('ADMIN_UNAUTHENTICATED', 401);
        const authenticated = await access.authenticate(token);
        if (!authenticated.user.permissions.includes(definition.permission) || definition.superAdminOnly && !authenticated.user.roles.includes('super_admin')) throw new AdminError('ADMIN_FORBIDDEN', 403);
        if (authenticated.enrollmentRequired && !definition.enrollmentAllowed) throw new AdminError('ADMIN_TOTP_ENROLLMENT_REQUIRED', 403);
        assertAdminOrigin(req, origins); await rate.check(authenticated.user.id, definition.method === 'get' ? 'read' : 'write');
        const body = definition.body?.safeParse(req.body ?? {}), query = definition.query?.safeParse(req.query);
        const invalid = body && !body.success ? body.error : query && !query.success ? query.error : null;
        if (invalid) throw new AdminError('ADMIN_INPUT_INVALID', 422, { fields: invalid.issues.map(issue => ({ path: issue.path.join('.'), message: 'قيمة غير صالحة' })) });
        const ctx: AdminRequestContext = { ...authenticated, actor: actorWithContext(authenticated.actor, requestId, ip), params: Object.fromEntries(Object.entries(req.params).map(([key, value]) => [key, String(value)])), body: (body?.success ? body.data : {}) as Record<string, unknown>, query: (query?.success ? query.data : {}) as Record<string, unknown>, requestId, ip };
        const result = await definition.handler(ctx);
        if (definition.path === '/auth/logout' || definition.path === '/security/sessions/:id' && ctx.params.id === ctx.sessionId) res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/admin' });
        res.json({ data: result.data, meta: { ...result.meta, requestId } });
      } catch (error) { adminErrorResponse(res, error, requestId); }
    });
  };
  options.register?.(register, access);
  // A readable in-process contract generates RBAC tests without a public
  // endpoint inventory or a route that could reveal administrative metadata.
  Object.defineProperty(router, 'adminEndpoints', { value: definitions, enumerable: false });
  return router;
}
export function adminEndpointInventory(router: Router): Array<Pick<AdminEndpointDefinition, 'method' | 'path' | 'permission' | 'superAdminOnly' | 'writes'>> { return ((router as Router & { adminEndpoints?: AdminEndpointDefinition[] }).adminEndpoints ?? []).map(({ method, path, permission, superAdminOnly, writes }) => ({ method, path, permission, superAdminOnly, writes })); }

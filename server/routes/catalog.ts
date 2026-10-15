import { Router, type RequestHandler, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { CatalogGrantError, type CatalogGrantService } from '../services/catalogGrantService';

const messages: Record<string, string> = {
  CATALOG_INPUT_INVALID: 'بيانات الطلب غير صالحة.', CATALOG_FORBIDDEN: 'ليست لديك صلاحية إدارة أدوار المكتبة.',
  CATALOG_ACTOR_MISSING: 'الحساب غير متاح.', CATALOG_TARGET_MISSING: 'الحساب المطلوب غير موجود.',
  CATALOG_GRANT_MISSING: 'منحة الصلاحية غير موجودة.', CATALOG_GRANT_EXISTS: 'هذه الصلاحية ممنوحة بالفعل.',
  CATALOG_GRANT_REVOKED: 'أُلغيت هذه الصلاحية بالفعل.', CATALOG_LAST_OWNER: 'يجب الإبقاء على مالك نشط واحد على الأقل.',
  CATALOG_REQUEST_CONFLICT: 'معرّف الطلب مستخدم لطلب مختلف.', CATALOG_BUSY: 'توجد عملية أخرى قيد التنفيذ. أعد المحاولة.',
};
/** Mount explicitly after the existing authentication middleware. Never mount bootstrapOwner over HTTP. */
export function createCatalogRouter(service: Pick<CatalogGrantService, 'getAccess' | 'createGrant' | 'revokeGrant'>) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.use(requireAuth);
  const handler = (work: (req: AuthenticatedRequest) => Promise<unknown>): RequestHandler => async (req, res: Response) => {
    try { res.json(await work(req)); }
    catch (error) {
      if (error instanceof CatalogGrantError && messages[error.code]) return void res.status(error.status).json({ code: error.code, error: messages[error.code] });
      res.status(500).json({ code: 'CATALOG_FAILED', error: 'تعذر إتمام طلب المكتبة.' });
    }
  };
  router.get('/access', handler(req => service.getAccess(req.user!.id)));
  router.post('/grants', handler(req => service.createGrant(req.user!.id, req.body)));
  router.post('/grants/:id/revoke', handler(req => service.revokeGrant(req.user!.id, req.params.id, req.body)));
  return router;
}

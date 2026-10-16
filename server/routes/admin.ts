import { Router, Response } from 'express';
import { config, getStorageReadiness } from '../config';
import { pingDatabase } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { getCloudRenderPolicy } from '../services/cloudRenderPolicy';
import { getQuranSourceActivationGaps, listQuranSourceCandidates } from '../services/quranSourceRegistry';

const router = Router();

router.get('/overview', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'هذه العملية متاحة للأدمن فقط', code: 'ADMIN_REQUIRED' });
  }
  const db = await pingDatabase();
  const storage = getStorageReadiness(config.storage);
  const sources = listQuranSourceCandidates();
  const renderPolicy = getCloudRenderPolicy();
  return res.json({
    environment: config.nodeEnv,
    database: { status: db.ok ? 'connected' : 'degraded', latencyMs: db.latencyMs },
    storage,
    renderPolicy,
    sources: {
      total: sources.length,
      activationReady: sources.filter(source => getQuranSourceActivationGaps(source).length === 0).length,
      reviewPending: sources.filter(source => getQuranSourceActivationGaps(source).length > 0).length,
    },
  });
});

export default router;

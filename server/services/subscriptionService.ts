import { query } from '../db';
import { normalizePlan, SubscriptionPlan } from '../../shared/planEntitlements';

/** Returns the currently active plan; expired and missing subscriptions are free. */
export async function getActivePlanForUser(userId: string): Promise<SubscriptionPlan> {
  const subscriptions = await query<Array<{ plan?: string }>>(
    `SELECT plan
     FROM subscriptions
     WHERE user_id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  return normalizePlan(subscriptions[0]?.plan);
}

/** Lazily transitions expired rows so all readers see a consistent state. */
export async function syncExpiredSubscriptions(userId: string): Promise<void> {
  await query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?
       AND status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()`,
    [userId],
  );
}

export async function getTodayCloudRenderCount(userId: string): Promise<number> {
  const rows = await query<Array<{ count: number | string }>>(
    `SELECT count
     FROM daily_cloud_render_usage
     WHERE user_id = ? AND date = CURDATE()
     LIMIT 1`,
    [userId],
  );
  return Number(rows[0]?.count || 0);
}

export interface TodayCloudRenderUsage {
  total: number;
  ffmpegAss: number;
  skiaCanvas: number;
  browserCloud: number;
  backgroundAsync: number;
}

/** Counts accepted cloud jobs by engine for the current database day. */
export async function getTodayCloudRenderUsage(userId: string): Promise<TodayCloudRenderUsage> {
  const rows = await query<Array<Record<string, number | string | null>>>(
    `SELECT
       COALESCE(SUM(count), 0) AS total,
       COALESCE(SUM(CASE WHEN engine = 'ffmpeg_ass' THEN count ELSE 0 END), 0) AS ffmpeg_ass,
       COALESCE(SUM(CASE WHEN engine = 'skia_canvas' THEN count ELSE 0 END), 0) AS skia_canvas,
       COALESCE(SUM(CASE WHEN engine = 'browser_cloud' THEN count ELSE 0 END), 0) AS browser_cloud,
       COALESCE(SUM(background_count), 0) AS background_async
     FROM daily_render_engine_usage
     WHERE user_id = ? AND date = CURDATE()`,
    [userId],
  ).catch(async () => query<Array<Record<string, number | string | null>>>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'ffmpeg_ass' THEN 1 ELSE 0 END) AS ffmpeg_ass,
       SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'skia_canvas' THEN 1 ELSE 0 END) AS skia_canvas,
       SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') = 'browser_cloud' THEN 1 ELSE 0 END) AS browser_cloud,
       SUM(CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.backgroundAsync')), 'false') = 'true' THEN 1 ELSE 0 END) AS background_async
     FROM render_jobs
     WHERE user_id = ? AND created_at >= CURDATE()` ,
    [userId],
  ));
  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    ffmpegAss: Number(row.ffmpeg_ass || 0),
    skiaCanvas: Number(row.skia_canvas || 0),
    browserCloud: Number(row.browser_cloud || 0),
    backgroundAsync: Number(row.background_async || 0),
  };
}

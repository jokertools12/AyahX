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

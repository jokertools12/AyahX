import client from 'prom-client';
import { query } from '../db';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const renderJobsTotal = new client.Counter({ name: 'quran_render_jobs_total', help: 'Render jobs by final or requested state', labelNames: ['event', 'plan'], registers: [register] });
export const renderDurationSeconds = new client.Histogram({ name: 'quran_render_duration_seconds', help: 'Completed render duration', buckets: [5, 15, 30, 60, 120, 300, 600], registers: [register] });
export const renderQueueDepth = new client.Gauge({ name: 'quran_render_queue_depth', help: 'Queued render jobs', registers: [register] });

export async function recordRenderAudit(jobId: string, userId: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
  await query(
    'INSERT INTO render_job_audit (id, job_id, user_id, event, details) VALUES (UUID(), ?, ?, ?, ?)',
    [jobId, userId, event, JSON.stringify(details)],
  ).catch(() => {});
  renderJobsTotal.inc({ event, plan: String(details.plan || 'unknown') });
}

export async function refreshRenderMetrics(): Promise<void> {
  const rows = await query<Array<{ count: number }>>("SELECT COUNT(*) AS count FROM render_jobs WHERE status = 'queued'");
  renderQueueDepth.set(Number(rows[0]?.count || 0));
}

export async function prometheusMetrics(): Promise<string> {
  await refreshRenderMetrics().catch(() => {});
  return register.metrics();
}

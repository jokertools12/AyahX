import client from 'prom-client';
import { query } from '../db';
import type { RenderWorkerEngine } from './renderCapacity';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const renderJobsTotal = new client.Counter({ name: 'quran_render_jobs_total', help: 'Render jobs by final or requested state', labelNames: ['event', 'plan'], registers: [register] });
export const renderDurationSeconds = new client.Histogram({ name: 'quran_render_duration_seconds', help: 'Completed render duration', buckets: [5, 15, 30, 60, 120, 300, 600], registers: [register] });
export const renderQueueDepth = new client.Gauge({ name: 'quran_render_queue_depth', help: 'Queued render jobs', registers: [register] });
export const renderEngineQueueDepth = new client.Gauge({
  name: 'quran_render_engine_queue_depth', help: 'Queued render jobs by isolated engine', labelNames: ['engine'], registers: [register],
});
export const renderEngineActiveJobs = new client.Gauge({
  name: 'quran_render_engine_active_jobs', help: 'Running render jobs by isolated engine', labelNames: ['engine'], registers: [register],
});

const ENGINES: RenderWorkerEngine[] = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'];

function normalizeEngine(value: string | null | undefined): RenderWorkerEngine {
  if (value === 'skia_canvas' || value === 'browser_cloud') return value;
  return 'ffmpeg_ass';
}

export async function recordRenderAudit(jobId: string, userId: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
  await query(
    'INSERT INTO render_job_audit (id, job_id, user_id, event, details) VALUES (UUID(), ?, ?, ?, ?)',
    [jobId, userId, event, JSON.stringify(details)],
  ).catch(() => {});
  renderJobsTotal.inc({ event, plan: String(details.plan || 'unknown') });
}

export async function refreshRenderMetrics(): Promise<void> {
  const rows = await query<Array<{ engine: string | null; status: string; count: number }>>(
    "SELECT COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') AS engine, status, COUNT(*) AS count FROM render_jobs WHERE status IN ('queued', 'running') GROUP BY engine, status",
  );
  renderEngineQueueDepth.reset();
  renderEngineActiveJobs.reset();
  let queued = 0;
  const queuedByEngine = new Map<RenderWorkerEngine, number>();
  const activeByEngine = new Map<RenderWorkerEngine, number>();
  for (const row of rows) {
    const engine = normalizeEngine(row.engine);
    const count = Number(row.count || 0);
    if (row.status === 'queued') {
      queued += count;
      queuedByEngine.set(engine, count);
    } else if (row.status === 'running') {
      activeByEngine.set(engine, count);
    }
  }
  for (const engine of ENGINES) {
    renderEngineQueueDepth.set({ engine }, queuedByEngine.get(engine) || 0);
    renderEngineActiveJobs.set({ engine }, activeByEngine.get(engine) || 0);
  }
  renderQueueDepth.set(queued);
}

export async function prometheusMetrics(): Promise<string> {
  await refreshRenderMetrics().catch(() => {});
  return register.metrics();
}

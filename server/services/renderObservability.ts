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
export const renderEngineReplicas = new client.Gauge({
  name: 'quran_render_engine_replicas', help: 'Configured Railway replicas by isolated engine', labelNames: ['engine'], registers: [register],
});
export const renderEngineSlotsTotal = new client.Gauge({
  name: 'quran_render_engine_slots_total', help: 'Admission slots by isolated engine', labelNames: ['engine'], registers: [register],
});
export const renderEngineSlotsUsed = new client.Gauge({
  name: 'quran_render_engine_slots_used', help: 'Active admission slots by isolated engine', labelNames: ['engine'], registers: [register],
});
export const renderEngineQueueWaitSeconds = new client.Gauge({
  name: 'quran_render_engine_queue_wait_seconds', help: 'Queued wait-time quantiles by isolated engine', labelNames: ['engine', 'quantile'], registers: [register],
});
export const renderEngineOldestWaitingSeconds = new client.Gauge({
  name: 'quran_render_engine_oldest_waiting_seconds', help: 'Oldest queued render age by isolated engine', labelNames: ['engine'], registers: [register],
});
export const renderFailuresTotal = new client.Counter({
  name: 'quran_render_failures_total', help: 'Render failures by engine and classified code', labelNames: ['engine', 'code'], registers: [register],
});
export const renderOomEventsTotal = new client.Counter({
  name: 'quran_render_oom_events_total', help: 'Observed cgroup OOM events by engine', labelNames: ['engine'], registers: [register],
});
export const renderJobCpuSeconds = new client.Histogram({
  name: 'quran_render_job_cpu_seconds', help: 'Observed cgroup CPU time per completed render', labelNames: ['engine'], buckets: [0.1, 1, 5, 15, 30, 60, 180, 600], registers: [register],
});
export const renderJobPeakMemoryBytes = new client.Histogram({
  name: 'quran_render_job_peak_memory_bytes', help: 'Observed cgroup peak memory per completed render', labelNames: ['engine'], buckets: [64e6, 128e6, 256e6, 512e6, 1e9, 2e9, 4e9, 8e9], registers: [register],
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
  if (event === 'failed') {
    renderFailuresTotal.inc({ engine: normalizeEngine(String(details.engine || '')), code: String(details.errorCode || 'UNKNOWN') });
  }
}

export function recordRenderResources(engine: RenderWorkerEngine, resources: { cpuSeconds?: number | null; peakMemoryBytes?: number | null; oomKills?: number }): void {
  if (resources.cpuSeconds != null && Number.isFinite(resources.cpuSeconds)) renderJobCpuSeconds.observe({ engine }, Math.max(0, resources.cpuSeconds));
  if (resources.peakMemoryBytes != null && Number.isFinite(resources.peakMemoryBytes)) renderJobPeakMemoryBytes.observe({ engine }, Math.max(0, resources.peakMemoryBytes));
  if (Number(resources.oomKills || 0) > 0) renderOomEventsTotal.inc({ engine }, Number(resources.oomKills));
}

export async function refreshRenderMetrics(): Promise<void> {
  const rows = await query<Array<{ engine: string | null; status: string; count: number }>>(
    "SELECT COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') AS engine, status, COUNT(*) AS count FROM render_jobs WHERE status IN ('queued', 'running') GROUP BY engine, status",
  );
  renderEngineQueueDepth.reset();
  renderEngineActiveJobs.reset();
  renderEngineReplicas.reset();
  renderEngineSlotsTotal.reset();
  renderEngineSlotsUsed.reset();
  renderEngineQueueWaitSeconds.reset();
  renderEngineOldestWaitingSeconds.reset();
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
  const waitRows = await query<Array<{ engine: string | null; wait_seconds: number }>>(
    "SELECT COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') AS engine, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS wait_seconds FROM render_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 10000",
  ).catch(() => []);
  const waitsByEngine = new Map<RenderWorkerEngine, number[]>();
  for (const engine of ENGINES) waitsByEngine.set(engine, []);
  for (const row of waitRows) waitsByEngine.get(normalizeEngine(row.engine))!.push(Math.max(0, Number(row.wait_seconds || 0)));

  const capacityRows = await query<Array<{ engine: string; replicas: number; slots_per_replica: number }>>(
    'SELECT engine, replicas, slots_per_replica FROM render_engine_capacity',
  ).catch(() => []);
  const capacityByEngine = new Map(capacityRows.map((row) => [normalizeEngine(row.engine), row]));
  renderQueueDepth.set(queued);
  for (const engine of ENGINES) {
    const capacity = capacityByEngine.get(engine);
    const replicas = Math.max(1, Number(capacity?.replicas || process.env[`${engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER'}_RENDER_REPLICAS`] || 1));
    const slotsPerReplica = Math.max(1, Number(capacity?.slots_per_replica || (engine === 'ffmpeg_ass' ? 3 : 2)));
    const waits = waitsByEngine.get(engine) || [];
    const sorted = [...waits].sort((a, b) => a - b);
    const quantile = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
    renderEngineReplicas.set({ engine }, replicas);
    renderEngineSlotsTotal.set({ engine }, replicas * slotsPerReplica);
    renderEngineSlotsUsed.set({ engine }, Math.min(replicas * slotsPerReplica, activeByEngine.get(engine) || 0));
    renderEngineQueueWaitSeconds.set({ engine, quantile: 'p50' }, quantile(0.5));
    renderEngineQueueWaitSeconds.set({ engine, quantile: 'p95' }, quantile(0.95));
    renderEngineQueueWaitSeconds.set({ engine, quantile: 'max' }, sorted.length ? sorted[sorted.length - 1] : 0);
    renderEngineOldestWaitingSeconds.set({ engine }, sorted.length ? sorted[sorted.length - 1] : 0);
  }
}

export async function prometheusMetrics(): Promise<string> {
  await refreshRenderMetrics().catch(() => {});
  return register.metrics();
}

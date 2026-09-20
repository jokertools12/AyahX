import { query } from '../db';
import { logger } from '../logger';
import type { RenderWorkerEngine } from './renderCapacity';

const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';
const ENGINES: RenderWorkerEngine[] = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'];
const idleSince = new Map<RenderWorkerEngine, number>();

interface EngineScaleConfig {
  engine: RenderWorkerEngine;
  serviceId: string | undefined;
  slotsPerReplica: number;
  minReplicas: number;
  maxReplicas: number;
}

interface QueueCounts {
  waiting: number;
  active: number;
}

export interface AutoscalePlanInput {
  currentReplicas: number;
  waiting: number;
  active: number;
  slotsPerReplica: number;
  minReplicas: number;
  maxReplicas: number;
  nowMs: number;
  idleSinceMs?: number;
  idleWindowMs: number;
}

export interface AutoscalePlan {
  desiredReplicas: number;
  idleSinceMs?: number;
}

/** Pure scaling decision, kept separate so capacity changes can be tested
 * without reaching Railway or a live database. */
export function planRenderAutoscale(input: AutoscalePlanInput): AutoscalePlan {
  const current = Math.max(0, input.currentReplicas);
  const min = Math.max(1, input.minReplicas);
  const max = Math.max(min, input.maxReplicas);
  const slots = Math.max(1, input.slotsPerReplica);
  const load = Math.max(0, input.waiting) + Math.max(0, input.active);
  const targetByLoad = Math.ceil(load / slots);
  const desiredUp = Math.min(max, Math.max(min, targetByLoad));
  if (desiredUp > current) return { desiredReplicas: desiredUp };
  if (input.waiting === 0 && input.active === 0 && current > min) {
    const idleSinceMs = input.idleSinceMs ?? input.nowMs;
    if (input.nowMs - idleSinceMs >= input.idleWindowMs) {
      return { desiredReplicas: Math.max(min, current - 1) };
    }
    return { desiredReplicas: current, idleSinceMs };
  }
  return { desiredReplicas: current };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function prefixFor(engine: RenderWorkerEngine): 'FFMPEG' | 'SKIA' | 'BROWSER' {
  return engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER';
}

function configFor(engine: RenderWorkerEngine): EngineScaleConfig {
  const prefix = prefixFor(engine);
  return {
    engine,
    serviceId: process.env[`${prefix}_RENDER_SERVICE_ID`],
    // These calibrations describe the worker replicas, not the small API
    // container. They are intentionally configurable after a benchmark.
    slotsPerReplica: positiveInt(process.env[`${prefix}_RENDER_SLOTS_PER_REPLICA`], engine === 'ffmpeg_ass' ? 3 : 2),
    minReplicas: positiveInt(process.env[`${prefix}_RENDER_MIN_REPLICAS`], 2),
    maxReplicas: Math.max(
      positiveInt(process.env[`${prefix}_RENDER_MIN_REPLICAS`], 2),
      positiveInt(process.env[`${prefix}_RENDER_MAX_REPLICAS`], 5),
    ),
  };
}

function autoscalingEnabled(): boolean {
  return process.env.RAILWAY_AUTOSCALER_ENABLED === 'true'
    && Boolean(process.env.RAILWAY_AUTOSCALER_TOKEN)
    && Boolean(process.env.RAILWAY_ENVIRONMENT_ID)
    && ENGINES.every((engine) => Boolean(configFor(engine).serviceId));
}

async function railwayGraphql<T>(queryText: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Project tokens are restricted to exactly this Railway project and
      // environment. Do not use a personal account token in a worker.
      'Project-Access-Token': process.env.RAILWAY_AUTOSCALER_TOKEN!,
    },
    body: JSON.stringify({ query: queryText, variables }),
  });
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join('; ') || `Railway API HTTP ${response.status}`);
  }
  return payload.data;
}

async function getCurrentReplicas(serviceId: string): Promise<number> {
  const data = await railwayGraphql<{ serviceInstance: { numReplicas: number | null } }>(
    'query($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { numReplicas } }',
    { serviceId, environmentId: process.env.RAILWAY_ENVIRONMENT_ID! },
  );
  return Math.max(0, Number(data.serviceInstance.numReplicas || 0));
}

async function updateReplicas(serviceId: string, replicas: number): Promise<void> {
  await railwayGraphql<{ serviceInstanceUpdate: boolean }>(
    'mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }',
    { serviceId, environmentId: process.env.RAILWAY_ENVIRONMENT_ID!, input: { numReplicas: replicas } },
  );
}

async function currentQueueCounts(): Promise<Record<RenderWorkerEngine, QueueCounts>> {
  const rows = await query<Array<{ engine: string | null; status: 'queued' | 'running'; count: number }>>(
    "SELECT COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') AS engine, status, COUNT(*) AS count FROM render_jobs WHERE status IN ('queued', 'running') GROUP BY COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass'), status",
  );
  const counts = Object.fromEntries(ENGINES.map((engine) => [engine, { waiting: 0, active: 0 }])) as Record<RenderWorkerEngine, QueueCounts>;
  for (const row of rows) {
    const engine: RenderWorkerEngine = row.engine === 'skia_canvas' || row.engine === 'browser_cloud' ? row.engine : 'ffmpeg_ass';
    if (row.status === 'queued') counts[engine].waiting = Number(row.count || 0);
    else counts[engine].active = Number(row.count || 0);
  }
  return counts;
}

async function persistCapacity(config: EngineScaleConfig, replicas: number, counts: QueueCounts): Promise<void> {
  await query(
    `INSERT INTO render_engine_capacity (engine, replicas, slots_per_replica, waiting_jobs, active_jobs, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE replicas = VALUES(replicas), slots_per_replica = VALUES(slots_per_replica),
       waiting_jobs = VALUES(waiting_jobs), active_jobs = VALUES(active_jobs), updated_at = NOW()`,
    [config.engine, replicas, config.slotsPerReplica, counts.waiting, counts.active],
  );
}

/**
 * Safely resizes only the worker whose own queue needs capacity. A queue is
 * never redirected into another engine. Scale up is immediate; scale down is
 * delayed until the configured idle window and only with zero active jobs.
 */
export async function runRenderAutoscalerTick(): Promise<void> {
  if (!autoscalingEnabled()) return;
  const countsByEngine = await currentQueueCounts();
  const now = Date.now();
  const idleWindowMs = positiveInt(process.env.RAILWAY_AUTOSCALER_IDLE_MINUTES, 15) * 60_000;

  for (const engine of ENGINES) {
    const config = configFor(engine);
    const counts = countsByEngine[engine];
    try {
      const current = await getCurrentReplicas(config.serviceId!);
      const plan = planRenderAutoscale({
        currentReplicas: current,
        waiting: counts.waiting,
        active: counts.active,
        slotsPerReplica: config.slotsPerReplica,
        minReplicas: config.minReplicas,
        maxReplicas: config.maxReplicas,
        nowMs: now,
        idleSinceMs: idleSince.get(engine),
        idleWindowMs,
      });
      const desired = plan.desiredReplicas;
      if (plan.idleSinceMs === undefined) idleSince.delete(engine);
      else idleSince.set(engine, plan.idleSinceMs);

      if (desired !== current) {
        await updateReplicas(config.serviceId!, desired);
        logger.info(`Render autoscaler changed ${engine} replicas ${current} -> ${desired}; waiting=${counts.waiting}, active=${counts.active}, slotsPerReplica=${config.slotsPerReplica}`);
      }
      await persistCapacity(config, desired, counts);
    } catch (error) {
      logger.error(`Render autoscaler failed for ${engine}:`, error);
    }
  }
}

export function renderAutoscalerIntervalMs(): number {
  return Math.max(5_000, positiveInt(process.env.RAILWAY_AUTOSCALER_POLL_SECONDS, 15) * 1_000);
}

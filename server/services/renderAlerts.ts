import { query } from '../db';
import { pool } from '../db';
import { logger } from '../logger';
import type { RenderWorkerEngine } from './renderCapacity';
import IORedis from 'ioredis';

const ENGINES: RenderWorkerEngine[] = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'];
const lastSentAt = new Map<string, number>();
let redisProbe: IORedis | null = null;

export async function closeRenderAlertProbe(): Promise<void> {
  const probe = redisProbe;
  redisProbe = null;
  await probe?.quit().catch(() => probe?.disconnect());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEngine(value: string | null | undefined): RenderWorkerEngine {
  return value === 'skia_canvas' || value === 'browser_cloud' ? value : 'ffmpeg_ass';
}

async function sendAlert(key: string, message: string): Promise<void> {
  const webhook = process.env.RENDER_ALERT_WEBHOOK_URL?.trim();
  if (!webhook) return;
  const cooldownMs = positiveInt(process.env.RENDER_ALERT_COOLDOWN_MINUTES, 15) * 60_000;
  const last = lastSentAt.get(key) || 0;
  if (Date.now() - last < cooldownMs) return;
  lastSentAt.set(key, Date.now());
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `[AyahX render alert] ${message}`, message, key }),
    });
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
  } catch (error) {
    logger.warn(`Could not send render alert ${key}:`, error);
  }
}

async function checkInfrastructurePressure(): Promise<void> {
  const internalPool: any = (pool as any).pool || pool;
  const openConnections = Number(internalPool?._allConnections?.length || 0);
  const poolLimit = Number(internalPool?.config?.connectionLimit || process.env.MYSQL_POOL_SIZE || 15);
  if (poolLimit > 0 && openConnections / poolLimit > 0.8) {
    await sendAlert('mysql-connections>80%', `MySQL pool is using ${openConnections}/${poolLimit} connections`);
  }

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;
  if (!redisProbe) {
    redisProbe = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: true });
    redisProbe.on('error', (error) => logger.warn('Render alert Redis probe error:', error));
  }
  try {
    const info = await redisProbe.info('memory');
    const used = Number(info.match(/^used_memory:(\d+)/m)?.[1] || 0);
    const configuredMax = Number(info.match(/^maxmemory:(\d+)/m)?.[1] || 0);
    const envMax = Number(process.env.REDIS_MEMORY_LIMIT_MB || 0) * 1024 * 1024;
    const max = configuredMax > 0 ? configuredMax : envMax;
    if (max > 0 && used / max > 0.7) {
      await sendAlert('redis-memory>70%', `Redis memory is ${(used / max * 100).toFixed(1)}% (${Math.round(used / 1048576)}MiB/${Math.round(max / 1048576)}MiB)`);
    }
  } catch (error) {
    logger.warn('Could not inspect Redis memory for render alerts:', error);
  }
}

/** Best-effort threshold checks. Missing webhook configuration is a no-op. */
export async function runRenderAlertTick(): Promise<void> {
  if (!process.env.RENDER_ALERT_WEBHOOK_URL) return;
  await checkInfrastructurePressure();
  const rows = await query<Array<{ engine: string | null; wait_seconds: number }>>(
    "SELECT COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass') AS engine, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS wait_seconds FROM render_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 10000",
  ).catch(() => []);
  for (const engine of ENGINES) {
    const waits = rows.filter((row) => normalizeEngine(row.engine) === engine).map((row) => Number(row.wait_seconds || 0)).sort((a, b) => a - b);
    const p95 = waits.length ? waits[Math.min(waits.length - 1, Math.floor(waits.length * 0.95))] : 0;
    const oldest = waits.length ? waits[waits.length - 1] : 0;
    if (p95 > 60) await sendAlert(`${engine}:p95>60`, `${engine} queue p95 wait is ${p95}s`);
    if (p95 > 180) await sendAlert(`${engine}:p95>180`, `${engine} queue p95 wait is critical at ${p95}s`);
    if (oldest > 300) await sendAlert(`${engine}:oldest>300`, `${engine} oldest queued job is ${oldest}s old`);
  }

  const [failures] = await query<Array<{ failed: number; terminal: number }>>(
    "SELECT SUM(status = 'failed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)) AS failed, SUM(status IN ('failed', 'succeeded') AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)) AS terminal FROM render_jobs",
  ).catch(() => [{ failed: 0, terminal: 0 }]);
  const failureRate = Number(failures?.terminal || 0) > 0 ? Number(failures.failed || 0) / Number(failures.terminal) : 0;
  if (failureRate > 0.03) await sendAlert('failure-rate>3%', `Render failure rate is ${(failureRate * 100).toFixed(1)}% over the last 15 minutes`);

  const oomRows = await query<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM render_jobs WHERE error_code = 'OOM_SUSPECTED' AND updated_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
  ).catch(() => [{ count: 0 }]);
  if (Number(oomRows[0]?.count || 0) > 0) await sendAlert('oom', `${oomRows[0].count} OOM-suspected render failure(s) in the last 15 minutes`);

  const maxRows = await query<Array<{ engine: string; replicas: number }>>(
    'SELECT engine, replicas FROM render_engine_capacity',
  ).catch(() => []);
  for (const row of maxRows) {
    const prefix = normalizeEngine(row.engine) === 'ffmpeg_ass' ? 'FFMPEG' : normalizeEngine(row.engine) === 'skia_canvas' ? 'SKIA' : 'BROWSER';
    const maxReplicas = positiveInt(process.env[`${prefix}_RENDER_MAX_REPLICAS`], 6);
    if (Number(row.replicas) >= maxReplicas) await sendAlert(`${row.engine}:max-replicas`, `${row.engine} reached MAX_REPLICAS=${maxReplicas}`);
  }
}

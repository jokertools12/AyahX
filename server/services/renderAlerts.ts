import { query } from '../db';
import { logger } from '../logger';
import type { RenderWorkerEngine } from './renderCapacity';

const ENGINES: RenderWorkerEngine[] = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'];
const lastSentAt = new Map<string, number>();

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

/** Best-effort threshold checks. Missing webhook configuration is a no-op. */
export async function runRenderAlertTick(): Promise<void> {
  if (!process.env.RENDER_ALERT_WEBHOOK_URL) return;
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

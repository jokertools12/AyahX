import fs from 'fs';
import os from 'os';

const MB = 1024 * 1024;
export type RenderWorkerEngine = 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud';

const DEFAULT_MAX_CONCURRENCY = 32;

const MEMORY_PROFILES: Record<RenderWorkerEngine, {
  envPrefix: string;
  memoryPerJobMb: number;
  memoryReserveMb: number;
}> = {
  // These native paths do not launch Chromium. The values are intentionally
  // conservative defaults and can be tightened after Railway peak metrics.
  ffmpeg_ass: { envPrefix: 'FFMPEG', memoryPerJobMb: 128, memoryReserveMb: 256 },
  skia_canvas: { envPrefix: 'SKIA', memoryPerJobMb: 256, memoryReserveMb: 256 },
  // Chromium + FFmpeg remains isolated in its own worker pool.
  browser_cloud: { envPrefix: 'BROWSER', memoryPerJobMb: 650, memoryReserveMb: 350 },
};

function readCgroupMemoryLimit(): number | null {
  const candidates = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];
  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw || raw === 'max') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER) return value;
    } catch {
      // The worker may run outside Linux cgroups (local Windows/macOS); use os.totalmem below.
    }
  }
  return null;
}

function readCgroupCpuLimit(): number | null {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (raw.length >= 2 && raw[0] !== 'max') {
      const quota = Number(raw[0]);
      const period = Number(raw[1]);
      if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
        return Math.max(0.1, quota / period);
      }
    }
  } catch {
    // cgroup v1 and non-Linux hosts use the legacy files/fallback below.
  }

  try {
    const quota = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim());
    const period = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());
    if (quota > 0 && period > 0) return Math.max(0.1, quota / period);
  } catch {
    // The worker may run outside Linux cgroups.
  }

  return null;
}

export function availableCpuCores(): number {
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const hostCores = Math.max(1, parallelism || 1);
  const cgroupCores = readCgroupCpuLimit();
  return Math.max(1, Math.floor(Math.min(hostCores, cgroupCores || hostCores)));
}

/** Parses a positive concurrency setting. `auto` deliberately resolves to the host CPU capacity. */
export function resolveConcurrencySetting(value: string | undefined, fallback = availableCpuCores()): number {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return Math.max(1, fallback);
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.max(1, fallback);
}

function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRenderWorkerEngine(value?: string): RenderWorkerEngine {
  if (value === 'ffmpeg_ass' || value === 'skia_canvas' || value === 'browser_cloud') return value;
  return 'browser_cloud';
}

export function getRenderMemoryProfile(engine: RenderWorkerEngine = resolveRenderWorkerEngine(process.env.RENDER_WORKER_ENGINE)): {
  memoryPerJobMb: number;
  memoryReserveMb: number;
} {
  const profile = MEMORY_PROFILES[engine];
  return {
    memoryPerJobMb: positiveEnvNumber(`${profile.envPrefix}_RENDER_MEMORY_PER_JOB_MB`, profile.memoryPerJobMb),
    memoryReserveMb: positiveEnvNumber(`${profile.envPrefix}_RENDER_MEMORY_RESERVE_MB`, profile.memoryReserveMb),
  };
}

export interface RenderCapacitySnapshot {
  engine: RenderWorkerEngine;
  cpuCores: number;
  memoryLimitBytes: number;
  estimatedUsedBytes: number;
  availableBytes: number;
  memoryPerJobBytes: number;
  memoryReserveBytes: number;
  activeJobs: number;
  targetConcurrency: number;
}

/**
 * Estimates safe render parallelism from the actual container limits.
 * Chromium and FFmpeg are child processes, so their memory is reserved per
 * active job in addition to the Node worker RSS. Existing jobs are never
 * stopped when capacity falls; only admission of the next job is throttled.
 */
export function getRenderCapacity(
  activeJobs: number,
  configuredMax?: number,
  engine: RenderWorkerEngine = resolveRenderWorkerEngine(process.env.RENDER_WORKER_ENGINE),
): RenderCapacitySnapshot {
  const cpuCores = availableCpuCores();
  const memoryLimitBytes = readCgroupMemoryLimit() || os.totalmem();
  const profile = getRenderMemoryProfile(engine);
  const memoryPerJobBytes = profile.memoryPerJobMb * MB;
  const memoryReserveBytes = profile.memoryReserveMb * MB;
  const nodeRssBytes = process.memoryUsage().rss;
  const normalizedActiveJobs = Math.max(0, activeJobs);
  const estimatedUsedBytes = nodeRssBytes + normalizedActiveJobs * memoryPerJobBytes;
  const availableBytes = Math.max(0, memoryLimitBytes - estimatedUsedBytes - memoryReserveBytes);
  const additionalMemorySlots = Math.floor(availableBytes / memoryPerJobBytes);
  const maxConcurrency = configuredMax && configuredMax > 0
    ? configuredMax
    : Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(cpuCores, 1));
  const targetConcurrency = Math.max(
    normalizedActiveJobs,
    Math.min(maxConcurrency, cpuCores, normalizedActiveJobs + additionalMemorySlots),
  );

  return {
    engine,
    cpuCores,
    memoryLimitBytes,
    estimatedUsedBytes,
    availableBytes,
    memoryPerJobBytes,
    memoryReserveBytes,
    activeJobs: normalizedActiveJobs,
    targetConcurrency: Math.max(1, targetConcurrency),
  };
}

export function capacityPollIntervalMs(): number {
  const configured = Number.parseInt(process.env.RENDER_CAPACITY_POLL_MS || '5000', 10);
  return Number.isFinite(configured) ? Math.max(1000, Math.min(30000, configured)) : 5000;
}

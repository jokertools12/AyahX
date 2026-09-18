import fs from 'fs';
import os from 'os';

const MB = 1024 * 1024;
const DEFAULT_MEMORY_PER_JOB_MB = 300;
const DEFAULT_MEMORY_RESERVE_MB = 180;
const DEFAULT_MAX_CONCURRENCY = 16;

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

export function availableCpuCores(): number {
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, parallelism || 1);
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

export interface RenderCapacitySnapshot {
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
export function getRenderCapacity(activeJobs: number, configuredMax?: number): RenderCapacitySnapshot {
  const cpuCores = availableCpuCores();
  const memoryLimitBytes = readCgroupMemoryLimit() || os.totalmem();
  const memoryPerJobBytes = positiveEnvNumber('RENDER_MEMORY_PER_JOB_MB', DEFAULT_MEMORY_PER_JOB_MB) * MB;
  const memoryReserveBytes = positiveEnvNumber('RENDER_MEMORY_RESERVE_MB', DEFAULT_MEMORY_RESERVE_MB) * MB;
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

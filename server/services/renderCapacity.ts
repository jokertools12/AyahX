import fs from 'fs';
import os from 'os';

const MB = 1024 * 1024;
export type RenderWorkerEngine = 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud';

const DEFAULT_MAX_CONCURRENCY = 8;
const HARD_MAX_CONCURRENCY = 8;

export interface RenderJobProfile {
  memoryPerJobMb: number;
  cpuPerJob: number;
  memoryReserveMb: number;
}

const DEFAULT_PROFILES: Record<RenderWorkerEngine, RenderJobProfile> = {
  ffmpeg_ass: { memoryPerJobMb: 256, cpuPerJob: 1, memoryReserveMb: 512 },
  skia_canvas: { memoryPerJobMb: 512, cpuPerJob: 1.5, memoryReserveMb: 512 },
  browser_cloud: { memoryPerJobMb: 900, cpuPerJob: 2, memoryReserveMb: 512 },
};

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCgroupValue(paths: string[]): number | null {
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw || raw === 'max') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER) return value;
    } catch {
      // cgroup files are absent on local Windows/macOS development machines.
    }
  }
  return null;
}

function readCgroupMemoryLimit(): number | null {
  const override = positiveNumber(process.env.RENDER_MEMORY_LIMIT_MB, 0);
  if (override > 0) return override * MB;
  return readCgroupValue(['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']);
}

function readCgroupCpuLimit(): number | null {
  const override = positiveNumber(process.env.RENDER_CPU_LIMIT, 0);
  if (override > 0) return override;
  try {
    const parts = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] !== 'max') {
      const quota = Number(parts[0]);
      const period = Number(parts[1]);
      if (quota > 0 && period > 0) return quota / period;
    }
  } catch { /* fallback to cgroup v1 */ }
  try {
    const quota = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim());
    const period = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());
    if (quota > 0 && period > 0) return quota / period;
  } catch { /* local development fallback */ }
  return null;
}

export function availableCpuCores(): number {
  const hostCores = Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
  return Math.max(1, Math.floor(Math.min(hostCores, readCgroupCpuLimit() || hostCores)));
}

export function resolveConcurrencySetting(value: string | undefined, fallback = availableCpuCores()): number {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return Math.max(1, fallback);
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.max(1, fallback);
}

export function resolveRenderWorkerEngine(value?: string): RenderWorkerEngine {
  if (value === 'ffmpeg_ass' || value === 'skia_canvas' || value === 'browser_cloud') return value;
  if (value === 'ffmpeg') return 'ffmpeg_ass';
  if (value === 'skia') return 'skia_canvas';
  if (value === 'browser') return 'browser_cloud';
  return 'browser_cloud';
}

export function getRenderJobProfile(engine: RenderWorkerEngine = resolveRenderWorkerEngine(process.env.RENDER_WORKER_ENGINE)): RenderJobProfile {
  const defaults = DEFAULT_PROFILES[engine];
  const prefix = engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER';
  return {
    memoryPerJobMb: positiveNumber(process.env[`${prefix}_RENDER_MEMORY_PER_JOB_MB`] || process.env.RENDER_MEMORY_PER_JOB_MB, defaults.memoryPerJobMb),
    cpuPerJob: positiveNumber(process.env[`${prefix}_RENDER_CPU_PER_JOB`] || process.env.RENDER_CPU_PER_JOB, defaults.cpuPerJob),
    memoryReserveMb: positiveNumber(process.env[`${prefix}_RENDER_MEMORY_RESERVE_MB`] || process.env.RENDER_MEMORY_RESERVE_MB, defaults.memoryReserveMb),
  };
}

export function getRenderMemoryProfile(engine: RenderWorkerEngine = resolveRenderWorkerEngine(process.env.RENDER_WORKER_ENGINE)) {
  const profile = getRenderJobProfile(engine);
  return { memoryPerJobMb: profile.memoryPerJobMb, memoryReserveMb: profile.memoryReserveMb };
}

export function readCurrentMemoryBytes(): number {
  return readCgroupValue(['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) || process.memoryUsage().rss;
}

export function readMemoryPeakBytes(): number {
  return readCgroupValue(['/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory/memory.max_usage_in_bytes']) || readCurrentMemoryBytes();
}

export function readOomKillCount(): number {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.events', 'utf8');
    const match = raw.match(/^oom_kill\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  } catch { return 0; }
}

export interface RenderCapacitySnapshot {
  engine: RenderWorkerEngine;
  cpuCores: number;
  memoryLimitBytes: number;
  currentMemoryBytes: number;
  estimatedUsedBytes: number;
  availableBytes: number;
  memoryPerJobBytes: number;
  memoryReserveBytes: number;
  cpuPerJob: number;
  activeJobs: number;
  targetConcurrency: number;
  memorySlots: number;
  cpuSlots: number;
  admissionSafe: boolean;
}

export function getRenderCapacity(
  activeJobs: number,
  configuredMax?: number,
  engine: RenderWorkerEngine = resolveRenderWorkerEngine(process.env.RENDER_WORKER_ENGINE),
): RenderCapacitySnapshot {
  const profile = getRenderJobProfile(engine);
  const cpuCores = Math.max(1, Math.floor(readCgroupCpuLimit() || availableCpuCores()));
  const memoryLimitBytes = readCgroupMemoryLimit() || os.totalmem();
  const currentMemoryBytes = readCurrentMemoryBytes();
  const memoryPerJobBytes = profile.memoryPerJobMb * MB;
  const memoryReserveBytes = profile.memoryReserveMb * MB;
  const normalizedActiveJobs = Math.max(0, activeJobs);
  // memory.current already includes Node plus every live child process. Do
  // not add the active-job estimate again or healthy replicas become falsely
  // throttled as work increases.
  const estimatedUsedBytes = Math.max(currentMemoryBytes, process.memoryUsage().rss);
  const admissionLimit = memoryLimitBytes * 0.9;
  const availableBytes = Math.max(0, admissionLimit - estimatedUsedBytes - memoryReserveBytes);
  const additionalMemorySlots = Math.max(0, Math.floor(availableBytes / memoryPerJobBytes));
  const memorySlots = normalizedActiveJobs + additionalMemorySlots;
  const cpuSlots = Math.max(1, Math.floor((cpuCores * Number(process.env.RENDER_CPU_TARGET_UTIL || 0.85)) / profile.cpuPerJob));
  const configured = configuredMax && configuredMax > 0 ? configuredMax : resolveConcurrencySetting(process.env.RENDER_CAPACITY_HARD_MAX, DEFAULT_MAX_CONCURRENCY);
  const hardMax = Math.max(1, Math.min(HARD_MAX_CONCURRENCY, configured));
  const targetConcurrency = Math.max(normalizedActiveJobs, Math.min(hardMax, memorySlots, cpuSlots));
  return {
    engine, cpuCores, memoryLimitBytes, currentMemoryBytes, estimatedUsedBytes, availableBytes,
    memoryPerJobBytes, memoryReserveBytes, cpuPerJob: profile.cpuPerJob, activeJobs: normalizedActiveJobs,
    targetConcurrency: Math.max(1, targetConcurrency), memorySlots, cpuSlots,
    admissionSafe: currentMemoryBytes + memoryPerJobBytes + memoryReserveBytes <= admissionLimit,
  };
}

export function capacityPollIntervalMs(): number {
  const configured = Number.parseInt(process.env.RENDER_CAPACITY_POLL_MS || '5000', 10);
  return Number.isFinite(configured) ? Math.max(1000, Math.min(30000, configured)) : 5000;
}

export function renderJobTimeoutMs(engine: RenderWorkerEngine): number {
  const fallback = engine === 'browser_cloud' ? 20 * 60_000 : 15 * 60_000;
  const configured = Number.parseInt(process.env.RENDER_JOB_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

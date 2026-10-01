import path from 'path';
import fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import { RenderQueueEngine } from './renderQueueBroker';
import { logger } from '../logger';
import { readOomKillCount, renderJobTimeoutMs } from './renderCapacity';

const children = new Map<string, ChildProcess>();

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RenderChildResources {
  cpuSeconds: number | null;
  peakMemoryBytes: number | null;
  oomKills: number;
}

type ProcessSample = { cpuTicks: number; residentBytes: number };

/**
 * Samples the isolated child process tree rather than the worker cgroup.
 * Railway workers run Linux; the fallback keeps local Windows development
 * functional while the cgroup governor still protects the replica.
 */
function readProcessTreeSample(rootPid: number): ProcessSample | null {
  if (process.platform !== 'linux') return null;
  try {
    const ppidByPid = new Map<number, number>();
    const sampleByPid = new Map<number, ProcessSample>();
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen < 0) continue;
        const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
        const ppid = Number(fields[1]);
        const cpuTicks = Number(fields[11]) + Number(fields[12]);
        if (!Number.isFinite(ppid) || !Number.isFinite(cpuTicks)) continue;
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        ppidByPid.set(pid, ppid);
        sampleByPid.set(pid, { cpuTicks, residentBytes: Number(rssMatch?.[1] || 0) * 1024 });
      } catch {
        // Processes can disappear while /proc is being scanned.
      }
    }
    const tree = new Set<number>([rootPid]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [pid, ppid] of ppidByPid) {
        if (tree.has(ppid) && !tree.has(pid)) {
          tree.add(pid);
          expanded = true;
        }
      }
    }
    let cpuTicks = 0;
    let residentBytes = 0;
    for (const pid of tree) {
      const sample = sampleByPid.get(pid);
      if (sample) {
        cpuTicks += sample.cpuTicks;
        residentBytes += sample.residentBytes;
      }
    }
    return { cpuTicks, residentBytes };
  } catch {
    return null;
  }
}

function startResourceSampler(child: ChildProcess): { finish: () => RenderChildResources } {
  const startOom = readOomKillCount();
  const start = child.pid ? readProcessTreeSample(child.pid) : null;
  let peakMemoryBytes = start?.residentBytes || 0;
  const samples: ProcessSample[] = [];
  if (start) samples.push(start);
  const timer = setInterval(() => {
    if (!child.pid) return;
    const current = readProcessTreeSample(child.pid);
    if (!current) return;
    samples.push(current);
    peakMemoryBytes = Math.max(peakMemoryBytes, current.residentBytes);
  }, 250);
  timer.unref?.();
  return {
    finish: () => {
      clearInterval(timer);
      if (child.pid) {
        const final = readProcessTreeSample(child.pid);
        if (final) {
          samples.push(final);
          peakMemoryBytes = Math.max(peakMemoryBytes, final.residentBytes);
        }
      }
      const end = samples[samples.length - 1];
      const cpuSeconds = start && end ? Math.max(0, (end.cpuTicks - start.cpuTicks) / 100) : null;
      return {
        cpuSeconds,
        peakMemoryBytes: peakMemoryBytes || null,
        oomKills: Math.max(0, readOomKillCount() - startOom),
      };
    },
  };
}

function childCommand(jobId: string, engine: RenderQueueEngine): { command: string; args: string[] } {
  const compiled = path.resolve(process.cwd(), 'dist-server/renderChild.cjs');
  if (fs.existsSync(compiled)) return { command: process.execPath, args: [compiled, jobId, engine] };
  const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  return { command: process.execPath, args: [tsxCli, path.resolve(process.cwd(), 'server/renderChild.ts'), jobId, engine] };
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      // Railway runs Linux, but keeping the Windows path makes local
      // cancellation deterministic too.
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    } else if (child.pid) {
      // The child is detached on POSIX, so a negative pid addresses the whole
      // process group (tsx -> renderer -> ffmpeg/chromium), not only tsx.
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

function forceTerminateProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    } else if (child.pid) {
      process.kill(-child.pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

/** Executes one render in an isolated child process. The BullMQ supervisor
 * remains responsive and a bad FFmpeg/Chromium process cannot take its queue
 * consumer down with it. */
export function runRenderJobInChild(jobId: string, engine: RenderQueueEngine): Promise<RenderChildResources> {
  return new Promise((resolve, reject) => {
    const { command, args } = childCommand(jobId, engine);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, RENDER_CHILD_PROCESS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    children.set(jobId, child);
    const resourceSampler = startResourceSampler(child);
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error('[render-child:' + jobId + '] exceeded its ' + renderJobTimeoutMs(engine) + 'ms deadline; terminating it.');
      terminateProcessTree(child);
      setTimeout(() => forceTerminateProcessTree(child), 10_000).unref?.();
    }, renderJobTimeoutMs(engine));
    child.stdout?.on('data', (data: Buffer) => logger.info(`[render-child:${jobId}] ${data.toString().trim()}`));
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.once('error', (error) => {
      clearTimeout(timeout);
      children.delete(jobId);
      const wrapped: any = error;
      wrapped.renderResources = resourceSampler.finish();
      reject(wrapped);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      children.delete(jobId);
      const resources = resourceSampler.finish();
      if (code === 0 && !timedOut) resolve(resources);
      else {
        const error: any = new Error(`Render child exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${stderr.slice(-1200)}`);
        error.renderResources = resources;
        reject(error);
      }
    });
  });
}

export function stopRenderChild(jobId: string): void {
  const child = children.get(jobId);
  if (!child) return;
  terminateProcessTree(child);
  setTimeout(() => {
    forceTerminateProcessTree(child);
  }, 10_000).unref?.();
}

export function stopAllRenderChildren(): void {
  for (const jobId of children.keys()) stopRenderChild(jobId);
}

export function activeRenderChildCount(): number {
  return children.size;
}

/** Waits for children to finish naturally during a Railway deployment drain.
 * The caller decides when to terminate/requeue the remainder. */
export async function waitForRenderChildren(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (children.size > 0 && Date.now() < deadline) {
    await delay(Math.min(500, Math.max(1, deadline - Date.now())));
  }
  return children.size === 0;
}

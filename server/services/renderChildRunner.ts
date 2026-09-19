import path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { RenderQueueEngine } from './renderQueueBroker';
import { logger } from '../logger';
import { renderJobTimeoutMs } from './renderCapacity';

const children = new Map<string, ChildProcess>();

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function childCommand(jobId: string, engine: RenderQueueEngine): { command: string; args: string[] } {
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
export function runRenderJobInChild(jobId: string, engine: RenderQueueEngine): Promise<void> {
  return new Promise((resolve, reject) => {
    const { command, args } = childCommand(jobId, engine);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    children.set(jobId, child);
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
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      children.delete(jobId);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error(`Render child exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${stderr.slice(-1200)}`));
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

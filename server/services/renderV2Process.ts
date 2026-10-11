import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CatalogError } from './catalogContracts';

const childObservers = new Set<(child: ChildProcess) => void>();
export function observeRenderV2Children(observer: (child: ChildProcess) => void): () => void {
  childObservers.add(observer); return () => { childObservers.delete(observer); };
}

/** Diagnostics are hashed: neither an upstream capability nor a private path enters a job/log. */
export async function runRenderV2Process(binary: string, args: string[], options: {
  signal?: AbortSignal; timeoutMs?: number; outputLimitBytes?: number;
  onChild?: (child: ChildProcess) => void;
} = {}): Promise<{ stdout: Buffer; stderr: string }> {
  options.signal?.throwIfAborted();
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  options.onChild?.(child);
  for (const observer of childObservers) observer(child);
  const chunks: Buffer[] = [];
  let size = 0, diagnostic = '', exceeded = false, timedOut = false;
  const limit = options.outputLimitBytes ?? 8 * 1024 * 1024;
  const abort = () => child.kill('SIGKILL');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort(); }, options.timeoutMs ?? 180_000);
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) { exceeded = true; abort(); }
    else chunks.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-65_536); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new CatalogError('RENDER_V2_EXECUTABLE_UNAVAILABLE', 503)));
      child.once('close', code => {
        if (options.signal?.aborted) return reject(new CatalogError('RENDER_CANCELLED', 409));
        if (timedOut) return reject(new CatalogError('RENDER_V2_PROCESS_TIMEOUT', 504));
        if (exceeded) return reject(new CatalogError('RENDER_V2_PROCESS_OUTPUT_LIMIT', 422));
        if (code !== 0) return reject(new CatalogError('RENDER_V2_PROCESS_FAILED', 502, {
          exit_code: code, diagnostic_sha256: createHash('sha256').update(diagnostic).digest('hex'),
        }));
        resolve();
      });
    });
    return { stdout: Buffer.concat(chunks), stderr: diagnostic };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

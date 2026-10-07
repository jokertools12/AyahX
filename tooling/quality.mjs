import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Root commands are reused; no full-repository AI scan or private uploads.
const root = fileURLToPath(new URL('..', import.meta.url));
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this through npm --prefix tooling run quality.');
for (const args of [['run', 'build'], ['test', '--', 'src/test/animationTimeline.test.ts']]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

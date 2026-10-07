import { readdir, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { localEndpoint } from './comfy-client.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail });
add('Node', Number(process.versions.node.split('.')[0]) >= 22 ? 'ready' : 'failed', process.versions.node);
for (const name of await readdir(resolve(root, '.agents/skills'))) {
  const text = await readFile(resolve(root, '.agents/skills', name, 'SKILL.md'), 'utf8');
  add(`skill:${name}`, /^---\r?\n[\s\S]*?\r?\n---/.test(text) ? 'ready' : 'failed', 'project-local');
}
for (const pkg of ['ai', '@ai-sdk/openai', '@terrain-ai/cli']) {
  try { const metadata = JSON.parse(await readFile(new URL(`node_modules/${pkg}/package.json`, import.meta.url))); add(pkg, 'ready', metadata.version); }
  catch { add(pkg, 'failed', 'Run npm --prefix tooling ci --ignore-scripts'); }
}
const terrain = spawnSync(process.execPath, [fileURLToPath(new URL('terrain-cli.mjs', import.meta.url)), '--help'], { encoding: 'utf8', timeout: 15000 });
add('Terrain executable', terrain.status === 0 ? 'ready' : 'pending', terrain.status === 0 ? 'CLI responds' : 'Windows CLI binary/desktop installation required');
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
add('AutoGPT runtime', docker.status === 0 ? 'pending' : 'pending', docker.status === 0 ? 'Docker available; AutoGPT launch deferred' : 'Docker unavailable; launch deferred by user');
try {
  const url = localEndpoint(process.env.AYAHX_COMFY_URL);
  const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
  add('ComfyUI runtime', response.ok ? 'ready' : 'pending', response.ok ? 'Local service responds; model/output not verified' : `HTTP ${response.status}`);
} catch { add('ComfyUI runtime', 'pending', 'Local service unavailable; launch deferred by user'); }
add('Live AI provider', 'pending', 'No paid/provider call made; configure explicit model/key before use');
for (const path of ['tooling/prompts/ayahx-prompts.json', 'tooling/autogpt/ayahx-research-task.md', 'docs/toolkit-guide.ar.md']) {
  try { await access(resolve(root, path)); add(path, 'ready', 'present'); } catch { add(path, 'failed', 'missing'); }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
if (checks.some(x => x.status === 'failed')) process.exitCode = 1;

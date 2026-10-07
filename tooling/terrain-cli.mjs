import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = join(root, 'tooling/runtime/env-catalog');
if (existsSync(join(catalog, 'catalog.json'))) process.env.TERRAIN_ENV_CATALOG = catalog;
const candidates = [process.env.AYAHX_TERRAIN_BIN, join(root, 'tooling/runtime/terrain-release/terrain.exe'), join(homedir(), '.terrain/bin/terrain.exe'), join(homedir(), '.terrain/bin/terrain')].filter(Boolean);
const binary = candidates.find(x => existsSync(x));
const args = process.argv.slice(2);
const result = binary
  ? spawnSync(binary, args, { stdio: 'inherit', cwd: root, windowsHide: true })
  : spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/@terrain-ai/cli/bin/terrain.js', import.meta.url)), ...args], { stdio: 'inherit', cwd: root, windowsHide: true });
process.exitCode = result.status ?? 1;

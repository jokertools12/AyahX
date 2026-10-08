import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const explore = args.includes('--explore');
const agent = args.includes('--agent') || explore;
const list = args.includes('--list');
const authCommand = args.find(arg => ['--login', '--models'].includes(arg));
if (args.includes('--login') && args.includes('--models')) throw new Error('Choose one e2e account command.');
const forwarded = args.filter(arg => !['--agent', '--list', '--login', '--models', '--explore'].includes(arg) && (!explore || arg.startsWith('--')));
const goal = explore
  ? args.filter(arg => arg !== '--explore' && !arg.startsWith('--')).join(' ') || 'Explore the public AyahX navigation and report actionable issues without submitting forms.'
  : undefined;
const command = authCommand ? (authCommand === '--login' ? 'login' : 'models') : list ? 'list' : explore ? 'explore' : 'run';
const commandArgs = authCommand ? ['openai'] : explore
  ? ['--config', 'e2e.config.ts', ...forwarded, goal]
  : ['--config', 'e2e.config.ts', ...forwarded];
const child = spawn(process.execPath, [
  fileURLToPath(new URL('node_modules/e2e/dist/cli/bin.js', import.meta.url)),
  command,
  ...commandArgs,
], {
  cwd, stdio: 'inherit',
  env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', AYAHX_E2E_AGENT: agent ? '1' : '0' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

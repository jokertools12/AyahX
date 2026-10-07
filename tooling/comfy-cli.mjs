import { readFile } from 'node:fs/promises';
import { comfyRequest, submitBackground } from './comfy-client.mjs';
try {
  const [action, filename] = process.argv.slice(2);
  if (action === 'health') console.log(JSON.stringify(await comfyRequest('/system_stats'), null, 2));
  else if (action === 'submit' && filename) {
    const raw = await readFile(filename, 'utf8');
    if (Buffer.byteLength(raw) > 262144) throw new Error('Workflow too large.');
    console.log(JSON.stringify(await submitBackground(JSON.parse(raw)), null, 2));
  } else throw new Error('Usage: comfy health | comfy submit <API-workflow.json>');
} catch (error) { console.error(error.message); process.exitCode = 1; }

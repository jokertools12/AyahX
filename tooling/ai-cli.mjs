import { ask } from './ai-client.mjs';
try {
  const result = await ask(process.argv.slice(2).join(' '));
  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error('AI request failed. Verify the explicit provider, model and key locally; no fallback was attempted.');
  process.exitCode = 1;
}

/**
 * Staging-only acceptance/load probe. It measures API admission, not video
 * rendering: use unique test users/tokens because production enforces one
 * active job per user and plan quotas. Never point this at production without
 * an explicit test account pool.
 */
const baseUrl = (process.env.RENDER_LOAD_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const tokens = (process.env.RENDER_LOAD_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const count = Math.max(1, Number(process.env.RENDER_LOAD_COUNT || 100));
const manifest = JSON.parse(process.env.RENDER_LOAD_MANIFEST || '{}');
if (!tokens.length) throw new Error('RENDER_LOAD_TOKENS must contain staging test-user tokens');

const start = performance.now();
const responses = await Promise.all(Array.from({ length: count }, (_, index) => fetch(`${baseUrl}/api/render-jobs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[index % tokens.length]}` },
  body: JSON.stringify({ manifest, renderEngine: manifest.renderEngine, idempotencyKey: `load-${Date.now()}-${index}` }),
})));
const elapsedMs = performance.now() - start;
const counts = responses.reduce<Record<string, number>>((acc, response) => { acc[String(response.status)] = (acc[String(response.status)] || 0) + 1; return acc; }, {});
console.log(JSON.stringify({ count, elapsedMs, p99AdmissionSeconds: elapsedMs / 1000, statusCounts: counts }, null, 2));
if (responses.some((response) => response.status >= 500)) process.exitCode = 1;

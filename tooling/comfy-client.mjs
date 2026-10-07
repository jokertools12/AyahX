export function localEndpoint(raw = 'http://127.0.0.1:8188') {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('ComfyUI must use a plain loopback HTTP endpoint.');
  }
  return url.origin;
}

export function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !Object.keys(workflow).length) throw new Error('Use a ComfyUI API-format node graph.');
  const allowed = new Set(['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage']);
  for (const node of Object.values(workflow)) {
    if (!node || !allowed.has(node.class_type) || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) throw new Error('Only reviewed core background-generation nodes are allowed.');
  }
  return workflow;
}

export async function comfyRequest(route, options = {}, endpoint = process.env.AYAHX_COMFY_URL, fetchImpl = globalThis.fetch) {
  if (!['/system_stats', '/prompt'].includes(route)) throw new Error('Unsupported route.');
  const response = await fetchImpl(localEndpoint(endpoint) + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`);
  return response.json();
}

export async function submitBackground(workflow, endpoint, fetchImpl) {
  validateWorkflow(workflow);
  const result = await comfyRequest('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) }, endpoint, fetchImpl);
  if (!result.prompt_id || Object.keys(result.node_errors || {}).length) throw new Error('ComfyUI rejected the graph.');
  return { promptId: result.prompt_id, status: 'queued' };
}

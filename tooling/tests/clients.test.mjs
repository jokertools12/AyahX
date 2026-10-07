import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ask, configuration } from '../ai-client.mjs';
import { localEndpoint, validateWorkflow, submitBackground } from '../comfy-client.mjs';

const env = { AYAHX_TOOLKIT_PROVIDER: 'openai', AYAHX_TOOLKIT_BASE_URL: 'https://api.openai.com/v1', AYAHX_TOOLKIT_API_KEY: 'test-only', AYAHX_TOOLKIT_MODEL: 'test-model' };

test('SDK sends a single request to the chosen provider and handles the chat response', async () => {
  let calls = 0;
  const result = await ask('Review the render queue', env, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.messages.at(-1).content, 'Review the render queue');
    return Response.json({ id: 'test', object: 'chat.completion', created: 0, model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Review complete.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
  });
  assert.equal(result.text, 'Review complete.');
  assert.equal(calls, 1);
});

test('provider failures never retry or fall back', async () => {
  let calls = 0;
  await assert.rejects(ask('review', env, async () => { calls++; return Response.json({ error: { message: 'unavailable' } }, { status: 503 }); }));
  assert.equal(calls, 1);
});

test('configuration rejects omitted provider and mismatched endpoint', () => {
  assert.throws(() => configuration({ ...env, AYAHX_TOOLKIT_PROVIDER: '' }));
  assert.throws(() => configuration({ ...env, AYAHX_TOOLKIT_BASE_URL: 'https://example.com' }));
});

test('OpenRouter routing disables provider fallback and data collection', async () => {
  const routerEnv = { ...env, AYAHX_TOOLKIT_PROVIDER: 'openrouter', AYAHX_TOOLKIT_BASE_URL: 'https://openrouter.ai/api/v1' };
  await ask('review', routerEnv, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(JSON.parse(options.body).provider, { allow_fallbacks: false, data_collection: 'deny' });
    return Response.json({ id: 'test', object: 'chat.completion', created: 0, model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] });
  });
});

test('Comfy endpoint cannot target remote hosts, credentials or arbitrary paths', () => {
  for (const raw of ['https://example.com', 'http://127.0.0.1/admin', 'http://user:pass@localhost:8188', 'http://localhost:8188?x=1']) assert.throws(() => localEndpoint(raw));
  assert.equal(localEndpoint(), 'http://127.0.0.1:8188');
});

test('background graph submits only reviewed core nodes and reports queued, not completed', async () => {
  const graph = JSON.parse(await readFile(new URL('../workflows/quran-background.api.json', import.meta.url)));
  const result = await submitBackground(graph, undefined, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8188/prompt');
    assert.deepEqual(JSON.parse(options.body).prompt, graph);
    assert.equal(options.redirect, 'error');
    return Response.json({ prompt_id: 'mock-queue-id', node_errors: {} });
  });
  assert.deepEqual(result, { promptId: 'mock-queue-id', status: 'queued' });
  assert.throws(() => validateWorkflow({ 1: { class_type: 'ExecuteShell', inputs: {} } }));
});

test('Comfy node errors cannot be mistaken for success', async () => {
  await assert.rejects(submitBackground({ 1: { class_type: 'SaveImage', inputs: {} } }, undefined, async () => Response.json({ prompt_id: 'id', node_errors: { 1: { errors: ['bad'] } } })));
});

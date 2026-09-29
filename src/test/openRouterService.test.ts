import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPENROUTER_DEFAULT_TEXT_MODEL,
  OPENROUTER_OPTIONAL_MODEL_CATALOG,
  callOpenRouterChat,
  getOpenRouterConfig,
  getOpenRouterStatus,
  inspectOpenRouterModels,
  smokeTestOpenRouterGeneration,
} from '../../server/services/openRouterService';
import {
  resolveAiConfigFromSettings,
  resolveImageAiConfigFromSettings,
  transcribeAudioWithAi,
} from '../../server/services/aiService';

const envKeys = [
  'AI_PROVIDER',
  'AI_IMAGE_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_TEXT_MODEL',
  'OPENROUTER_TEXT_FALLBACK_MODELS',
  'OPENROUTER_MODEL_FALLBACKS_ENABLED',
  'OPENROUTER_ALLOW_PROVIDER_FALLBACKS',
  'OPENROUTER_DATA_COLLECTION',
  'OPENROUTER_FREE_ONLY',
];

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function response(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

describe('OpenRouter provider gateway', () => {
  it('selects OpenRouter explicitly and exposes only sanitized status', () => {
    const config = resolveAiConfigFromSettings({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'or-test-secret',
      OPENROUTER_TEXT_FALLBACK_MODELS: 'nvidia/nemotron-3-super-120b-a12b:free',
      OPENROUTER_MODEL_FALLBACKS_ENABLED: 'true',
    });
    expect(config?.type).toBe('openrouter');
    expect(config?.key).toBe('or-test-secret');
    expect(config?.openRouter?.textModels).toEqual([
      OPENROUTER_DEFAULT_TEXT_MODEL,
      'nvidia/nemotron-3-super-120b-a12b:free',
    ]);

    const status = getOpenRouterStatus(config?.openRouter || null);
    expect(status.configured).toBe(true);
    expect(status).not.toHaveProperty('key');
  });

  it('sends a deterministic model priority list and privacy policy to chat completions', async () => {
    const config = getOpenRouterConfig('or-test-secret')!;
    process.env.OPENROUTER_ALLOW_PROVIDER_FALLBACKS = 'false';
    process.env.OPENROUTER_DATA_COLLECTION = 'deny';
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(response({
      model: 'qwen/qwen3.8-27b:free',
      choices: [{ message: { content: '{"refinedTexts":["نص منقح"]}' } }],
      usage: { total_tokens: 9 },
    }, 200, { 'x-generation-id': 'gen_test_1' }));

    const result = await callOpenRouterChat(config, {
      messages: [{ role: 'user', content: 'اختبر' }],
      maxTokens: 32,
      temperature: 0.1,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'smoke_result',
          strict: true,
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: false,
          },
        },
      },
      requireParameters: true,
    });

    expect(result.content).toContain('refinedTexts');
    expect(result.model).toBe('qwen/qwen3.8-27b:free');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe(config.textModels[0]);
    expect(body.models).toBeUndefined();
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'smoke_result', strict: true },
    });
    expect(body.provider).toMatchObject({ allow_fallbacks: false, data_collection: 'deny', zdr: true, require_parameters: true });
    expect(body.messages[0].content).toBe('اختبر');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer or-test-secret');
  });

  it('defaults to the structured Qwen model only with model fallbacks disabled', () => {
    const config = getOpenRouterConfig('or-test-secret', {})!;
    expect(config.textModels).toEqual(['qwen/qwen3.8-27b:free']);
    expect(config.allowProviderFallbacks).toBe(false);
  });

  it('does not enable model fallback just because a fallback is configured', () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_FALLBACK_MODELS: 'nvidia/nemotron-3-super-120b-a12b:free',
    })!;
    expect(config.textModels).toEqual(['qwen/qwen3.8-27b:free']);
  });

  it('blocks Stealth models while the request privacy policy is deny', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_DATA_COLLECTION: 'deny',
      OPENROUTER_FREE_ONLY: 'true',
    })!;
    const fetchMock = vi.spyOn(global, 'fetch');

    await expect(callOpenRouterChat(config, {
      models: [OPENROUTER_OPTIONAL_MODEL_CATALOG.stealthMultimodal],
      messages: [{ role: 'user', content: 'اختبار' }],
    })).rejects.toMatchObject({ code: 'OPENROUTER_PRIVACY_MODEL_BLOCKED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows an explicitly selected Stealth model only after explicit privacy opt-in', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_DATA_COLLECTION: 'allow',
      OPENROUTER_FREE_ONLY: 'false',
    })!;
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(response({
      model: OPENROUTER_OPTIONAL_MODEL_CATALOG.stealthMultimodal,
      choices: [{ message: { content: 'تم' } }],
    }));

    await callOpenRouterChat(config, {
      models: [OPENROUTER_OPTIONAL_MODEL_CATALOG.stealthMultimodal],
      messages: [{ role: 'user', content: 'اختبار' }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe(OPENROUTER_OPTIONAL_MODEL_CATALOG.stealthMultimodal);
    expect(body.provider.data_collection).toBe('allow');
    expect(body.provider).not.toHaveProperty('zdr');
  });

  it('checks the live catalog for zero price and JSON Schema support without generating', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_MODEL: 'qwen/qwen3.8-27b:free',
      OPENROUTER_FREE_ONLY: 'true',
      OPENROUTER_DATA_COLLECTION: 'deny',
    })!;
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({
      data: [{
        id: 'qwen/qwen3.8-27b:free',
        context_length: 262144,
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['structured_outputs', 'tools'],
      }],
      }))
      .mockResolvedValueOnce(response({
        data: [{
          model_id: 'qwen/qwen3.8-27b:free',
          provider_name: 'ModelRun',
          pricing: { prompt: '0', completion: '0' },
          supported_parameters: ['structured_outputs'],
          uptime_last_1d: 96,
        }],
      }));

    const result = await inspectOpenRouterModels(config);

    expect(result.success).toBe(true);
    expect(result.structuredOutputSelectedModels).toEqual(['qwen/qwen3.8-27b:free']);
    expect(result.selectedModelReports[0]).toMatchObject({
      available: true,
      free: true,
      freeSlug: true,
      contextLength: 262144,
      supportsStructuredOutputs: true,
      zeroRetentionRequired: true,
      hasZeroRetentionEndpoint: true,
      supportsStructuredOutputsOnZeroRetentionEndpoint: true,
      zeroRetentionProvider: 'ModelRun',
      zeroRetentionUptimeLast1d: 96,
      usableForAyahXText: true,
      issues: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/endpoints/zdr');
    expect(result.message).toContain('Zero Data Retention');
  });

  it('fails closed when a free structured model has no matching ZDR endpoint', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_MODEL: 'qwen/qwen3.8-27b:free',
      OPENROUTER_FREE_ONLY: 'true',
      OPENROUTER_DATA_COLLECTION: 'deny',
    })!;
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({
        data: [{
          id: 'qwen/qwen3.8-27b:free',
          context_length: 262144,
          pricing: { prompt: '0', completion: '0' },
          supported_parameters: ['structured_outputs'],
        }],
      }))
      .mockResolvedValueOnce(response({ data: [] }));

    const result = await inspectOpenRouterModels(config);

    expect(result.success).toBe(false);
    expect(result.selectedModelReports[0]).toMatchObject({
      supportsStructuredOutputs: true,
      zeroRetentionRequired: true,
      hasZeroRetentionEndpoint: false,
      supportsStructuredOutputsOnZeroRetentionEndpoint: false,
      usableForAyahXText: false,
      issues: ['zdr_endpoint_unavailable'],
    });
    expect(result.message).toContain('Zero Data Retention');
  });

  it('does not treat a paid ZDR endpoint as eligible under the free-only policy', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_MODEL: 'qwen/qwen3.8-27b:free',
      OPENROUTER_FREE_ONLY: 'true',
      OPENROUTER_DATA_COLLECTION: 'deny',
    })!;
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({
        data: [{
          id: 'qwen/qwen3.8-27b:free',
          pricing: { prompt: '0', completion: '0' },
          supported_parameters: ['structured_outputs'],
        }],
      }))
      .mockResolvedValueOnce(response({
        data: [{
          model_id: 'qwen/qwen3.8-27b:free',
          provider_name: 'PaidProvider',
          pricing: { prompt: '0.000001', completion: '0.000002' },
          supported_parameters: ['structured_outputs'],
        }],
      }));

    const result = await inspectOpenRouterModels(config);

    expect(result.success).toBe(false);
    expect(result.selectedModelReports[0]).toMatchObject({
      hasZeroRetentionEndpoint: true,
      supportsStructuredOutputsOnZeroRetentionEndpoint: false,
      usableForAyahXText: false,
      issues: ['zdr_endpoint_unavailable'],
    });
  });

  it('fails closed when OpenRouter cannot verify its ZDR endpoint catalog', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_DATA_COLLECTION: 'deny',
    })!;
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ error: { message: 'catalog unavailable' } }, 503));

    const result = await inspectOpenRouterModels(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain('تعذر التحقق من نقاط نهاية Zero Data Retention');
    expect(result.selectedModelReports).toEqual([]);
  });

  it('runs a minimal strict-schema generation probe and returns no generated content', async () => {
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_MODEL: 'qwen/qwen3.8-27b:free',
      OPENROUTER_DATA_COLLECTION: 'deny',
      OPENROUTER_FREE_ONLY: 'true',
    })!;
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(response({
      model: 'qwen/qwen3.8-27b:free',
      choices: [{ message: { content: '{"ok":true}' } }],
    }, 200, { 'x-generation-id': 'gen_smoke_test' }));

    const result = await smokeTestOpenRouterGeneration(config);

    expect(result).toMatchObject({ model: 'qwen/qwen3.8-27b:free', generationId: 'gen_smoke_test' });
    expect(result).not.toHaveProperty('content');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'ayahx_openrouter_connection_test', strict: true },
    });
    expect(body.messages.map((message: any) => message.content).join(' ')).not.toMatch(/quran|audio|user data/i);
    expect(body.provider).toMatchObject({ allow_fallbacks: false, data_collection: 'deny', require_parameters: true });
  });

  it('rejects a successful HTTP response that violates the smoke-test schema', async () => {
    const config = getOpenRouterConfig('or-test-secret', {})!;
    vi.spyOn(global, 'fetch').mockResolvedValue(response({
      model: OPENROUTER_DEFAULT_TEXT_MODEL,
      choices: [{ message: { content: '{"ok":true,"unexpected":"data"}' } }],
    }));

    await expect(smokeTestOpenRouterGeneration(config)).rejects.toMatchObject({
      code: 'OPENROUTER_SMOKE_TEST_INVALID_RESPONSE',
    });
  });

  it('preserves provider quota failures for the admin smoke-test result', async () => {
    const config = getOpenRouterConfig('or-test-secret', {})!;
    vi.spyOn(global, 'fetch').mockResolvedValue(response({
      error: { message: 'Free model rate limit reached' },
    }, 429));

    await expect(smokeTestOpenRouterGeneration(config)).rejects.toMatchObject({
      code: 'OPENROUTER_REQUEST_FAILED',
      status: 429,
    });
  });

  it('rejects free models that cannot enforce AyahX JSON Schema or privacy policy', async () => {
    const models = [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'inclusionai/ling-3.0-flash-sante:free',
      'stealth/space-bunny-alpha',
    ];
    const config = getOpenRouterConfig('or-test-secret', {
      OPENROUTER_TEXT_MODEL: models[0],
      OPENROUTER_TEXT_FALLBACK_MODELS: models.slice(1).join(','),
      OPENROUTER_MODEL_FALLBACKS_ENABLED: 'true',
      OPENROUTER_FREE_ONLY: 'true',
      OPENROUTER_DATA_COLLECTION: 'deny',
    })!;
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({
      data: [
        { id: models[0], pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
        { id: models[1], pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
        { id: models[2], pricing: { prompt: '0', completion: '0' }, supported_parameters: ['response_format'] },
      ],
      }))
      .mockResolvedValueOnce(response({ data: [] }));

    const result = await inspectOpenRouterModels(config);

    expect(result.success).toBe(false);
    expect(result.selectedModelReports.map((report) => report.usableForAyahXText)).toEqual([false, false, false]);
    expect(result.selectedModelReports[0].issues).toContain('structured_outputs_unsupported');
    expect(result.selectedModelReports[1].issues).toContain('structured_outputs_unsupported');
    expect(result.selectedModelReports[2].issues).toContain('free_slug_required');
    expect(result.selectedModelReports[2].issues).toContain('privacy_policy_blocked');
    expect(result.selectedModelReports[0].issues).toContain('zdr_endpoint_unavailable');
  });

  it('rejects audio locally when OpenRouter is the selected text provider', async () => {
    const aiConfig = resolveAiConfigFromSettings({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'or-test-secret',
    });
    const fetchMock = vi.spyOn(global, 'fetch');
    await expect(transcribeAudioWithAi('UklGRg==', aiConfig!, 'audio/wav', 'ar')).rejects.toMatchObject({
      code: 'OPENROUTER_AUDIO_UNSUPPORTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not advertise OpenRouter text credentials as a working image provider', () => {
    expect(resolveImageAiConfigFromSettings({
      AI_IMAGE_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'or-test-secret',
    })).toBeNull();
    expect(resolveImageAiConfigFromSettings({
      AI_IMAGE_PROVIDER: 'none',
      GEMINI_API_KEY: 'gemini-test-secret',
    })).toBeNull();
    expect(resolveImageAiConfigFromSettings({
      AI_IMAGE_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-secret',
    })).toMatchObject({ type: 'gemini', key: 'gemini-test-secret' });
  });
});

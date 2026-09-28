import { logger } from '../logger';

/**
 * Small, dependency-free OpenRouter gateway.
 *
 * The application deliberately talks to OpenRouter through fetch instead of
 * shipping a provider SDK into the API image.  That keeps the provider
 * boundary easy to audit and makes it impossible for a browser bundle to see
 * the server-side key.
 */

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';

// This is the currently selected free text model that supports the structured
// response format used by AyahX's safe text-refinement path. Keep the choice
// explicit: the generic `openrouter/free` router can silently change model
// families and is therefore not appropriate for a reproducible editorial
// workflow.
export const OPENROUTER_DEFAULT_TEXT_MODEL = 'qwen/qwen3.8-27b:free';
export const OPENROUTER_DEFAULT_TEXT_FALLBACK_MODELS: string[] = [];

/**
 * Models the user asked us to assess. They are informational only, never
 * automatic fallbacks. Their live catalog contract must be rechecked before
 * selection because pricing, capabilities, and provider terms can change.
 */
export const OPENROUTER_OPTIONAL_MODEL_CATALOG = {
  longContext: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  medicalDomain: 'inclusionai/ling-3.0-flash-sante:free',
  stealthMultimodal: 'stealth/space-bunny-alpha',
} as const;

export type OpenRouterRole = 'system' | 'user' | 'assistant';

export interface OpenRouterMessage {
  role: OpenRouterRole;
  content: string | Array<Record<string, unknown>>;
}

export interface OpenRouterConfig {
  apiKey: string;
  textModels: string[];
  allowProviderFallbacks: boolean;
  dataCollection: 'allow' | 'deny';
  freeOnly: boolean;
  siteUrl?: string;
  appName: string;
}

export type OpenRouterSettingsSource = Record<string, string | undefined>;

export interface OpenRouterChatResult {
  content: string;
  model: string;
  generationId?: string;
  usage?: Record<string, unknown>;
}

export interface OpenRouterSelectedModelReport {
  id: string;
  available: boolean;
  free: boolean;
  freeSlug: boolean;
  contextLength?: number;
  supportsStructuredOutputs: boolean;
  usableForAyahXText: boolean;
  issues: Array<'unavailable' | 'not_free' | 'free_slug_required' | 'structured_outputs_unsupported' | 'privacy_policy_blocked'>;
}

export class OpenRouterServiceError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly model?: string;

  constructor(code: string, message: string, status?: number, model?: string) {
    super(message);
    this.name = 'OpenRouterServiceError';
    this.code = code;
    this.status = status;
    this.model = model;
  }
}

function envBool(name: string, fallback: boolean, settings: OpenRouterSettingsSource = process.env): boolean {
  const value = settings[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function parseSiteUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** OpenRouter's free catalog uses the explicit `:free` model variant. */
export function isFreeOpenRouterModel(model: string): boolean {
  return model.trim().endsWith(':free');
}

/**
 * Reads provider configuration without ever returning the secret in a
 * diagnostic object.  An empty fallback variable intentionally disables the
 * defaults; this makes deployment changes explicit.
 */
export function getOpenRouterConfig(
  apiKeyOverride?: string,
  settings: OpenRouterSettingsSource = process.env,
): OpenRouterConfig | null {
  const apiKey = (apiKeyOverride || settings.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return null;

  const primary = (settings.OPENROUTER_TEXT_MODEL || OPENROUTER_DEFAULT_TEXT_MODEL).trim();
  const fallbackEnv = settings.OPENROUTER_TEXT_FALLBACK_MODELS;
  const fallbackModels = fallbackEnv === undefined
    ? OPENROUTER_DEFAULT_TEXT_FALLBACK_MODELS
    : parseList(fallbackEnv);
  const useFallbacks = envBool('OPENROUTER_MODEL_FALLBACKS_ENABLED', false, settings);
  const textModels = [primary, ...(useFallbacks ? fallbackModels : [])]
    .filter(Boolean)
    .filter((model, index, all) => all.indexOf(model) === index);

  return {
    apiKey,
    textModels,
    // OpenRouter can load-balance across providers by default.  Keep that
    // choice explicit and privacy-first; operators may opt in deliberately.
    allowProviderFallbacks: envBool('OPENROUTER_ALLOW_PROVIDER_FALLBACKS', false, settings),
    dataCollection: settings.OPENROUTER_DATA_COLLECTION?.trim().toLowerCase() === 'allow' ? 'allow' : 'deny',
    freeOnly: envBool('OPENROUTER_FREE_ONLY', true, settings),
    siteUrl: parseSiteUrl(settings.OPENROUTER_SITE_URL),
    appName: (settings.OPENROUTER_APP_NAME || 'AyahX').trim().slice(0, 120),
  };
}

export function getOpenRouterStatus(config: OpenRouterConfig | null = getOpenRouterConfig()): Record<string, unknown> {
  return {
    configured: Boolean(config),
    provider: 'openrouter',
    textModels: config?.textModels || [],
    freeOnly: config?.freeOnly ?? true,
    allowProviderFallbacks: config?.allowProviderFallbacks ?? false,
    dataCollection: config?.dataCollection ?? 'deny',
    siteUrlConfigured: Boolean(config?.siteUrl),
  };
}

function assertModelPolicy(models: string[], config: OpenRouterConfig): void {
  if (models.length === 0) {
    throw new OpenRouterServiceError('OPENROUTER_MODEL_NOT_CONFIGURED', 'لم يتم تحديد نموذج OpenRouter صالح.');
  }
  if (config.dataCollection === 'deny') {
    const stealthModel = models.find((model) => /^stealth\//i.test(model));
    if (stealthModel) {
      throw new OpenRouterServiceError(
        'OPENROUTER_PRIVACY_MODEL_BLOCKED',
        'تم حظر نموذج Stealth مع منع جمع البيانات؛ قد يحتفظ المزوّد بالمطالبات والنتائج. راجع سياسة المزوّد وغيّر إعداد الخصوصية صراحةً قبل تجربته.',
        undefined,
        stealthModel,
      );
    }
  }
  if (config.freeOnly) {
    const paid = models.find((model) => !isFreeOpenRouterModel(model));
    if (paid) {
      throw new OpenRouterServiceError(
        'OPENROUTER_PAID_MODEL_BLOCKED',
        `تم حظر النموذج غير المجاني ${paid}. غيّر OPENROUTER_FREE_ONLY صراحةً إذا كان ذلك مقصوداً.`,
        undefined,
        paid,
      );
    }
  }
}

function stripProviderSecrets(message: string, apiKey: string): string {
  return message.split(apiKey).join('[redacted]').slice(0, 500);
}

async function readProviderError(response: Response, apiKey: string): Promise<string> {
  const raw = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.error?.message || parsed?.message;
    if (typeof message === 'string') return stripProviderSecrets(message, apiKey);
  } catch {
    // Fall through to the bounded raw response.
  }
  return stripProviderSecrets(raw || `OpenRouter returned HTTP ${response.status}`, apiKey);
}

function attachAbortTimeout(timeoutMs: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

export interface OpenRouterChatOptions {
  messages: OpenRouterMessage[];
  models?: string[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: Record<string, unknown>;
  requireParameters?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Calls the OpenAI-compatible OpenRouter chat endpoint. */
export async function callOpenRouterChat(
  config: OpenRouterConfig,
  options: OpenRouterChatOptions,
): Promise<OpenRouterChatResult> {
  const models = (options.models?.length ? options.models : config.textModels)
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model, index, all) => all.indexOf(model) === index);
  assertModelPolicy(models, config);

  const body: Record<string, unknown> = {
    ...(models.length > 1 ? { models } : { model: models[0] }),
    messages: options.messages,
    stream: false,
    max_tokens: Math.max(16, Math.min(8192, Math.round(options.maxTokens ?? 2048))),
    temperature: Math.max(0, Math.min(1, options.temperature ?? 0.2)),
    provider: {
      allow_fallbacks: config.allowProviderFallbacks,
      data_collection: config.dataCollection,
      // `deny` prevents routing to providers that collect data for storage or
      // training; require ZDR as a separate, stronger retention control.
      ...(config.dataCollection === 'deny' ? { zdr: true } : {}),
      ...(options.requireParameters === undefined ? {} : { require_parameters: options.requireParameters }),
    },
  };
  if (options.responseFormat) body.response_format = options.responseFormat;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.siteUrl) headers['HTTP-Referer'] = config.siteUrl;
  if (config.appName) headers['X-OpenRouter-Title'] = config.appName;

  const timeout = attachAbortTimeout(options.timeoutMs ?? 30000, options.signal);
  try {
    const response = await fetch(`${OPENROUTER_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    if (!response.ok) {
      const message = await readProviderError(response, config.apiKey);
      throw new OpenRouterServiceError('OPENROUTER_REQUEST_FAILED', message, response.status, models[0]);
    }

    const data = await response.json().catch(() => null) as any;
    const rawContent = data?.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part: any) => typeof part === 'string' ? part : part?.text || '').join('')
        : '';
    if (!content.trim()) {
      throw new OpenRouterServiceError('OPENROUTER_EMPTY_RESPONSE', 'أعاد OpenRouter استجابة فارغة.', response.status, data?.model || models[0]);
    }

    const generationId = response.headers.get('x-generation-id') || undefined;
    const model = typeof data?.model === 'string' ? data.model : models[0];
    logger.info('OpenRouter chat request completed', {
      model,
      generationId,
      fallbackCount: Math.max(0, models.length - 1),
    });
    return { content, model, generationId, usage: data?.usage };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new OpenRouterServiceError('OPENROUTER_TIMEOUT', 'انتهت مهلة الاتصال بـ OpenRouter.', undefined, models[0]);
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}

/**
 * Exercises one real, low-token text generation with a fixed JSON Schema.
 * The probe contains no Quran, user content, or audio and never returns the
 * generated text to the caller; it proves the selected route can actually
 * serve the contract rather than merely appearing in the model catalog.
 */
export async function smokeTestOpenRouterGeneration(
  config: OpenRouterConfig,
): Promise<{ model: string; generationId?: string; latencyMs: number }> {
  const startedAt = Date.now();
  const result = await callOpenRouterChat(config, {
    messages: [
      {
        role: 'system',
        content: 'This is a provider connectivity test. Return only the requested JSON object.',
      },
      {
        role: 'user',
        content: 'Return {"ok":true}. Do not add any other property or text.',
      },
    ],
    maxTokens: 32,
    temperature: 0,
    timeoutMs: 20_000,
    requireParameters: true,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'ayahx_openrouter_connection_test',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new OpenRouterServiceError(
      'OPENROUTER_SMOKE_TEST_INVALID_RESPONSE',
      'استجاب النموذج، لكن مخرجات اختبار JSON غير صالحة.',
      undefined,
      result.model,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || (parsed as Record<string, unknown>).ok !== true
    || Object.keys(parsed as Record<string, unknown>).length !== 1) {
    throw new OpenRouterServiceError(
      'OPENROUTER_SMOKE_TEST_INVALID_RESPONSE',
      'استجاب النموذج، لكنه لم يلتزم بمخطط اختبار JSON.',
      undefined,
      result.model,
    );
  }

  return {
    model: result.model,
    ...(result.generationId ? { generationId: result.generationId } : {}),
    latencyMs: Date.now() - startedAt,
  };
}

/** Read the public model catalog without sending a generation request. */
export async function inspectOpenRouterModels(
  configOrApiKey?: OpenRouterConfig | string | null,
  settings: OpenRouterSettingsSource = process.env,
): Promise<{
  success: boolean;
  message: string;
  latencyMs: number;
  selectedModels: string[];
  availableSelectedModels: string[];
  freeSelectedModels: string[];
  structuredOutputSelectedModels: string[];
  selectedModelReports: OpenRouterSelectedModelReport[];
}> {
  const config = typeof configOrApiKey === 'object'
    ? configOrApiKey
    : getOpenRouterConfig(configOrApiKey, settings);
  if (!config) {
    return {
      success: false,
      message: 'مفتاح OpenRouter غير محدد.',
      latencyMs: 0,
      selectedModels: [],
      availableSelectedModels: [],
      freeSelectedModels: [],
      structuredOutputSelectedModels: [],
      selectedModelReports: [],
    };
  }
  const start = Date.now();
  try {
    const response = await fetch(`${OPENROUTER_API_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const message = await readProviderError(response, config.apiKey);
      return {
        success: false,
        message,
        latencyMs,
        selectedModels: config.textModels,
        availableSelectedModels: [],
        freeSelectedModels: [],
        structuredOutputSelectedModels: [],
        selectedModelReports: [],
      };
    }
    const data = await response.json().catch(() => ({})) as any;
    const catalog = (Array.isArray(data?.data) ? data.data : []) as Array<Record<string, any>>;
    const catalogById = new Map<string, Record<string, any>>(catalog.map((model) => [String(model.id), model]));
    const availableSelectedModels = config.textModels.filter((id) => catalogById.has(id));
    const selectedModelReports = config.textModels.map((id): OpenRouterSelectedModelReport => {
      const model = catalogById.get(id);
      const pricing = model?.pricing || {};
      const free = String(pricing.prompt) === '0' && String(pricing.completion) === '0';
      const freeSlug = isFreeOpenRouterModel(id);
      const supportedParameters = Array.isArray(model?.supported_parameters)
        ? model.supported_parameters.map((value: unknown) => String(value).toLowerCase())
        : [];
      const supportsStructuredOutputs = supportedParameters.includes('structured_outputs');
      const issues: OpenRouterSelectedModelReport['issues'] = [];
      if (!model) issues.push('unavailable');
      if (config.freeOnly && !free) issues.push('not_free');
      if (config.freeOnly && !freeSlug) issues.push('free_slug_required');
      if (!supportsStructuredOutputs) issues.push('structured_outputs_unsupported');
      if (config.dataCollection === 'deny' && /^stealth\//i.test(id)) issues.push('privacy_policy_blocked');
      const usableForAyahXText = issues.length === 0;
      const contextLength = Number(model?.context_length);
      return {
        id,
        available: Boolean(model),
        free,
        freeSlug,
        ...(Number.isFinite(contextLength) && contextLength > 0 ? { contextLength } : {}),
        supportsStructuredOutputs,
        usableForAyahXText,
        issues,
      };
    });
    const freeSelectedModels = selectedModelReports.filter((report) => report.free).map((report) => report.id);
    const structuredOutputSelectedModels = selectedModelReports
      .filter((report) => report.supportsStructuredOutputs)
      .map((report) => report.id);
    const success = selectedModelReports.length > 0 && selectedModelReports.every((report) => report.usableForAyahXText);
    const hasUnavailable = selectedModelReports.some((report) => !report.available);
    const hasSchemaMismatch = selectedModelReports.some((report) => !report.supportsStructuredOutputs);
    const hasPriceMismatch = selectedModelReports.some((report) => config.freeOnly && (!report.free || !report.freeSlug));
    const hasPrivacyMismatch = selectedModelReports.some((report) => report.issues.includes('privacy_policy_blocked'));
    const message = success
      ? `تم الاتصال. كل النماذج المحددة مجانية ومتاحة وتدعم JSON Schema: ${selectedModelReports.map((report) => report.id).join(', ')}`
      : hasUnavailable
        ? 'تم الاتصال، لكن واحدًا أو أكثر من النماذج المحددة غير موجود في الكتالوج الحالي.'
        : hasPriceMismatch
          ? 'النموذج لا يطابق قفل المجاني الحالي؛ يلزم نموذج بسعر صفر وبمعرّف ينتهي بـ :free.'
          : hasPrivacyMismatch
            ? 'النموذج غير متوافق مع سياسة منع جمع البيانات الحالية.'
            : hasSchemaMismatch
              ? 'النموذج متاح، لكنه لا يعلن دعم JSON Schema المطلوب لمخرجات AyahX المنظمة.'
              : 'النماذج المحددة لا تجتاز سياسة AyahX الحالية.';
    return {
      success,
      message,
      latencyMs,
      selectedModels: config.textModels,
      availableSelectedModels,
      freeSelectedModels,
      structuredOutputSelectedModels,
      selectedModelReports,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'تعذر الاتصال بـ OpenRouter.',
      latencyMs: Date.now() - start,
      selectedModels: config.textModels,
      availableSelectedModels: [],
      freeSelectedModels: [],
      structuredOutputSelectedModels: [],
      selectedModelReports: [],
    };
  }
}

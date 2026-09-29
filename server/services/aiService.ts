/**
 * AI Service Gateway
 * Handles prompt formatting, external provider dispatch (OpenRouter, Gemini, Lovable, OpenAI),
 * markdown codeblock stripping, and safe JSON output parsing.
 */

import {
  callOpenRouterChat,
  getOpenRouterConfig,
  getOpenRouterStatus,
  type OpenRouterConfig,
  type OpenRouterSettingsSource,
} from './openRouterService';
import { getRawSettings } from './settingsService';

export interface AiConfig {
  type: 'openrouter' | 'gemini' | 'lovable' | 'openai';
  key: string;
  /** Present only for the OpenRouter provider; never serialize this object to a client. */
  openRouter?: OpenRouterConfig;
}

export interface TranscribeAudioResult {
  lines: Array<{ text: string; startTime: number; endTime: number }>;
  text?: string;
  /** AI timestamps are never an approved Quran alignment source. */
  timingStatus?: 'untrusted';
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
}

export interface SubtitleLine {
  text: string;
  start?: number;
  end?: number;
  [key: string]: any;
}

/**
 * Safely extracts and parses JSON from LLM outputs, stripping Markdown codeblock fences
 */
export function safeParseJson(raw: string): any {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const AI_RUNTIME_SETTING_KEYS = [
  'AI_PROVIDER',
  'AI_IMAGE_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_TEXT_MODEL',
  'OPENROUTER_TEXT_FALLBACK_MODELS',
  'OPENROUTER_MODEL_FALLBACKS_ENABLED',
  'OPENROUTER_ALLOW_PROVIDER_FALLBACKS',
  'OPENROUTER_DATA_COLLECTION',
  'OPENROUTER_FREE_ONLY',
  'OPENROUTER_SITE_URL',
  'OPENROUTER_APP_NAME',
  'GEMINI_API_KEY',
  'LOVABLE_API_KEY',
  'OPENAI_API_KEY',
] as const;

export type AiSettingsSource = OpenRouterSettingsSource;

function buildProviderConfig(type: AiConfig['type'], key: string, settings: AiSettingsSource): AiConfig {
  if (type === 'openrouter') {
    return { type, key, openRouter: getOpenRouterConfig(key, settings) || undefined };
  }
  return { type, key };
}

/** Pure configuration resolver, kept separate from DB reads for testability. */
export function resolveAiConfigFromSettings(
  settings: AiSettingsSource,
  options?: { openRouterApiKeyOverride?: string },
): AiConfig | null {
  const explicitProvider = (settings.AI_PROVIDER || '').trim().toLowerCase();
  const geminiKey = settings.GEMINI_API_KEY;
  const lovableKey = settings.LOVABLE_API_KEY;
  const openAiKey = settings.OPENAI_API_KEY;
  const openRouterKey = options?.openRouterApiKeyOverride || settings.OPENROUTER_API_KEY;

  if (explicitProvider) {
    if (explicitProvider === 'openrouter') {
      return openRouterKey ? buildProviderConfig('openrouter', openRouterKey, settings) : null;
    }
    if (explicitProvider === 'gemini') return geminiKey ? buildProviderConfig('gemini', geminiKey, settings) : null;
    if (explicitProvider === 'lovable') return lovableKey ? buildProviderConfig('lovable', lovableKey, settings) : null;
    if (explicitProvider === 'openai') return openAiKey ? buildProviderConfig('openai', openAiKey, settings) : null;
    return null;
  }

  // New deployments naturally select OpenRouter when its key is present.
  if (openRouterKey) return buildProviderConfig('openrouter', openRouterKey, settings);
  // Legacy deployments keep their previous deterministic precedence until
  // they opt into AI_PROVIDER explicitly.
  if (geminiKey) return buildProviderConfig('gemini', geminiKey, settings);
  if (lovableKey) return buildProviderConfig('lovable', lovableKey, settings);
  if (openAiKey) return buildProviderConfig('openai', openAiKey, settings);
  return null;
}

/**
 * Resolves the configured text/audio provider.
 *
 * `AI_PROVIDER` is the explicit switch.  When it is absent, the old
 * environment-key precedence remains as a migration path so an existing
 * deployment does not unexpectedly stop working.  Once AI_PROVIDER is set,
 * a missing key is a hard configuration error; there is no silent provider
 * fallback for that request.
 */
export async function getAiConfig(options?: { openRouterApiKeyOverride?: string }): Promise<AiConfig | null> {
  const settings = await getRawSettings([...AI_RUNTIME_SETTING_KEYS]);
  return resolveAiConfigFromSettings(settings, options);
}

/** A safe diagnostic object for the future settings screen and admin checks. */
export async function getAiProviderStatus(): Promise<Record<string, unknown>> {
  const settings = await getRawSettings([...AI_RUNTIME_SETTING_KEYS]);
  const explicitProvider = (settings.AI_PROVIDER || '').trim().toLowerCase() || null;
  const config = resolveAiConfigFromSettings(settings);
  const knownProviders = new Set(['openrouter', 'gemini', 'lovable', 'openai']);
  const diagnostic: Record<string, unknown> = {
    configured: Boolean(config),
    selectedProvider: config?.type || explicitProvider,
    explicitProvider,
    invalidProvider: explicitProvider && !knownProviders.has(explicitProvider) ? explicitProvider : null,
    keyConfigured: Boolean(config),
    imageProvider: settings.AI_IMAGE_PROVIDER || (settings.GEMINI_API_KEY ? 'gemini' : null),
  };
  if (config?.type === 'openrouter') {
    diagnostic.openrouter = getOpenRouterStatus(config.openRouter || null);
  }
  return diagnostic;
}

/**
 * Image generation is intentionally a separate capability.  OpenRouter's
 * free text catalog is not an image generator; keep an explicitly configured
 * Gemini image key available while the settings redesign adds per-capability
 * controls.
 */
export function resolveImageAiConfigFromSettings(settings: AiSettingsSource): AiConfig | null {
  const requested = (settings.AI_IMAGE_PROVIDER || '').trim().toLowerCase();
  if (requested === 'openrouter') {
    return settings.OPENROUTER_API_KEY
      ? buildProviderConfig('openrouter', settings.OPENROUTER_API_KEY, settings)
      : null;
  }
  if (requested === 'gemini' || (!requested && settings.GEMINI_API_KEY)) {
    return settings.GEMINI_API_KEY ? buildProviderConfig('gemini', settings.GEMINI_API_KEY, settings) : null;
  }
  return null;
}

export async function getImageAiConfig(): Promise<AiConfig | null> {
  const settings = await getRawSettings([...AI_RUNTIME_SETTING_KEYS]);
  return resolveImageAiConfigFromSettings(settings);
}

/**
 * Helper to determine exact audio MIME type for Gemini/OpenAI
 */
function detectAudioMimeType(base64: string, fallbackMime?: string): string {
  if (fallbackMime && typeof fallbackMime === 'string' && fallbackMime.startsWith('audio/')) {
    return fallbackMime;
  }
  const clean = base64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
  if (clean.startsWith('UklGR')) return 'audio/wav';
  if (clean.startsWith('SUQz') || clean.startsWith('/+NI') || clean.startsWith('//OI')) return 'audio/mp3';
  if (clean.startsWith('T2dnUw')) return 'audio/ogg';
  return 'audio/wav';
}

export const GEMINI_AUDIO_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

export const GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

export const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];

/**
 * Dispatches audio transcription request to the configured AI provider
 */
export async function transcribeAudioWithAi(
  audioBase64: string,
  aiConfig: AiConfig,
  requestedMimeType?: string,
  language?: string,
): Promise<TranscribeAudioResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 40000);

  const cleanBase64 = audioBase64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
  const mimeType = detectAudioMimeType(audioBase64, requestedMimeType);

  try {
    if (aiConfig.type === 'openrouter') {
      throw Object.assign(
        new Error('OpenRouter مفعّل للنص فقط في AyahX؛ لم يُرسل الملف الصوتي إلى أي مزوّد.'),
        { code: 'OPENROUTER_AUDIO_UNSUPPORTED' },
      );
    }

    if (aiConfig.type === 'gemini') {
      let lastErrText = '';

      for (const model of GEMINI_AUDIO_MODELS) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.key}`;
          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: 'أنت خبير في تفريغ النصوص والابتهالات الإسلامية بدقة متناهية مع التوقيتات. قم بتفريغ هذا الصوت بدقة إلى أسطر متوافقة مع التوقيت. أرجع JSON فقط بالشكل: {"lines": [{"text": "...", "startTime": 0.0, "endTime": 3.5}], "text": "..."}',
                    },
                    {
                      inline_data: {
                        mime_type: mimeType,
                        data: cleanBase64,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                response_mime_type: 'application/json',
              },
            }),
          });

          if (response.ok) {
            const geminiData = await response.json();
            const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = rawText ? safeParseJson(rawText) : null;
            if (parsed) {
              return {
                ...parsed,
                timingStatus: 'untrusted',
                provider: 'gemini',
                model,
              };
            }
            return { lines: [], text: rawText || '', timingStatus: 'untrusted', provider: 'gemini', model };
          }

          lastErrText = await response.text();
          console.warn(`Gemini model ${model} returned status ${response.status}:`, lastErrText.slice(0, 200));

          // If 503 (high demand) or 429 (rate limit) or 404 (model decommissioned), try next model
          if (response.status === 503 || response.status === 429 || response.status === 404) {
            continue;
          }

          // If other bad request, still try next model in case of capability difference
          continue;
        } catch (callErr: any) {
          if (callErr.name === 'AbortError') throw callErr;
          console.warn(`Error calling Gemini model ${model}:`, callErr.message);
          lastErrText = callErr.message;
        }
      }

      console.error('All Gemini audio models exhausted. Last error:', lastErrText);
      throw new Error('فشل معالجة الصوت عبر خدمة الذكاء الاصطناعي (خطأ من المزود)');
    }

    // Fallback Lovable AI Gateway
    const response = await fetch('https://ai.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are an expert audio transcriber specializing in Arabic Quranic recitation and Islamic speech.
Transcribe the audio accurately into time-aligned lines for video subtitles.
Return JSON with format: {"lines": [{"text": "...", "startTime": 0.0, "endTime": 3.5}]}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio precisely with timestamps:' },
              { type: 'image_url', image_url: { url: `data:audio/mp3;base64,${audioBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI Gateway error details:', errText);
      throw new Error('فشل معالجة الصوت عبر بوابة الذكاء الاصطناعي');
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Refines Islamic subtitle text using Gemini or fallback AI
 */
export async function refineTextWithAi(
  lines: SubtitleLine[],
  aiConfig: AiConfig
): Promise<SubtitleLine[]> {
  const linesText = lines
    .slice(0, 100)
    .map((l, i) => {
      const text = typeof l?.text === 'string' ? l.text.slice(0, 500) : '';
      return `${i}: "${text}"`;
    })
    .join('\n');

  const prompt = `أنت خبير في مراجعة وتدقيق النصوص الدينية والابتهالات الإسلامية.
المطلوب:
1. إصلاح أي أحرف مقطوعة أو كلمات غير متناسقة.
2. إضافة التشكيل المناسب للوضوح وجمال العرض.
3. الحفاظ التام على نفس عدد الأسطر والمعنى.
الأسطر الحالية:
${linesText}
أرجع مصفوفة refinedTexts بنفس الترتيب.`;

  const applyRefinedTexts = (candidate: any): SubtitleLine[] => {
    const refinedTexts = candidate?.refinedTexts || candidate;
    if (!Array.isArray(refinedTexts) || refinedTexts.length !== lines.length) return lines;
    return lines.map((line, index) => {
      const nextText = refinedTexts[index];
      // Never let a model delete a line or inject a non-string object into a
      // subtitle manifest.  Ambiguous output stays exactly as the user wrote it.
      return typeof nextText === 'string' && nextText.trim()
        ? { ...line, text: nextText.trim() }
        : line;
    });
  };

  if (aiConfig.type === 'openrouter') {
    try {
      if (!aiConfig.openRouter) throw new Error('إعداد OpenRouter غير مكتمل في الخادم');
      const result = await callOpenRouterChat(aiConfig.openRouter, {
        messages: [
          {
            role: 'system',
            content: 'أنت مدقق نصوص عربي. لا تخترع نصاً قرآنياً ولا تستبدل كلمة غير مؤكدة. أعد JSON فقط بالشكل {"refinedTexts":[...]} وبنفس عدد العناصر تماماً.',
          },
          { role: 'user', content: prompt },
        ],
        maxTokens: 4096,
        temperature: 0.1,
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'ayahx_refined_texts',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                refinedTexts: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: lines.length,
                  maxItems: lines.length,
                },
              },
              required: ['refinedTexts'],
              additionalProperties: false,
            },
          },
        },
        requireParameters: true,
        timeoutMs: 30000,
      });
      return applyRefinedTexts(safeParseJson(result.content));
    } catch (err: any) {
      console.warn('OpenRouter text refinement failed; preserving original lines:', err?.message || err);
      return lines;
    }
  }

  if (aiConfig.type === 'gemini') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      for (const model of GEMINI_TEXT_MODELS) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.key}`;
          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { response_mime_type: 'application/json' },
            }),
          });

          if (response.ok) {
            const geminiData = await response.json();
            const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              const parsed = safeParseJson(rawText);
              const refined = applyRefinedTexts(parsed);
              if (refined !== lines) return refined;
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          console.warn(`Error calling Gemini text model ${model}:`, err.message);
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Graceful fallback to original lines if AI service fails or provider is not gemini
  return lines;
}

export interface GenerateImageOptions {
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:5';
  style?: 'photorealistic' | 'cinematic' | 'islamicArt' | 'minimalist';
}

export interface GenerateImageResult {
  base64: string;
  mimeType: string;
  dataUrl: string;
  modelUsed: string;
}

/**
 * Generates aesthetic Islamic backgrounds and visual artwork using Gemini Generative Media (Nano Banana)
 */
export async function generateImageWithAi(
  prompt: string,
  aiConfig: AiConfig,
  options?: GenerateImageOptions
): Promise<GenerateImageResult> {
  if (aiConfig.type !== 'gemini') {
    throw new Error('توليد الصور بالذكاء الاصطناعي مدعوم حالياً عبر Google Gemini');
  }

  const aspectRatio = options?.aspectRatio || '9:16';
  const enhancedPrompt = `${prompt}, peaceful Islamic aesthetic, divine atmospheric lighting, 8k resolution, elegant masterpiece composition, cinematic depth of field, ultra-detailed, no distorted artifacts, beautiful wallpaper quality`;

  let lastErr = '';
  let quotaHit = false;

  for (const model of GEMINI_IMAGE_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.key}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: enhancedPrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          const inlineData = part.inlineData || part.inline_data;
          if (inlineData && inlineData.data) {
            const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
            const base64 = inlineData.data;
            const dataUrl = `data:${mimeType};base64,${base64}`;
            return {
              base64,
              mimeType,
              dataUrl,
              modelUsed: model,
            };
          }
        }
      }

      const errText = await response.text().catch(() => '');
      if (response.status === 429) {
        quotaHit = true;
      }
      lastErr = `Model ${model} returned ${response.status}: ${errText.slice(0, 150)}`;
      console.warn('Gemini image generation attempt failed:', lastErr);
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('انتهت مهلة توليد الصورة بالذكاء الاصطناعي');
      lastErr = err.message;
      console.warn(`Error with image model ${model}:`, err.message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (quotaHit) {
    throw new Error('تم استهلاك حد الطلبات المجاني لتوليد الصور (Quota Limit) على Google AI Studio. يرجى التحقق من الخطة في AI Studio أو استخدام مكتبة الخلفيات الجاهزة.');
  }

  throw new Error(`فشل توليد الصورة بالذكاء الاصطناعي: ${lastErr || 'يرجى المحاولة لاحقاً'}`);
}


/**
 * AI Service Gateway
 * Handles prompt formatting, external provider dispatch (Gemini, Lovable, OpenAI),
 * markdown codeblock stripping, and safe JSON output parsing.
 */

export interface AiConfig {
  type: 'gemini' | 'lovable' | 'openai';
  key: string;
}

export interface TranscribeAudioResult {
  lines: Array<{ text: string; startTime: number; endTime: number }>;
  text?: string;
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

/**
 * Resolves configured AI provider credentials from environment variables
 */
export function getAiConfig(): AiConfig | null {
  const geminiKey = process.env.GEMINI_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) return { type: 'gemini', key: geminiKey };
  if (lovableKey) return { type: 'lovable', key: lovableKey };
  if (openAiKey) return { type: 'openai', key: openAiKey };
  return null;
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
  requestedMimeType?: string
): Promise<TranscribeAudioResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 40000);

  const cleanBase64 = audioBase64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
  const mimeType = detectAudioMimeType(audioBase64, requestedMimeType);

  try {
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
              return parsed;
            }
            return { lines: [], text: rawText || '' };
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
              const refinedTexts = parsed?.refinedTexts || parsed;
              if (Array.isArray(refinedTexts)) {
                return lines.map((l, i) => ({
                  ...l,
                  text: refinedTexts[i] || l.text,
                }));
              }
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


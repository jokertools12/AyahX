import type { AiConfig, GenerateImageOptions, GenerateImageResult } from './aiService';

type Model = { id: string; architecture?: { output_modalities?: string[] }; pricing?: Record<string, string> };
export function isFreeImageModel(model: Model): boolean {
  const prices = Object.values(model.pricing || {});
  return model.id.endsWith(':free') && !!model.architecture?.output_modalities?.includes('image')
    && prices.length > 0 && prices.every(p => Number.isFinite(Number(p)) && Number(p) === 0);
}

/** Free-only by contract. Catalog lookup happens on demand, never in a background poll. */
export async function generateOpenRouterImage(prompt: string, config: AiConfig, options?: GenerateImageOptions): Promise<GenerateImageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  const headers = { Authorization: `Bearer ${config.key.trim()}`, 'Content-Type': 'application/json' };
  try {
    const catalogResponse = await fetch('https://openrouter.ai/api/v1/models', { headers, signal: controller.signal });
    if (!catalogResponse.ok) throw Object.assign(new Error('تعذر التحقق من توفر خدمة توليد الصور؛ حاول لاحقًا.'), { status: 503, code: 'AI_IMAGE_CATALOG_UNAVAILABLE' });
    const catalog = await catalogResponse.json();
    const free = (catalog.data || []).filter(isFreeImageModel) as Model[];
    const model = config.imageModel ? free.find(m => m.id === config.imageModel) : free.sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!model) throw Object.assign(new Error('توليد الصور غير متاح حاليًا. يمكنك اختيار خلفية من المكتبة أو رفع صورة.'), { status: 503, code: 'AI_IMAGE_FREE_MODEL_UNAVAILABLE' });
    const styles = { photorealistic: 'natural photorealistic lighting', cinematic: 'cinematic light and depth of field', islamicArt: 'Islamic geometric art and ornamental motifs', minimalist: 'minimal composition and ample negative space' };
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({ model: model.id, messages: [{ role: 'user', content: `${prompt}, ${styles[options?.style || 'cinematic'] || styles.cinematic}, peaceful atmosphere, no text or watermarks` }], modalities: ['image', 'text'], image_config: { aspect_ratio: options?.aspectRatio || '9:16' }, provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, image: 0 } } }),
    });
    if (!response.ok) throw Object.assign(new Error(response.status === 429 ? 'خدمة توليد الصور مشغولة حاليًا؛ حاول لاحقًا.' : 'تعذر توليد الصورة؛ حاول لاحقًا.'), { status: response.status === 429 ? 429 : 502, code: response.status === 429 ? 'AI_IMAGE_QUOTA_EXCEEDED' : 'AI_IMAGE_PROVIDER_FAILED' });
    const data = await response.json();
    const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const match = typeof url === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match || match[2].length > 28000000) throw Object.assign(new Error('لم تكتمل الصورة؛ حاول بوصف آخر.'), { status: 502, code: 'AI_IMAGE_EMPTY_RESULT' });
    return { mimeType: match[1], base64: match[2], dataUrl: url, modelUsed: model.id };
  } catch (error: any) {
    if (error.name === 'AbortError') throw Object.assign(new Error('انتهت مهلة توليد الصورة؛ حاول لاحقًا.'), { status: 504, code: 'AI_IMAGE_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timeout); }
}

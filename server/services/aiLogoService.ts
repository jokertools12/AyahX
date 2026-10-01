import { callOpenRouterChat } from './openRouterService';
import { AiConfig, GEMINI_TEXT_MODELS } from './aiService';

/** Reject active or external SVG content before it enters a renderer. */
export function extractSafeLogoSvg(raw: string): string {
  const svg = raw.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
  const externalCss = svg && [...svg.matchAll(/url\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#'));
  if (!svg || svg.length > 60000 || externalCss || /<(?:script|foreignObject|iframe|image|use)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|@import|javascript:/i.test(svg)) {
    throw Object.assign(new Error('لم يُرجع الذكاء الاصطناعي شعارًا صالحًا وآمنًا؛ حاول بوصف مختلف'), { code: 'AI_LOGO_INVALID_RESULT', status: 502 });
  }
  return svg;
}

export async function generateAiLogoSvg(brand: string, subtitle: string, style: string, config: AiConfig): Promise<{ svg: string; modelUsed: string; provider: string }> {
  const prompt = `Create one self-contained SVG logo, viewBox="0 0 500 500", for a Quran channel. Brand: ${JSON.stringify(brand)}. Subtitle: ${JSON.stringify(subtitle)}. Style: ${style}. Use elegant gold gradients and readable Arabic typography. Return only SVG, no markdown. Use vector shapes and text only, no images, links, scripts, foreignObject or external resources.`;
  if (config.type === 'openrouter' && config.openRouter) {
    const result = await callOpenRouterChat(config.openRouter, { messages: [{ role: 'user', content: prompt }], maxTokens: 3000, timeoutMs: 45000 });
    return { svg: extractSafeLogoSvg(result.content), modelUsed: result.model, provider: 'openrouter' };
  }
  if (config.type === 'gemini') {
    const model = GEMINI_TEXT_MODELS.includes('gemini-2.5-flash') ? 'gemini-2.5-flash' : GEMINI_TEXT_MODELS[0];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key.trim() }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 3000 } }),
    });
    if (!response.ok) throw Object.assign(new Error('تعذر توليد الشعار لدى Gemini؛ راجع حصة الطلبات وصلاحية المفتاح'), { status: response.status === 429 ? 429 : 502, code: 'AI_LOGO_PROVIDER_FAILED' });
    const data = await response.json();
    return { svg: extractSafeLogoSvg((data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')), modelUsed: model, provider: 'gemini' };
  }
  throw Object.assign(new Error('مزود النصوص المحدد لا يدعم تصميم الشعارات في التطبيق'), { status: 503, code: 'AI_LOGO_PROVIDER_UNSUPPORTED' });
}

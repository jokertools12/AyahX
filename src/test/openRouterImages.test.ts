import { afterEach, expect, it, vi } from 'vitest';
import { generateOpenRouterImage, isFreeImageModel } from '../../server/services/openRouterImageService';
const free = { id: 'fixture/image:free', architecture: { output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0', image: '0' } };
afterEach(() => vi.unstubAllGlobals());
it('rejects paid, unknown-price and vision-only models', () => {
  expect(isFreeImageModel(free)).toBe(true);
  expect(isFreeImageModel({ ...free, pricing: { image: '0.01' } })).toBe(false);
  expect(isFreeImageModel({ ...free, pricing: undefined })).toBe(false);
  expect(isFreeImageModel({ ...free, architecture: { output_modalities: ['text'] } })).toBe(false);
});
it('makes no generation request when no free image model exists', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
  vi.stubGlobal('fetch', request);
  await expect(generateOpenRouterImage('nature', { type: 'openrouter', key: 'fixture' })).rejects.toMatchObject({ code: 'AI_IMAGE_FREE_MODEL_UNAVAILABLE', status: 503 });
  expect(request).toHaveBeenCalledOnce();
});
it('forwards ratio and style with zero-price routing and no model fallback', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [free] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,cG5n' } }] } }] })));
  vi.stubGlobal('fetch', request);
  expect(await generateOpenRouterImage('nature', { type: 'openrouter', key: ' fixture ' }, { aspectRatio: '16:9', style: 'minimalist' })).toMatchObject({ dataUrl: 'data:image/png;base64,cG5n' });
  const body = JSON.parse(request.mock.calls[1][1].body);
  expect(body.image_config.aspect_ratio).toBe('16:9');
  expect(body.messages[0].content).toContain('minimal composition');
  expect(body.provider).toEqual({ allow_fallbacks: false, max_price: { prompt: 0, completion: 0, image: 0 } });
  expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer fixture');
});
it('does not accept text as a generated image', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [free] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'image description' } }] }))));
  await expect(generateOpenRouterImage('nature', { type: 'openrouter', key: 'fixture' })).rejects.toMatchObject({ code: 'AI_IMAGE_EMPTY_RESULT' });
});

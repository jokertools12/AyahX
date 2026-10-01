import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImageWithAi } from '../../server/services/aiService';
import { extractSafeLogoSvg } from '../../server/services/aiLogoService';
import { getBestVideoUrl, searchPexelsVideos } from '../lib/pexelsApi';

vi.mock('../lib/api', () => ({ getAuthToken: () => 'fixture-token' }));
afterEach(() => vi.unstubAllGlobals());

describe('Media provider failures and actual settings', () => {
  it('authenticates Pexels requests and drops unplayable entries', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ videos: [
      { id: 1, video_files: [{ file_type: 'video/mp4', link: 'https://example.test/a.mp4' }] },
      { id: 2, video_files: [{ file_type: 'video/webm', link: 'https://example.test/a.webm' }] },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    expect(await searchPexelsVideos('nature', { orientation: 'landscape' })).toHaveLength(1);
    expect(request.mock.calls[0][0]).toContain('orientation=landscape');
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token');
  });
  it('reports Pexels authorization errors instead of showing an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'اشتراك مطلوب' }), { status: 403 })));
    await expect(searchPexelsVideos('nature')).rejects.toThrow('اشتراك مطلوب');
  });
  it('never selects a WebM source as an MP4 video', () => {
    const files = [{ file_type: 'video/webm', quality: 'hd', width: 720, height: 1280, link: 'wrong.webm' }, { file_type: 'video/mp4', quality: 'sd', width: 360, height: 640, link: 'right.mp4' }];
    expect(getBestVideoUrl({ video_files: files } as any)).toBe('right.mp4');
  });
  it('sends the selected image ratio and style in a single provider request', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cG5n' } }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const result = await generateImageWithAi('mountains', { type: 'gemini', key: ' fixture-key ', imageModel: 'gemini-2.5-flash-image' }, { aspectRatio: '16:9', style: 'minimalist' });
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
    expect(body.contents[0].parts[0].text).toContain('minimal composition');
    expect(request.mock.calls[0][1].headers['x-goog-api-key']).toBe('fixture-key');
    expect(request.mock.calls[0][0]).not.toContain('fixture-key');
    expect(result.dataUrl).toBe('data:image/png;base64,cG5n');
    expect(request).toHaveBeenCalledOnce();
  });
  it('does not retry other models after quota exhaustion', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }));
    vi.stubGlobal('fetch', request);
    await expect(generateImageWithAi('mountains', { type: 'gemini', key: 'fixture' })).rejects.toMatchObject({ status: 429, code: 'AI_IMAGE_QUOTA_EXCEEDED' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('never claims a successful image when the provider returns only text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }), { status: 200 })));
    await expect(generateImageWithAi('mountains', { type: 'gemini', key: 'fixture' })).rejects.toMatchObject({ code: 'AI_IMAGE_EMPTY_RESULT' });
  });
  it.each(['<script>alert(1)</script>', '<image href="https://example.test/a.png"/>', '<rect fill="url(https://example.test/a)"/>', '<rect onclick="alert(1)"/>'])('rejects active or external AI logo content: %s', content => {
    expect(() => extractSafeLogoSvg(`<svg>${content}</svg>`)).toThrow();
  });
  it('retains self-contained SVG gradients and Arabic text', () => {
    const svg = '<svg viewBox="0 0 500 500"><defs><linearGradient id="gold"/></defs><rect fill="url(#gold)"/><text>قرآن</text></svg>';
    expect(extractSafeLogoSvg(svg)).toBe(svg);
  });
});

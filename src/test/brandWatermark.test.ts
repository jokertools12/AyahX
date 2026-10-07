import { afterEach, expect, test, vi } from 'vitest';
import { loadBrandWatermark } from '../lib/brand';

afterEach(() => vi.unstubAllGlobals());

test('brand selection embeds the local PNG without requesting an AI provider', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['original-png-bytes'], { type: 'image/png' }) });
  vi.stubGlobal('fetch', fetchMock);
  expect(await loadBrandWatermark('white')).toMatch(/^data:image\/png;base64,/);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith('/brand/06_Monochrome_White.png', { credentials: 'same-origin' });
});

test('missing or invalid assets fail without replacing the saved watermark', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(loadBrandWatermark('color')).rejects.toThrow('unavailable');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['<html>'], { type: 'text/html' }) }));
  await expect(loadBrandWatermark('symbol')).rejects.toThrow('Invalid');
});

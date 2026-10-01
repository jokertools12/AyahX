import { describe, expect, it, vi } from 'vitest';
const encoder = vi.hoisted(() => ({ load: vi.fn(async () => true), on: vi.fn(), off: vi.fn(), writeFile: vi.fn(async () => {}), exec: vi.fn(async (_args: string[]) => 0), readFile: vi.fn(async () => new Uint8Array(1200)), deleteFile: vi.fn(async () => true) }));
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: class { constructor() { return encoder; } } }));
vi.mock('@ffmpeg/util', () => ({ fetchFile: async () => new Uint8Array(20), toBlobURL: async () => 'blob:core' }));
import { convertWebmToMp4 } from '@/lib/ffmpeg';
describe('local MP4 encoder', () => {
 it('rejects failed encoding, cleans files and permits the next conversion with fresh progress', async () => {
  vi.stubGlobal('URL', { revokeObjectURL: vi.fn() });
  vi.stubGlobal('AbortSignal', { timeout: () => undefined });
  encoder.exec.mockResolvedValueOnce(1);
  await expect(convertWebmToMp4(new Blob(['video']))).rejects.toThrow('MP4');
  expect(encoder.readFile).not.toHaveBeenCalled();
  expect(encoder.deleteFile).toHaveBeenCalledWith('input.webm');
  expect(encoder.deleteFile).toHaveBeenCalledWith('output.mp4');
  const progress=vi.fn();
  const result=await convertWebmToMp4(new Blob(['video']), {fps:60,audioBitrate:'320k',onProgress:progress});
  expect(result.type).toBe('video/mp4');
  expect(progress).toHaveBeenCalledWith(1);
  expect(encoder.on).toHaveBeenCalledTimes(2);
  expect(encoder.off).toHaveBeenCalledTimes(2);
  expect(encoder.exec.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining(['60','320k','libx264']));
  vi.unstubAllGlobals();
 });
});

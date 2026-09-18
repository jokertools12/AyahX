import { describe, it, expect } from 'vitest';
import {
  validateUrlForSsrf,
  validateLocalFilePath,
  validateManifestAssets,
} from '../../server/services/assetCatalogResolver';
import { RenderManifest } from '../../server/models/renderManifest';

describe('Asset Catalog & Security Validator', () => {
  it('allows verified Quranic and media CDN domains', () => {
    expect(validateUrlForSsrf('https://audio.qurancdn.com/Alafasy/001.mp3').safe).toBe(true);
    expect(validateUrlForSsrf('https://everyayah.com/data/Alafasy_128kbps/001001.mp3').safe).toBe(true);
    expect(validateUrlForSsrf('https://images.unsplash.com/photo-12345').safe).toBe(true);
    expect(validateUrlForSsrf('https://videos.pexels.com/video-files/1/clip.mp4').safe).toBe(true);
  });

  it('blocks cloud metadata address (169.254.169.254)', () => {
    const res = validateUrlForSsrf('http://169.254.169.254/latest/meta-data/');
    expect(res.safe).toBe(false);
    expect(res.reason).toContain('SSRF');
  });

  it('blocks private IPv4 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
    expect(validateUrlForSsrf('http://10.0.0.5/audio.mp3').safe).toBe(false);
    expect(validateUrlForSsrf('http://172.16.50.1/video.mp4').safe).toBe(false);
    expect(validateUrlForSsrf('http://172.31.255.255/video.mp4').safe).toBe(false);
    expect(validateUrlForSsrf('http://192.168.1.1/secret.mp3').safe).toBe(false);
  });

  it('blocks non-HTTP protocols (file://, gopher://, ftp://)', () => {
    expect(validateUrlForSsrf('file:///etc/passwd').safe).toBe(false);
    expect(validateUrlForSsrf('gopher://127.0.0.1:70/').safe).toBe(false);
    expect(validateUrlForSsrf('ftp://example.com/audio.mp3').safe).toBe(false);
  });

  it('prevents directory traversal and null-byte injection on local paths', () => {
    const baseDir = 'C:\\uploads\\renders';
    expect(validateLocalFilePath(baseDir, 'user123/video.mp4').safe).toBe(true);
    expect(validateLocalFilePath(baseDir, '../../etc/passwd').safe).toBe(false);
    expect(validateLocalFilePath(baseDir, 'user123/video.mp4\0.jpg').safe).toBe(false);
  });

  it('enforces maximum duration and frame limits', () => {
    const manifestStub: any = {
      audio: {
        audioUrl: 'https://audio.qurancdn.com/Alafasy/001.mp3',
        durationSeconds: 1500, // 25 minutes (exceeds 10-minute default limit!)
      },
      fps: 30,
      background: { url: 'https://images.unsplash.com/bg.jpg' },
    };
    const res = validateManifestAssets(manifestStub);
    expect(res.safe).toBe(false);
    expect(res.reason).toContain('تتجاوز الحد المسموح');
  });

  it('heals manifest with blob audioUrl when valid everyAyahUrls are present', () => {
    const manifestStub: any = {
      audio: {
        audioUrl: 'blob:http://localhost:5173/test-audio-blob',
        durationSeconds: 10,
        everyAyahUrls: ['https://everyayah.com/data/Alafasy_128kbps/001001.mp3'],
      },
      fps: 30,
      background: { url: 'https://images.unsplash.com/bg.jpg' },
    };
    const res = validateManifestAssets(manifestStub);
    expect(res.safe).toBe(true);
    expect(manifestStub.audio.audioUrl).toBe('https://everyayah.com/data/Alafasy_128kbps/001001.mp3');
  });

  it('rejects raw blob audioUrl when no everyAyahUrls fallback is provided', () => {
    const manifestStub: any = {
      audio: {
        audioUrl: 'blob:http://localhost:5173/unresolved-blob',
        durationSeconds: 10,
      },
      fps: 30,
      background: { url: 'https://images.unsplash.com/bg.jpg' },
    };
    const res = validateManifestAssets(manifestStub);
    expect(res.safe).toBe(false);
    expect(res.reason).toContain('blob:');
  });

  it('accepts a premium raster data URL but blocks executable/local background sources', () => {
    const safeInlineImage: any = {
      audio: {
        audioUrl: 'https://audio.qurancdn.com/Alafasy/001.mp3',
        durationSeconds: 10,
      },
      fps: 30,
      background: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=', type: 'image' },
    };
    expect(validateManifestAssets(safeInlineImage).safe).toBe(true);

    const unsafeInlineHtml = {
      ...safeInlineImage,
      background: { url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', type: 'image' },
    };
    expect(validateManifestAssets(unsafeInlineHtml as any).safe).toBe(false);

    const unsafeFilePath = {
      ...safeInlineImage,
      background: { url: 'file:///etc/passwd', type: 'image' },
    };
    expect(validateManifestAssets(unsafeFilePath as any).safe).toBe(false);
  });
});

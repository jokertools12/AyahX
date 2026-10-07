// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from 'vitest';
import { loadImage } from '@napi-rs/canvas';

test('application icons and social card export at their declared resolutions', async () => {
  for (const [name, width, height] of [['app-icon-192.png', 192, 192], ['app-icon-512.png', 512, 512], ['apple-touch-icon.png', 180, 180], ['social-preview.png', 1200, 630]] as const) {
    const image = await loadImage(readFileSync(`public/brand/${name}`));
    expect(image.width).toBe(width); expect(image.height).toBe(height);
  }
});

test('imported original masters match the recorded source and manifest icon paths exist', () => {
  const manifest = JSON.parse(readFileSync('public/brand/provenance.json', 'utf8'));
  for (const file of manifest.originals) {
    expect(createHash('sha256').update(readFileSync(`public/brand/${file.name}`)).digest('hex')).toBe(file.sha256);
  }
  const webmanifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));
  for (const icon of webmanifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true);
});

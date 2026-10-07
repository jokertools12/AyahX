// @vitest-environment node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { NativeSceneRenderer } from '../../server/renderer/nativeSceneRenderer';

test.each(['01_Primary_Horizontal.png', '06_Monochrome_White.png', '03_Symbol_Transparent.png'])('renders the approved %s master on the first native frame', async filename => {
  const dataUrl = `data:image/png;base64,${readFileSync(`public/brand/${filename}`).toString('base64')}`;
  const scene = new NativeSceneRenderer({
    outputDimensions: { width: 720, height: 1280 }, fps: 30,
    reciter: { id: 'fixture', name: '' },
    canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 1, ayahs: [{ numberInSurah: 1, text: 'بسم الله' }] },
    timingMap: { words: [], validationStatus: 'needs_review' }, audio: { durationSeconds: 1 },
    background: { type: 'color', url: '#000000', overlayOpacity: 0, motionSpeed: 1 },
    typography: { fontFamily: 'Amiri', fontSize: 28, textColor: '#ffffff' },
    displaySettings: { showSurahName: false, showReciterName: false, showAyahText: false, showAyahNumber: false,
      logoWatermarkEnabled: true, logoWatermarkPreset: 'custom', logoWatermarkUrl: dataUrl,
      logoWatermarkPosition: 'topRight', logoWatermarkSize: 200, logoWatermarkOpacity: 1 },
  } as any);
  try {
    await scene.init();
    const pixels = await scene.renderFrameRgbaBuffer(0, 0);
    let colored = 0;
    let masterPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 20 || pixels[i + 1] > 20 || pixels[i + 2] > 20) colored++;
    expect(colored).toBeGreaterThan(500);
    // Exclude the caption below the medallion. These colors must come from the master.
    for (let y = 0; y < 150; y++) for (let x = 500; x < 720; x++) {
      const i = (y * 720 + x) * 4;
      const matches = filename.includes('White')
        ? pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245
        : pixels[i] < 12 && pixels[i + 1] >= 100 && pixels[i + 1] <= 115 && pixels[i + 2] >= 70 && pixels[i + 2] <= 85;
      if (matches) masterPixels++;
    }
    expect(masterPixels).toBeGreaterThan(50);
    const canvas = createCanvas(720, 1280);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 720, 1280), 0, 0);
    mkdirSync('qa-output/brand', { recursive: true });
    writeFileSync(`qa-output/brand/native-${filename}`, canvas.toBuffer('image/png'));
  } finally { await scene.close(); }
});

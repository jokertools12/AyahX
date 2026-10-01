import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { NativeSceneRenderer } from '../server/renderer/nativeSceneRenderer';
import * as options from '../src/data/displayOptions';

const output = path.resolve('qa-output/display-options');
fs.mkdirSync(output, { recursive: true });
const base: any = {
  schemaVersion: '1.0.0', rendererVersion: '1.0.0', revision: 'settings-qa',
  outputDimensions: { width: 720, height: 1280 }, aspectRatio: '9:16', fps: 30,
  audio: { sourceMode: 'single_url', durationSeconds: 3, audioContentHash: 'fixture-only' },
  canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 2, ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ' }, { numberInSurah: 2, text: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' }] },
  reciter: { id: 'qa', name: 'مشاري راشد العفاسي' },
  timingMap: { mapId: 'fixture-only', audioContentHash: 'fixture-only', sourceId: 'verified_dataset', validationStatus: 'approved', words: [
    ...['بِسْمِ', 'اللَّهِ', 'الرَّحْمَٰنِ'].map((displayToken, i) => ({ canonicalWordKey: `1:1:${i+1}`, displayWordIndex: i, displayToken, startMs: i * 300, endMs: (i+1)*300 })),
    ...['الْحَمْدُ', 'لِلَّهِ', 'رَبِّ', 'الْعَالَمِينَ'].map((displayToken, i) => ({ canonicalWordKey: `1:2:${i+1}`, displayWordIndex: i, displayToken, startMs: 1000+i*400, endMs: 1000+(i+1)*400 })),
  ] },
  typography: { fontFamily: 'Amiri', fontSize: 32, textColor: '#fff7e6', shadowIntensity: 0.5, overlayOpacity: 0.35 },
  background: { type: 'color', url: '#162b3a', overlayOpacity: 0.35 },
  displaySettings: { visualDesign: 'moonlit', showSurahName: true, showReciterName: true, showAyahText: true, showAyahNumber: true, highlightStyle: 'glow', glowStyle: 'golden', frameStyle: 'ornate', screenBorderStyle: 'goldenTrim', screenBorderColor: 'gold', ayahNumberStyle: 'quran3d', ayahNumberColor: 'gold', verseDisplayMode: 'wordByWord', animationProfile: 'karaoke', ayahTransition: 'fade', textShadowStyle: 'soft', surahNameStyle: 'classic', surahNamePosition: 'top', reciterNameStyle: 'pill', watermarkEnabled: true, watermarkText: '@AyahX', watermarkPosition: 'bottomRight', socialWatermarkEnabled: true, socialHandle: '@AyahX', socialPlatform: 'youtube', socialWatermarkPosition: 'bottomCenter', logoWatermarkEnabled: true, logoWatermarkPreset: 'goldCalligraphy', logoBrandName: 'آيات', logoWatermarkPosition: 'topRight', logoWatermarkSize: 85, logoWatermarkOpacity: 0.9 },
};
const groups: Record<string, readonly { value: string }[]> = {
  verseDisplayMode: options.VERSE_DISPLAY_MODE_OPTIONS, animationProfile: options.ANIMATION_PROFILE_OPTIONS,
  ayahTransition: options.AYAH_TRANSITION_OPTIONS, highlightStyle: options.HIGHLIGHT_STYLE_OPTIONS,
  glowStyle: options.GLOW_STYLE_OPTIONS, textShadowStyle: options.TEXT_SHADOW_OPTIONS,
  ayahNumberStyle: options.AYAH_NUMBER_STYLE_OPTIONS, ayahNumberColor: options.AYAH_NUMBER_COLOR_OPTIONS,
  surahNamePosition: options.SURA_NAME_POSITION_OPTIONS, surahNameStyle: options.SURA_NAME_STYLE_OPTIONS,
  reciterNameStyle: options.RECITER_NAME_STYLE_OPTIONS, frameStyle: options.FRAME_STYLE_OPTIONS,
  screenBorderStyle: options.SCREEN_BORDER_STYLE_OPTIONS, screenBorderColor: options.SCREEN_BORDER_COLOR_OPTIONS,
  watermarkPosition: options.WATERMARK_POSITION_OPTIONS, socialWatermarkPosition: options.SOCIAL_WATERMARK_POSITION_OPTIONS,
  socialPlatform: options.SOCIAL_PLATFORM_OPTIONS, logoWatermarkPosition: options.LOGO_WATERMARK_POSITION_OPTIONS,
  logoWatermarkPreset: options.LOGO_WATERMARK_PRESET_OPTIONS.filter(o => o.value !== 'custom'),
};
const results: any[] = [];
for (const [key, variants] of Object.entries(groups)) {
  const sheet = createCanvas(Math.min(4, variants.length)*180, Math.ceil(variants.length/4)*350);
  const sheetCtx = sheet.getContext('2d'); sheetCtx.fillStyle='#07121c'; sheetCtx.fillRect(0,0,sheet.width,sheet.height);
  const hashes = new Map<string,string>();
  for (const [index, variant] of variants.entries()) {
    const manifest = structuredClone(base); manifest.displaySettings[key] = variant.value;
    if (['animationProfile','textShadowStyle','glowStyle'].includes(key)) manifest.displaySettings.verseDisplayMode = 'full';
    if (key === 'watermarkPosition') manifest.displaySettings.socialWatermarkEnabled = false;
    const scene = new NativeSceneRenderer(manifest); await scene.init();
    const hash = crypto.createHash('sha256'); let frame: Buffer;
    for (const time of [0.15,0.55,1.05,1.5]) { frame = await scene.renderFrameRgbaBuffer(Math.round(time*30),time); hash.update(frame); }
    await scene.close();
    const canvas = createCanvas(720,1280); canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame!),720,1280),0,0);
    const digest=hash.digest('hex'); const sameAs=hashes.get(digest); hashes.set(digest,variant.value);
    results.push({key,value:variant.value,status:'rendered', ...(sameAs?{sameAs}:{}), digest});
    const x=(index%4)*180,y=Math.floor(index/4)*350;
    sheetCtx.drawImage(canvas,x,y,180,320); sheetCtx.fillStyle='#ffffff'; sheetCtx.font='12px sans-serif'; sheetCtx.fillText(variant.value,x+5,y+337);
  }
  fs.writeFileSync(path.join(output,`${key}.png`),sheet.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
if (results.some(r => r.sameAs)) throw new Error(`Inert display options: ${JSON.stringify(results.filter(r => r.sameAs))}`);
console.log(JSON.stringify({count:results.length,duplicates:results.filter(r=>r.sameAs),output},null,2));

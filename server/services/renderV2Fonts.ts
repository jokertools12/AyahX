import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { CatalogError } from './catalogContracts';

export const RENDER_V2_FONTS = [
  ['Amiri', 'amiri.ttf'], ['Amiri Quran', 'amiriquran.ttf'], ['Noto Naskh Arabic', 'notonaskharabic.ttf'],
  ['Scheherazade New', 'scheherazadenew.ttf'], ['Lateef', 'lateef.ttf'], ['Mada', 'mada.ttf'],
] as const;
function fontPath(filename: string): string {
  const directory = fs.existsSync('public/fonts') ? 'public/fonts' : 'dist/fonts';
  return path.resolve(process.cwd(), directory, filename);
}
let registered = false;
export function registerRenderV2Fonts(): void {
  if (registered) return;
  for (const [family, filename] of RENDER_V2_FONTS) {
    const file = fontPath(filename);
    if (!fs.existsSync(file) || !GlobalFonts.registerFromPath(file, family) || !GlobalFonts.has(family)) throw new CatalogError('RENDER_V2_LOCAL_FONT_UNAVAILABLE', 503, { family });
  }
  registered = true;
}
/** Real TTF cmap glyph indices (format4/12); zero means .notdef, not a font fallback. */
export function ttfGlyphIndex(bytes: Buffer, point: number): number {
  if (bytes.length < 12) throw new CatalogError('RENDER_V2_FONT_INVALID', 503);
  let cmap = -1;
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const row = 12 + i * 16;
    if (bytes.toString('ascii', row, row + 4) === 'cmap') cmap = bytes.readUInt32BE(row + 8);
  }
  if (cmap < 0 || cmap + 4 > bytes.length) throw new CatalogError('RENDER_V2_FONT_INVALID', 503);
  for (let i = 0; i < bytes.readUInt16BE(cmap + 2); i++) {
    const row = cmap + 4 + i * 8, platform = bytes.readUInt16BE(row), encoding = bytes.readUInt16BE(row + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const table = cmap + bytes.readUInt32BE(row + 4), format = bytes.readUInt16BE(table);
    if (format === 12) {
      const count = bytes.readUInt32BE(table + 12);
      for (let group = 0; group < count; group++) {
        const start = table + 16 + group * 12, first = bytes.readUInt32BE(start), last = bytes.readUInt32BE(start + 4);
        if (point >= first && point <= last) { const index = bytes.readUInt32BE(start + 8) + point - first; if (index) return index; }
      }
    } else if (format === 4 && point <= 0xffff) {
      const count = bytes.readUInt16BE(table + 6) / 2, ends = table + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, offsets = deltas + count * 2;
      for (let segment = 0; segment < count; segment++) {
        const first = bytes.readUInt16BE(starts + segment * 2), last = bytes.readUInt16BE(ends + segment * 2);
        if (point < first || point > last) continue;
        const delta = bytes.readInt16BE(deltas + segment * 2), offset = bytes.readUInt16BE(offsets + segment * 2);
        const raw = offset ? bytes.readUInt16BE(offsets + segment * 2 + offset + 2 * (point - first)) : point;
        const index = raw ? (raw + delta) & 0xffff : 0;
        if (index) return index;
      }
    }
  }
  return 0;
}
export interface RenderV2FontProof { family: string; file: string; sha256: string; visible_codepoints: number; missing: string[]; rendered_words: number; words_without_ink: number; passed: boolean }
/** Run on the REAL worker Linux against the complete DB-exported corpus, not sample text. */
export function auditRenderV2CorpusFonts(corpus: readonly string[], options: { raster?: boolean } = {}): { platform: string; unique_words: number; corpus_sha256: string; fonts: RenderV2FontProof[]; passed: boolean } {
  if (!corpus.length) throw new CatalogError('RENDER_V2_CORPUS_REQUIRED', 422);
  registerRenderV2Fonts();
  const words = [...new Set(corpus)].sort(), controls = new Set([0x034f, 0x200a, 0x200b, 0x2060, 0x2063]);
  const points = [...new Set(words.flatMap(word => [...word].map(c => c.codePointAt(0)!)))].filter(point => point !== 32 && !controls.has(point));
  const canvas = createCanvas(640, 112), context = canvas.getContext('2d');
  const fonts = RENDER_V2_FONTS.map(([family, filename]): RenderV2FontProof => {
    const bytes = fs.readFileSync(fontPath(filename));
    const missing = points.filter(point => !ttfGlyphIndex(bytes, point)).map(point => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`);
    let empty = 0;
    context.font = `40px "${family}"`;
    context.fillStyle = '#ffffff'; context.direction = 'rtl'; context.textAlign = 'right';
    for (const word of options.raster === false ? [] : words) {
      context.clearRect(0, 0, 640, 112);
      context.fillText(word, 620, 72);
      const pixels = context.getImageData(0, 0, 640, 112).data;
      let ink = false;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { ink = true; break; }
      if (!ink) empty++;
    }
    return { family, file: filename, sha256: createHash('sha256').update(bytes).digest('hex'), visible_codepoints: points.length, missing, rendered_words: options.raster === false ? 0 : words.length, words_without_ink: empty, passed: !missing.length && !empty };
  });
  return { platform: process.platform, unique_words: words.length, corpus_sha256: createHash('sha256').update(words.join('\n')).digest('hex'), fonts, passed: fonts.every(font => font.passed) };
}

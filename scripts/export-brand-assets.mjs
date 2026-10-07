import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { resolve } from 'node:path';

// Export approved vector masters; do not redraw or modify the originals.
for (const size of [180, 192, 512]) {
  const image = await loadImage(await readFile('public/brand/04_App_Icon.svg'));
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  await writeFile(`public/brand/${size === 180 ? 'apple-touch-icon' : `app-icon-${size}`}.png`, canvas.toBuffer('image/png'));
}
if (!GlobalFonts.registerFromPath(resolve('server/assets/fonts/NotoNaskhArabic-Regular.ttf'), 'AyahX Arabic')) throw new Error('Arabic font registration failed.');
const canvas = createCanvas(1200, 630);
const context = canvas.getContext('2d');
context.fillStyle = '#F5F7F8';
context.fillRect(0, 0, 1200, 630);
context.fillStyle = '#056B4B';
context.fillRect(0, 0, 1200, 12);
context.fillStyle = '#D2A536';
context.fillRect(540, 492, 120, 4);
const mark = await loadImage(await readFile('public/brand/01_Primary_Horizontal.svg'));
context.drawImage(mark, 230, 165, 740, 740 * 250 / 808);
context.font = '36px "AyahX Arabic"';
context.fillStyle = '#0D2C46';
context.textAlign = 'center';
context.fillText('صناعة المقاطع القرآنية والابتهالات', 600, 460);
await writeFile('public/brand/social-preview.png', canvas.toBuffer('image/png'));
console.log('Exported app icons, touch icon and 1200×630 social preview from approved SVG masters.');

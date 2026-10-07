/** Original, locally hosted masters from the owner's AyahX Brand Studio. */
export const BRAND = {
  name: 'AyahX',
  tagline: 'صناعة المقاطع القرآنية والابتهالات',
  colors: { emerald: '#056B4B', gold: '#D2A536', midnight: '#0D2C46' },
  assets: {
    horizontal: '/brand/01_Primary_Horizontal.svg',
    horizontalWhite: '/brand/06_Monochrome_White.svg',
    horizontalBlack: '/brand/06_Monochrome_Black.svg',
    stacked: '/brand/02_Stacked_Logo.svg',
    symbol: '/brand/03_Symbol_Transparent.svg',
    appIcon: '/brand/04_App_Icon.svg',
    favicon: '/brand/05_Favicon.svg',
  },
} as const;

export const BRAND_WATERMARKS = [
  { id: 'color', label: 'الشعار الملون', url: '/brand/01_Primary_Horizontal.png' },
  { id: 'white', label: 'شعار أبيض', url: '/brand/06_Monochrome_White.png' },
  { id: 'symbol', label: 'رمز AyahX', url: '/brand/03_Symbol_Transparent.png' },
] as const;

/** Embed original PNG bytes so browser and cloud renderers receive the same asset. */
export async function loadBrandWatermark(id: typeof BRAND_WATERMARKS[number]['id']): Promise<string> {
  const asset = BRAND_WATERMARKS.find(item => item.id === id);
  if (!asset) throw new Error('Unknown brand watermark');
  const response = await fetch(asset.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Brand image unavailable');
  const blob = await response.blob();
  if (blob.type !== 'image/png' || blob.size > 512 * 1024) throw new Error('Invalid brand image');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image data'));
    reader.onerror = () => reject(new Error('Image could not be read'));
    reader.readAsDataURL(blob);
  });
}

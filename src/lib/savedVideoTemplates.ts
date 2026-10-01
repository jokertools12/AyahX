import type { DisplaySettings } from '@/components/DisplaySettingsPanel';
import type { TextSettings } from '@/components/TextSettingsPanel';
import type { ExportSettings } from '@/components/ExportFormatSelector';
import type { AudioEffects } from '@/hooks/useAudioEffects';

export const TEMPLATES_KEY = 'ayah-clip-display-templates';

export interface VideoTemplateConfiguration {
  textSettings?: TextSettings;
  exportSettings?: ExportSettings;
  audioEffects?: AudioEffects;
  aspectRatio?: '9:16' | '16:9';
  background?: { id: string; type: string; url: string; thumbnail: string };
  customBackground?: string | null;
  customBackgroundType?: 'image' | 'video';
}

export interface SavedTemplate extends VideoTemplateConfiguration {
  version?: 2;
  id: string;
  name: string;
  settings: Partial<DisplaySettings>;
  createdAt: number;
  badge?: string;
}

export function loadSavedTemplates(storage: Pick<Storage, 'getItem'>): SavedTemplate[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TEMPLATES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedTemplate => item &&
      typeof item.id === 'string' && typeof item.name === 'string' &&
      item.settings && typeof item.settings === 'object' && !Array.isArray(item.settings));
  } catch { return []; }
}

// Object URLs expire when their originating page closes. Persist the asset,
// rather than a reference that silently stops working in another video.
export async function persistTemplateAsset(url: string | null | undefined): Promise<string | null | undefined> {
  if (!url?.startsWith('blob:')) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error('تعذر حفظ الملف المرفق بالقالب');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('تعذر حفظ الملف المرفق بالقالب'));
    reader.readAsDataURL(blob);
  });
}

export async function createSavedTemplate(name: string, settings: DisplaySettings, configuration: VideoTemplateConfiguration = {}): Promise<SavedTemplate> {
  const snapshot = JSON.parse(JSON.stringify({ settings, ...configuration }));
  snapshot.settings.logoWatermarkUrl = await persistTemplateAsset(snapshot.settings.logoWatermarkUrl);
  snapshot.customBackground = await persistTemplateAsset(snapshot.customBackground);
  if (snapshot.background) {
    snapshot.background.url = await persistTemplateAsset(snapshot.background.url);
    snapshot.background.thumbnail = await persistTemplateAsset(snapshot.background.thumbnail);
  }
  return { ...snapshot, version: 2, id: `tpl-${crypto.randomUUID()}`, name: name.trim(), createdAt: Date.now() };
}

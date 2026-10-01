import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplaySettingsPanel, type DisplaySettings } from '@/components/DisplaySettingsPanel';
import { createSavedTemplate, loadSavedTemplates, TEMPLATES_KEY, type VideoTemplateConfiguration } from '@/lib/savedVideoTemplates';

vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ canUseFeature: () => true, isPremium: true, isFreeFont: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const display: DisplaySettings = {
  showSurahName: true, showReciterName: false, showAyahText: true, showAyahNumber: true,
  highlightStyle: 'glow', frameStyle: 'none', ayahNumberStyle: 'quran3d', ayahNumberColor: 'gold',
  verseDisplayMode: 'full', animationProfile: 'karaoke', animationReducedMotion: true,
  surahNamePosition: 'top', surahNameStyle: 'classic', reciterNameStyle: 'simple',
  textShadowStyle: 'none', ayahTransition: 'fade', watermarkEnabled: false,
  watermarkText: '', watermarkPosition: 'bottomCenter', lyricsDisplayStyle: 'scroll',
  slideshowTransition: 'crossfade', logoWatermarkEnabled: true, logoWatermarkPreset: 'custom',
  logoWatermarkUrl: 'data:image/png;base64,YQ==', logoBrandName: 'قناتي', logoSubtitle: 'تلاوات',
  socialWatermarkEnabled: true, socialPlatform: 'instagram', socialHandle: '@channel',
  socialWatermarkOpacity: 0, logoWatermarkOpacity: 0, screenBorderStyle: 'goldenTrim',
};
const configuration: VideoTemplateConfiguration = {
  textSettings: { fontSize: 44, fontFamily: '"Amiri", serif', textColor: '#123456', shadowIntensity: 0, overlayOpacity: 0 },
  exportSettings: { format: 'webm', quality: 'ultra', motionSpeed: 0.5, recordingMethod: 'smooth', fps: 60, audioBitrate: '320k', renderEngine: 'browser' },
  audioEffects: { reverbEnabled: true, reverbLevel: 0.75, echoEnabled: true, echoDelay: 0.5, echoFeedback: 0.6, pitchShift: 0, speedAdjust: 1, copyrightProtectionEnabled: false, normalizeEnabled: true, eqEnabled: true, volume: 1.5 },
  aspectRatio: '16:9', background: { id: 'other', type: 'image', url: 'https://example.com/background.jpg', thumbnail: 'https://example.com/thumb.jpg' },
  customBackground: null, customBackgroundType: 'image',
};

function Editor({ original = false }: { original?: boolean }) {
  const [settings, setSettings] = useState<DisplaySettings>(original ? display : { ...display, showSurahName: false, animationReducedMotion: false, socialHandle: '@different' });
  const [config, setConfig] = useState<VideoTemplateConfiguration>(original ? configuration : { textSettings: { ...configuration.textSettings!, fontSize: 20 }, aspectRatio: '9:16', customBackground: 'old-background' });
  return <><DisplaySettingsPanel settings={settings} onChange={setSettings} textSettings={config.textSettings}
    onTextSettingsChange={textSettings => setConfig(previous => ({ ...previous, textSettings }))}
    templateConfiguration={config} onTemplateConfigurationChange={restored => setConfig(previous => ({ ...previous, ...restored }))} />
    <output data-testid="configuration">{JSON.stringify({ settings, config })}</output></>;
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('saved video templates across separate videos', () => {
  it('saves the complete configuration and restores it after opening another editor', async () => {
    const first = render(<Editor original />);
    fireEvent.click(screen.getByRole('button', { name: 'تنسيقاتي المحفوظة' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التنسيق الحالي كقالب خاص' }));
    fireEvent.change(screen.getByPlaceholderText('اسم القالب (مثال: ريلز الجمعة الفاخر)...'), { target: { value: 'تنسيقي الكامل' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(loadSavedTemplates(localStorage)).toHaveLength(1));
    expect(loadSavedTemplates(localStorage)[0]).toMatchObject({ version: 2, settings: display, ...configuration });
    first.unmount();
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'تنسيقاتي المحفوظة' }));
    fireEvent.click(screen.getByRole('button', { name: 'تنسيقي الكامل' }));
    const restored = JSON.parse(screen.getByTestId('configuration').textContent!);
    expect(restored.settings).toEqual(display);
    expect(restored.config).toMatchObject(configuration);
  });

  it('keeps new fields intact when applying a legacy display-only template', () => {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([{ id: 'legacy', name: 'قديم', settings: { showSurahName: true }, createdAt: 1 }]));
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'تنسيقاتي المحفوظة' }));
    fireEvent.click(screen.getByRole('button', { name: 'قديم' }));
    const restored = JSON.parse(screen.getByTestId('configuration').textContent!);
    expect(restored.settings).toMatchObject({ showSurahName: true, animationProfile: 'karaoke', socialHandle: '@different' });
    expect(restored.config.textSettings.fontSize).toBe(20);
  });

  it('does not report success or lose existing templates when storage is full', async () => {
    const { toast } = await import('sonner');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    render(<Editor original />);
    fireEvent.click(screen.getByRole('button', { name: 'تنسيقاتي المحفوظة' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التنسيق الحالي كقالب خاص' }));
    fireEvent.change(screen.getByPlaceholderText('اسم القالب (مثال: ريلز الجمعة الفاخر)...'), { target: { value: 'فشل الحفظ' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'فشل الحفظ' })).toBeNull();
    spy.mockRestore();
  });

  it('rejects corrupt storage and preserves snapshot values after later edits', async () => {
    expect(loadSavedTemplates({ getItem: () => '{bad' })).toEqual([]);
    expect(loadSavedTemplates({ getItem: () => '{}' })).toEqual([]);
    expect(loadSavedTemplates({ getItem: () => '[null,{"id":"x","name":"x","settings":[]}]' })).toEqual([]);
    const current = { ...display };
    const saved = await createSavedTemplate('snapshot', current, configuration);
    current.socialHandle = '@edited';
    expect(saved.settings.socialHandle).toBe('@channel');
    expect(saved.textSettings!.overlayOpacity).toBe(0);
    expect(saved.customBackground).toBeNull();
  });

  it('stores uploaded object URLs as reusable assets instead of expired page references', async () => {
    const fetchAsset = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) } as Response);
    try {
      const saved = await createSavedTemplate('uploaded assets', { ...display, logoWatermarkUrl: 'blob:logo' }, { ...configuration, customBackground: 'blob:background' });
      expect(saved.settings.logoWatermarkUrl).toBe('data:image/png;base64,aW1hZ2U=');
      expect(saved.customBackground).toBe('data:image/png;base64,aW1hZ2U=');
      expect(fetchAsset).toHaveBeenCalledTimes(2);
    } finally { fetchAsset.mockRestore(); }
  });
});


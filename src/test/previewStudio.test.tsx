import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SocialShareButtons } from '@/components/SocialShareButtons';
import { DisplaySettingsPanel, type DisplaySettings } from '@/components/DisplaySettingsPanel';
import { AudioEffectsPanel } from '@/components/AudioEffectsPanel';
import { VIDEO_PRESETS } from '@/data/videoPresets';

vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true, canUseFeature: () => true, isFreeFont: () => true }) }));
const base = { ...VIDEO_PRESETS[0].displaySettings, socialWatermarkEnabled: true, socialHandle: '@Original', glowStyle: 'none' } as DisplaySettings;
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function DisplayHarness() { const [settings, setSettings] = useState(base); return <DisplaySettingsPanel settings={settings} onChange={setSettings} />; }

describe('preview studio settings and sharing', () => {
  it('consolidates advanced controls and lets a disabled glow be selected again', () => {
    render(<DisplayHarness />);
    expect(screen.queryByText('طريقة عرض الآيات ورقم الآية 3D')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'أنماط الحركة وتأثيرات العرض القرآني المتقدمة' }));
    const golden = document.getElementById('glowstyle-golden')!;
    fireEvent.click(golden);
    expect(golden).toHaveAttribute('aria-checked', 'true');
  });
  it('keeps the social handle and position changes instead of overwriting them with stale state', () => {
    render(<DisplayHarness />);
    fireEvent.click(screen.getByRole('button', { name: /العلامة المائية والهوية/ }));
    const handle = screen.getByPlaceholderText('@QuranReels أو @username');
    fireEvent.change(handle, { target: { value: '@Updated' } });
    expect(handle).toHaveValue('@Updated');
    fireEvent.click(document.getElementById('socpos-topCenter')!);
    expect(document.getElementById('socpos-topCenter')).toHaveAttribute('aria-checked', 'true');
  });
  it('shares an MP4-only cloud result, uses edited caption, and ignores cancellation', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    render(<SocialShareButtons videoBlob={null} mp4Blob={new Blob(['mp4'], { type: 'video/mp4' })} title="تلاوة" text="بصوت القارئ" filename="video.webm" />);
    fireEvent.change(screen.getByLabelText('وصف المشاركة والوسوم'), { target: { value: 'وصف مخصص' } });
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share.mock.calls[0][0].text).toBe('وصف مخصص');
    expect(share.mock.calls[0][0].files[0].name).toBe('video.mp4');
    expect(share.mock.calls[0][0].files[0].type).toBe('video/mp4');
  });
  it('does not share internal WebM recording before MP4 conversion', () => {
    render(<SocialShareButtons videoBlob={new Blob(['webm'], { type: 'video/webm' })} title="تلاوة" text="وصف" filename="video.mp4" />);
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'تحميل MP4' })).toBeDisabled();
  });
  it('applies a premium audio preset with stable timing and no retired transforms', () => {
    const changed = vi.fn();
    render(<AudioEffectsPanel effects={{ reverbEnabled: false, reverbLevel: 0.5, echoEnabled: true, echoDelay: 0.3, echoFeedback: 0.4, pitchShift: 0, speedAdjust: 1, copyrightProtectionEnabled: false, normalizeEnabled: false, eqEnabled: false, volume: 1.25 }} onChange={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'وضوح متوازن' }));
    expect(changed.mock.calls[0][0]).toMatchObject({ volume: 1, normalizeEnabled: true, eqEnabled: true, echoEnabled: false, reverbEnabled: false, speedAdjust: 1, pitchShift: 0, copyrightProtectionEnabled: false });
  });
});

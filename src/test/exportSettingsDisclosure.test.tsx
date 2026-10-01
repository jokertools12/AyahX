import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportFormatSelector, type ExportSettings } from '@/components/ExportFormatSelector';

const subscription = vi.hoisted(() => ({ premium: false, cloudRemaining: 20, cloudPolicy: undefined as undefined | { enabledEngines: string[] } }));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    isPremium: subscription.premium,
    cloudPolicy: subscription.cloudPolicy,
    entitlements: {
      allowedQualities: subscription.premium ? ['medium', 'high', 'ultra'] : ['medium', 'high'],
      allowedFps: subscription.premium ? [30, 60] : [30],
      ffmpegAssDailyLimit: 1, skiaCanvasDailyLimit: 2,
    },
    dailyUsage: { browserRenderLimit: 5, browserRenderRemaining: 5,
      browserCloudRenderLimit: 20, browserCloudRenderRemaining: subscription.cloudRemaining },
  }),
}));
vi.mock('@/hooks/useVideoRecorder', () => ({
  QUALITY_PRESETS: {
    medium: { label: '720p', resolution: '720 × 1280' },
    high: { label: '1080p', resolution: '1080 × 1920' },
    ultra: { label: '4K', resolution: '2160 × 3840' },
  },
}));

afterEach(() => { cleanup(); subscription.premium = false; subscription.cloudRemaining = 20; subscription.cloudPolicy = undefined; });
const initial: ExportSettings = { format: 'mp4', quality: 'high', motionSpeed: 1, recordingMethod: 'auto', renderEngine: 'browser' };
function Harness({ onExport = vi.fn(), recording = false, converting = false, ready = false }) {
  const [settings, setSettings] = useState(initial);
  return <ExportFormatSelector settings={settings} onChange={setSettings} onExport={onExport}
    videoBlob={ready ? new Blob(['test'], { type: 'video/webm' }) : null} mp4Blob={ready ? new Blob(['mp4'], { type: 'video/mp4' }) : null}
    isRecording={recording} isConverting={converting} />;
}
function toggle(title: string) { fireEvent.click(screen.getByText(title, { selector: 'summary span.block' })); }
function radio(id: string) { return document.getElementById(id)!; }

describe('export settings progressive disclosure', () => {
  it('selects WebM locally and restores MP4 for cloud production', () => {
    render(<Harness ready />);
    fireEvent.click(radio('format-webm'));
    expect(radio('format-webm')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'تحميل WEBM' })).toBeEnabled();
    toggle('طريقة إنتاج الفيديو');
    fireEvent.click(radio('engine-skia-canvas'));
    expect(document.getElementById('format-webm')).toBeNull();
    expect(radio('format-mp4')).toHaveAttribute('aria-checked', 'true');
  });
  it('only offers deployed cloud engines and applies free cloud output limits', () => {
    subscription.cloudPolicy = { enabledEngines: ['skia_canvas'] };
    render(<Harness />);
    toggle('طريقة إنتاج الفيديو');
    expect(document.getElementById('engine-ffmpeg-ass')).toBeNull();
    expect(document.getElementById('engine-browser-cloud')).toBeNull();
    fireEvent.click(radio('engine-skia-canvas'));
    expect(radio('quality-medium')).toHaveAttribute('aria-checked', 'true');
    expect(radio('quality-high')).toBeDisabled();
    expect(radio('engine-browser')).toBeEnabled();
  });
  it('keeps recording descriptions fully visible in container-responsive cards', () => {
    render(<Harness />);
    toggle('طريقة إنتاج الفيديو');
    for (const name of ['تلقائي ذكي', 'جودة قصوى', 'سلس وسريع', 'خفيف واقتصادي']) {
      const button = screen.getByRole('button', { name: new RegExp(name) });
      expect(button).toHaveClass('whitespace-normal', 'min-w-0', 'h-auto');
      expect(button).not.toHaveClass('whitespace-nowrap');
      expect(button.lastElementChild).not.toHaveClass('line-clamp-1');
      expect(button.parentElement).toHaveClass('grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))]');
    }
  });

  it('retains every engine and recording strategy after closing and reopening', () => {
    render(<Harness />);
    toggle('طريقة إنتاج الفيديو');
    for (const id of ['engine-browser', 'engine-ffmpeg-ass', 'engine-skia-canvas', 'engine-browser-cloud']) expect(radio(id)).toBeInTheDocument();
    for (const name of ['تلقائي ذكي', 'جودة قصوى', 'سلس وسريع', 'خفيف واقتصادي']) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeEnabled();
    fireEvent.click(radio('engine-skia-canvas'));
    expect(radio('engine-skia-canvas')).toHaveAttribute('aria-checked', 'true');
    toggle('طريقة إنتاج الفيديو'); toggle('طريقة إنتاج الفيديو');
    expect(radio('engine-skia-canvas')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio('engine-browser'));
    fireEvent.click(screen.getByRole('button', { name: /سلس وسريع/ }));
    toggle('طريقة إنتاج الفيديو'); toggle('طريقة إنتاج الفيديو');
    expect(screen.getByRole('button', { name: /سلس وسريع/ })).toHaveClass('gradient-primary');
  });

  it('preserves free-tier restrictions without removing locked options', () => {
    render(<Harness />);
    toggle('خيارات الصوت والحركة'); toggle('طريقة إنتاج الفيديو');
    expect(radio('quality-ultra')).toBeDisabled();
    expect(radio('fps-60')).toBeDisabled();
    expect(radio('engine-browser-cloud')).toBeDisabled();
    expect(radio('engine-ffmpeg-ass')).toBeEnabled();
    expect(radio('engine-skia-canvas')).toBeEnabled();
    expect(screen.getByText(/يعمل الصوت بالإعداد القياسي/)).toBeInTheDocument();
  });

  it('retains premium FPS and bitrate selections and cloud quota restriction', () => {
    subscription.premium = true;
    subscription.cloudRemaining = 0;
    render(<Harness />);
    toggle('خيارات الصوت والحركة'); toggle('طريقة إنتاج الفيديو');
    fireEvent.click(radio('fps-60')); fireEvent.click(radio('bitrate-320k'));
    toggle('خيارات الصوت والحركة'); toggle('خيارات الصوت والحركة');
    expect(radio('fps-60')).toHaveAttribute('aria-checked', 'true');
    expect(radio('bitrate-320k')).toHaveAttribute('aria-checked', 'true');
    expect(radio('engine-browser-cloud')).toBeDisabled();
    for (const id of ['bitrate-128k', 'bitrate-192k', 'bitrate-320k']) expect(radio(id)).toBeEnabled();
  });

  it.each([[false, false, true, 1], [true, false, true, 0], [false, true, true, 0], [false, false, false, 0]])(
    'preserves download availability: recording=%s converting=%s ready=%s', (recording, converting, ready, count) => {
      const download = vi.fn();
      render(<Harness recording={Boolean(recording)} converting={Boolean(converting)} ready={Boolean(ready)} onExport={download} />);
      const buttons = screen.queryAllByRole('button', { name: /تحميل/ });
      expect(buttons).toHaveLength(Number(count));
      if (count) {
        fireEvent.click(screen.getByRole('button', { name: 'تحميل MP4' }));
        expect(screen.getByText('WebM')).toBeInTheDocument();
        expect(download.mock.calls).toEqual([['mp4']]);
      }
    },
  );
});

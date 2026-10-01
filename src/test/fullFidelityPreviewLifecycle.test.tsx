import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FullFidelityVideoPreview } from '../components/FullFidelityVideoPreview';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('discards a scene that finished loading after its manifest was replaced', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('__RENDER_SCENE_VERSION__', 'new-scene-fingerprint');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  let finishOld!: (value: boolean) => void;
  const oldRender = vi.fn(); const newRender = vi.fn();
  const factory = vi.fn()
    .mockReturnValueOnce({ initScene: () => new Promise<boolean>(resolve => { finishOld = resolve; }), renderFrame: oldRender })
    .mockReturnValue({ initScene: async () => true, renderFrame: newRender });
  const props: any = {
    background: null, surahName: 'الفاتحة', reciterName: 'قارئ', currentAyah: null,
    aspectRatio: '9:16', textSettings: {}, isPlaying: false,
    sceneManifest: { revision: 'old', fps: 30, outputDimensions: { width: 720, height: 1280 }, background: { type: 'color' } },
  };
  const view = render(<FullFidelityVideoPreview {...props} />);
  const frame = view.container.querySelector('iframe')!;
  expect(frame).toHaveAttribute('src', '/render-harness.html?v=new-scene-fingerprint');
  Object.defineProperty(frame.contentWindow, '__CREATE_RENDER_CONTROLLER__', { value: factory, configurable: true });
  fireEvent.load(frame);
  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  view.rerender(<FullFidelityVideoPreview {...props} sceneManifest={{ ...props.sceneManifest, revision: 'new' }} />);
  await act(async () => { finishOld(true); });
  await waitFor(() => expect(newRender).toHaveBeenCalled());
  expect(oldRender).not.toHaveBeenCalled();
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-preview-state', 'ready');
});

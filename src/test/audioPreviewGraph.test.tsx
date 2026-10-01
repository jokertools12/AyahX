import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAudioEffects } from '@/hooks/useAudioEffects';

const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 }, delayTime: { value: 0 }, frequency: { value: 0 }, Q: { value: 0 }, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
afterEach(() => vi.unstubAllGlobals());
describe('audio preview recording graph', () => {
  it('routes normalized audio to both speakers and recording, and updates the switch live', () => {
    const compressor = node(), destination = {}, stream = {}, recordingDest = { ...node(), stream };
    class Context {
      sampleRate = 100; destination = destination; state = 'running';
      createGain = node; createDelay = node; createBiquadFilter = node; createConvolver = node;
      createMediaElementSource = node; createDynamicsCompressor = () => compressor;
      createMediaStreamDestination = () => recordingDest;
      createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
    }
    vi.stubGlobal('AudioContext', Context);
    const { result } = renderHook(() => useAudioEffects());
    act(() => result.current.initializeAudio(document.createElement('audio')));
    expect(compressor.connect.mock.calls).toEqual([[destination], [recordingDest]]);
    expect(result.current.getRecordingStream()).toBe(stream);
    expect(compressor.ratio.value).toBe(1);
    act(() => result.current.updateEffect('normalizeEnabled', true));
    expect(compressor.threshold.value).toBe(-24);
    expect(compressor.ratio.value).toBe(4);
    act(() => result.current.updateEffect('normalizeEnabled', false));
    expect(compressor.ratio.value).toBe(1);
  });
});

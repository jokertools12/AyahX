import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCloudRenderLimits } from '../../shared/cloudRenderPolicy';
import { getCloudRenderPolicy } from '../../server/services/cloudRenderPolicy';

const clip = { audio: { durationSeconds: 120 }, outputDimensions: { width: 720, height: 1280 }, fps: 30 };
afterEach(() => vi.unstubAllEnvs());
describe('cloud production limits', () => {
  it('accepts the free boundary and both orientations', () => {
    expect(validateCloudRenderLimits('free', clip)).toEqual([]);
    expect(validateCloudRenderLimits('free', { ...clip, outputDimensions: { width: 1280, height: 720 } })).toEqual([]);
  });
  it('rejects slow audio that would exceed the output duration limit', () => {
    expect(validateCloudRenderLimits('free', { ...clip, audioEffects: { speedAdjust: 0.75 } })).not.toEqual([]);
  });
  it('enforces duration, resolution and FPS for premium requests too', () => {
    const premium = { ...clip, audio: { durationSeconds: 300 }, outputDimensions: { width: 1080, height: 1920 } };
    expect(validateCloudRenderLimits('monthly', premium)).toEqual([]);
    expect(validateCloudRenderLimits('yearly', { ...premium, audio: { durationSeconds: 301 } })).not.toEqual([]);
    expect(validateCloudRenderLimits('monthly', { ...premium, outputDimensions: { width: 2160, height: 3840 } })).not.toEqual([]);
    expect(validateCloudRenderLimits('monthly', { ...premium, fps: 60 })).not.toEqual([]);
  });
  it('fails closed for invalid resource claims', () => {
    expect(validateCloudRenderLimits('free', { ...clip, audio: { durationSeconds: NaN } })).not.toEqual([]);
    expect(validateCloudRenderLimits('free', { ...clip, audioEffects: { speedAdjust: 0 } })).not.toEqual([]);
  });
  it('defaults to one engine and does not replace an explicitly stopped engine', () => {
    vi.stubEnv('ENGINE_FFMPEG_ENABLED', 'false'); vi.stubEnv('ENGINE_BROWSER_ENABLED', 'false');
    vi.stubEnv('ENGINE_SKIA_ENABLED', 'true');
    expect(getCloudRenderPolicy().enabledEngines).toEqual(['skia_canvas']);
    vi.stubEnv('ENGINE_SKIA_ENABLED', 'false');
    expect(getCloudRenderPolicy().defaultEngine).toBeNull();
  });
});

import {
  DeterministicRenderOptions,
  DeterministicRenderResult,
} from './deterministicVideoRenderer';
import { renderNativeSceneVideo } from './nativeSceneVideoRenderer';

/**
 * Idea 2: Native Skia Canvas engine.
 *
 * The frame scene is executed on @napi-rs/canvas, while FFmpeg only encodes
 * the resulting RGBA frames. It has its own worker/queue and does not invoke
 * Chromium or the Browser Cloud engine.
 */
export function renderSkiaCanvasVideo(
  options: DeterministicRenderOptions,
): Promise<DeterministicRenderResult> {
  return renderNativeSceneVideo(options, {
    label: 'Engine 2 Skia Canvas',
    scratchPrefix: 'render_skia',
    preset: 'fast',
    qualityCrf: options.manifest.qualityPreset === 'ultra' ? '15' : options.manifest.qualityPreset === 'medium' ? '20' : '18',
  });
}

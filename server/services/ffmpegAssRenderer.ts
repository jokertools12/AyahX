import {
  DeterministicRenderOptions,
  DeterministicRenderResult,
} from './deterministicVideoRenderer';
import { renderNativeSceneVideo } from './nativeSceneVideoRenderer';

/**
 * Idea 1: FFmpeg native engine.
 *
 * FFmpeg remains the independent encoder and worker path, but the scene is
 * rendered natively from the same full-fidelity harness contract as Preview
 * and Browser Cloud. This prevents the old ASS-only path from dropping
 * backgrounds, borders, transitions, badges, watermarks or display settings.
 */
export function renderFfmpegAssVideo(
  options: DeterministicRenderOptions,
): Promise<DeterministicRenderResult> {
  return renderNativeSceneVideo(options, {
    label: 'Engine 1 FFmpeg',
    scratchPrefix: 'render_ffmpeg',
    preset: 'veryfast',
    qualityCrf: options.manifest.qualityPreset === 'ultra' ? '15' : options.manifest.qualityPreset === 'medium' ? '20' : '18',
  });
}

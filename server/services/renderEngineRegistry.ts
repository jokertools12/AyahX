import { validateRenderManifest, RenderManifest } from '../models/renderManifest';
import { validateManifestAssets } from './assetCatalogResolver';
import { estimateRenderJobProfile, RenderWorkload, resolveRenderWorkerEngine, RenderWorkerEngine } from './renderCapacity';
import type { DeterministicRenderOptions, DeterministicRenderResult } from './deterministicVideoRenderer';

export interface RenderEngineValidation {
  valid: boolean;
  errors: string[];
}

export interface RenderEngine {
  id: RenderWorkerEngine;
  version: '1.0.0';
  usesChromium: boolean;
  validate(manifest: unknown): RenderEngineValidation;
  estimate(manifest: RenderManifest): ReturnType<typeof estimateRenderJobProfile>;
  render(options: DeterministicRenderOptions): Promise<DeterministicRenderResult>;
}

function workloadForManifest(manifest: RenderManifest): RenderWorkload {
  return {
    width: manifest.outputDimensions.width,
    height: manifest.outputDimensions.height,
    fps: manifest.fps,
    durationSeconds: manifest.audio.durationSeconds,
    backgroundType: manifest.background.type,
  };
}

function validateManifest(manifest: unknown): RenderEngineValidation {
  const parsed = validateRenderManifest(manifest);
  if (!parsed.valid || !parsed.manifest) return { valid: false, errors: parsed.errors || ['Invalid render manifest'] };
  const assets = validateManifestAssets(parsed.manifest);
  return assets.safe ? { valid: true, errors: [] } : { valid: false, errors: [assets.reason || 'Unsafe render asset'] };
}

const definitions: Record<RenderWorkerEngine, Omit<RenderEngine, 'id' | 'render'>> = {
  ffmpeg_ass: {
    version: '1.0.0',
    usesChromium: false,
    validate: validateManifest,
    estimate: (manifest) => estimateRenderJobProfile('ffmpeg_ass', workloadForManifest(manifest)),
  },
  skia_canvas: {
    version: '1.0.0',
    usesChromium: false,
    validate: validateManifest,
    estimate: (manifest) => estimateRenderJobProfile('skia_canvas', workloadForManifest(manifest)),
  },
  browser_cloud: {
    version: '1.0.0',
    usesChromium: true,
    validate: validateManifest,
    estimate: (manifest) => estimateRenderJobProfile('browser_cloud', workloadForManifest(manifest)),
  },
};

export function getRenderEngine(value: unknown): RenderEngine {
  const id = resolveRenderWorkerEngine(typeof value === 'string' ? value : undefined);
  const definition = definitions[id];
  return {
    ...definition,
    id,
    async render(options) {
      if (id === 'ffmpeg_ass') {
        const module = await import('./ffmpegAssRenderer');
        return module.renderFfmpegAssVideo(options);
      }
      if (id === 'skia_canvas') {
        const module = await import('./skiaCanvasRenderer');
        return module.renderSkiaCanvasVideo(options);
      }
      const module = await import('./browserCloudRenderer');
      return module.renderBrowserCloudVideo(options);
    },
  };
}

export function listRenderEngines(): RenderEngine[] {
  return (Object.keys(definitions) as RenderWorkerEngine[]).map((id) => getRenderEngine(id));
}

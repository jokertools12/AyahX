import { CLOUD_ENGINES, type CloudRenderPolicy } from '../../shared/cloudRenderPolicy';

export function getCloudRenderPolicy(): CloudRenderPolicy {
  const enabledEngines = CLOUD_ENGINES.filter(engine => {
    const prefix = engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER';
    // Only Skia is enabled by default. Explicit flags permit diagnostic runs.
    return process.env[`ENGINE_${prefix}_ENABLED`] === 'true'
      || engine === 'skia_canvas' && process.env.ENGINE_SKIA_ENABLED !== 'false';
  });
  const backlog = Number(process.env.RENDER_MAX_BACKLOG || 50);
  return {
    enabledEngines,
    defaultEngine: enabledEngines.includes('skia_canvas') ? 'skia_canvas' : enabledEngines[0] ?? null,
    maxBacklog: Number.isFinite(backlog) ? Math.max(1, Math.floor(backlog)) : 50,
  };
}

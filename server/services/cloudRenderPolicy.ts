import { CLOUD_ENGINES, type CloudRenderPolicy } from '../../shared/cloudRenderPolicy';

export function getCloudRenderPolicy(): CloudRenderPolicy {
  const enabledEngines = CLOUD_ENGINES.filter(engine => {
    // The final AyahX topology is Skia-only on the server. Browser rendering
    // remains a client capability and must never become a Railway queue.
    if (engine === 'browser_cloud') return false;
    const prefix = engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER';
    // Only Skia is enabled by default. FFmpeg remains opt-in for the approved
    // mux path; no environment flag can create a server browser renderer.
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

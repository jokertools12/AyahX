import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RENDER_QUEUE_NAMES } from '../../server/services/renderQueueBroker';

describe('render engine isolation', () => {
  it('uses three durable queues with no shared queue name', () => {
    const names = Object.values(RENDER_QUEUE_NAMES);
    expect(names).toEqual([
      'quran-render-ffmpeg-v1',
      'quran-render-skia-v1',
      'quran-render-browser-v1',
    ]);
    expect(new Set(names).size).toBe(3);
  });

  it('does not route native engines through the browser renderer', () => {
    const ffmpegSource = fs.readFileSync(path.resolve(process.cwd(), 'server/services/ffmpegAssRenderer.ts'), 'utf8');
    const skiaSource = fs.readFileSync(path.resolve(process.cwd(), 'server/services/skiaCanvasRenderer.ts'), 'utf8');
    expect(ffmpegSource).not.toContain('return renderFullFidelityVideo');
    expect(skiaSource).not.toContain('return renderFullFidelityVideo');
    expect(ffmpegSource).not.toContain("from './browserCloudRenderer'");
    expect(skiaSource).not.toContain("from './browserCloudRenderer'");
  });
});

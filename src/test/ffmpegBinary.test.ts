import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFfmpegResourceArgs, getFfmpegVideoEncoderArgs } from '../../server/services/ffmpegBinary';

describe('FFmpeg resource limits', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies the configured limit to both filters and libx264', () => {
    vi.stubEnv('RENDER_FFMPEG_THREADS', '1');

    expect(getFfmpegResourceArgs()).toEqual([
      '-filter_threads', '1',
      '-filter_complex_threads', '1',
    ]);
    expect(getFfmpegVideoEncoderArgs()).toEqual([
      '-threads:v', '1',
      '-x264-params', 'threads=1:lookahead_threads=1:sliced_threads=0',
    ]);
  });

  it('defaults to one encoder thread when the deployment variable is absent', () => {
    vi.stubEnv('RENDER_FFMPEG_THREADS', '');

    expect(getFfmpegVideoEncoderArgs()).toContain('threads=1:lookahead_threads=1:sliced_threads=0');
  });
});

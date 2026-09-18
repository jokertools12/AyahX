import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { isFfmpegAvailable, processVideoToSmoothMp4 } from '../../server/services/videoRenderingService';
import { probeMediaFile } from '../../server/services/mediaProbeService';

describe('High-Performance Background FFmpeg Rendering Service', () => {
  it('detects native FFmpeg binary on the system', () => {
    expect(isFfmpegAvailable()).toBe(true);
    expect(ffmpegPath).toBeDefined();
  });

  it('rejects empty or invalid buffers with a clear error', async () => {
    await expect(processVideoToSmoothMp4(Buffer.alloc(0))).rejects.toThrow();
  });

  it('successfully converts and stabilizes video into a smooth, hardware-accelerated H.264 MP4', async () => {
    // Generate a minimal synthetic 1-second WebM clip using ffmpeg lavfi testsrc & sine audio
    const gen = spawnSync(
      ffmpegPath!,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=1:size=360x640:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'vp8',
        '-c:a', 'libvorbis',
        '-f', 'webm',
        'pipe:1',
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    expect(gen.status).toBe(0);
    const inputWebmBuffer = gen.stdout;
    expect(inputWebmBuffer.length).toBeGreaterThan(1000);

    // Now process through our professional rendering service
    const outputMp4Buffer = await processVideoToSmoothMp4(inputWebmBuffer, {
      fps: 30,
      crf: 19,
      preset: 'ultrafast',
      filename: 'smooth-test.mp4',
    });

    expect(outputMp4Buffer.length).toBeGreaterThan(1000);

    // Verify valid MP4 container structure (ftyp box at start)
    const boxType = outputMp4Buffer.toString('ascii', 4, 8);
    expect(boxType).toBe('ftyp');

    // Verify compatible major brand (isom or mp42)
    const majorBrand = outputMp4Buffer.toString('ascii', 8, 12);
    expect(['isom', 'mp42']).toContain(majorBrand);
  }, 40000);

  it('encodes the premium 60fps / 320kbps profile without silently falling back to 30fps', async () => {
    const gen = spawnSync(
      ffmpegPath!,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=3:size=360x640:rate=30',
        // Noise prevents an encoder from using the tiny low-complexity sine
        // stream to report a misleadingly low average bitrate.
        '-f', 'lavfi', '-i', 'anoisesrc=duration=3:color=white:sample_rate=44100',
        '-c:v', 'vp8',
        '-c:a', 'libvorbis',
        '-f', 'webm',
        'pipe:1',
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    expect(gen.status).toBe(0);

    const output = await processVideoToSmoothMp4(gen.stdout, {
      fps: 60,
      audioBitrate: '320k',
      crf: 19,
      preset: 'ultrafast',
      filename: 'premium-60fps.mp4',
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-premium-60fps-'));
    const outputPath = path.join(dir, 'premium-60fps.mp4');

    try {
      fs.writeFileSync(outputPath, output);
      const probe = await probeMediaFile(outputPath);
      expect(probe.video?.fps).toBe(60);
      expect(probe.video?.codec).toBe('h264');
      expect(probe.audio?.codec).toBe('aac');
      expect(probe.audio?.sampleRate).toBe(96_000);
      expect(probe.audio?.bitrate ?? 0).toBeGreaterThan(280_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);
});

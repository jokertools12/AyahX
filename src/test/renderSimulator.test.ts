import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderDeterministicVideo } from '../../server/services/deterministicVideoRenderer';

const savedEnvironment = {
  simulate: process.env.RENDER_SIMULATE,
  delay: process.env.RENDER_SIMULATE_MS,
  delayAlias: process.env.RENDER_SIMULATE_DELAY_MS,
  memory: process.env.RENDER_SIMULATE_MEMORY_MB,
  cpu: process.env.RENDER_SIMULATE_CPU_MS,
  cpuSeconds: process.env.RENDER_SIMULATE_CPU_SECONDS,
};

afterEach(() => {
  process.env.RENDER_SIMULATE = savedEnvironment.simulate;
  process.env.RENDER_SIMULATE_MS = savedEnvironment.delay;
  process.env.RENDER_SIMULATE_DELAY_MS = savedEnvironment.delayAlias;
  process.env.RENDER_SIMULATE_MEMORY_MB = savedEnvironment.memory;
  process.env.RENDER_SIMULATE_CPU_MS = savedEnvironment.cpu;
  process.env.RENDER_SIMULATE_CPU_SECONDS = savedEnvironment.cpuSeconds;
});

describe('Staging render simulator', () => {
  it('produces a probeable fixture without dispatching the real engine', async () => {
    process.env.RENDER_SIMULATE = '1';
    process.env.RENDER_SIMULATE_MS = '10';
    process.env.RENDER_SIMULATE_MEMORY_MB = '1';
    process.env.RENDER_SIMULATE_CPU_MS = '1';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ayahx-simulate-'));
    const outputPath = path.join(directory, 'fixture.mp4');
    try {
      const result = await renderDeterministicVideo({
        outputPath,
        manifest: {
          renderEngine: 'skia_canvas',
          outputDimensions: { width: 360, height: 640 },
          fps: 30,
          audio: { durationSeconds: 1 },
          background: { type: 'color', url: '#102030' },
          displaySettings: {},
        } as any,
      });
      expect(result.probe.video?.codec).toBe('h264');
      expect(result.probe.audio?.codec).toBe('aac');
      expect(result.probe.video?.pixelFormat).toBe('yuv420p');
      expect(result.durationSeconds).toBeGreaterThan(0.7);
      expect(fs.statSync(outputPath).size).toBeGreaterThan(1024);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts the Railway load-test delay and CPU aliases', async () => {
    process.env.RENDER_SIMULATE = '1';
    delete process.env.RENDER_SIMULATE_MS;
    process.env.RENDER_SIMULATE_DELAY_MS = '10';
    delete process.env.RENDER_SIMULATE_CPU_MS;
    process.env.RENDER_SIMULATE_CPU_SECONDS = '0.001';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ayahx-simulate-alias-'));
    try {
      const result = await renderDeterministicVideo({
        outputPath: path.join(directory, 'fixture.mp4'),
        manifest: {
          renderEngine: 'browser_cloud',
          outputDimensions: { width: 360, height: 640 },
          fps: 30,
          audio: { durationSeconds: 1 },
          background: { type: 'color', url: '#102030' },
          displaySettings: {},
        } as any,
      });
      expect(result.probe.video?.codec).toBe('h264');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

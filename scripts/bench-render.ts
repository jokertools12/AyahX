import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { renderDeterministicVideo } from '../server/services/deterministicVideoRenderer';
import { estimateRenderJobProfile, resolveRenderWorkerEngine, RenderWorkerEngine, readCgroupCpuUsageMicros, readMemoryPeakBytes } from '../server/services/renderCapacity';

type BenchmarkResult = Record<string, unknown>;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ayahx-render-bench-'));
const durations = (process.env.BENCH_DURATIONS || '15,60,300').split(',').map(Number).filter((n) => n > 0);
const engines = (process.env.BENCH_ENGINES || 'ffmpeg_ass,skia_canvas,browser_cloud')
  .split(',').map((value) => resolveRenderWorkerEngine(value.trim())).filter(Boolean) as RenderWorkerEngine[];
const sizes = (process.env.BENCH_SIZES || '720x1280,1080x1920').split(',').map((value) => {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}).filter((size) => size.width >= 360 && size.height >= 360);

function makeAudio(duration: number): string {
  const output = path.join(root, `tone-${duration}.m4a`);
  const result = spawnSync(ffmpegStatic || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-c:a', 'aac', '-ar', '44100', output], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`Unable to create benchmark audio for ${duration}s`);
  return output;
}

async function main(): Promise<void> {
  const results: BenchmarkResult[] = [];
  for (const engine of engines) {
    for (const size of sizes) {
      for (const duration of durations) {
        const audioFilePath = makeAudio(duration);
        const outputPath = path.join(root, `${engine}-${size.width}x${size.height}-${duration}.mp4`);
        const manifest: any = {
          schemaVersion: '1.0.0', rendererVersion: '1.0.0', renderEngine: engine,
          revision: `bench-${engine}-${size.width}-${size.height}-${duration}`,
          aspectRatio: size.height >= size.width ? '9:16' : '16:9', outputDimensions: size,
          fps: 30, qualityPreset: 'medium', audioBitrate: '192k', codecProfile: 'high-4.1',
          reciter: { id: 'bench', name: 'Benchmark', everyAyahSubfolder: 'Alafasy_128kbps' },
          canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 1, ayahs: [{ numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' }] },
          timingMap: { mapId: 'bench-map', audioContentHash: 'benchmark-audio-hash', validationStatus: 'approved', words: [{ canonicalWordKey: '1:1:1', displayWordIndex: 0, displayToken: 'بِسْمِ', startMs: 0, endMs: 1000 }] },
          audio: { sourceMode: 'single_url', audioUrl: audioFilePath, audioContentHash: `bench-audio-${duration}`, durationSeconds: duration },
          background: { id: 'bench-color', type: 'color', url: '#09151E', overlayOpacity: 0.4, shadowIntensity: 0.5, motionSpeed: 1 },
          typography: { fontSize: 28, fontFamily: '"Amiri", serif', textColor: '#FFFFFF', shadowIntensity: 0.5, overlayOpacity: 0.4 },
          displaySettings: { showSurahName: true, showReciterName: true, showAyahText: true, showAyahNumber: true, highlightStyle: 'glow', frameStyle: 'ornate', screenBorderStyle: 'doubleCinema', screenBorderColor: 'gold', ayahNumberStyle: 'quran3d', ayahNumberColor: 'gold', verseDisplayMode: 'wordByWord', surahNamePosition: 'top', surahNameStyle: 'classic', reciterNameStyle: 'simple', textShadowStyle: 'soft', ayahTransition: 'fade', watermarkEnabled: false, glowStyle: 'golden', slideshowTransition: 'crossfade' },
          outputFormat: 'mp4',
        };
        const profile = estimateRenderJobProfile(engine, { ...size, fps: 30, durationSeconds: duration, backgroundType: 'color' });
        const start = process.hrtime.bigint();
        const cpuBefore = readCgroupCpuUsageMicros();
        const memoryBefore = readMemoryPeakBytes();
        try {
          const result = await renderDeterministicVideo({ manifest, audioFilePath, outputPath });
          const cpuAfter = readCgroupCpuUsageMicros();
          results.push({ engine, ...size, duration, status: 'succeeded', wallSeconds: Number(process.hrtime.bigint() - start) / 1e9, cgroupCpuMs: cpuBefore !== null && cpuAfter !== null ? (cpuAfter - cpuBefore) / 1000 : null, peakMemoryBytes: Math.max(memoryBefore, readMemoryPeakBytes()), fileSizeBytes: result.fileSizeBytes, profile });
        } catch (error) {
          results.push({ engine, ...size, duration, status: 'failed', error: String((error as Error).message || error), wallSeconds: Number(process.hrtime.bigint() - start) / 1e9, peakMemoryBytes: Math.max(memoryBefore, readMemoryPeakBytes()), profile });
        }
      }
    }
  }
  const output = process.env.BENCH_OUTPUT || path.resolve('bench-results', `render-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ output, results }, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((error) => { console.error(error); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = 1; });

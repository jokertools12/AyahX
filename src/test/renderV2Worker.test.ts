// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { NativeSceneRenderer } from '../../server/renderer/nativeSceneRenderer';
import { RenderManifestV2Schema, toRenderManifestV1Internal, type RenderManifestV2 } from '../../server/models/renderManifestV2';
import { auditRenderV2CorpusFonts, ttfGlyphIndex } from '../../server/services/renderV2Fonts';
import { rawPcmCorrelation, buildGoldenTargets, correlateRenderV2DecodedAudio } from '../../server/services/renderV2Qa';
import { parseAudioByteRange, prepareRenderV2Audio } from '../../server/services/renderV2Audio';
import { renderNativeSceneVideo } from '../../server/services/nativeSceneVideoRenderer';
import { runRenderV2Process } from '../../server/services/renderV2Process';
import { getFfmpegBinary } from '../../server/services/ffmpegBinary';
import { countRenderV2BlackFrames, measureRenderV2AudioSync } from '../../server/services/renderV2Qa';

export function renderV2WorkerFixture(): RenderManifestV2 {
  const words = ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ', 'ٱلرَّحِيمِ'];
  const canonical = (ayah: number) => ({ numberInSurah: ayah, text: words.join(' '), words: words.map((text, index) => ({ text, wordIndex: index + 1, canonicalWordKey: `1:${ayah}:${index + 1}` })) });
  return RenderManifestV2Schema.parse({ schemaVersion: '2.0.0', rendererVersion: '2.0.0', renderEngine: 'skia_canvas', repetitionDisplayMode: 'canonical',
    recitation: { id: 'unit', slug: 'unit', reciterId: 'unit-reciter', reciterName: 'اختبار', providerCode: 'unit' },
    canonicalTextVersion: { id: 'unit', checksum: 'a'.repeat(64) }, canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 3, ayahs: [canonical(1), canonical(2), canonical(3)] },
    timeline: { coordinate: 'render_ms', durationMs: 2400, sourceWindow: { fromMs: 5000, toMs: 7400 }, ayahs: [
      { ayah: 1, startMs: 150, endMs: 1250, highlightMode: 'word', words: [[1, 150, 350], [2, 350, 550], [1, 550, 750], [3, 850, 1050], [4, 1050, 1250]].map(([wordIndex, startMs, endMs], index) => ({ wordIndex, startMs, endMs, canonicalWordKey: `1:1:${wordIndex}`, occurrenceId: `event:${index}` })) },
      { ayah: 2, startMs: 1300, endMs: 1800, highlightMode: 'ayah', highlightReason: 'TIMING_NEEDS_REVIEW', words: [] },
      { ayah: 3, startMs: 1800, endMs: 2400, highlightMode: 'ayah', highlightReason: 'TIMING_ESTIMATED', words: [] },
    ], gaps: [{ startMs: 1250, endMs: 1300, type: 'inter_ayah', evidence: 'source_timestamps' }] },
    audioPlan: { recitationId: 'unit', mode: 'surah_slice', coordinate: 'source_ms', provider: 'unit', license: null, attribution: null, parts: [{ url: 'https://example.org/source.mp3', sliceFromMs: 5000, sliceToMs: 7400 }], fallbackUsed: false, allowedHosts: ['example.org'], sourceIdentity: { kind: 'external_url', url: 'https://example.org/source.mp3' } },
    audioPlanHash: 'b'.repeat(64), timingVersionHash: 'c'.repeat(64), options: {}, warnings: [],
  });
}

describe('catalog v2 worker actual scene', () => {
  it('paints time-selected repeated canonical words, short waqf hold and ayah-only review/estimated', async () => {
    const manifest = toRenderManifestV1Internal(renderV2WorkerFixture());
    manifest.outputDimensions = { width: 360, height: 640 };
    const scene = new NativeSceneRenderer(manifest);
    try {
      await scene.init();
      for (const [ms, key, occurrence, held, ayah, mode] of [
        [0, null, null, false, 1, 'word'], [250, '1:1:1', 'event:0', false, 1, 'word'],
        [450, '1:1:2', 'event:1', false, 1, 'word'], [650, '1:1:1', 'event:2', false, 1, 'word'],
        [800, '1:1:1', 'event:2', true, 1, 'word'], [950, '1:1:3', 'event:3', false, 1, 'word'],
        [1550, null, null, false, 2, 'ayah'], [2100, null, null, false, 3, 'ayah'],
      ] as const) {
        const pixels = await scene.renderFrameRgbaBuffer(Math.round(ms * 30 / 1000), ms / 1000);
        const state = scene.getFrameState()!;
        expect(state.paintedWordKeys).toEqual(key ? [key] : []);
        expect(state.occurrenceId).toBe(occurrence); expect(state.held).toBe(held);
        expect(state.ayah).toBe(ayah); expect(state.mode).toBe(mode);
        expect(pixels.length).toBe(360 * 640 * 4);
        expect(scene.capturePng().subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      }
      // Backward seeking re-derives state from time, never the last canonical index.
      await scene.renderFrameRgbaBuffer(7, .250);
      expect(scene.getFrameState()?.occurrenceId).toBe('event:0');
      expect(scene.getExternalAssetRequestCount()).toBe(0);
    } finally { await scene.close(); }
  });
  it('keeps golden expectation independent of the painted scene, including all occurrences', () => {
    const targets = buildGoldenTargets(renderV2WorkerFixture());
    expect([...targets.values()].flat()).toHaveLength(7);
    expect([...targets.values()].flat().filter(entry => entry.key === '1:1:1')).toHaveLength(2);
    expect([...targets.values()].flat().filter(entry => entry.mode === 'ayah')).toHaveLength(2);
  });
  it('checks bundled glyph indices and actually rasterizes with six fonts', () => {
    const proof = auditRenderV2CorpusFonts(renderV2WorkerFixture().canonicalAyahRange.ayahs[0].words.map(word => word.text));
    expect(proof.fonts).toHaveLength(6); expect(proof.unique_words).toBe(4); expect(proof.passed).toBe(true);
    const font = fs.readFileSync(path.resolve('public/fonts/amiri.ttf'));
    expect(ttfGlyphIndex(font, 0x0628)).toBeGreaterThan(0);
    expect(ttfGlyphIndex(font, 0x10ffff)).toBe(0);
  });
  it.each([30, 60] as const)('encodes a non-frame-aligned Skia duration at %i fps with every frame and decoded audio intact', async fps => {
    const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ayahx-v2-native-unit-'));
    try {
      const audioPath = path.join(scratch, 'owned-noise.wav'), referencePcmPath = path.join(scratch, 'reference.s16le'), outputPath = path.join(scratch, 'actual.mp4');
      await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:seed=73:sample_rate=44100:duration=2.415', '-c:a', 'pcm_s16le', audioPath]);
      await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-y', '-v', 'error', '-i', audioPath, '-ac', '1', '-ar', '16000', '-f', 's16le', referencePcmPath]);
      const fixture=renderV2WorkerFixture();fixture.timeline.durationMs=2415;fixture.timeline.sourceWindow.toMs=7415;fixture.timeline.ayahs[2].endMs=2415;fixture.audioPlan.parts[0].sliceToMs=7415;
      fixture.options.fps = fps;
      const manifest = toRenderManifestV1Internal(fixture, audioPath);
      manifest.outputDimensions = { width: 360, height: 640 };
      const targets = buildGoldenTargets(fixture), measured: string[] = [];
      const result = await renderNativeSceneVideo({ manifest, audioFilePath: audioPath, outputPath }, { label: 'v2 owned fixture', scratchPrefix: 'render_v2_unit', preset: 'ultrafast', qualityCrf: '23',
        onFrame: (index, _time, scene) => { for (const target of targets.get(index) ?? []) { const state = scene.getFrameState()!; expect(state.paintedWordKeys).toEqual(target.key ? [target.key] : []); measured.push(state.occurrenceId ?? 'ayah'); } },
      });
      expect(measured).toHaveLength(7); expect(Math.abs(result.probe.durationSeconds - 2.415)).toBeLessThanOrEqual(1/fps);
      expect(await countRenderV2BlackFrames(outputPath)).toEqual({ black: 0, frames: Math.ceil(2.415 * fps) });
      const correlation = await measureRenderV2AudioSync(outputPath, { audioPath, referencePcmPath, durationMs: 2415,seekMethod:'bounded_full_download', audioBytesFetched: 0, referenceBytesFetched: 0, sourceSizeBytes: 0, rangeSupported: false, fullDownloadFallback: false, requests: [], warnings: [] }, 0, undefined, 1000/fps);
      expect(correlation.score).toBeGreaterThanOrEqual(.95); expect(Math.abs(correlation.lag_ms)).toBeLessThanOrEqual(40);
      expect(correlation.passed).toBe(true); expect(correlation.aac_padding_trimmed_ms).toBeGreaterThanOrEqual(0);
    } finally { await fs.promises.rm(scratch, { recursive: true, force: true }); }
  }, 30_000);
});
describe('raw independently decoded PCM comparison', () => {
  function noise() { let seed = 73; return Int16Array.from({ length: 16_000 }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed % 16000) - 8000; }); }
  it('finds sub-millisecond lag with centering and gain normalization', () => {
    const reference = noise(), actual = new Int16Array(reference.length), shift = 117;
    for (let i = shift; i < actual.length; i++) actual[i] = reference[i - shift] * 2 + 100;
    const result = rawPcmCorrelation(reference, actual);
    expect(result.score).toBeGreaterThan(.99999); expect(result.lag_ms).toBe(7.3125); expect(result.passed).toBe(true);
  });
  it('keeps excessive shift and unrelated audio failed despite a correlation search', () => {
    const reference = noise(), actual = new Int16Array(reference.length), shift = 960;
    for (let i = shift; i < actual.length; i++) actual[i] = reference[i - shift];
    const result = rawPcmCorrelation(reference, actual);
    expect(result.score).toBeGreaterThan(.99999); expect(result.lag_ms).toBe(60); expect(result.passed).toBe(false);
    expect(rawPcmCorrelation(reference, Int16Array.from(reference, value => -value)).passed).toBe(false);
  });
  it('rejects a perfectly correlated prefix when half the audio is missing', () => {
    const reference = noise(), result = rawPcmCorrelation(reference, reference.slice(0, 8000));
    expect(result.score).toBe(1); expect(result.lag_ms).toBe(0);
    expect(result.duration_difference_ms).toBe(500); expect(result.passed).toBe(false);
  });
  it('accounts only for a bounded AAC tail and still rejects declared truncation or excessive padding at 60 fps', () => {
    const reference = noise(), padded = new Int16Array(16_361); padded.set(reference);
    const stream = { codec: 'aac', sampleRate: 44100, channels: 1, durationSeconds: 1 };
    const result = correlateRenderV2DecodedAudio(reference, padded, stream, 1000/60);
    expect(result.passed).toBe(true); expect(result.aac_padding_trimmed_ms).toBe(22.5625);
    expect(correlateRenderV2DecodedAudio(reference, reference, { ...stream, durationSeconds: .98 }, 1000/60).passed).toBe(false);
    const excessive = new Int16Array(17_000); excessive.set(reference);
    expect(correlateRenderV2DecodedAudio(reference, excessive, stream, 1000/60).passed).toBe(false);
    expect(correlateRenderV2DecodedAudio(reference, padded, { ...stream, codec: 'pcm_s16le' }, 1000/60).passed).toBe(false);
  });
});
describe('full resolution encoded black-frame scan', () => {
  it('rejects empty black frames while preserving sparse Quran text on black', async () => {
    auditRenderV2CorpusFonts(['قُلْ هُوَ ٱللَّهُ أَحَدٌ']);
    const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ayahx-d7-black-test-'));
    try {
      for (const hasText of [false, true]) {
        const canvas = createCanvas(1080, 1920), context = canvas.getContext('2d');
        context.fillStyle = '#000000'; context.fillRect(0, 0, 1080, 1920);
        if (hasText) { context.fillStyle = '#ffffff'; context.font = '28px "Amiri Quran"'; context.fillText('قُلْ هُوَ ٱللَّهُ أَحَدٌ', 540, 960); }
        const image = path.join(scratch, `${hasText}.png`), video = path.join(scratch, `${hasText}.mp4`);
        await fs.promises.writeFile(image, canvas.toBuffer('image/png'));
        await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-y', '-v', 'error', '-loop', '1', '-i', image, '-frames:v', '3', '-r', '30', '-c:v', 'libx264', '-threads:v', '1', '-pix_fmt', 'yuv420p', video]);
        expect(await countRenderV2BlackFrames(video)).toEqual({ black: hasText ? 0 : 3, frames: 3 });
      }
    } finally { await fs.promises.rm(scratch, { recursive: true, force: true }); }
  }, 30_000);
});
describe('audio transport boundary', () => {
  it('accepts only a single valid bounded byte range', () => {
    expect(parseAudioByteRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
    expect(parseAudioByteRange('bytes=100-9999', 1000)).toEqual({ start: 100, end: 999 });
    for (const value of ['bytes=-1', 'bytes=0-1,3-4', 'bytes=1000-', 'bytes=20-10', 'bytes=999999999999999999-']) expect(() => parseAudioByteRange(value, 1000)).toThrow('AUDIO_RANGE_INVALID');
  });
  it('rejects private, signed and YouTube URLs before opening a connection', async () => {
    const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ayahx-v2-boundary-unit-'));
    try {
      for (const url of ['https://127.0.0.1/a.mp3', 'https://youtube.com/a.mp3', 'https://example.org/a.mp3?token=private']) {
        const input = renderV2WorkerFixture().audioPlan;
        input.sourceIdentity = { kind: 'external_url', url }; input.allowedHosts = ['example.org', 'youtube.com'];
        await expect(prepareRenderV2Audio(input, scratch, 2400)).rejects.toMatchObject({ status: 422 });
      }
    } finally { await fs.promises.rm(scratch, { recursive: true, force: true }); }
  });
});

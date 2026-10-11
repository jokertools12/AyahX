import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { RenderManifestV2Schema, toRenderManifestV1Internal, type RenderManifestV2 } from '../models/renderManifestV2';
import { renderNativeSceneVideo } from './nativeSceneVideoRenderer';
import type { DeterministicRenderOptions, DeterministicRenderResult } from './deterministicVideoRenderer';
import { prepareRenderV2Audio } from './renderV2Audio';
import { observeRenderV2Children } from './renderV2Process';
import { beginRenderV2MemoryMonitor, buildGoldenTargets, countRenderV2BlackFrames, measureRenderV2AudioSync, RenderV2QaError, writeGoldenPng, type GoldenFrameProof, type RenderV2QaReport } from './renderV2Qa';
import { CatalogError } from './catalogContracts';
import { auditRenderV2CorpusFonts, registerRenderV2Fonts } from './renderV2Fonts';

export interface RenderCatalogV2Options {
  manifest: RenderManifestV2; outputPath: string; signal?: AbortSignal;
  onProgress?: DeterministicRenderOptions['onProgress'];
}
export interface RenderCatalogV2Result extends DeterministicRenderResult { qaReport: RenderV2QaReport; audioBytesFetched: number }

/** V2 only. Client/v1 validators, provider fallbacks and legacy audio preparation are never used. */
export async function renderCatalogV2Video(options: RenderCatalogV2Options): Promise<RenderCatalogV2Result> {
  const manifest = RenderManifestV2Schema.parse(options.manifest);
  registerRenderV2Fonts();
  const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ayahx-render-v2-'));
  const goldenDirectory = `${options.outputPath}.qa`;
  const started = performance.now(), memory = beginRenderV2MemoryMonitor();
  const stopObserving = observeRenderV2Children(memory.child);
  let memoryFinished = false;
  try {
    options.onProgress?.(1, 0, 0, 'جلب الصوت المسموح وقياس خطة القص...');
    const audio = await prepareRenderV2Audio(manifest.audioPlan, scratch, manifest.timeline.durationMs, options.signal);
    const sceneManifest = toRenderManifestV1Internal(manifest, audio.audioPath);
    const targets = buildGoldenTargets(manifest), golden: GoldenFrameProof[] = [];
    const transitions: RenderV2QaReport['highlighting_transitions'] = [];
    let lastState = '', capturedPngs = 0, externalAssets = 0;
    const sampleFrames = [...targets.keys()].sort((a, b) => a - b);
    const selectedImages = new Set(sampleFrames.filter((_, index) => index % Math.max(1, Math.ceil(sampleFrames.length / 24)) === 0));
    const result = await renderNativeSceneVideo({ manifest: sceneManifest, outputPath: options.outputPath,
      audioFilePath: audio.audioPath, signal: options.signal, onProgress: options.onProgress }, {
      label: 'Catalog v2 Skia Canvas', scratchPrefix: 'render_catalog_v2_scene', preset: 'fast', qualityCrf: '18', onChild: memory.child,
      onFrame: async (frameIndex, _seconds, scene) => {
        const state = scene.getFrameState();
        externalAssets = Math.max(externalAssets, scene.getExternalAssetRequestCount());
        if (!state) throw new CatalogError('RENDER_V2_SCENE_STATE_UNAVAILABLE', 503);
        const stateKey = JSON.stringify([state.ayah, state.mode, state.paintedWordKeys, state.occurrenceId]);
        if (stateKey !== lastState) { transitions.push({ time_ms: state.timeMs, word_keys: state.paintedWordKeys, occurrence_id: state.occurrenceId, ayah: state.ayah, mode: state.mode }); lastState = stateKey; }
        if (!targets.has(frameIndex)) return;
        const image = selectedImages.has(frameIndex) && capturedPngs < 24 ? await writeGoldenPng(goldenDirectory, frameIndex, scene.capturePng()) : {};
        if ('png' in image) capturedPngs++;
        for (const target of targets.get(frameIndex)!) golden.push({ frame_index: frameIndex, time_ms: state.timeMs, ayah: target.ayah,
          expected_word_key: target.key, expected_occurrence_id: target.occurrence, actual_word_keys: state.paintedWordKeys,
          actual_occurrence_id: state.occurrenceId, actual_mode: state.mode, held: state.held,
          passed: state.ayah === target.ayah && state.mode === target.mode && state.occurrenceId === target.occurrence &&
            (target.key === null ? state.paintedWordKeys.length === 0 : state.paintedWordKeys.length === 1 && state.paintedWordKeys[0] === target.key),
          painted_words: state.paintedWords, ...image });
      },
    });
    const correlation = await measureRenderV2AudioSync(options.outputPath, audio, manifest.timeline.sourceWindow.fromMs, options.signal);
    const black = await countRenderV2BlackFrames(options.outputPath, options.signal);
    const fontProof = auditRenderV2CorpusFonts(manifest.canonicalAyahRange.ayahs.flatMap(ayah => ayah.words.map(word => word.text)));
    const selectedFont = fontProof.fonts.find(font => font.family === manifest.options.fontFamily)!;
    const rss = memory.finish(); memoryFinished = true;
    const transitionErrors = manifest.timeline.ayahs.flatMap(ayah => ayah.words.map(word => {
      const firstPaint = transitions.find(event => event.occurrence_id === word.occurrenceId && event.word_keys.includes(word.canonicalWordKey));
      return firstPaint ? Math.abs(firstPaint.time_ms - word.startMs) : Number.POSITIVE_INFINITY;
    }));
    const maxTransitionError = transitionErrors.length ? Math.max(...transitionErrors) : 0;
    const duration = result.probe.video?.durationSeconds ?? result.durationSeconds;
    const tolerance = 1000 / manifest.options.fps, difference = Math.abs(duration * 1000 - manifest.timeline.durationMs);
    const failures: string[] = [];
    if (difference > tolerance + .001) failures.push('VIDEO_DURATION_OUTSIDE_ONE_FRAME');
    if (black.black !== 0) failures.push('BLACK_FRAMES_DETECTED');
    if (black.frames !== result.totalFrames) failures.push('VIDEO_FRAME_COUNT_MISMATCH');
    if (golden.length !== [...targets.values()].reduce((n, entries) => n + entries.length, 0) || golden.some(frame => !frame.passed)) failures.push('GOLDEN_HIGHLIGHT_MISMATCH');
    if (!correlation.passed) failures.push('AUDIO_SYNC_CORRELATION_FAILED');
    if (maxTransitionError > tolerance + .001) failures.push('HIGHLIGHT_TRANSITION_OUTSIDE_ONE_FRAME');
    if (externalAssets !== 0) failures.push('EXTERNAL_ASSET_REQUEST_DETECTED');
    if (!selectedFont.passed) failures.push('TOFU_GLYPHS_DETECTED');
    if (rss.limit !== null && rss.total > rss.limit) failures.push('WORKER_MEMORY_LIMIT_EXCEEDED');
    const { rawStreams: _raw, ...probe } = result.probe;
    const qaReport: RenderV2QaReport = { schema_version: 'd7-qa-1', passed: failures.length === 0, failures,
      expected_duration_ms: manifest.timeline.durationMs, video_duration_ms: duration * 1000, duration_difference_ms: difference, duration_tolerance_ms: tolerance,
      ffprobe: probe, black_frames: black.black, black_scan_frames: black.frames, golden_frames: golden, highlighting_transitions: transitions,
      highlighting_transition_max_error_ms: Number.isFinite(maxTransitionError) ? maxTransitionError : -1,
      audio_correlation: correlation, audio_bytes_fetched: audio.audioBytesFetched, audio_reference_bytes_fetched: audio.referenceBytesFetched,
      audio_total_qa_bytes_fetched: audio.audioBytesFetched + audio.referenceBytesFetched, audio_source_size_bytes: audio.sourceSizeBytes,
      audio_range_supported: audio.rangeSupported, audio_full_download_fallback: audio.fullDownloadFallback, warnings: audio.warnings,
      audio_requests: audio.requests, external_asset_requests: externalAssets,
      render_time_ms: performance.now() - started, peak_worker_rss_bytes: rss.worker, peak_worker_and_children_rss_bytes: rss.total,
      memory_limit_bytes: rss.limit, memory_sample_interval_ms: 100, selected_font: manifest.options.fontFamily, font_assets_local: true,
      memory_measurement_scope: process.platform === 'linux' ? 'linux_worker_and_children_sampled_rss' : 'worker_only_children_unavailable',
      tofu_glyphs: selectedFont.missing.length };
    await fs.promises.writeFile(`${options.outputPath}.qa.json`, JSON.stringify(qaReport, null, 2) + '\n');
    if (!qaReport.passed) throw new RenderV2QaError(qaReport);
    return { ...result, qaReport, audioBytesFetched: audio.audioBytesFetched };
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    // Underlying legacy renderer messages may contain paths. Only a fixed code escapes this v2 boundary.
    throw new CatalogError('RENDER_V2_FAILED', 502);
  } finally {
    stopObserving();
    if (!memoryFinished) memory.finish();
    await fs.promises.rm(scratch, { recursive: true, force: true });
  }
}

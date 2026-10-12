import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { RenderManifestV2 } from '../models/renderManifestV2';
import type { NativeFrameState } from '../renderer/nativeSceneRenderer';
import { probeMediaFile, type AudioStreamInfo, type MediaProbeResult } from './mediaProbeService';
import type { PreparedRenderV2Audio } from './renderV2Audio';
import { CatalogError } from './catalogContracts';
import { getFfmpegBinary } from './ffmpegBinary';
import { runRenderV2Process } from './renderV2Process';

export interface GoldenFrameProof {
  frame_index: number; time_ms: number; ayah: number; expected_word_key: string | null;
  expected_occurrence_id: string | null; actual_word_keys: string[]; actual_occurrence_id: string | null;
  actual_mode: 'word' | 'ayah'; held: boolean; passed: boolean; png?: string; png_sha256?: string;
  painted_words: NativeFrameState['paintedWords'];
}
export interface RenderV2QaReport {
  schema_version: 'd7-qa-1'; passed: boolean; failures: string[];
  expected_duration_ms: number; video_duration_ms: number; duration_difference_ms: number; duration_tolerance_ms: number;
  ffprobe: Omit<MediaProbeResult, 'rawStreams'>; black_frames: number; black_scan_frames: number;
  golden_frames: GoldenFrameProof[]; highlighting_transitions: Array<{ time_ms: number; word_keys: string[]; occurrence_id: string | null; ayah: number; mode: string }>;
  highlighting_transition_max_error_ms: number;
  audio_correlation: { score: number; lag_ms: number; sample_rate: number; compared_samples: number; duration_difference_ms: number; duration_tolerance_ms: number; method: string; passed: boolean; declared_audio_duration_ms?: number; untrimmed_decoded_duration_ms?: number; aac_padding_trimmed_ms?: number };
  audio_bytes_fetched: number; audio_reference_bytes_fetched: number; audio_total_qa_bytes_fetched: number;
  audio_source_size_bytes: number; audio_range_supported: boolean; audio_full_download_fallback: boolean; warnings: string[];
  audio_seek_method: PreparedRenderV2Audio['seekMethod'];
  audio_fetch_to_source_size_ratio: number; audio_clip_to_source_duration_ratio: number; audio_range_efficiency_passed: boolean | null;
  audio_requests: PreparedRenderV2Audio['requests']; external_asset_requests: number;
  render_time_ms: number; peak_worker_rss_bytes: number; peak_worker_and_children_rss_bytes: number; memory_limit_bytes: number | null; memory_sample_interval_ms: number;
  memory_measurement_scope: 'linux_worker_and_children_sampled_rss' | 'worker_only_children_unavailable';
  selected_font: string; font_assets_local: true;
  tofu_glyphs: number;
}
export class RenderV2QaError extends CatalogError {
  constructor(public readonly qaReport: RenderV2QaReport) { super('RENDER_V2_QA_FAILED', 422, { failures: qaReport.failures }); }
}
export function buildGoldenTargets(manifest: RenderManifestV2): Map<number, Array<{ ayah: number; key: string | null; occurrence: string | null; mode: 'word'|'ayah' }>> {
  const targets = new Map<number, Array<{ ayah: number; key: string | null; occurrence: string | null; mode: 'word'|'ayah' }>>();
  const add = (timeMs: number, item: { ayah: number; key: string | null; occurrence: string | null; mode: 'word'|'ayah' }) => {
    const frame = Math.min(Math.ceil(manifest.timeline.durationMs * manifest.options.fps / 1000) - 1, Math.round(timeMs * manifest.options.fps / 1000));
    targets.set(frame, [...(targets.get(frame) ?? []), item]);
  };
  for (const ayah of manifest.timeline.ayahs) {
    if (ayah.highlightMode === 'ayah') add((ayah.startMs + ayah.endMs) / 2, { ayah: ayah.ayah, key: null, occurrence: null, mode: 'ayah' });
    else for (const word of ayah.words) add((word.startMs + word.endMs) / 2, { ayah: ayah.ayah, key: word.canonicalWordKey, occurrence: word.occurrenceId, mode: 'word' });
  }
  return targets;
}
export function rawPcmCorrelation(reference: Int16Array, actual: Int16Array, sampleRate = 16_000, durationToleranceMs = 1000 / 30): RenderV2QaReport['audio_correlation'] {
  if (reference.length < sampleRate / 10 || actual.length < sampleRate / 10) throw new CatalogError('RENDER_V2_AUDIO_REFERENCE_TOO_SHORT', 422);
  const bound = Math.round(sampleRate * .150), length = Math.min(reference.length, actual.length);
  // Fixed interior sample positions, same for every lag; centered raw PCM NCC.
  const stride = Math.max(1, Math.floor(length / 20_000));
  const scoreAt = (lag: number) => {
    let n = 0, left = 0, right = 0, squareLeft = 0, squareRight = 0, product = 0;
    for (let i = bound; i < length - bound; i += stride) {
      const a = reference[i], b = actual[i + lag];
      left += a; right += b; squareLeft += a*a; squareRight += b*b; product += a*b; n++;
    }
    const denominator = Math.sqrt((n*squareLeft - left*left) * (n*squareRight - right*right));
    return { score: denominator > 0 ? (n*product - left*right) / denominator : 0, count: n };
  };
  let bestLag = 0, best = scoreAt(0);
  const coarseStep = 1;
  for (let lag = -bound; lag <= bound; lag += coarseStep) { const result = scoreAt(lag); if (result.score > best.score) { best = result; bestLag = lag; } }
  const center = bestLag;
  for (let lag = Math.max(-bound, center - coarseStep); lag <= Math.min(bound, center + coarseStep); lag++) { const result = scoreAt(lag); if (result.score > best.score) { best = result; bestLag = lag; } }
  const lagMs = bestLag * 1000 / sampleRate;
  const durationDifferenceMs = Math.abs(reference.length - actual.length) * 1000 / sampleRate;
  return { score: best.score, lag_ms: lagMs, sample_rate: sampleRate, compared_samples: best.count, duration_difference_ms: durationDifferenceMs, duration_tolerance_ms: durationToleranceMs, method: 'centered_raw_pcm_ncc_full_decode_independent_reference', passed: best.score >= .95 && Math.abs(lagMs) <= 40 && durationDifferenceMs <= durationToleranceMs + .001 };
}
function numericFile(file: string): number | null {
  if (!fs.existsSync(file)) return null;
  const value = fs.readFileSync(file, 'utf8').trim();
  if (value === 'max') return null;
  const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function linuxRss(pid: number): number {
  try { return Number(/^VmRSS:\s+(\d+)\s+kB$/mu.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ESRCH'].includes(String(error.code))) return 0; throw error; }
}
export function beginRenderV2MemoryMonitor(): { child: (child: ChildProcess) => void; finish: () => { worker: number; total: number; limit: number | null } } {
  const children = new Set<number>(); let peakWorker = 0, peakTotal = 0;
  const sample = () => { const worker = process.memoryUsage().rss; peakWorker = Math.max(peakWorker, worker); const childRss = process.platform === 'linux' ? [...children].reduce((n, pid) => n + linuxRss(pid), 0) : 0; peakTotal = Math.max(peakTotal, worker + childRss); };
  sample(); const timer = setInterval(sample, 100);
  return { child: child => { if (child.pid) { children.add(child.pid); child.once('close', () => children.delete(child.pid!)); sample(); } }, finish: () => {
    clearInterval(timer); sample();
    const configured = Number(process.env.RENDER_MEMORY_LIMIT_MB);
    const limit = configured > 0 ? configured * 1024 * 1024 : numericFile('/sys/fs/cgroup/memory.max') ?? numericFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    return { worker: peakWorker, total: peakTotal, limit };
  } };
}
/** MP4 declares the audible AAC duration; a decoder can emit its last padded block.
 * Only remove a bounded final AAC block, and independently check declared duration.
 * Truncation, other codecs and excessive tails retain the original duration guard.
 */
export function correlateRenderV2DecodedAudio(reference: Int16Array, decoded: Int16Array, stream: AudioStreamInfo | null, durationToleranceMs: number): RenderV2QaReport['audio_correlation'] {
  if (!stream || !Number.isFinite(stream.durationSeconds) || stream.durationSeconds <= 0) throw new CatalogError('RENDER_V2_AUDIO_DURATION_UNAVAILABLE', 422);
  const sampleRate = 16_000, declaredMs = stream.durationSeconds * 1000;
  const declaredSamples = Math.round(stream.durationSeconds * sampleRate);
  const paddingSamples = decoded.length - declaredSamples;
  const boundedPadding = stream.codec === 'aac' && stream.sampleRate > 0 && paddingSamples >= 0 && paddingSamples <= Math.ceil(1024 * sampleRate / stream.sampleRate) + 1;
  const actual = boundedPadding ? decoded.subarray(0, declaredSamples) : decoded;
  const result = rawPcmCorrelation(reference, actual, sampleRate, durationToleranceMs);
  return { ...result, declared_audio_duration_ms: declaredMs, untrimmed_decoded_duration_ms: decoded.length * 1000 / sampleRate,
    aac_padding_trimmed_ms: boundedPadding ? paddingSamples * 1000 / sampleRate : 0,
    passed: result.passed && Math.abs(reference.length * 1000 / sampleRate - declaredMs) <= durationToleranceMs + .001 };
}
export async function measureRenderV2AudioSync(outputPath: string, audio: PreparedRenderV2Audio, sourceFromMs: number, signal?: AbortSignal, durationToleranceMs = 1000 / 30): Promise<RenderV2QaReport['audio_correlation']> {
  const probe = await probeMediaFile(outputPath);
  const { stdout } = await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-v', 'error', '-threads', '1', '-i', outputPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { signal, outputLimitBytes: 4_000_000 });
  const source = await fs.promises.open(audio.referencePcmPath, 'r');
  const wanted = Math.round(audio.durationMs * 16_000 / 1000) * 2, reference = Buffer.alloc(wanted);
  try { const { bytesRead } = await source.read(reference, 0, wanted, Math.round(sourceFromMs * 16_000 / 1000) * 2); if (bytesRead !== wanted) throw new CatalogError('RENDER_V2_AUDIO_REFERENCE_TRUNCATED', 422); }
  finally { await source.close(); }
  const int16 = (bytes: Buffer) => { const samples = new Int16Array(Math.floor(bytes.length / 2)); for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i*2); return samples; };
  return correlateRenderV2DecodedAudio(int16(reference), int16(stdout), probe.audio, durationToleranceMs);
}
/** Decode every full-resolution frame. Maximum luma preserves small text on black. */
export async function countRenderV2BlackFrames(outputPath: string, signal?: AbortSignal): Promise<{ black: number; frames: number }> {
  const result = await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-v', 'error', '-threads', '1', '-i', outputPath, '-map', '0:v:0', '-an', '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-'], { signal, outputLimitBytes: 2_000_000 });
  const maxima = [...result.stdout.toString('utf8').matchAll(/lavfi\.signalstats\.YMAX=(\d+)/gu)].map(match => Number(match[1]));
  if (!maxima.length) throw new CatalogError('RENDER_V2_BLACK_SCAN_EMPTY', 502);
  // Limited-range luma black is 16; tolerance covers encoder rounding only.
  return { black: maxima.filter(value => value <= 20).length, frames: maxima.length };
}
export async function writeGoldenPng(directory: string, frame: number, bytes: Buffer): Promise<{ png: string; png_sha256: string }> {
  await fs.promises.mkdir(directory, { recursive: true });
  const filename = `frame-${String(frame).padStart(6, '0')}.png`;
  await fs.promises.writeFile(path.join(directory, filename), bytes);
  return { png: filename, png_sha256: createHash('sha256').update(bytes).digest('hex') };
}

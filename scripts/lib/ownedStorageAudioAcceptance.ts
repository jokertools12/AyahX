import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CatalogError } from '../../server/services/catalogContracts';
import { getFfmpegBinary, getFfprobeBinary } from '../../server/services/ffmpegBinary';
import { assertLicensedOffsetEvidence, type LicensedOffsetEvidence, type LicensedOffsetVerifier } from '../../server/services/licensedAudioVerification';
import { toRenderTimeline, type SourceAyahTiming } from '../../shared/timing/toRenderTimeline';
import type { StorageAudioPlan } from '../../server/services/licensedSourceResolver';

export const OWNED_SAMPLE_RATE = 8000;
export function ownedNoiseWav(dataBytes: number, seed: number): Buffer {
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 16000 || dataBytes % 2) throw new CatalogError('OWNED_FIXTURE_INVALID', 422);
  const b = Buffer.alloc(dataBytes + 44); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(OWNED_SAMPLE_RATE, 24); b.writeUInt32LE(OWNED_SAMPLE_RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  // Aperiodic, independently seeded owned noise avoids sine-wave lag ambiguity.
  let state = seed >>> 0;
  for (let i = 44; i < b.length; i += 2) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; b.writeInt16LE((state >>> 16) - 32768, i); }
  return b;
}
export async function mediaCommand(binary: string, args: string[], maxBytes = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let bytes = 0; let diagnostic = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new CatalogError('STORAGE_TEST_MEDIA_TIMEOUT', 500)); }, 60000);
    child.stdout.on('data', (b: Buffer) => { bytes += b.length; if (bytes > maxBytes) { child.kill('SIGKILL'); reject(new CatalogError('STORAGE_TEST_MEDIA_LIMIT', 500)); } else chunks.push(b); });
    child.stderr.on('data', () => { diagnostic = true; });
    child.once('error', () => { clearTimeout(timer); reject(new CatalogError('STORAGE_TEST_MEDIA_UNAVAILABLE', 503)); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || diagnostic) reject(new CatalogError('STORAGE_TEST_MEDIA_FAILED', 500)); else resolve(Buffer.concat(chunks)); });
  });
}
export async function decodeOwnedWindow(file: string, startMs: number, durationMs: number): Promise<Buffer> {
  return mediaCommand(getFfmpegBinary(), ['-v', 'error', '-nostdin', '-ss', String(startMs / 1000), '-i', file, '-t', String(durationMs / 1000), '-map', '0:a:0', '-ac', '1', '-ar', String(OWNED_SAMPLE_RATE), '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']);
}
/** Raw, unrounded mean-centered NCC; search includes lags outside the acceptance band. */
export function measureOwnedOffset(reference: Buffer, candidate: Buffer): { ncc: number; lagMs: number; durationDifferenceMs: number } {
  if (reference.length < 12480 || candidate.length < 12480 || reference.length % 2 || candidate.length % 2) throw new CatalogError('STORAGE_TEST_PCM_INVALID', 422);
  const samples = 3200, interior = 2400, radius = 640;
  const ref = Array.from({ length: samples }, (_, i) => reference.readInt16LE((interior + i) * 2));
  const mean = ref.reduce((a, b) => a + b, 0) / samples;
  const centered = ref.map(x => x - mean), power = centered.reduce((a, b) => a + b * b, 0);
  if (!power || candidate.length / 2 < interior + samples + radius) throw new CatalogError('STORAGE_TEST_PCM_INVALID', 422);
  let best = -Infinity, bestLag = 0;
  for (let lag = -radius; lag <= radius; lag++) {
    let sum = 0, sq = 0, dot = 0;
    for (let i = 0; i < samples; i++) { const value = candidate.readInt16LE((interior + i + lag) * 2); sum += value; sq += value * value; dot += centered[i] * value; }
    const variance = sq - sum * sum / samples, ncc = variance > 0 ? dot / Math.sqrt(power * variance) : -Infinity;
    if (ncc > best) { best = ncc; bestLag = lag; }
  }
  if (!Number.isFinite(best)) throw new CatalogError('STORAGE_TEST_PCM_INVALID', 422);
  return { ncc: Math.min(1, best), lagMs: bestLag * 1000 / OWNED_SAMPLE_RATE, durationDifferenceMs: (candidate.length - reference.length) * 500 / OWNED_SAMPLE_RATE };
}
export interface OwnedChapter { surah: number; originalPath: string; downloadedPath: string; durationMs: number; sha256: string }
/** Real measured fixture verifier, never a production QUD offset engine. */
export function ownedFixtureOffsetVerifier(chapters: readonly OwnedChapter[]): LicensedOffsetVerifier {
  return { async verify(input) {
    const chapter = chapters.find(c => c.surah === input.surah);
    if (!chapter || chapter.sha256 !== input.sha256 || input.recitationId !== 'owned-test-fixture' || chapters.length !== 3 || new Set(chapters.map(c => c.surah)).size !== 3) throw new CatalogError('STORAGE_TEST_REFERENCE_INVALID', 422);
    const samples: LicensedOffsetEvidence['samples'] = [];
    for (const c of chapters) {
      const count = c.surah + 4;
      const starts = [0, Math.floor((c.durationMs - 1000) / 2), Math.floor(c.durationMs - 1000)];
      for (const [index, from] of starts.entries()) {
        const reference = await decodeOwnedWindow(c.originalPath, from, 1000);
        const candidate = await decodeOwnedWindow(c.surah === input.surah ? input.localPath : c.downloadedPath, from, 1000);
        samples.push({ surah: c.surah, ayah: [1, Math.ceil(count / 2), count][index], chapterAyahCount: count, ...measureOwnedOffset(reference, candidate) });
      }
    }
    const origin = samples.find(s => s.surah === input.surah && s.ayah === 1)!;
    // This generated standalone WAV has a measured matching sample-zero origin.
    // A displaced candidate cannot be declared a chapter-owned zero offset.
    if (origin.lagMs !== 0) throw new CatalogError('STORAGE_TEST_CHAPTER_ORIGIN_CHANGED', 409);
    const proof: LicensedOffsetEvidence = { method: 'v1', recitationId: input.recitationId, sourceSha256: input.sha256, sourceSurah: input.surah, sourceChapterOffsetMs: origin.lagMs, qudVersion: 'v0.0.0', protocol: 'distributed_3_surahs_interior_300ms', samples };
    assertLicensedOffsetEvidence(proof, input.recitationId, input.sha256, input.surah); return proof;
  } };
}
export function ownedTimings(durationMs: number): SourceAyahTiming[] {
  return [{ ayah: 1, coordinate: 'chapter_ms', source: 'owned_acceptance_fixture', source_offset_ms: null, words: [[1, 0, 0, Math.floor(durationMs)]] }];
}
export async function renderOwnedPlan(plan: StorageAudioPlan, localPath: string, outputPath: string): Promise<Record<string, unknown>> {
  assertLicensedOffsetEvidence(plan.offsetEvidence, plan.recitationId, plan.sha256, plan.surah);
  const timeline = toRenderTimeline([{ ayah: 1, coordinate: 'chapter_ms', source: 'owned_acceptance_fixture', source_offset_ms: null, words: [[1, 0, 300, 2300]] }], { chapterOffsetMs: plan.sourceChapterOffsetMs, sourceFormat: 'absolute_source', padMs: 0 });
  await mediaCommand(getFfmpegBinary(), ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=black:s=160x284:r=10', '-ss', String(timeline.sourceWindow.fromMs / 1000), '-i', localPath, '-t', String(timeline.durationMs / 1000), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads:v', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outputPath]);
  const probe = JSON.parse((await mediaCommand(getFfprobeBinary(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath])).toString('utf8')) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
  if (!probe.streams.some(s => s.codec_type === 'audio') || !probe.streams.some(s => s.codec_type === 'video') || Math.abs(Number(probe.format.duration) * 1000 - timeline.durationMs) > 150) throw new CatalogError('STORAGE_TEST_RENDER_INVALID', 500);
  return { kind: plan.kind, source_sha256: plan.sha256, source_window_ms: timeline.sourceWindow, duration_ms: Number(probe.format.duration) * 1000, sha256: createHash('sha256').update(await readFile(outputPath)).digest('hex'), audio_and_video: true, actual_ffmpeg: true, synthetic_only: true };
}

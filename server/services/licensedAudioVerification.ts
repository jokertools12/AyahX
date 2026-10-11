import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CatalogError } from './catalogContracts';
import { getFfprobeBinary } from './ffmpegBinary';
import { assertStorageSize, type AudioObjectStorage, type AudioObjectSpec } from './catalogStorageContracts';
import { toRenderTimeline, type SourceAyahTiming } from '../../shared/timing/toRenderTimeline';

export interface ProbedAudio { durationMs: number; sampleRate: number; bitrate: number | null; channels: number; codec: string; contentType: string }
export type OffsetSampleEvidence = { surah: number; ayah: number; chapterAyahCount: number; ncc: number; durationDifferenceMs: number; lagMs: number; vadAgreement?: number };
export interface LicensedOffsetEvidence {
  method: 'v1' | 'v2'; sourceSha256: string; recitationId: string; qudVersion: string;
  sourceSurah: number; sourceChapterOffsetMs: number;
  samples: OffsetSampleEvidence[]; protocol: 'distributed_3_surahs_interior_300ms';
  v2Acceptance?: { cause: 'codec_processing_only'; decision: 'accepted_for_data_pipeline_verification'; reviewBlockers: string[]; evidenceSha256: string; humanReviewId: string };
}
/** Must be produced by a server-side engine, never passed through from browser input. */
export interface LicensedOffsetVerifier { verify(input: { recitationId: string; surah: number; localPath: string; sha256: string }): Promise<LicensedOffsetEvidence> }
export function assertLicensedOffsetEvidence(proof: LicensedOffsetEvidence, recitationId: string, sha256: string, surah?: number): void {
  if (!proof || !['v1', 'v2'].includes(proof.method) || proof.recitationId !== recitationId || proof.sourceSha256 !== sha256 || !Number.isSafeInteger(proof.sourceSurah) || proof.sourceSurah < 1 || proof.sourceSurah > 114 || (surah !== undefined && proof.sourceSurah !== surah) || !Number.isSafeInteger(proof.sourceChapterOffsetMs) || proof.sourceChapterOffsetMs < 0 || !/^v\d+\.\d+\.\d+$/u.test(proof.qudVersion) || proof.protocol !== 'distributed_3_surahs_interior_300ms' || !Array.isArray(proof.samples) || proof.samples.length < 5) throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED', 409);
  const surahs = new Set<number>(), lengths = new Set<number>(), keys = new Set<string>();
  for (const s of proof.samples) {
    if (![s.surah, s.ayah, s.chapterAyahCount].every(Number.isSafeInteger) || s.surah < 1 || s.surah > 114 || s.ayah < 1 || s.ayah > s.chapterAyahCount || keys.has(`${s.surah}:${s.ayah}`) || ![s.ncc, s.durationDifferenceMs, s.lagMs].every(Number.isFinite) || s.ncc > 1 || s.ncc < (proof.method === 'v1' ? .95 : .90) || Math.abs(s.durationDifferenceMs) > 30 || Math.abs(s.lagMs) > 30) throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED', 409);
    if (proof.method === 'v2' && (typeof s.vadAgreement !== 'number' || !Number.isFinite(s.vadAgreement) || s.vadAgreement < .9 || s.vadAgreement > 1)) throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED', 409);
    surahs.add(s.surah); lengths.add(s.chapterAyahCount); keys.add(`${s.surah}:${s.ayah}`);
  }
  if (surahs.size < 3 || lengths.size < 3) throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED', 409);
  if (proof.method === 'v2' && (!proof.v2Acceptance || proof.v2Acceptance.cause !== 'codec_processing_only' || proof.v2Acceptance.decision !== 'accepted_for_data_pipeline_verification' || !Array.isArray(proof.v2Acceptance.reviewBlockers) || proof.v2Acceptance.reviewBlockers.length !== 0 || !/^[a-f0-9]{64}$/u.test(proof.v2Acceptance.evidenceSha256) || !proof.v2Acceptance.humanReviewId)) throw new CatalogError('LICENSED_V2_REQUIRES_HUMAN_ACCEPTANCE', 409);
}
/** Extension is never used to recognize media. Container + streams must agree. */
export function audioMagic(bytes: Buffer): 'mp3' | 'mp4' | 'aac' | 'ogg' | 'flac' | 'wav' {
  if (bytes.length < 12) throw new CatalogError('AUDIO_MAGIC_INVALID', 422);
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'mp3';
  throw new CatalogError('AUDIO_MAGIC_INVALID', 422);
}
export function parseAudioProbe(raw: unknown, magic: ReturnType<typeof audioMagic>): ProbedAudio {
  const value = raw as { format?: { format_name?: string; duration?: string; bit_rate?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string; duration?: string }> };
  if (!value || !Array.isArray(value.streams) || value.streams.some(s => s.codec_type !== 'audio') || value.streams.length !== 1) throw new CatalogError('AUDIO_STREAMS_INVALID', 422);
  const audio = value.streams[0], format = value.format?.format_name ?? '';
  const codecs: Record<string, string[]> = { mp3: ['mp3'], mp4: ['aac', 'alac'], aac: ['aac'], ogg: ['opus', 'vorbis', 'flac'], flac: ['flac'], wav: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8'] };
  const demuxers: Record<string, string[]> = { mp3: ['mp3'], mp4: ['mov', 'mp4', 'm4a'], aac: ['aac'], ogg: ['ogg'], flac: ['flac'], wav: ['wav'] };
  const durationMs = Number(value.format?.duration ?? audio.duration) * 1000, sampleRate = Number(audio.sample_rate), channels = Number(audio.channels), bitrate = Number(audio.bit_rate ?? value.format?.bit_rate);
  if (!codecs[magic].includes(audio.codec_name ?? '') || !format.split(',').some(n => demuxers[magic].includes(n)) || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || !Number.isSafeInteger(channels) || channels < 1 || channels > 8) throw new CatalogError('AUDIO_PROBE_INVALID', 422);
  return { durationMs, sampleRate, channels, codec: audio.codec_name!, bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null, contentType: { mp3: 'audio/mpeg', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' }[magic] };
}
export async function probeLicensedAudio(file: string, magic: ReturnType<typeof audioMagic>): Promise<ProbedAudio> {
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(getFfprobeBinary(), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,mov,aac,ogg,flac,wav', '-show_streams', '-show_format', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', bytes = 0, diagnosticBytes = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new CatalogError('AUDIO_PROBE_TIMEOUT', 422)); }, 60000);
    child.stdout.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 1024 * 1024) { child.kill('SIGKILL'); reject(new CatalogError('AUDIO_PROBE_LIMIT', 422)); } else out += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { diagnosticBytes += b.length; });
    child.once('error', () => { clearTimeout(timer); reject(new CatalogError('AUDIO_PROBE_UNAVAILABLE', 503)); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || diagnosticBytes) reject(new CatalogError('AUDIO_PROBE_FAILED', 422)); else resolve(out); });
  });
  try { return parseAudioProbe(JSON.parse(raw), magic); } catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError('AUDIO_PROBE_INVALID', 422); }
}
export interface LicensedVerificationInput { spec: AudioObjectSpec; recitationId: string; surah: number; timings: readonly SourceAyahTiming[]; scratchRoot: string }
export interface LicensedVerificationResult extends ProbedAudio { sha256: string; sizeBytes: number; offset: LicensedOffsetEvidence; warnings: string[] }
/** Bounded stream; a client checksum/HEAD/ETag can never grant verified status. */
export async function verifyLicensedAudio(storage: AudioObjectStorage, input: LicensedVerificationInput, engine: LicensedOffsetVerifier): Promise<LicensedVerificationResult> {
  assertStorageSize(input.spec.sizeBytes);
  if (!Array.isArray(input.timings) || !input.timings.length) throw new CatalogError('LICENSED_TIMINGS_UNAVAILABLE', 409);
  const head = await storage.head(input.spec.objectKey);
  if (!head || head.sizeBytes !== input.spec.sizeBytes) throw new CatalogError('AUDIO_UPLOAD_TRUNCATED', 422);
  await mkdir(input.scratchRoot, { recursive: true }); const root = await realpath(input.scratchRoot);
  const file = path.join(root, `licensed-verify-${randomUUID()}.audio`);
  const { body } = await storage.read(input.spec.objectKey); const hash = createHash('sha256'); let sizeBytes = 0, prefix = Buffer.alloc(0);
  const inspect = new Transform({ transform(chunk: Buffer, _encoding, done) {
    sizeBytes += chunk.length;
    if (sizeBytes > input.spec.sizeBytes) { done(new CatalogError('AUDIO_UPLOAD_OVERSIZED', 422)); return; }
    hash.update(chunk); if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.length)]); done(null, chunk);
  } });
  try { await pipeline(body, inspect, createWriteStream(file, { flags: 'wx', mode: 0o600 })); }
  catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError('AUDIO_VERIFICATION_STREAM_FAILED', 502); }
  if (sizeBytes !== input.spec.sizeBytes || (await stat(file)).size !== sizeBytes) throw new CatalogError('AUDIO_UPLOAD_TRUNCATED', 422);
  const sha256 = hash.digest('hex'); if (sha256 !== input.spec.sha256) throw new CatalogError('AUDIO_SHA256_MISMATCH', 422);
  const audio = await probeLicensedAudio(file, audioMagic(prefix));
  const offset = await engine.verify({ recitationId: input.recitationId, surah: input.surah, localPath: file, sha256 });
  assertLicensedOffsetEvidence(offset, input.recitationId, sha256, input.surah);
  let lastWordInSourceMs: number;
  try { lastWordInSourceMs = toRenderTimeline(input.timings, { chapterOffsetMs: offset.sourceChapterOffsetMs, sourceFormat: 'qud_release', padMs: 0 }).sourceWindow.toMs; }
  catch (error) { if (error instanceof Error && error.message.startsWith('TIMELINE_')) throw new CatalogError('LICENSED_TIMING_COORDINATES_INVALID', 409); throw error; }
  // Reject before the caller can mark verified or replace an existing source.
  if (lastWordInSourceMs > audio.durationMs + 30) throw new CatalogError('LICENSED_TIMING_COORDINATES_INVALID', 409);
  const warnings = Math.abs(audio.durationMs - lastWordInSourceMs) / lastWordInSourceMs > .05 ? ['DURATION_DIFFERS_FROM_LAST_WORD_OVER_5_PERCENT'] : [];
  // This task intentionally retains private scratch files: no filesystem cleanup
  // after the user's denial. Render lifecycle ownership/cleanup belongs to D8.
  return { ...audio, sha256, sizeBytes, offset, warnings };
}

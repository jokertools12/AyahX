/** Root-operated, read-only legacy renderer proof. Never admitted as a user job. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../server/db';
import { RenderManifestSchema } from '../server/models/renderManifest';
import { renderDeterministicVideo } from '../server/services/deterministicVideoRenderer';
import { getFfmpegBinary, getFfprobeBinary } from '../server/services/ffmpegBinary';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function command(binary: string, args: string[], cap = 64 * 1024 * 1024): Promise<Buffer> {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const chunks: Buffer[] = [];
  let size = 0, exceeded = false;
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > cap) { exceeded = true; child.kill('SIGKILL'); }
    else chunks.push(chunk);
  });
  // Provider-free commands can still print private filesystem paths: consume, never expose.
  child.stderr.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('LEGACY_PROOF_CHILD_START_FAILED')));
      child.once('close', code => code === 0 && !exceeded ? resolve() : reject(new Error('LEGACY_PROOF_CHILD_FAILED')));
    });
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}
function sync(reference: Buffer, actual: Buffer) {
  const floats = (bytes: Buffer) => Array.from({ length: Math.floor(bytes.length / 4) }, (_, i) => bytes.readFloatLE(i * 4));
  const a = floats(reference), b = floats(actual);
  let best = -1, bestLag = 0;
  for (let lag = -240; lag <= 240; lag++) {
    let aa = 0, bb = 0, ab = 0;
    const start = Math.max(0, -lag), end = Math.min(a.length, b.length - lag);
    for (let i = start; i < end; i++) { aa += a[i] * a[i]; bb += b[i + lag] * b[i + lag]; ab += a[i] * b[i + lag]; }
    const ncc = ab / Math.sqrt(aa * bb);
    if (ncc > best) { best = ncc; bestLag = lag; }
  }
  return { ncc: best, lag_ms: bestLag * 1000 / 6000 };
}
async function main() {
  assert.ok(process.argv.includes('--root-operated'), 'LEGACY_PROOF_ROOT_OPERATION_REQUIRED');
  assert.notEqual(process.env.RENDER_SIMULATE, '1', 'LEGACY_PROOF_SIMULATION_FORBIDDEN');
  const scratch = await mkdtemp(join(tmpdir(), 'ayahx-d7-legacy-owned-'));
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT a.text_uthmani FROM quran_ayahs a JOIN quran_text_versions v ON v.id=a.text_version_id JOIN riwayat r ON r.id=v.riwayah_id WHERE v.is_active=1 AND r.code='hafs_an_asim' AND a.surah=1 AND a.ayah=1");
    assert.equal(rows.length, 1, 'LEGACY_PROOF_CANONICAL_TEXT_REQUIRED');
    const audio = join(scratch, 'owned-noise.wav'), output = join(scratch, 'legacy.mp4');
    await command(getFfmpegBinary(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:seed=73011:sample_rate=48000:duration=2.4', '-c:a', 'pcm_s16le', audio]);
    const audioBytes = await command(getFfmpegBinary(), ['-v', 'error', '-i', audio, '-f', 's16le', '-']);
    const manifest = RenderManifestSchema.parse({
      schemaVersion: '1.0.0', rendererVersion: '1.0.0', renderEngine: 'skia_canvas', revision: 'd7-owned-noise-legacy-proof-v1',
      aspectRatio: '9:16', outputDimensions: { width: 360, height: 640 }, fps: 30, qualityPreset: 'low', codecProfile: 'baseline',
      animationProfile: 'static', animationReducedMotion: true,
      reciter: { id: 'owned-noise-qa-fixture', name: 'اختبار صوت مملوك غير قرآني' },
      canonicalAyahRange: { surahNumber: 1, surahName: 'الفاتحة', startAyah: 1, endAyah: 1, ayahs: [{ numberInSurah: 1, text: String(rows[0].text_uthmani) }] },
      timingMap: { mapId: 'owned-noise-no-speech-timing', audioContentHash: hash(audioBytes), validationStatus: 'needs_review', words: [] },
      audio: { sourceMode: 'single_url', audioUrl: 'owned-noise-local.wav', audioContentHash: hash(audioBytes), durationSeconds: 2.4 },
      background: { id: 'owned-noise-proof-solid', type: 'color', url: '#102321', overlayOpacity: 0.4, shadowIntensity: 0.5, motionSpeed: 3 },
      typography: { fontFamily: 'Amiri', fontSize: 28, textColor: '#ffffff', shadowIntensity: 0, overlayOpacity: 0.4 },
      displaySettings: { showAyahText: true, showAyahNumber: false, showSurahName: false, showReciterName: false, watermarkEnabled: false,
        highlightStyle: 'none', frameStyle: 'none', animationProfile: 'static', animationReducedMotion: true, ayahTransition: 'none', glowStyle: 'none' },
    });
    const started = Date.now();
    const result = await renderDeterministicVideo({ manifest, audioFilePath: audio, outputPath: output });
    const probe = JSON.parse((await command(getFfprobeBinary(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], 512_000)).toString('utf8'));
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    assert.ok(video && Number(video.nb_frames) >= 61, 'LEGACY_PROOF_VIDEO_FRAMES_REQUIRED');
    const rgb = await command(getFfmpegBinary(), ['-v', 'error', '-i', output, '-map', '0:v:0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    const frameBytes = 360 * 640 * 3, frameCount = rgb.length / frameBytes;
    assert.ok(Number.isInteger(frameCount), 'LEGACY_PROOF_PARTIAL_FRAME');
    let blackFrames = 0;
    for (let frame = 0; frame < frameCount; frame++) {
      const bytes = rgb.subarray(frame * frameBytes, (frame + 1) * frameBytes);
      let sum = 0; for (const value of bytes) sum += value;
      if (sum / frameBytes < 3) blackFrames++;
    }
    const frameHashes = [0, 30, 60].map(frame => ({ frame, rgb_sha256: hash(rgb.subarray(frame * frameBytes, (frame + 1) * frameBytes)) }));
    const png = await command(getFfmpegBinary(), ['-v', 'error', '-i', output, '-vf', 'select=eq(n\\,30)', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], 2 * 1024 * 1024);
    const pcmArgs = ['-vn', '-ac', '1', '-ar', '6000', '-f', 'f32le', '-'];
    const measuredSync = sync(await command(getFfmpegBinary(), ['-v', 'error', '-i', audio, ...pcmArgs]), await command(getFfmpegBinary(), ['-v', 'error', '-i', output, ...pcmArgs]));
    assert.ok(measuredSync.ncc >= 0.95 && Math.abs(measuredSync.lag_ms) <= 40, 'LEGACY_PROOF_AUDIO_SYNC_FAILED');
    assert.equal(blackFrames, 0, 'LEGACY_PROOF_BLACK_FRAME');
    assert.ok(Math.abs(Number(probe.format.duration) - 2.4) <= 1 / 30, 'LEGACY_PROOF_DURATION_FAILED');
    console.log(JSON.stringify({ passed: true, platform: process.platform, schema_version: manifest.schemaVersion, engine: manifest.renderEngine,
      sql_writes: 0, fixture: 'OWNED_NOISE_QA_NOT_QURAN_TIMING', canonical_text_sha256: hash(String(rows[0].text_uthmani)),
      manifest_sha256: hash(JSON.stringify(manifest)), audio_pcm_sha256: hash(audioBytes), duration_seconds: Number(probe.format.duration),
      frame_count: frameCount, renderer_total_frames: result.totalFrames, frame_hashes: frameHashes, black_frames: blackFrames,
      sync: measuredSync, elapsed_ms: Date.now() - started, video_bytes: result.fileSizeBytes,
      png_base64: png.toString('base64'), checked_at: new Date().toISOString() }));
  } finally {
    await pool.end();
    // Only this invocation's new mkdtemp directory, never historical files.
    await rm(scratch, { recursive: true, force: true });
  }
}
void main().catch(() => { console.error('D7_LEGACY_PROOF_FAILED'); process.exitCode = 1; });

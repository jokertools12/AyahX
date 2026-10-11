import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ownedNoiseWav, measureOwnedOffset, ownedFixtureOffsetVerifier, renderOwnedPlan, type OwnedChapter } from '../../scripts/lib/ownedStorageAudioAcceptance';
import { assertAcceptanceOptions, assertNoAcceptanceSecrets, lifecycleDayOne } from '../../scripts/test-licensed-audio-storage';
import { assertLicensedOffsetEvidence, audioMagic, probeLicensedAudio } from '../../server/services/licensedAudioVerification';
import type { StorageAudioPlan } from '../../server/services/licensedSourceResolver';
import { AcceptanceLogSecretScanner, acceptanceCredentialValues, runCapturedR2Acceptance } from '../../scripts/run-r2-storage-acceptance';

describe('owned audio measured offset, never an always-pass verifier', () => {
  const pcm = ownedNoiseWav(16000, 1729).subarray(44);
  it('finds the actual zero lag with raw NCC and duration', () => { const m = measureOwnedOffset(pcm, pcm); expect(m.ncc).toBeGreaterThanOrEqual(.999999); expect(m.lagMs).toBe(0); expect(m.durationDifferenceMs).toBe(0); });
  it('measures a rejected 40ms lag rather than assuming zero', () => { const shifted = Buffer.alloc(pcm.length); pcm.copy(shifted, 640); const m = measureOwnedOffset(pcm, shifted); expect(m.ncc).toBeGreaterThan(.99); expect(m.lagMs).toBe(40); });
  it('fails unrelated recordings', () => { const m = measureOwnedOffset(pcm, ownedNoiseWav(16000, 1730).subarray(44)); expect(m.ncc).toBeLessThan(.95); });
  it('reports actual sample-duration mismatch', () => { expect(measureOwnedOffset(pcm, Buffer.concat([pcm, Buffer.alloc(640)])).durationDifferenceMs).toBe(40); });
  it('rejects invalid short PCM with a safe code', () => { expect(() => measureOwnedOffset(Buffer.alloc(16), pcm)).toThrow('STORAGE_TEST_PCM_INVALID'); });
  it('does not round 0.949999997 across the accepted boundary', () => {
    expect(() => assertLicensedOffsetEvidence({ method: 'v1', recitationId: 'x', sourceSha256: '0'.repeat(64), sourceSurah: 1, sourceChapterOffsetMs: 0, qudVersion: 'v0.0.0', protocol: 'distributed_3_surahs_interior_300ms', samples: [1, 2, 3].flatMap(surah => [1, 3, surah + 4].map(ayah => ({ surah, ayah, chapterAyahCount: surah + 4, ncc: .949999997, lagMs: 0, durationDifferenceMs: 0 }))) }, 'x', '0'.repeat(64), 1)).toThrow('LICENSED_OFFSET_NOT_VERIFIED');
  });
});
describe('real owned media commands locally, no cloud', () => {
  it('actual ffprobe + nine measured windows across three sources + actual FFmpeg AudioPlan render', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ayahx-owned-storage-proof-')), chapters: OwnedChapter[] = [];
    for (let i = 0; i < 3; i++) {
      const bytes = ownedNoiseWav(16000 * (i + 4), 1729 + i), originalPath = path.join(root, `original-${i}.wav`), downloadedPath = path.join(root, `copy-${i}.wav`);
      await writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 }); await writeFile(downloadedPath, bytes, { flag: 'wx', mode: 0o600 });
      chapters.push({ surah: i + 1, originalPath, downloadedPath, durationMs: (i + 4) * 1000, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const chapter = chapters[1], probe = await probeLicensedAudio(chapter.originalPath, audioMagic(await readFile(chapter.originalPath)));
    expect(probe.durationMs).toBe(5000); expect(probe.codec).toBe('pcm_s16le');
    const engine = ownedFixtureOffsetVerifier(chapters), proof = await engine.verify({ recitationId: 'owned-test-fixture', surah: 2, localPath: chapter.downloadedPath, sha256: chapter.sha256 });
    expect(proof.samples).toHaveLength(9); expect(new Set(proof.samples.map(s => s.surah)).size).toBe(3); expect(proof.samples.every(s => s.ncc >= .95 && s.lagMs === 0 && s.durationDifferenceMs === 0)).toBe(true);
    const plan: StorageAudioPlan = { kind: 'licensed_file', recitationId: 'owned-test-fixture', surah: 2, sourceId: 'synthetic-no-db', storageObjectId: 'synthetic-no-db', adapter: 'r2', bucket: 'synthetic-not-real-r2', objectKey: 'synthetic-not-cloud', sha256: chapter.sha256, durationMs: probe.durationMs, sourceChapterOffsetMs: proof.sourceChapterOffsetMs, offsetEvidence: proof };
    const render = await renderOwnedPlan(plan, chapter.downloadedPath, path.join(root, 'owned-render.mp4'));
    expect(render.actual_ffmpeg).toBe(true); expect(render.audio_and_video).toBe(true); expect(render.duration_ms).toBe(2000);
    // Change an actual candidate file, not a mocked score; the measured verifier rejects it.
    await writeFile(chapter.downloadedPath, ownedNoiseWav(16000 * 5, 9999));
    await expect(engine.verify({ recitationId: 'owned-test-fixture', surah: 2, localPath: chapter.downloadedPath, sha256: chapter.sha256 })).rejects.toThrow(/STORAGE_TEST_CHAPTER_ORIGIN_CHANGED|LICENSED_OFFSET_NOT_VERIFIED/u);
    // Private owned artifacts retained: no filesystem cleanup is attempted.
  }, 120000);
});
describe('acceptance safety and evidence boundaries', () => {
  const config = { bucket: 'ayahx-audio-staging', endpoint: 'https://example.invalid', accountId: '0'.repeat(32), accessKeyId: 'writer-key', secretAccessKey: 'writer-secret', access: 'read_write' as const };
  const options = { config, readerConfig: { ...config, accessKeyId: 'reader-key', secretAccessKey: 'reader-secret', access: 'read_only' as const }, mode: 'r2' as const, forbiddenBucket: 'ayahx-audio-prod', allowedOrigin: 'https://ayahx-staging.up.railway.app', scratchRoot: path.join(tmpdir(), 'owned-test'), reportPath: path.join(tmpdir(), 'owned-test.json') };
  it('accepts only exact staging and read-only prod scope probe', () => { expect(() => assertAcceptanceOptions(options)).not.toThrow(); expect(() => assertAcceptanceOptions({ ...options, config: { ...config, bucket: 'ayahx-audio-prod' } })).toThrow('STORAGE_TEST_STAGING_ONLY'); });
  it('forbids loopback local fallback', () => { expect(() => assertAcceptanceOptions({ ...options, config: { ...config, localTestOnly: true } })).toThrow('STORAGE_TEST_STAGING_ONLY'); });
  it('requires the exact measured allowed origin', () => { expect(() => assertAcceptanceOptions({ ...options, allowedOrigin: '*' })).toThrow('STORAGE_TEST_ARGUMENTS_INVALID'); });
  it('accepts day-one abort with no automatic deletion', () => { expect(lifecycleDayOne({ rules: [{ enabled: true, conditions: { prefix: '' }, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86400 } } }] })).toBe(true); });
  it('rejects disabled, wrong duration or deletion lifecycle', () => { expect(lifecycleDayOne({ rules: [{ enabled: false, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86400 } } }] })).toBe(false); expect(lifecycleDayOne({ rules: [{ enabled: true, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86401 } } }] })).toBe(false); expect(lifecycleDayOne({ rules: [{ enabled: true, deleteObjectsTransition: {}, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86400 } } }] })).toBe(false); });
  it('scans real secret strings and signature URLs without printing either', () => { expect(() => assertNoAcceptanceSecrets({ error: 'safe-code' }, ['secret-value'])).not.toThrow(); expect(() => assertNoAcceptanceSecrets({ error: 'secret-value' }, ['secret-value'])).toThrow('STORAGE_TEST_SECRET_REPORT_LEAK'); expect(() => assertNoAcceptanceSecrets({ error: 'X-Amz-Signature=redacted' }, [])).toThrow('STORAGE_TEST_SECRET_REPORT_LEAK'); });
  it('detects secret values split across stdout writes', () => { const scan = new AcceptanceLogSecretScanner(['secret-value']); scan.consume(Buffer.from('safe secre')); scan.consume(Buffer.from('t-value')); scan.finish(); expect(scan.violated).toBe(true); });
  it('detects signing URLs split across stderr writes without exposing them', () => { const scan = new AcceptanceLogSecretScanner([]); scan.consume(Buffer.from('X-Amz-Sig')); scan.consume(Buffer.from('nature=anything')); scan.finish(); expect(scan.violated).toBe(true); });
  it('accepts safe sanitized logs', () => { const scan = new AcceptanceLogSecretScanner(['secret-value']); scan.consume(Buffer.from('{"failure_code":"STORAGE_REQUEST_FAILED"}')); scan.finish(); expect(scan.violated).toBe(false); });
  it('scans all supplied credentials including unused production tokens without cloud calls', () => { expect(acceptanceCredentialValues({ accountId: 'account', staging: { writer: { accessKeyId: 'stage' } }, production: { reader: { secretAccessKey: 'prod' } }, bucket: 'public-name' })).toEqual(['account', 'stage', 'prod']); });
});

const live = process.env.RUN_REAL_R2_ACCEPTANCE === '1' && !!process.env.R2_ACCEPTANCE_CREDENTIAL_FILE && !!process.env.R2_ACCEPTANCE_REPORT && !!process.env.R2_ACCEPTANCE_SCRATCH;
describe.skipIf(!live)('actual R2 staging acceptance — explicit opt-in only', () => {
  it('passes all 1–7 with actual external browser/lifecycle evidence and verified cleanup', async () => {
    const capture = await runCapturedR2Acceptance(); expect(capture.status).toBe('PASSED_STORAGE_ACCEPTANCE_1_TO_7_AND_LOG_SECRET_SCAN');
    const report = JSON.parse(await readFile(process.env.R2_ACCEPTANCE_REPORT!, 'utf8'));
    expect(report.failure_code ?? null).toBe(null); expect(report.test_objects_deleted).toBe(true); expect(report.status).toBe('PASSED_STORAGE_ACCEPTANCE_1_TO_7');
  }, 1200000);
});

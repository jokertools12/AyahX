import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, ListPartsCommand, ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { S3LicensedAudioStorage, type S3AudioStorageConfig } from '../server/services/catalogObjectStorage';
import { licensedObjectKey, AUDIO_MULTIPART_PART_BYTES, AUDIO_OBJECT_LIMIT_BYTES, type AudioObjectSpec } from '../server/services/catalogStorageContracts';
import { verifyLicensedAudio } from '../server/services/licensedAudioVerification';
import { CatalogError } from '../server/services/catalogContracts';
import type { StorageAudioPlan } from '../server/services/licensedSourceResolver';
import { mediaCommand, ownedNoiseWav, ownedTimings, ownedFixtureOffsetVerifier, renderOwnedPlan, type OwnedChapter } from './lib/ownedStorageAudioAcceptance';
import { getFfmpegBinary } from '../server/services/ffmpegBinary';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export interface AudioStorageAcceptanceOptions {
  config: S3AudioStorageConfig; readerConfig: S3AudioStorageConfig; scratchRoot: string; reportPath: string;
  allowedOrigin: string; forbiddenBucket: string; mode: 'r2'; lifecycleEvidencePath?: string; browserEvidencePath?: string;
}
const ensure = (condition: unknown, code: string): void => { if (!condition) throw new CatalogError(code, 500); };
export function assertAcceptanceOptions(o: AudioStorageAcceptanceOptions): void {
  ensure(o.mode === 'r2' && o.config.bucket === 'ayahx-audio-staging' && o.forbiddenBucket === 'ayahx-audio-prod' && o.readerConfig.bucket === o.config.bucket && o.readerConfig.endpoint === o.config.endpoint && o.config.access === 'read_write' && o.readerConfig.access === 'read_only' && !o.config.localTestOnly && !o.readerConfig.localTestOnly, 'STORAGE_TEST_STAGING_ONLY');
  ensure(o.allowedOrigin === 'https://ayahx-staging.up.railway.app' && path.isAbsolute(o.scratchRoot) && path.isAbsolute(o.reportPath), 'STORAGE_TEST_ARGUMENTS_INVALID');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
  ensure(!path.resolve(o.scratchRoot).toLowerCase().startsWith(repo.toLowerCase()), 'STORAGE_TEST_SCRATCH_MUST_BE_OUTSIDE_GIT');
}
export function assertNoAcceptanceSecrets(report: unknown, secrets: readonly string[]): void {
  const json = JSON.stringify(report); ensure(!secrets.some(s => s && json.includes(s)) && !/X-Amz-(?:Signature|Credential|Security-Token)|r2\.cloudflarestorage\.com|https?:\/\//iu.test(json), 'STORAGE_TEST_SECRET_REPORT_LEAK');
}
export function lifecycleDayOne(configuration: unknown): boolean {
  const c = configuration as { rules?: Array<{ enabled?: boolean; conditions?: { prefix?: string }; abortMultipartUploadsTransition?: { condition?: { maxAge?: number; type?: string } }; deleteObjectsTransition?: unknown }> };
  return !!c && Array.isArray(c.rules) && !c.rules.some(r => r.enabled && r.deleteObjectsTransition) && c.rules.some(r => r.enabled === true && (!r.conditions?.prefix || r.conditions.prefix === 'test/') && r.abortMultipartUploadsTransition?.condition?.type === 'Age' && r.abortMultipartUploadsTransition.condition.maxAge === 86400);
}
async function externalProof(file: string | undefined, bucket: string, kind: 'lifecycle' | 'browser', origin: string): Promise<Record<string, unknown>> {
  if (!file) return { status: 'NOT_RUN', reason: kind === 'browser' ? 'ACTUAL_BROWSER_EVIDENCE_REQUIRED' : 'CLOUDFLARE_GET_LIFECYCLE_EVIDENCE_REQUIRED' };
  const bytes = await readFile(file), p = JSON.parse(bytes.toString('utf8'));
  ensure(Number.isFinite(Date.parse(p.checked_at)) && Date.now() - Date.parse(p.checked_at) >= 0 && Date.now() - Date.parse(p.checked_at) < 86400000, 'STORAGE_TEST_EXTERNAL_PROOF_INVALID');
  if (kind === 'lifecycle') {
    const record = Array.isArray(p.results) ? p.results.find((r: { bucket?: string; step?: string }) => r.bucket === bucket && r.step === 'verify/lifecycle') : null;
    ensure(record?.success === true && record.status === 200 && lifecycleDayOne(record.result), 'STORAGE_TEST_LIFECYCLE_PROOF_INVALID');
  } else ensure(p.bucket === bucket && p.browser === 'chromium' && p.allowed_origin === origin && typeof p.denied_origin === 'string' && p.denied_origin !== origin && p.checks?.allowed_put === true && p.checks?.allowed_get === true && p.checks?.range_status === 206 && p.checks?.disallowed_blocked === true, 'STORAGE_TEST_BROWSER_PROOF_INVALID');
  return { status: 'PASSED', evidence_sha256: createHash('sha256').update(bytes).digest('hex'), checked_at: p.checked_at, ...(kind === 'lifecycle' ? { abort_after_seconds: 86400, expiry_observed: false, evidence_scope: 'CONFIGURATION_READBACK_NOT_24_HOUR_EXPIRY' } : { browser: 'chromium', exact_origins: true }) };
}
/** Explicit opt-in. All mutations are restricted to stage test/<fresh UUID>/. */
export async function runAudioStorageAcceptance(o: AudioStorageAcceptanceOptions): Promise<Record<string, unknown>> {
  assertAcceptanceOptions(o);
  const started = Date.now(), prefix = `test/${randomUUID()}/`, owned = [ownedNoiseWav(50 * 1024 * 1024, 1729), ownedNoiseWav(16000 * 10, 1730), ownedNoiseWav(16000 * 14, 1731)];
  const specs = owned.map((b, i) => { const sha256 = createHash('sha256').update(b).digest('hex'); return { objectKey: prefix + licensedObjectKey('owned-test-fixture', i + 1, sha256, 'wav'), sizeBytes: b.length, sha256, contentType: 'audio/wav' }; });
  const writable = new S3LicensedAudioStorage(o.config), readonly = new S3LicensedAudioStorage(o.readerConfig);
  const raw = (c: S3AudioStorageConfig) => new S3Client({ endpoint: c.endpoint, region: c.region ?? 'auto', forcePathStyle: true, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }, maxAttempts: 1 });
  const reader = raw(o.readerConfig), writer = raw(o.config), pending = new Map<string, string>(), keys = new Set<string>();
  const report: Record<string, unknown> = { mode: 'r2', actual_r2: true, started_at: new Date(started).toISOString(), status: 'RUNNING', fixture_scope: 'OWNED_SYNTHETIC_PIPELINE_NOT_QUD_OR_VOICE_IDENTITY', no_provider_audio: true, bucket: o.config.bucket, prefix, results: {} };
  const results = report.results as Record<string, unknown>;
  const put = async (s: AudioObjectSpec, b: Buffer) => { keys.add(s.objectKey); const c = await writable.presignPut(s, 300); const r = await fetch(c.url, { method: 'PUT', body: new Uint8Array(b), headers: c.requiredHeaders, signal: AbortSignal.timeout(120000) }); ensure(r.ok, 'STORAGE_TEST_PUT_FAILED'); };
  const rejected = async (work: () => Promise<unknown>, code: string) => { try { await work(); } catch (e) { if (e instanceof CatalogError && e.code === code) return code; throw new CatalogError('STORAGE_TEST_UNEXPECTED_REJECTION', 500); } throw new CatalogError('STORAGE_TEST_REJECTION_MISSING', 500); };
  try {
    await mkdir(o.scratchRoot, { recursive: true }); const chapters: OwnedChapter[] = [];
    for (let i = 0; i < owned.length; i++) { const originalPath = path.join(o.scratchRoot, `owned-${i + 1}-${randomUUID()}.wav`); await writeFile(originalPath, owned[i], { flag: 'wx', mode: 0o600 }); chapters.push({ surah: i + 1, originalPath, downloadedPath: path.join(o.scratchRoot, `downloaded-${i + 1}-${randomUUID()}.wav`), durationMs: (owned[i].length - 44) / 16, sha256: specs[i].sha256 }); }
    report.active_check = 'MULTIPART_RESUME'; const uploadStarted = Date.now(), spec = specs[0]; keys.add(spec.objectKey); const uploadId = await writable.beginMultipart(spec); pending.set(spec.objectKey, uploadId);
    const sendPart = async (client: S3LicensedAudioStorage, part: number) => { const b = owned[0].subarray((part - 1) * AUDIO_MULTIPART_PART_BYTES, Math.min(part * AUDIO_MULTIPART_PART_BYTES, owned[0].length)), c = await client.presignPart(spec.objectKey, uploadId, part, b.length, 300), r = await fetch(c.url, { method: 'PUT', body: new Uint8Array(b), headers: c.requiredHeaders, signal: AbortSignal.timeout(120000) }); ensure(r.ok && r.headers.get('etag'), 'STORAGE_TEST_PART_PUT_FAILED'); };
    await sendPart(writable, 1); const first = await writable.listParts(spec.objectKey, uploadId); ensure(first.length === 1, 'STORAGE_TEST_RESUME_FAILED');
    const checkpoint = path.join(o.scratchRoot, `multipart-checkpoint-${randomUUID()}.json`); await writeFile(checkpoint, JSON.stringify({ objectKey: spec.objectKey, uploadId, parts: first }), { flag: 'wx', mode: 0o600 });
    const restored = new S3LicensedAudioStorage(o.config);
    try { const saved = JSON.parse(await readFile(checkpoint, 'utf8')); ensure(saved.uploadId === uploadId && JSON.stringify(await restored.listParts(spec.objectKey, saved.uploadId)) === JSON.stringify(saved.parts), 'STORAGE_TEST_RESUME_FAILED'); for (let p = 2; p <= Math.ceil(owned[0].length / AUDIO_MULTIPART_PART_BYTES); p++) await sendPart(restored, p); await restored.completeMultipart(spec, saved.uploadId, await restored.listParts(spec.objectKey, saved.uploadId)); pending.delete(spec.objectKey); } finally { restored.close(); }
    results.multipart = { bytes: spec.sizeBytes, parts: Math.ceil(spec.sizeBytes / AUDIO_MULTIPART_PART_BYTES), milliseconds: Date.now() - uploadStarted, resume_from_persisted_checkpoint_fresh_client: true, process_kill_test: false };
    report.active_check = 'OWNED_CHAPTER_PUT'; for (let i = 1; i < specs.length; i++) await put(specs[i], owned[i]);
    report.active_check = 'READ_RANGE_SHA'; const readStarted = Date.now();
    for (const [i, s] of specs.entries()) { ensure((await readonly.head(s.objectKey))?.sizeBytes === s.sizeBytes, 'STORAGE_TEST_HEAD_SIZE_FAILED'); const { body } = await readonly.read(s.objectKey); await pipeline(body, createWriteStream(chapters[i].downloadedPath, { flags: 'wx', mode: 0o600 })); const b = await readFile(chapters[i].downloadedPath); ensure(b.length === s.sizeBytes && createHash('sha256').update(b).digest('hex') === s.sha256, 'STORAGE_TEST_SHA_FAILED'); }
    const signed = await readonly.presignGet(spec.objectKey, 300), range = await fetch(signed.url, { headers: { Range: 'bytes=100-1099' }, signal: AbortSignal.timeout(120000) }); ensure(range.status === 206 && range.headers.get('content-range') === `bytes 100-1099/${spec.sizeBytes}` && Buffer.from(await range.arrayBuffer()).equals(owned[0].subarray(100, 1100)), 'STORAGE_TEST_RANGE_FAILED');
    results.read_range_sha = { files: 3, bytes: specs.reduce((n, s) => n + s.sizeBytes, 0), milliseconds: Date.now() - readStarted, full_sha256_matches: true, range_status: 206, range_bytes: 1000, signed_ttl_seconds: 300 };
    const forbidden = async (work: () => Promise<unknown>, code: string) => { try { await work(); } catch (e) { const status = e && typeof e === 'object' && '$metadata' in e ? (e.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined; if (status === 403) return; throw new CatalogError(code, 500); } throw new CatalogError(code, 500); };
    report.active_check = 'TOKEN_SCOPING'; const deniedKey = prefix + 'readonly-denied.txt'; keys.add(deniedKey);
    await forbidden(() => reader.send(new PutObjectCommand({ Bucket: o.config.bucket, Key: deniedKey, Body: 'denied' })), 'STORAGE_TEST_READONLY_WRITE_ALLOWED');
    await forbidden(() => reader.send(new DeleteObjectCommand({ Bucket: o.config.bucket, Key: spec.objectKey })), 'STORAGE_TEST_READONLY_DELETE_ALLOWED');
    await forbidden(() => writer.send(new ListObjectsV2Command({ Bucket: o.forbiddenBucket, MaxKeys: 1 })), 'STORAGE_TEST_WRITER_OTHER_BUCKET_ALLOWED');
    results.credential_scoping = { read_only_put: 403, read_only_delete: 403, writer_existing_production_bucket_list: 403, production_mutations: 0 };
    results.immutable_object = await rejected(() => writable.presignPut(spec), 'STORAGE_OBJECT_IMMUTABLE');
    report.active_check = 'ACTUAL_OFFSET_FFPROBE'; const engine = ownedFixtureOffsetVerifier(chapters), verified = [];
    for (const [i, s] of specs.entries()) verified.push(await verifyLicensedAudio(readonly, { spec: s, recitationId: 'owned-test-fixture', surah: i + 1, timings: ownedTimings(chapters[i].durationMs), scratchRoot: o.scratchRoot }, engine));
    results.actual_verification = verified.map((v, i) => ({ surah: i + 1, sha256: v.sha256, bytes: v.sizeBytes, duration_ms: v.durationMs, codec: v.codec, sample_rate: v.sampleRate, warnings: v.warnings, offset: v.offset }));
    const plan: StorageAudioPlan = { kind: 'licensed_file', recitationId: 'owned-test-fixture', surah: 2, sourceId: 'synthetic-no-db', storageObjectId: 'synthetic-no-db', adapter: 'r2', bucket: o.config.bucket, objectKey: specs[1].objectKey, sha256: specs[1].sha256, durationMs: verified[1].durationMs, sourceChapterOffsetMs: verified[1].offset.sourceChapterOffsetMs, offsetEvidence: verified[1].offset };
    report.active_check = 'AUDIO_PLAN_FFMPEG'; results.audio_plan_render = await renderOwnedPlan(plan, chapters[1].downloadedPath, path.join(o.scratchRoot, `owned-render-${randomUUID()}.mp4`));
    report.active_check = 'REJECTIONS'; const negative: Record<string, unknown> = {};
    negative.above_1gb = await rejected(() => writable.presignPut({ ...spec, objectKey: prefix + licensedObjectKey('owned-limit', 1, spec.sha256, 'wav'), sizeBytes: AUDIO_OBJECT_LIMIT_BYTES + 1 }), 'AUDIO_OBJECT_SIZE_LIMIT');
    negative.truncated = await rejected(() => verifyLicensedAudio(readonly, { spec: { ...spec, sizeBytes: spec.sizeBytes + 1 }, recitationId: 'owned-test-fixture', surah: 1, timings: ownedTimings(chapters[0].durationMs), scratchRoot: o.scratchRoot }, engine), 'AUDIO_UPLOAD_TRUNCATED');
    negative.wrong_sha = await rejected(() => verifyLicensedAudio(readonly, { spec: { ...spec, sha256: '0'.repeat(64) }, recitationId: 'owned-test-fixture', surah: 1, timings: ownedTimings(chapters[0].durationMs), scratchRoot: o.scratchRoot }, engine), 'AUDIO_SHA256_MISMATCH');
    const invalid = Buffer.from('NOT AUDIO FILE '.repeat(10)), invalidSha = createHash('sha256').update(invalid).digest('hex'), invalidSpec = { objectKey: prefix + licensedObjectKey('owned-invalid', 1, invalidSha, 'wav'), sha256: invalidSha, sizeBytes: invalid.length, contentType: 'audio/wav' }; await put(invalidSpec, invalid);
    negative.invalid_magic = await rejected(() => verifyLicensedAudio(readonly, { spec: invalidSpec, recitationId: 'owned-test-fixture', surah: 1, timings: ownedTimings(1000), scratchRoot: o.scratchRoot }, engine), 'AUDIO_MAGIC_INVALID');
    const videoPath = path.join(o.scratchRoot, `owned-video-${randomUUID()}.mp4`); await mediaCommand(getFfmpegBinary(), ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', '-c:v', 'libx264', '-threads:v', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoPath]);
    const video = await readFile(videoPath), videoSha = createHash('sha256').update(video).digest('hex'), videoSpec = { objectKey: prefix + licensedObjectKey('owned-video', 1, videoSha, 'm4a'), sizeBytes: video.length, sha256: videoSha, contentType: 'audio/mp4' }; await put(videoSpec, video);
    negative.video_stream = await rejected(() => verifyLicensedAudio(readonly, { spec: videoSpec, recitationId: 'owned-test-fixture', surah: 1, timings: ownedTimings(1000), scratchRoot: o.scratchRoot }, engine), 'AUDIO_STREAMS_INVALID'); results.rejections = negative;
    report.active_check = 'ABORT_AND_LIFECYCLE'; const incomplete = { ...spec, objectKey: prefix + licensedObjectKey('owned-abort', 1, spec.sha256, 'wav') }, id = await writable.beginMultipart(incomplete); pending.set(incomplete.objectKey, id);
    const part = await writable.presignPart(incomplete.objectKey, id, 1, AUDIO_MULTIPART_PART_BYTES, 300); ensure((await fetch(part.url, { method: 'PUT', body: new Uint8Array(owned[0].subarray(0, AUDIO_MULTIPART_PART_BYTES)), signal: AbortSignal.timeout(120000) })).ok, 'STORAGE_TEST_ABORT_PART_FAILED'); ensure((await writable.listParts(incomplete.objectKey, id)).length === 1, 'STORAGE_TEST_ABORT_PART_FAILED'); await writable.abortMultipart(incomplete.objectKey, id); pending.delete(incomplete.objectKey);
    let absentUpload = false;
    try { await writer.send(new ListPartsCommand({ Bucket: o.config.bucket, Key: incomplete.objectKey, UploadId: id })); } catch (e) { absentUpload = !!e && typeof e === 'object' && '$metadata' in e && (e.$metadata as { httpStatusCode?: number }).httpStatusCode === 404; }
    ensure(absentUpload, 'STORAGE_TEST_ABORT_NOT_CONFIRMED'); results.abort_incomplete_upload = { populated_part_aborted: true, list_parts_status: 404 };
    report.active_check = 'EXTERNAL_PROOFS'; results.lifecycle_day_one = await externalProof(o.lifecycleEvidencePath, o.config.bucket, 'lifecycle', o.allowedOrigin); results.browser_cors = await externalProof(o.browserEvidencePath, o.config.bucket, 'browser', o.allowedOrigin);
    report.status = (results.lifecycle_day_one as { status: string }).status === 'PASSED' && (results.browser_cors as { status: string }).status === 'PASSED' ? 'PASSED_STORAGE_ACCEPTANCE_1_TO_7' : 'PASSED_EXECUTED_CHECKS_EXTERNAL_EVIDENCE_PENDING';
  } catch (e) { report.status = 'FAILED'; report.failure_code = e instanceof CatalogError ? e.code : 'STORAGE_TEST_FAILURE'; report.failure_check = report.active_check ?? 'SETUP'; }
  finally {
    const failures: string[] = [];
    for (const [key, id] of pending) { try { await writable.abortMultipart(key, id); } catch { failures.push('STORAGE_TEST_MULTIPART_CLEANUP_FAILED'); } }
    for (const key of keys) { try { if (key === prefix + 'readonly-denied.txt') await writer.send(new DeleteObjectCommand({ Bucket: o.config.bucket, Key: key })); else { await writable.deleteObject(key); ensure(await writable.head(key) === null, 'STORAGE_TEST_DELETE_NOT_CONFIRMED'); } } catch { failures.push('STORAGE_TEST_OBJECT_CLEANUP_FAILED'); } }
    try { const left = await writer.send(new ListObjectsV2Command({ Bucket: o.config.bucket, Prefix: prefix, MaxKeys: 1000 })); ensure(!left.IsTruncated && !left.Contents?.length, 'STORAGE_TEST_CLEANUP_NOT_EMPTY'); } catch { failures.push('STORAGE_TEST_CLEANUP_NOT_EMPTY'); }
    try { const left = await writer.send(new ListMultipartUploadsCommand({ Bucket: o.config.bucket, Prefix: prefix, MaxUploads: 1000 })); ensure(!left.IsTruncated && !left.Uploads?.length, 'STORAGE_TEST_MULTIPART_CLEANUP_NOT_EMPTY'); } catch { failures.push('STORAGE_TEST_MULTIPART_CLEANUP_NOT_EMPTY'); }
    report.test_objects_deleted = failures.length === 0; report.cleanup_failure_codes = failures; if (failures.length) report.status = 'FAILED';
    writable.close(); readonly.close(); reader.destroy(); writer.destroy(); report.finished_at = new Date().toISOString(); report.milliseconds = Date.now() - started;
    assertNoAcceptanceSecrets(report, [o.config.accessKeyId, o.config.secretAccessKey, o.readerConfig.accessKeyId, o.readerConfig.secretAccessKey]); report.secret_scan = 'PASSED_REPORT_AND_REDACTED_ERROR_FIELDS';
    await writeFile(o.reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  }
  return report;
}
export async function runPrivateR2Acceptance(file: string, reportPath: string, scratchRoot: string, lifecycleEvidencePath?: string, browserEvidencePath?: string): Promise<Record<string, unknown>> {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
  ensure(path.isAbsolute(file) && !path.resolve(file).toLowerCase().startsWith(repo.toLowerCase()), 'STORAGE_TEST_CREDENTIALS_MUST_BE_OUTSIDE_GIT');
  const c = JSON.parse(await readFile(file, 'utf8')) as { accountId: string; endpoint: string; staging: { bucket: string; writer: { accessKeyId: string; secretAccessKey: string }; reader: { accessKeyId: string; secretAccessKey: string } } };
  const common = { accountId: c.accountId, endpoint: c.endpoint, bucket: c.staging.bucket, forcePathStyle: true };
  return runAudioStorageAcceptance({ config: { ...common, ...c.staging.writer, access: 'read_write' }, readerConfig: { ...common, ...c.staging.reader, access: 'read_only' }, scratchRoot, reportPath, allowedOrigin: 'https://ayahx-staging.up.railway.app', forbiddenBucket: 'ayahx-audio-prod', mode: 'r2', lifecycleEvidencePath, browserEvidencePath });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.RUN_REAL_R2_ACCEPTANCE !== '1' || !process.env.R2_ACCEPTANCE_CREDENTIAL_FILE || !process.env.R2_ACCEPTANCE_REPORT || !process.env.R2_ACCEPTANCE_SCRATCH) throw new CatalogError('R2_ACCEPTANCE_EXPLICIT_OPT_IN_REQUIRED', 422);
    const r = await runPrivateR2Acceptance(process.env.R2_ACCEPTANCE_CREDENTIAL_FILE, process.env.R2_ACCEPTANCE_REPORT, process.env.R2_ACCEPTANCE_SCRATCH, process.env.R2_ACCEPTANCE_LIFECYCLE_EVIDENCE, process.env.R2_ACCEPTANCE_BROWSER_EVIDENCE);
    process.stdout.write(JSON.stringify({ status: r.status, failure_code: r.failure_code ?? null, test_objects_deleted: r.test_objects_deleted, secret_scan: r.secret_scan }) + '\n'); if (r.status !== 'PASSED_STORAGE_ACCEPTANCE_1_TO_7') process.exitCode = 1;
  } catch (e) { process.stdout.write(JSON.stringify({ status: 'FAILED', failure_code: e instanceof CatalogError ? e.code : 'STORAGE_TEST_FAILURE' }) + '\n'); process.exitCode = 1; }
}

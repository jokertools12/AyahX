import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3LicensedAudioStorage, type S3AudioStorageConfig } from '../server/services/catalogObjectStorage';
import { licensedObjectKey, AUDIO_MULTIPART_PART_BYTES } from '../server/services/catalogStorageContracts';
import { audioMagic, probeLicensedAudio } from '../server/services/licensedAudioVerification';
import { CatalogError } from '../server/services/catalogContracts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface TestCredentials { writer: { accessKey: string; secretKey: string }; reader: { accessKey: string; secretKey: string }; admin?: { accessKey: string; secretKey: string } }
export interface AudioStorageAcceptanceOptions { config: S3AudioStorageConfig; readerConfig: S3AudioStorageConfig; credentials?: TestCredentials; scratchRoot: string; reportPath: string; allowedOrigin: string; mode: 'local_seaweedfs' | 'r2'; setupLocalBuckets?: boolean }
const ensure = (condition: unknown, code: string): void => { if (!condition) throw new CatalogError(code, 500); };
/** Generates owned PCM audio. No provider/YouTube recordings are downloaded. */
function testWav(): Buffer {
  const bytes = Buffer.alloc(50 * 1024 * 1024 + 44); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(Math.round(Math.sin((i - 44) / 2 / 16000 * 440 * Math.PI * 2) * 1000), i);
  return bytes;
}
export async function runAudioStorageAcceptance(options: AudioStorageAcceptanceOptions): Promise<Record<string, unknown>> {
  const started = Date.now(), prefix = `test/${randomUUID()}/`, bytes = testWav(), sha = createHash('sha256').update(bytes).digest('hex');
  const spec = { objectKey: prefix + licensedObjectKey('owned-test-fixture', 1, sha, 'wav'), sizeBytes: bytes.length, sha256: sha, contentType: 'audio/wav' };
  const writable = new S3LicensedAudioStorage(options.config), readonly = new S3LicensedAudioStorage(options.readerConfig);
  const raw = (config: S3AudioStorageConfig) => new S3Client({ endpoint: config.endpoint, region: config.region ?? 'auto', forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 1 });
  const reader = raw(options.readerConfig), writer = raw(options.config); let uploadId: string | undefined, aborted: string | undefined;
  const report: Record<string, unknown> = { mode: options.mode, actual_r2: options.mode === 'r2', started_at: new Date(started).toISOString(), status: 'RUNNING', generated_owned_audio: true, no_provider_audio: true, bytes: bytes.length, sha256: sha, prefix, results: {} };
  const results = report.results as Record<string, unknown>;
  try {
    if (options.setupLocalBuckets && options.credentials?.admin) {
      const admin = raw({ ...options.config, accessKeyId: options.credentials.admin.accessKey, secretAccessKey: options.credentials.admin.secretKey });
      try {
        for (const bucket of [options.config.bucket, 'ayahx-k5-other']) {
          try { await admin.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) { const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''; if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(name)) throw new CatalogError('LOCAL_BUCKET_SETUP_FAILED', 500); }
        }
        await admin.send(new PutBucketCorsCommand({ Bucket: options.config.bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: [options.allowedOrigin], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['Content-Type', 'Range', 'If-None-Match', 'x-amz-*'], ExposeHeaders: ['ETag', 'Content-Range', 'Content-Length'], MaxAgeSeconds: 300 }] } }));
      } finally { admin.destroy(); }
    }
    const uploadStarted = Date.now(); uploadId = await writable.beginMultipart(spec);
    const count = Math.ceil(bytes.length / AUDIO_MULTIPART_PART_BYTES);
    const sendPart = async (part: number) => { const body = bytes.subarray((part - 1) * AUDIO_MULTIPART_PART_BYTES, Math.min(part * AUDIO_MULTIPART_PART_BYTES, bytes.length)); const capability = await writable.presignPart(spec.objectKey, uploadId!, part, body.length, 300); const response = await fetch(capability.url, { method: 'PUT', body: new Uint8Array(body), headers: capability.requiredHeaders }); ensure(response.ok, 'STORAGE_TEST_PART_PUT_FAILED'); ensure(response.headers.get('etag'), 'STORAGE_TEST_ETAG_MISSING'); };
    await sendPart(1);
    const resumed = await writable.listParts(spec.objectKey, uploadId); ensure(resumed.length === 1 && resumed[0].partNumber === 1, 'STORAGE_TEST_RESUME_FAILED');
    // Recreate the client to prove state is server-side, not process memory.
    const restored = new S3LicensedAudioStorage(options.config);
    try { ensure((await restored.listParts(spec.objectKey, uploadId)).length === 1, 'STORAGE_TEST_RESUME_FAILED'); } finally { restored.close(); }
    for (let part = 2; part <= count; part++) await sendPart(part);
    const parts = await writable.listParts(spec.objectKey, uploadId); await writable.completeMultipart(spec, uploadId, parts); uploadId = undefined;
    results.multipart = { bytes: bytes.length, parts: parts.length, resumed_after_client_restart: true, milliseconds: Date.now() - uploadStarted };
    const head = await readonly.head(spec.objectKey); ensure(head?.sizeBytes === bytes.length, 'STORAGE_TEST_HEAD_SIZE_FAILED');
    const signed = await readonly.presignGet(spec.objectKey, 300), range = await fetch(signed.url, { headers: { Range: 'bytes=100-1099' } });
    ensure(range.status === 206, 'STORAGE_TEST_RANGE_FAILED'); ensure(Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(100, 1100)), 'STORAGE_TEST_RANGE_BYTES_FAILED');
    results.signed_range = { status: range.status, bytes: 1000, ttl_seconds: 300 };
    const readStarted = Date.now(), downloaded = await readonly.read(spec.objectKey), hasher = createHash('sha256'); let readBytes = 0;
    for await (const b of downloaded.body) { hasher.update(b); readBytes += b.length; }
    ensure(readBytes === bytes.length && hasher.digest('hex') === sha, 'STORAGE_TEST_SHA_FAILED'); results.read = { bytes: readBytes, milliseconds: Date.now() - readStarted, sha256_matches: true };
    const forbidden = async (work: () => Promise<unknown>, code: string) => { let rejected = false; try { await work(); } catch (error) { const http = error && typeof error === 'object' && '$metadata' in error ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined; if (http === 403) rejected = true; else throw new CatalogError(code, 500); } ensure(rejected, code); };
    await forbidden(() => reader.send(new PutObjectCommand({ Bucket: options.config.bucket, Key: prefix + 'readonly-denied.txt', Body: 'denied' })), 'STORAGE_TEST_READONLY_WRITE_ALLOWED');
    await forbidden(() => reader.send(new DeleteObjectCommand({ Bucket: options.config.bucket, Key: spec.objectKey })), 'STORAGE_TEST_READONLY_DELETE_ALLOWED');
    await forbidden(() => writer.send(new GetObjectCommand({ Bucket: 'ayahx-k5-other', Key: spec.objectKey })), 'STORAGE_TEST_WRITER_OTHER_BUCKET_ALLOWED');
    results.credential_scoping = { read_only_put: 403, read_only_delete: 403, writer_other_bucket: 403 };
    let immutable = false; try { await writable.presignPut(spec); } catch (error) { if (error instanceof CatalogError && error.code === 'STORAGE_OBJECT_IMMUTABLE') immutable = true; else throw error; } ensure(immutable, 'STORAGE_TEST_OVERWRITE_ALLOWED'); results.immutable_object = true;
    const preflight = async (origin: string) => fetch(new URL(`/${options.config.bucket}/${spec.objectKey}`, options.config.endpoint), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range' } });
    const good = await preflight(options.allowedOrigin), bad = await preflight('https://not-our-origin.invalid');
    ensure(good.headers.get('access-control-allow-origin') === options.allowedOrigin, 'STORAGE_TEST_ALLOWED_CORS_FAILED'); ensure(bad.headers.get('access-control-allow-origin') !== 'https://not-our-origin.invalid', 'STORAGE_TEST_BAD_ORIGIN_CORS_ALLOWED'); results.cors_preflight = { allowed_status: good.status, denied_status: bad.status, exact_origin: true, browser_e2e: 'NOT_RUN' };
    await mkdir(options.scratchRoot, { recursive: true }); const ownWav = path.join(options.scratchRoot, `owned-fixture-${randomUUID()}.wav`); await writeFile(ownWav, bytes, { flag: 'wx', mode: 0o600 });
    const probe = await probeLicensedAudio(ownWav, audioMagic(bytes.subarray(0, 64))); results.ffprobe = probe;
    const incompleteSpec = { ...spec, objectKey: prefix + licensedObjectKey('owned-test-fixture', 2, sha, 'wav') }; aborted = await writable.beginMultipart(incompleteSpec); await writable.abortMultipart(incompleteSpec.objectKey, aborted); aborted = undefined;
    results.abort_incomplete_upload = true; results.lifecycle_day_one = 'NOT_TIME_ADVANCED'; results.offset_audio_plan_render = 'NOT_RUN_REQUIRES_SERVER_OFFSET_ENGINE_AND_MATCHING_QUD_RECORDING';
    report.status = 'PASSED_PARTIAL_STORAGE_ACCEPTANCE';
  } catch (error) { report.status = 'FAILED'; report.failure_code = error instanceof CatalogError ? error.code : 'STORAGE_TEST_FAILURE'; }
  finally {
    try { if (uploadId) await writable.abortMultipart(spec.objectKey, uploadId); if (aborted) await writable.abortMultipart(prefix + licensedObjectKey('owned-test-fixture', 2, sha, 'wav'), aborted); await writable.deleteObject(spec.objectKey); ensure((await writable.head(spec.objectKey)) === null, 'STORAGE_TEST_DELETE_NOT_CONFIRMED'); report.test_objects_deleted = true; } catch { report.test_objects_deleted = false; report.status = 'FAILED'; report.cleanup_failure_code = 'STORAGE_TEST_OBJECT_CLEANUP_FAILED'; }
    writable.close(); readonly.close(); reader.destroy(); writer.destroy();
    report.finished_at = new Date().toISOString(); report.milliseconds = Date.now() - started;
    const json = JSON.stringify(report, null, 2); const secrets = [options.config.accessKeyId, options.config.secretAccessKey, options.readerConfig.accessKeyId, options.readerConfig.secretAccessKey];
    ensure(!secrets.some(s => s && json.includes(s)) && !/X-Amz-(?:Signature|Credential)/iu.test(json), 'STORAGE_TEST_SECRET_REPORT_LEAK');
    await writeFile(options.reportPath, json, { flag: 'wx', mode: 0o600 });
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const credentialsPath = process.argv[2], reportPath = process.argv[3];
  if (!credentialsPath || !reportPath) throw new CatalogError('LOCAL_S3_TEST_ARGUMENTS_REQUIRED', 422);
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8')) as TestCredentials;
  const config: S3AudioStorageConfig = { bucket: 'ayahx-k5-test', endpoint: 'http://127.0.0.1:38333', localTestOnly: true, region: 'us-east-1', access: 'read_write', accessKeyId: credentials.writer.accessKey, secretAccessKey: credentials.writer.secretKey };
  const result = await runAudioStorageAcceptance({ config, readerConfig: { ...config, access: 'read_only', accessKeyId: credentials.reader.accessKey, secretAccessKey: credentials.reader.secretKey }, credentials, mode: 'local_seaweedfs', setupLocalBuckets: true, scratchRoot: path.join(path.dirname(credentialsPath), 'scratch'), reportPath, allowedOrigin: 'http://127.0.0.1:38900' });
  process.stdout.write(JSON.stringify({ status: result.status, failure_code: result.failure_code ?? null, test_objects_deleted: result.test_objects_deleted }) + '\n'); if (result.status === 'FAILED') process.exitCode = 1;
}

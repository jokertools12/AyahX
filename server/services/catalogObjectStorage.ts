import { Readable } from 'node:stream';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command, DeleteObjectCommand, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CatalogError } from './catalogContracts';
import { assertCatalogAudioUrl } from './catalogAudioSource';
import { assertStorageSize, assertSignedExpiry, AUDIO_MULTIPART_PART_BYTES, type AudioObjectStorage, type AudioObjectSpec, type UploadedPart, type StorageSignedCapability, type StoredAudioHead } from './catalogStorageContracts';

/** External provider recordings are references only. This adapter has no copying path. */
export class UrlReferenceAudioStorage implements AudioObjectStorage {
  readonly adapter = 'url_reference' as const;
  readonly bucket = null;
  constructor(private readonly hosts: readonly string[]) {}
  reference(url: string): string { return assertCatalogAudioUrl(url, this.hosts).href; }
  private unavailable(): never { throw new CatalogError('STORAGE_UPLOAD_NOT_CONFIGURED', 409); }
  async head(): Promise<null> { return this.unavailable(); }
  async read(): Promise<never> { return this.unavailable(); }
  async presignGet(): Promise<never> { return this.unavailable(); }
  async presignPut(): Promise<never> { return this.unavailable(); }
  async beginMultipart(): Promise<never> { return this.unavailable(); }
  async presignPart(): Promise<never> { return this.unavailable(); }
  async listParts(): Promise<never> { return this.unavailable(); }
  async completeMultipart(): Promise<never> { return this.unavailable(); }
  async abortMultipart(): Promise<never> { return this.unavailable(); }
  async listObjects(): Promise<never> { return this.unavailable(); }
  async deleteObject(): Promise<never> { return this.unavailable(); }
}
export interface S3AudioStorageConfig {
  bucket: string; endpoint: string; accessKeyId: string; secretAccessKey: string; accountId?: string;
  access: 'read_only' | 'read_write'; localTestOnly?: boolean; forcePathStyle?: boolean; region?: string;
}
export function validateS3AudioConfig(config: S3AudioStorageConfig): void {
  let endpoint: URL; try { endpoint = new URL(config.endpoint); } catch { throw new CatalogError('STORAGE_CONFIGURATION_INVALID', 503); }
  const local = config.localTestOnly === true && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
    (!local && (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}$/u.test(config.accountId ?? '') || endpoint.hostname !== `${config.accountId}.r2.cloudflarestorage.com` || (endpoint.port && endpoint.port !== '443'))) ||
    (local && !['http:', 'https:'].includes(endpoint.protocol)) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey) throw new CatalogError('STORAGE_CONFIGURATION_INVALID', 503);
}
/** Bucket-scoped client; all errors are fixed codes without SDK/credential/request text. */
export class S3LicensedAudioStorage implements AudioObjectStorage {
  readonly adapter = 'r2' as const;
  readonly bucket: string;
  private readonly client: S3Client;
  constructor(private readonly config: S3AudioStorageConfig) {
    validateS3AudioConfig(config); this.bucket = config.bucket;
    const options: S3ClientConfig = { region: config.region ?? 'auto', endpoint: config.endpoint, forcePathStyle: config.forcePathStyle ?? true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 1 };
    this.client = new S3Client(options);
  }
  close(): void { this.client.destroy(); }
  private key(key: string): void {
    if (!/^(?:test\/[a-zA-Z0-9_-]+\/)?licensed\/[a-z0-9][a-z0-9_-]{0,190}\/(?:00[1-9]|0[1-9][0-9]|10[0-9]|11[0-4])\/[a-f0-9]{64}\.(?:mp3|m4a|aac|ogg|opus|flac|wav)$/u.test(key)) throw new CatalogError('STORAGE_KEY_INVALID', 422);
  }
  private write(): void { if (this.config.access !== 'read_write') throw new CatalogError('STORAGE_READ_ONLY', 403); }
  private spec(spec: AudioObjectSpec): void {
    this.key(spec.objectKey); assertStorageSize(spec.sizeBytes);
    if (!/^[a-f0-9]{64}$/u.test(spec.sha256) || !spec.objectKey.includes(`/${spec.sha256}.`) || !/^audio\/[a-z0-9.+-]{1,50}$/u.test(spec.contentType)) throw new CatalogError('STORAGE_INPUT_INVALID', 422);
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError('STORAGE_REQUEST_FAILED', 502); } }
  async head(key: string): Promise<StoredAudioHead | null> {
    this.key(key);
    return this.safe(async () => {
      try { const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return { sizeBytes: r.ContentLength ?? 0, contentType: r.ContentType ?? '', etag: r.ETag ?? null }; }
      catch (error) { if (error && typeof error === 'object' && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404) return null; throw error; }
    });
  }
  async read(key: string, range?: { start: number; end: number }): Promise<{ body: Readable; head: StoredAudioHead }> {
    this.key(key);
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) throw new CatalogError('STORAGE_RANGE_INVALID', 422);
    return this.safe(async () => {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
      if (!(r.Body instanceof Readable)) throw new CatalogError('STORAGE_BODY_INVALID', 502);
      return { body: r.Body, head: { sizeBytes: r.ContentLength ?? 0, contentType: r.ContentType ?? '', etag: r.ETag ?? null } };
    });
  }
  async presignGet(key: string, seconds = 900): Promise<StorageSignedCapability> {
    this.key(key); assertSignedExpiry(seconds);
    return this.safe(async () => ({ url: await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: seconds }), expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), requiredHeaders: {} }));
  }
  async presignPut(spec: AudioObjectSpec, seconds = 900): Promise<StorageSignedCapability> {
    this.write(); this.spec(spec); assertSignedExpiry(seconds);
    if (await this.head(spec.objectKey)) throw new CatalogError('STORAGE_OBJECT_IMMUTABLE', 409);
    return this.safe(async () => ({ url: await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: spec.objectKey, ContentLength: spec.sizeBytes, ContentType: spec.contentType, IfNoneMatch: '*', Metadata: { sha256: spec.sha256 } }), { expiresIn: seconds, signableHeaders: new Set(['content-length']), unhoistableHeaders: new Set(['if-none-match']) }), expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), requiredHeaders: { 'content-type': spec.contentType, 'if-none-match': '*' } }));
  }
  async beginMultipart(spec: AudioObjectSpec): Promise<string> {
    this.write(); this.spec(spec); if (await this.head(spec.objectKey)) throw new CatalogError('STORAGE_OBJECT_IMMUTABLE', 409);
    return this.safe(async () => { const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: spec.objectKey, ContentType: spec.contentType, Metadata: { sha256: spec.sha256 } })); if (!r.UploadId) throw new CatalogError('STORAGE_UPLOAD_ID_MISSING', 502); return r.UploadId; });
  }
  private upload(uploadId: string, part?: number): void {
    if (!uploadId || uploadId.length > 512 || [...uploadId].some(c => c.charCodeAt(0) < 32) || (part !== undefined && (!Number.isSafeInteger(part) || part < 1 || part > Math.ceil(1_000_000_000 / AUDIO_MULTIPART_PART_BYTES)))) throw new CatalogError('STORAGE_MULTIPART_INVALID', 422);
  }
  async presignPart(key: string, uploadId: string, part: number, sizeBytes: number, seconds = 900): Promise<StorageSignedCapability> {
    this.write(); this.key(key); this.upload(uploadId, part); assertSignedExpiry(seconds);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > AUDIO_MULTIPART_PART_BYTES) throw new CatalogError('STORAGE_PART_SIZE_INVALID', 422);
    return this.safe(async () => ({ url: await getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: part, ContentLength: sizeBytes }), { expiresIn: seconds, signableHeaders: new Set(['content-length']) }), expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), requiredHeaders: {} }));
  }
  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    this.key(key); this.upload(uploadId);
    return this.safe(async () => {
      const r = await this.client.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MaxParts: 1000 }));
      if (r.IsTruncated) throw new CatalogError('STORAGE_PARTS_LIMIT', 422);
      return (r.Parts ?? []).map(p => { if (!p.PartNumber || !p.ETag || p.Size === undefined) throw new CatalogError('STORAGE_MULTIPART_INVALID', 502); return { partNumber: p.PartNumber, etag: p.ETag, sizeBytes: p.Size }; });
    });
  }
  async completeMultipart(spec: AudioObjectSpec, uploadId: string, parts: UploadedPart[]): Promise<void> {
    this.write(); this.spec(spec); this.upload(uploadId);
    const actual = await this.listParts(spec.objectKey, uploadId), count = Math.ceil(spec.sizeBytes / AUDIO_MULTIPART_PART_BYTES);
    if (parts.length !== count || actual.length !== count || parts.some((p, i) => p.partNumber !== i + 1 || p.etag !== actual[i]?.etag || p.sizeBytes !== actual[i]?.sizeBytes || p.sizeBytes !== Math.min(AUDIO_MULTIPART_PART_BYTES, spec.sizeBytes - i * AUDIO_MULTIPART_PART_BYTES))) throw new CatalogError('STORAGE_MULTIPART_INCOMPLETE', 422);
    await this.safe(() => this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: spec.objectKey, UploadId: uploadId, IfNoneMatch: '*', MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) } })).then(() => undefined));
  }
  async abortMultipart(key: string, uploadId: string): Promise<void> { this.write(); this.key(key); this.upload(uploadId); await this.safe(() => this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).then(() => undefined)); }
  async listObjects(prefix = 'licensed/'): Promise<Array<{ objectKey: string; sizeBytes: number }>> {
    if (!/^(?:licensed\/|test\/[a-zA-Z0-9_-]+\/licensed\/)$/u.test(prefix)) throw new CatalogError('STORAGE_PREFIX_INVALID', 422);
    return this.safe(async () => {
      const objects: Array<{ objectKey: string; sizeBytes: number }> = []; let continuation: string | undefined;
      do { const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuation })); for (const o of r.Contents ?? []) if (o.Key && o.Size !== undefined) objects.push({ objectKey: o.Key, sizeBytes: o.Size }); continuation = r.IsTruncated ? r.NextContinuationToken : undefined; if (r.IsTruncated && !continuation) throw new CatalogError('STORAGE_LIST_INVALID', 502); } while (continuation);
      return objects;
    });
  }
  async deleteObject(key: string): Promise<void> { this.write(); this.key(key); await this.safe(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).then(() => undefined)); }
}

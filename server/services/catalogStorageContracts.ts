import type { Readable } from 'node:stream';
import { CatalogError } from './catalogContracts';

export const AUDIO_OBJECT_LIMIT_BYTES = 1_000_000_000;
export const STORAGE_SIGNED_URL_MAX_SECONDS = 900;
export const AUDIO_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export type StorageAdapterName = 'url_reference' | 'r2';
export type LicensedAudioExtension = 'mp3' | 'm4a' | 'aac' | 'ogg' | 'opus' | 'flac' | 'wav';
export type UploadStatus = 'pending' | 'uploaded' | 'verified' | 'rejected' | 'soft_deleted' | 'deleted';
export interface AudioObjectSpec { objectKey: string; sizeBytes: number; sha256: string; contentType: string }
export interface StoredAudioHead { sizeBytes: number; contentType: string; etag: string | null }
export interface UploadedPart { partNumber: number; etag: string; sizeBytes: number }
/** URLs are response-only capabilities. Never persist or audit this shape. */
export interface StorageSignedCapability { url: string; expiresAt: string; requiredHeaders: Record<string, string> }
export interface AudioObjectStorage {
  readonly adapter: StorageAdapterName;
  readonly bucket: string | null;
  /** SDK adapters release connections; reference-only adapters need no teardown. */
  close?(): void | Promise<void>;
  head(key: string): Promise<StoredAudioHead | null>;
  read(key: string, range?: { start: number; end: number }): Promise<{ body: Readable; head: StoredAudioHead }>;
  presignGet(key: string, expiresSeconds?: number): Promise<StorageSignedCapability>;
  presignPut(spec: AudioObjectSpec, expiresSeconds?: number): Promise<StorageSignedCapability>;
  beginMultipart(spec: AudioObjectSpec): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, sizeBytes: number, expiresSeconds?: number): Promise<StorageSignedCapability>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipart(spec: AudioObjectSpec, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  listObjects(prefix?: string): Promise<Array<{ objectKey: string; sizeBytes: number }>>;
  deleteObject(key: string): Promise<void>;
}
const EXTENSIONS = new Set<LicensedAudioExtension>(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav']);
export function licensedObjectKey(slug: string, surah: number, sha256: string, extension: LicensedAudioExtension): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,190}$/u.test(slug) || !Number.isSafeInteger(surah) || surah < 1 || surah > 114 || !/^[a-f0-9]{64}$/u.test(sha256) || !EXTENSIONS.has(extension)) throw new CatalogError('STORAGE_INPUT_INVALID', 422);
  return `licensed/${slug}/${String(surah).padStart(3, '0')}/${sha256}.${extension}`;
}
export function assertStorageSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > AUDIO_OBJECT_LIMIT_BYTES) throw new CatalogError('AUDIO_OBJECT_SIZE_LIMIT', 422);
}
export function assertSignedExpiry(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > STORAGE_SIGNED_URL_MAX_SECONDS) throw new CatalogError('STORAGE_EXPIRY_INVALID', 422);
}
export function validateBatchAudioNames(names: readonly string[]): { accepted: Array<{ name: string; surah: number }>; missing: number[]; duplicates: number[]; invalid: string[] } {
  const accepted: Array<{ name: string; surah: number }> = [], invalid: string[] = [];
  const counts = new Map<number, number>();
  for (const name of names) {
    const match = /^(\d{3})\.(mp3|m4a|aac|ogg|opus|flac|wav)$/u.exec(name);
    const surah = match ? Number(match[1]) : 0;
    if (surah < 1 || surah > 114) { invalid.push(name); continue; }
    counts.set(surah, (counts.get(surah) ?? 0) + 1); accepted.push({ name, surah });
  }
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([surah]) => surah);
  return { accepted: accepted.filter(a => !duplicates.includes(a.surah)), missing: Array.from({ length: 114 }, (_, i) => i + 1).filter(n => !counts.has(n)), duplicates, invalid };
}

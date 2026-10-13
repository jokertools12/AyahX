import type { UploadCheckpoint } from './uploadAudio';

interface CheckpointStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
function key(userId: string, recitationId: string, surah: number) {
  if (!uuid.test(userId) || !uuid.test(recitationId) || !Number.isInteger(surah) || surah < 1 || surah > 114) throw new Error('AUDIO_CHECKPOINT_SCOPE_INVALID');
  return `ayahx-admin-upload:${userId}:${recitationId}:${surah}`;
}

export function validateUploadCheckpoint(value: unknown): UploadCheckpoint {
  if (!value || typeof value !== 'object') throw new Error('AUDIO_CHECKPOINT_INVALID');
  const row = value as Record<string, unknown>;
  if (typeof row.storageObjectId !== 'string' || !uuid.test(row.storageObjectId) || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256) || typeof row.fileName !== 'string' || row.fileName.length > 255 || !row.fileName || typeof row.sizeBytes !== 'number' || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 || typeof row.partSizeBytes !== 'number' || !Number.isSafeInteger(row.partSizeBytes) || row.partSizeBytes < 1 || row.partCount !== Math.ceil(row.sizeBytes / row.partSizeBytes)) throw new Error('AUDIO_CHECKPOINT_INVALID');
  // Project only approved metadata even if a caller passed a whole server session.
  return { storageObjectId: row.storageObjectId, sha256: row.sha256, fileName: row.fileName, sizeBytes: row.sizeBytes, partSizeBytes: row.partSizeBytes, partCount: row.partCount as number };
}

export function saveUploadCheckpoint(storage: CheckpointStorage, userId: string, recitationId: string, surah: number, value: UploadCheckpoint) {
  storage.setItem(key(userId, recitationId, surah), JSON.stringify(validateUploadCheckpoint(value)));
}

export function readUploadCheckpoint(storage: CheckpointStorage, userId: string, recitationId: string, surah: number): UploadCheckpoint | undefined {
  const raw = storage.getItem(key(userId, recitationId, surah));
  if (raw === null) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('AUDIO_CHECKPOINT_INVALID'); }
  return validateUploadCheckpoint(parsed);
}

/** Only remove a checkpoint after confirmed completion or an explicit user abort. */
export function clearUploadCheckpoint(storage: CheckpointStorage, userId: string, recitationId: string, surah: number) {
  storage.removeItem(key(userId, recitationId, surah));
}

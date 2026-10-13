import { describe, expect, it } from 'vitest';
import { clearUploadCheckpoint, readUploadCheckpoint, saveUploadCheckpoint } from './uploadCheckpoints';

const user = '00000000-0000-4000-8000-000000000001', recitation = '00000000-0000-4000-8000-000000000002';
const checkpoint = { storageObjectId: '00000000-0000-4000-8000-000000000003', sha256: 'a'.repeat(64), fileName: '001.mp3', sizeBytes: 20, partSizeBytes: 10, partCount: 2 };
function memoryStorage() { const items = new Map<string, string>(); return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } }; }

describe('upload resume metadata', () => {
  it('scopes checkpoints to one account, recording and chapter', () => {
    const storage = memoryStorage();
    saveUploadCheckpoint(storage, user, recitation, 1, checkpoint);
    expect(readUploadCheckpoint(storage, user, recitation, 1)).toEqual(checkpoint);
    expect(readUploadCheckpoint(storage, user, recitation, 2)).toBeUndefined();
    expect(readUploadCheckpoint(storage, recitation, recitation, 1)).toBeUndefined();
    clearUploadCheckpoint(storage, user, recitation, 1);
    expect(readUploadCheckpoint(storage, user, recitation, 1)).toBeUndefined();
  });
  it('never persists signed capabilities, credentials or private upload IDs', () => {
    const storage = memoryStorage();
    saveUploadCheckpoint(storage, user, recitation, 1, { ...checkpoint, put: { url: 'https://private.invalid/?signature=secret' }, uploadId: 'private-upload' } as typeof checkpoint);
    const raw = [...storage.items.values()][0];
    expect(raw).not.toMatch(/signature|private-upload|put|uploadId/u);
  });
  it('reports corruption and keeps the evidence until the owner chooses a remedy', () => {
    const storage = memoryStorage();
    saveUploadCheckpoint(storage, user, recitation, 1, checkpoint);
    const itemKey = [...storage.items.keys()][0];
    storage.items.set(itemKey, '{bad');
    expect(() => readUploadCheckpoint(storage, user, recitation, 1)).toThrow('AUDIO_CHECKPOINT_INVALID');
    expect(storage.items.get(itemKey)).toBe('{bad');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminWrite } from '../adminApi';
import { uploadLicensedAudio, type UploadCheckpoint } from './uploadAudio';
vi.mock('../adminApi', () => ({ adminWrite: vi.fn() }));
vi.mock('./hashAudioClient', () => ({ hashAudioFile: vi.fn(async () => 'a'.repeat(64)) }));
const request = vi.mocked(adminWrite);
const file = new File([new Uint8Array(16)], '001.wav', { type: 'audio/wav' });
const checkpoint: UploadCheckpoint = { storageObjectId: 'upload-id', sha256: 'a'.repeat(64), sizeBytes: 16, fileName: '001.wav', partSizeBytes: 8, partCount: 2 };
const input = () => ({ planned: { file, surah: 1, extension: 'wav' }, recitationId: 'recitation-id', rightsRef: 'approved-review-id', signal: new AbortController().signal, checkpoint, onCheckpoint: vi.fn(), onProgress: vi.fn() });

describe('licensed multipart resume', () => {
  beforeEach(() => request.mockReset());

  it('checks the selected file hash before opening a stored upload session', async () => {
    await expect(uploadLicensedAudio({ ...input(), checkpoint: { ...checkpoint, sha256: 'b'.repeat(64) } })).rejects.toThrow('AUDIO_RESUME_FILE_MISMATCH');
    expect(request).not.toHaveBeenCalled();
  });

  it('skips already accepted parts and resumes completion without retransmission', async () => {
    request.mockResolvedValueOnce({ data: { parts: [{ partNumber: 1, etag: 'one', sizeBytes: 8 }, { partNumber: 2, etag: 'two', sizeBytes: 8 }], completedObject: false, put: null }, meta: { requestId: 'test' } });
    request.mockResolvedValueOnce({ data: { status: 'uploaded', verification_task_id: 'task-id' }, meta: { requestId: 'test' } });
    const result = await uploadLicensedAudio(input());
    expect(request.mock.calls.map(call => call[0])).toEqual(['/storage/uploads/upload-id/resume', '/storage/uploads/upload-id/finish']);
    expect(result).toEqual({ storageObjectId: 'upload-id', verificationTaskId: 'task-id' });
  });

  it('refuses inconsistent completed part sizes without overwriting them', async () => {
    request.mockResolvedValueOnce({ data: { parts: [{ partNumber: 1, etag: 'one', sizeBytes: 4 }], completedObject: false, put: null }, meta: { requestId: 'test' } });
    await expect(uploadLicensedAudio(input())).rejects.toThrow('AUDIO_RESUME_PART_SIZE_MISMATCH');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

import { adminWrite } from '../adminApi';
import { hashAudioFile } from './hashAudioClient';
import type { PlannedAudioFile } from './uploadPlan';

interface Capability { url: string; expiresAt: string; requiredHeaders: Record<string, string> }
export interface UploadCheckpoint { storageObjectId: string; sha256: string; sizeBytes: number; fileName: string; partSizeBytes: number; partCount: number }
interface UploadSession extends UploadCheckpoint { uploadId: string | null; put: Capability | null }
interface UploadResume { parts: Array<{ partNumber: number; etag: string; sizeBytes: number }>; put: Capability | null; completedObject: boolean }
export interface UploadProgress { phase: 'hashing' | 'uploading' | 'verifying'; loaded: number; total: number }
const contentTypes: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', wav: 'audio/wav' };

function putPart(capability: Capability, body: Blob, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.open('PUT', capability.url);
    xhr.timeout = 15 * 60 * 1000;
    // Presigned capabilities are response-only and never logged or persisted.
    for (const [header, value] of Object.entries(capability.requiredHeaders)) {
      if (!['host', 'content-length'].includes(header.toLowerCase())) xhr.setRequestHeader(header, value);
    }
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
    xhr.onload = () => { finish(); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error('AUDIO_UPLOAD_HTTP_FAILED')); };
    xhr.onerror = () => { finish(); reject(new Error('AUDIO_UPLOAD_NETWORK_FAILED')); };
    xhr.ontimeout = () => { finish(); reject(new Error('AUDIO_UPLOAD_TIMEOUT')); };
    xhr.onabort = () => { finish(); reject(new DOMException('Upload cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

/** Sequential parts and files keep memory and connection usage bounded. Checkpoints hold no capability. */
export async function uploadLicensedAudio(input: {
  planned: PlannedAudioFile<File>; recitationId: string; rightsRef: string; signal: AbortSignal;
  checkpoint?: UploadCheckpoint; onCheckpoint: (checkpoint: UploadCheckpoint) => void; onProgress: (progress: UploadProgress) => void;
}): Promise<{ storageObjectId: string; verificationTaskId: string | null }> {
  const { file, surah, extension } = input.planned;
  const sha256 = await hashAudioFile(file, bytes => input.onProgress({ phase: 'hashing', loaded: bytes, total: file.size }), input.signal);
  if (input.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  let checkpoint = input.checkpoint;
  if (checkpoint && (checkpoint.sha256 !== sha256 || checkpoint.sizeBytes !== file.size || checkpoint.fileName !== file.name)) throw new Error('AUDIO_RESUME_FILE_MISMATCH');
  let resume: UploadResume | null = null;
  if (checkpoint) resume = (await adminWrite<UploadResume>(`/storage/uploads/${checkpoint.storageObjectId}/resume`, 'POST', {})).data;
  else {
    const session = (await adminWrite<UploadSession>('/storage/uploads', 'POST', { recitationId: input.recitationId, surah, sha256, sizeBytes: file.size, extension, contentType: contentTypes[extension], rightsRef: input.rightsRef, multipart: true })).data;
    checkpoint = { storageObjectId: session.storageObjectId, sha256, sizeBytes: file.size, fileName: file.name, partSizeBytes: session.partSizeBytes, partCount: session.partCount };
    input.onCheckpoint(checkpoint);
  }
  if (!Number.isSafeInteger(checkpoint.partSizeBytes) || checkpoint.partSizeBytes < 1 || checkpoint.partCount !== Math.ceil(file.size / checkpoint.partSizeBytes)) throw new Error('AUDIO_UPLOAD_SESSION_INVALID');
  let sent = 0;
  if (!resume?.completedObject) {
    for (let number = 1; number <= checkpoint.partCount; number++) {
      if (input.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const start = (number - 1) * checkpoint.partSizeBytes;
      const part = file.slice(start, Math.min(file.size, start + checkpoint.partSizeBytes));
      const completed = resume?.parts.find(row => row.partNumber === number);
      if (completed && completed.sizeBytes !== part.size) throw new Error('AUDIO_RESUME_PART_SIZE_MISMATCH');
      if (!completed) {
        const capability = (await adminWrite<Capability>(`/storage/uploads/${checkpoint.storageObjectId}/parts`, 'POST', { partNumber: number })).data;
        await putPart(capability, part, bytes => input.onProgress({ phase: 'uploading', loaded: sent + bytes, total: file.size }), input.signal);
      }
      sent += part.size;
      input.onProgress({ phase: 'uploading', loaded: sent, total: file.size });
    }
  }
  if (input.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  const finished = (await adminWrite<{ status: string; verification_task_id?: string }>(`/storage/uploads/${checkpoint.storageObjectId}/finish`, 'POST', {})).data;
  input.onProgress({ phase: 'verifying', loaded: file.size, total: file.size });
  return { storageObjectId: checkpoint.storageObjectId, verificationTaskId: finished.verification_task_id ?? null };
}

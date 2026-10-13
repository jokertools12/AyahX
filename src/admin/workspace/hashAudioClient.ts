export function hashAudioFile(file: File, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hashAudio.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Upload cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = (event: MessageEvent<{ type: string; bytes?: number; sha256?: string }>) => {
      if (event.data.type === 'progress') onProgress(event.data.bytes ?? 0);
      else if (event.data.type === 'complete' && /^[a-f0-9]{64}$/u.test(event.data.sha256 ?? '')) { finish(); resolve(event.data.sha256!); }
      else { finish(); reject(new Error('AUDIO_LOCAL_HASH_FAILED')); }
    };
    worker.onerror = () => { finish(); reject(new Error('AUDIO_LOCAL_HASH_FAILED')); };
    worker.postMessage({ file });
  });
}

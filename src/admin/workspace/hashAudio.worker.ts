import { audioFileChunks, hashAudioChunks } from './hashAudio';

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const sha256 = await hashAudioChunks(audioFileChunks(event.data.file), bytes => self.postMessage({ type: 'progress', bytes }));
    self.postMessage({ type: 'complete', sha256 });
  } catch {
    // File names, contents and upload capabilities never enter diagnostic output.
    self.postMessage({ type: 'error', code: 'AUDIO_LOCAL_HASH_FAILED' });
  }
};

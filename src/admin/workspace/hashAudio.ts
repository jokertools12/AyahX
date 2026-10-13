import { sha256 } from '@noble/hashes/sha2.js';

/** Bounded memory: one chunk plus the digest state, independent of the file size. */
export async function hashAudioChunks(chunks: AsyncIterable<Uint8Array>, onBytes?: (bytes: number) => void): Promise<string> {
  const hash = sha256.create();
  let bytes = 0;
  try {
    for await (const chunk of chunks) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      onBytes?.(bytes);
    }
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    hash.destroy();
  }
}

export async function* audioFileChunks(file: Blob): AsyncGenerator<Uint8Array> {
  const chunkBytes = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    yield new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
  }
}

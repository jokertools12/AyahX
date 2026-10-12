import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashAudioChunks } from './hashAudio';

describe('streaming audio SHA-256', () => {
  it('matches the independent Node digest across irregular chunk boundaries', async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 173).map((_, index) => index % 251);
    async function* chunks() { for (let offset = 0; offset < bytes.length; offset += 65537) yield bytes.subarray(offset, offset + 65537); }
    let processed = 0;
    const digest = await hashAudioChunks(chunks(), count => { processed = count; });
    expect(digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(processed).toBe(bytes.length);
  });

  it('rejects stream read errors rather than reporting a digest of truncated input', async () => {
    async function* failing() { yield new Uint8Array([1, 2]); throw new Error('read refused'); }
    await expect(hashAudioChunks(failing())).rejects.toThrow('read refused');
  });
});

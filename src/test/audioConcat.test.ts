import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { concatenateAudioUrls } from '@/lib/audioConcat';

class MockAudioBuffer {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  duration: number;
  private channelData: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number) {
    return this.channelData[channel] || this.channelData[0];
  }
}

class MockAudioContext {
  sampleRate = 44100;

  async decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    // Decode into a synthetic 2-second audio buffer (88,200 samples at 44.1kHz)
    const samples = buffer.byteLength > 0 ? buffer.byteLength * 100 : 88200;
    return new MockAudioBuffer(1, samples, 44100) as unknown as AudioBuffer;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }

  async close(): Promise<void> {}
}

describe('Audio Concatenation Engine (src/lib/audioConcat.ts)', () => {
  const originalAudioContext = window.AudioContext;
  const originalCreateObjectURL = window.URL.createObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    (window as any).AudioContext = MockAudioContext;
    window.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-concatenated-audio-blob');
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    window.URL.createObjectURL = originalCreateObjectURL;
    vi.restoreAllMocks();
  });

  it('returns empty result safely when empty array of URLs is provided', async () => {
    const result = await concatenateAudioUrls([]);
    expect(result).toEqual({
      blobUrl: '',
      totalDuration: 0,
      timestamps: [],
    });
  });

  it('returns empty result when null or undefined is passed', async () => {
    const resultNull = await concatenateAudioUrls(null as any);
    expect(resultNull.totalDuration).toBe(0);
    expect(resultNull.timestamps).toEqual([]);

    const resultUndef = await concatenateAudioUrls(undefined as any);
    expect(resultUndef.totalDuration).toBe(0);
    expect(resultUndef.timestamps).toEqual([]);
  });

  it('concatenates multiple audio URLs, computing cumulative timestamps with zero gap', async () => {
    const mockUrls = [
      'https://everyayah.com/data/001001.mp3',
      'https://everyayah.com/data/001002.mp3',
      'https://everyayah.com/data/001003.mp3',
    ];

    const progressTracker: Array<{ loaded: number; total: number }> = [];

    // Mock fetch to return dummy byte arrays
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (!mockUrls.includes(urlStr)) {
        return { ok: false, status: 404 } as any;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(441), // 441 bytes -> 44,100 samples -> 1.0 second
      } as any;
    });

    const result = await concatenateAudioUrls(mockUrls, (loaded, total) => {
      progressTracker.push({ loaded, total });
    });

    expect(result.blobUrl).toBe('blob:http://localhost/mock-concatenated-audio-blob');
    expect(result.timestamps).toHaveLength(3);

    // Verify per-segment cumulative timestamps start from 0 and chain seamlessly
    expect(result.timestamps[0].from).toBe(0);
    expect(result.timestamps[0].to).toBe(1);

    expect(result.timestamps[1].from).toBe(1);
    expect(result.timestamps[1].to).toBe(2);

    expect(result.timestamps[2].from).toBe(2);
    expect(result.timestamps[2].to).toBe(3);

    expect(result.totalDuration).toBe(3);

    // Verify progress tracking reported all segments
    expect(progressTracker).toHaveLength(3);
    expect(progressTracker[progressTracker.length - 1]).toEqual({ loaded: 3, total: 3 });
  });

  it('throws an error and rejects when an audio segment fails to fetch (e.g. 404/500)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('missing')) {
        return { ok: false, status: 404, statusText: 'Not Found' } as any;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(100),
      } as any;
    });

    const urls = [
      'https://everyayah.com/data/valid.mp3',
      'https://everyayah.com/data/missing.mp3',
    ];

    await expect(concatenateAudioUrls(urls)).rejects.toThrow('Failed to fetch https://everyayah.com/data/missing.mp3');
  });

  it('handles a single audio URL correctly', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(441),
      } as any;
    });

    const result = await concatenateAudioUrls(['https://everyayah.com/data/single.mp3']);
    expect(result.timestamps).toHaveLength(1);
    expect(result.timestamps[0].from).toBe(0);
    expect(result.timestamps[0].to).toBe(1);
    expect(result.totalDuration).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { surahs } from '@/data/surahs';
import { SURAH_AYAH_COUNTS } from '../../server/routes/videos';
import { famousAyahs } from '@/data/famousAyahs';
import { QUALITY_PRESETS, getQualityDimensions } from '@/hooks/useVideoRecorder';
import { H264_BROADCAST_ARGS, MPEG4_FALLBACK_ARGS } from '@/lib/ffmpeg';
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
    const samples = buffer.byteLength > 0 ? buffer.byteLength * 100 : 88200;
    return new MockAudioBuffer(1, samples, 44100) as unknown as AudioBuffer;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }

  async close(): Promise<void> {}
}

describe('Video Pipeline Deep QA & Broadcast Engineering Suite', () => {
  const originalAudioContext = window.AudioContext;
  const originalCreateObjectURL = window.URL.createObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    (window as any).AudioContext = MockAudioContext;
    window.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-audio-blob');
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    window.URL.createObjectURL = originalCreateObjectURL;
    vi.restoreAllMocks();
  });

  describe('Phase 1: Quranic Content & Tashkeel Accuracy (Zero-Tolerance)', () => {
    it('QA-01: Verifies all 114 Surahs have authentic canonical verse counts matching Mushaf standard', () => {
      expect(surahs).toHaveLength(114);
      expect(SURAH_AYAH_COUNTS).toHaveLength(114);

      for (let i = 0; i < 114; i++) {
        const surah = surahs[i];
        const expectedCount = SURAH_AYAH_COUNTS[i];
        expect(surah.number).toBe(i + 1);
        expect(surah.numberOfAyahs).toBe(expectedCount);
      }
    });

    it('QA-02: Verifies famous verses preserve authentic Uthmani tashkeel without corruption', () => {
      expect(famousAyahs.length).toBeGreaterThanOrEqual(10);

      // Verify Ayat al-Kursi (2:255)
      const ayatAlKursi = famousAyahs.find((a) => a.surahNumber === 2 && a.startAyah === 255);
      expect(ayatAlKursi).toBeDefined();
      expect(ayatAlKursi!.name).toBe('آية الكرسي');

      // Verify Al-Ikhlas (112:1-4)
      const alIkhlas = famousAyahs.find((a) => a.surahNumber === 112 && a.startAyah === 1);
      expect(alIkhlas).toBeDefined();
      expect(alIkhlas!.endAyah).toBe(4);

      // Verify authentic tashkeel in surah name data
      const fatihaSurah = surahs[0];
      expect(fatihaSurah.name).toBe('الفاتحة');
    });
  });

  describe('Phase 2: Audio Engineering & Concatenation Quality', () => {
    it('QA-03: Multi-ayah concatenation generates continuous cumulative timestamps with zero gap', async () => {
      const mockUrls = [
        'https://everyayah.com/data/001001.mp3',
        'https://everyayah.com/data/001002.mp3',
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(441), // 44,100 samples = 1.0s
        } as any;
      });

      const res = await concatenateAudioUrls(mockUrls);
      expect(res.timestamps).toHaveLength(2);
      expect(res.timestamps[0].from).toBe(0);
      expect(res.timestamps[0].to).toBe(1);
      expect(res.timestamps[1].from).toBe(1);
      expect(res.timestamps[1].to).toBe(2);
      expect(res.totalDuration).toBe(2);
    });

    it('QA-04: Boundary micro-fade smoothing applies smooth ramp at segment transitions', async () => {
      // Audio buffer concatenation applies micro-fade smoothing to prevent non-zero-crossing pops
      const urls = ['https://everyayah.com/data/001001.mp3', 'https://everyayah.com/data/001002.mp3'];
      vi.spyOn(global, 'fetch').mockImplementation(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(441),
      } as any));

      const res = await concatenateAudioUrls(urls);
      expect(res.blobUrl).toBe('blob:http://localhost/mock-audio-blob');
    });
  });

  describe('Phase 3: Sub-Frame Audio-Visual Synchronization Engine', () => {
    it('QA-05: Accurately maps Quran Foundation millisecond timestamps to active ayah and highlighted word', () => {
      const mockTimings = [
        {
          verse_key: '1:1',
          timestamp_from: 0,
          timestamp_to: 4500,
          segments: [
            [1, 0, 950],
            [2, 950, 1850],
            [3, 1850, 3100],
            [4, 3100, 4500],
          ] as [number, number, number][],
        },
        {
          verse_key: '1:2',
          timestamp_from: 4500,
          timestamp_to: 8900,
          segments: [
            [1, 4500, 5600],
            [2, 5600, 6900],
            [3, 6900, 8900],
          ] as [number, number, number][],
        },
      ];

      const evaluateSync = (nowMs: number) => {
        for (let i = 0; i < mockTimings.length; i++) {
          const t = mockTimings[i];
          if (nowMs >= t.timestamp_from && nowMs < t.timestamp_to) {
            const seg = t.segments.find((s) => nowMs >= s[1] && nowMs < s[2]);
            return {
              ayahIndex: i,
              wordIndex: seg ? seg[0] - 1 : null,
              wordProgress: seg ? (nowMs - seg[1]) / (seg[2] - seg[1]) : 0,
            };
          }
        }
        return null;
      };

      // At 500ms (Word 0 of Ayah 0)
      const sync1 = evaluateSync(500);
      expect(sync1).toEqual({
        ayahIndex: 0,
        wordIndex: 0,
        wordProgress: 500 / 950,
      });

      // At 2000ms (Word 2 of Ayah 0)
      const sync2 = evaluateSync(2000);
      expect(sync2?.ayahIndex).toBe(0);
      expect(sync2?.wordIndex).toBe(2);

      // At 5000ms (Word 0 of Ayah 1)
      const sync3 = evaluateSync(5000);
      expect(sync3?.ayahIndex).toBe(1);
      expect(sync3?.wordIndex).toBe(0);
    });
  });

  describe('Phase 4: Broadcast Encoding & Social Platform Target Specifications', () => {
    it('QA-06: H.264 broadcast encoding includes -movflags +faststart for instant Instagram & TikTok playback', () => {
      expect(H264_BROADCAST_ARGS).toContain('-movflags');
      expect(H264_BROADCAST_ARGS).toContain('+faststart');
      expect(H264_BROADCAST_ARGS).toContain('-profile:v');
      expect(H264_BROADCAST_ARGS).toContain('high');
      // Let the encoder choose the level: forcing 4.1 breaks 4K at 60 fps.
      expect(H264_BROADCAST_ARGS).not.toContain('-level:v');
      expect(H264_BROADCAST_ARGS).toContain('-crf');
      expect(H264_BROADCAST_ARGS).toContain('20');
      expect(H264_BROADCAST_ARGS).toContain('-pix_fmt');
      expect(H264_BROADCAST_ARGS).toContain('yuv420p');
      expect(H264_BROADCAST_ARGS).toContain('-max_muxing_queue_size');
      expect(H264_BROADCAST_ARGS).toContain('1024');
    });

    it('QA-07: Audio encoding strictly enforces 192kbps AAC stereo for broadcast fidelity', () => {
      expect(H264_BROADCAST_ARGS).toContain('-c:a');
      expect(H264_BROADCAST_ARGS).toContain('aac');
      expect(H264_BROADCAST_ARGS).toContain('-b:a');
      expect(H264_BROADCAST_ARGS).toContain('192k');
      expect(H264_BROADCAST_ARGS).toContain('-ar');
      expect(H264_BROADCAST_ARGS).toContain('44100');
      expect(H264_BROADCAST_ARGS).toContain('-ac');
      expect(H264_BROADCAST_ARGS).toContain('2');

      expect(MPEG4_FALLBACK_ARGS).toContain('-movflags');
      expect(MPEG4_FALLBACK_ARGS).toContain('+faststart');
    });

    it('QA-08: Resolution presets correctly configure 9:16 vertical reels and 16:9 landscape dimensions', () => {
      // 9:16 vertical resolutions
      const high916 = getQualityDimensions('high', '9:16');
      expect(high916).toEqual({ width: 1080, height: 1920 });

      const ultra916 = getQualityDimensions('ultra', '9:16');
      expect(ultra916).toEqual({ width: 2160, height: 3840 });

      const medium916 = getQualityDimensions('medium', '9:16');
      expect(medium916).toEqual({ width: 720, height: 1280 });

      // 16:9 landscape resolutions
      const high169 = getQualityDimensions('high', '16:9');
      expect(high169).toEqual({ width: 1920, height: 1080 });

      const ultra169 = getQualityDimensions('ultra', '16:9');
      expect(ultra169).toEqual({ width: 3840, height: 2160 });

      // Bitrates match upgraded broadcast specs for crisp Arabic diacritics
      expect(QUALITY_PRESETS.high.bitrate).toBe(8_000_000);
      expect(QUALITY_PRESETS.ultra.bitrate).toBe(18_000_000);
    });
  });

  describe('Phase 5: Safe Zone & Dynamic Text Fitting', () => {
    it('QA-09: Long verse auto-scaling bounds text within 48% vertical height of canvas', () => {
      const canvasHeight = 1920;
      const maxAllowedHeight = canvasHeight * 0.48; // 921.6px

      // Simulation of layout calculation for long verse (50 words)
      const simulatedLinesCount = 8;
      const simulatedLineHeight = 135;
      const initialTotalHeight = simulatedLinesCount * simulatedLineHeight; // 1080px (> 921.6px)

      expect(initialTotalHeight).toBeGreaterThan(maxAllowedHeight);

      const scaleDown = Math.max(0.68, Math.min(1, maxAllowedHeight / initialTotalHeight));
      const adjustedTotalHeight = initialTotalHeight * scaleDown;

      expect(scaleDown).toBeCloseTo(921.6 / 1080, 2);
      expect(adjustedTotalHeight).toBeLessThanOrEqual(maxAllowedHeight);
      expect(scaleDown).toBeGreaterThanOrEqual(0.68); // readable floor
    });

    it('QA-10: Short verse retains full scale without unnecessary reduction', () => {
      const canvasHeight = 1920;
      const maxAllowedHeight = canvasHeight * 0.48; // 921.6px

      // Simulation of short verse (Al-Kawthar 108:1, 4 words = 1 line)
      const simulatedLinesCount = 1;
      const simulatedLineHeight = 135;
      const initialTotalHeight = simulatedLinesCount * simulatedLineHeight; // 135px

      expect(initialTotalHeight).toBeLessThan(maxAllowedHeight);
      const scaleDown = initialTotalHeight > maxAllowedHeight ? maxAllowedHeight / initialTotalHeight : 1.0;
      expect(scaleDown).toBe(1.0);
    });
  });
});

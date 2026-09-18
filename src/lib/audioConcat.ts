/**
 * Fetches multiple audio URLs, decodes them, and concatenates them
 * into a single seamless WAV blob with zero gaps between segments,
 * micro-fade boundary smoothing, and broadcast peak normalization.
 *
 * Returns the blob URL and per-segment timestamps (in seconds).
 */

export interface ConcatResult {
  /** Object URL pointing to a WAV blob of the concatenated audio */
  blobUrl: string;
  /** Total duration in seconds */
  totalDuration: number;
  /** Per-segment start/end timestamps in seconds */
  timestamps: { from: number; to: number }[];
}

export async function concatenateAudioUrls(
  urls: string[],
  onProgress?: (loaded: number, total: number) => void
): Promise<ConcatResult> {
  if (!urls || urls.length === 0) {
    return {
      blobUrl: '',
      totalDuration: 0,
      timestamps: [],
    };
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();

  // 1. Fetch all files in parallel
  const buffers: ArrayBuffer[] = await Promise.all(
    urls.map(async (url, i) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}`);
      const buf = await res.arrayBuffer();
      onProgress?.(i + 1, urls.length);
      return buf;
    })
  );

  // 2. Decode all to AudioBuffer
  const rawDecoded: AudioBuffer[] = await Promise.all(
    buffers.map((buf) => ctx.decodeAudioData(buf.slice(0))) // slice to avoid detached buffer issues
  );

  // Standard target sample rate for broadcast audio
  const targetSampleRate = rawDecoded[0]?.sampleRate ?? 44100;

  // 3. Resample buffers if any segment has differing sampleRate
  const decoded: AudioBuffer[] = await Promise.all(
    rawDecoded.map(async (ab) => {
      if (ab.sampleRate === targetSampleRate) return ab;
      try {
        const OfflineCtx =
          window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        if (!OfflineCtx) return ab;
        const targetLen = Math.round(ab.duration * targetSampleRate);
        const offline = new OfflineCtx(ab.numberOfChannels, targetLen, targetSampleRate);
        const src = offline.createBufferSource();
        src.buffer = ab;
        src.connect(offline.destination);
        src.start(0);
        return await offline.startRendering();
      } catch {
        return ab;
      }
    })
  );

  // 4. Calculate total length and per-segment timestamps
  const numChannels = Math.max(...decoded.map((d) => d.numberOfChannels), 1);
  let totalSamples = 0;
  const timestamps: { from: number; to: number }[] = [];

  for (const ab of decoded) {
    const fromSec = totalSamples / targetSampleRate;
    totalSamples += ab.length;
    const toSec = totalSamples / targetSampleRate;
    timestamps.push({ from: fromSec, to: toSec });
  }

  // 5. Concatenate into a single buffer with boundary smoothing
  const merged = ctx.createBuffer(numChannels, totalSamples, targetSampleRate);
  let offset = 0;

  // 5ms micro-fade window (sample count) to eliminate clicks/pops at segment transitions
  const fadeLengthSamples = Math.round(targetSampleRate * 0.005);

  for (let s = 0; s < decoded.length; s++) {
    const ab = decoded[s];
    const isFirstSegment = s === 0;
    const isLastSegment = s === decoded.length - 1;
    const curFade = Math.min(fadeLengthSamples, Math.floor(ab.length / 4));

    for (let ch = 0; ch < numChannels; ch++) {
      const srcCh = ch < ab.numberOfChannels ? ch : 0;
      const srcData = ab.getChannelData(srcCh);
      const destData = merged.getChannelData(ch);

      // Copy samples
      destData.set(srcData, offset);

      // Apply smooth cosine micro-ramp at boundary if multiple segments
      if (curFade > 0 && decoded.length > 1) {
        if (!isFirstSegment) {
          // Fade in at head of segment
          for (let f = 0; f < curFade; f++) {
            const gain = 0.5 * (1 - Math.cos((Math.PI * f) / curFade));
            destData[offset + f] *= gain;
          }
        }
        if (!isLastSegment) {
          // Fade out at tail of segment
          for (let f = 0; f < curFade; f++) {
            const gain = 0.5 * (1 + Math.cos((Math.PI * f) / curFade));
            destData[offset + ab.length - curFade + f] *= gain;
          }
        }
      }
    }
    offset += ab.length;
  }

  // 6. Broadcast peak normalization (-1.0 dBFS = 0.891 target amplitude)
  let maxAbsSample = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = merged.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxAbsSample) maxAbsSample = abs;
    }
  }

  if (maxAbsSample > 0.001) {
    const targetPeak = 0.891; // -1.0 dBFS
    // Only adjust if clipping (> 0.99) or noticeably quiet (< 0.5)
    if (maxAbsSample > 0.99 || maxAbsSample < 0.5) {
      const normFactor = Math.min(Math.max(targetPeak / maxAbsSample, 0.4), 2.2);
      for (let ch = 0; ch < numChannels; ch++) {
        const data = merged.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.max(-1, Math.min(1, data[i] * normFactor));
        }
      }
    }
  }

  // 7. Encode to WAV
  const wavBlob = audioBufferToWav(merged);
  const blobUrl = URL.createObjectURL(wavBlob);

  ctx.close().catch(() => {});

  return {
    blobUrl,
    totalDuration: totalSamples / targetSampleRate,
    timestamps,
  };
}

// ── WAV encoder ─────────────────────────────────────────────────────────────

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Interleave channels
  const length = buffer.length * numChannels;
  const interleaved = new Float32Array(length);

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[i * numChannels + ch] = buffer.getChannelData(ch)[i];
    }
  }

  // Write WAV
  const dataLength = length * (bitDepth / 8);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write samples
  let writeOffset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(writeOffset, val, true);
    writeOffset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

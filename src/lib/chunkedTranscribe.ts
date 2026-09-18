/**
 * Client-side audio chunking for full transcription.
 * Splits audio into ~30s WAV segments, sends each to the edge function,
 * and merges results with correct timestamps.
 */

import { api } from '@/lib/api';

const CHUNK_DURATION_SEC = 90;

export interface TranscribedLine {
  text: string;
  start: number;
  end: number;
}

export interface ChunkedTranscriptionResult {
  text: string;
  lines: TranscribedLine[];
}

/**
 * Encode an AudioBuffer segment to a base64 WAV string downsampled to 16kHz mono.
 */
function audioBufferSegmentToBase64Wav(
  source: AudioBuffer,
  startSample: number,
  endSample: number
): string {
  const srcRate = source.sampleRate;
  const targetRate = 16000;
  const rawLength = endSample - startSample;

  // Extract and downmix to mono
  const srcChannel0 = source.getChannelData(0);
  const srcChannel1 = source.numberOfChannels > 1 ? source.getChannelData(1) : null;
  const rawMono = new Float32Array(rawLength);
  for (let i = 0; i < rawLength; i++) {
    const s0 = srcChannel0[startSample + i] || 0;
    const s1 = srcChannel1 ? srcChannel1[startSample + i] : s0;
    rawMono[i] = (s0 + s1) / 2;
  }

  // Resample to 16000 Hz if necessary for minimal payload and speech AI optimization
  let mono: Float32Array;
  let sampleRate: number;
  if (srcRate !== targetRate && srcRate > 0) {
    const targetLength = Math.max(1, Math.round((rawLength * targetRate) / srcRate));
    mono = new Float32Array(targetLength);
    const ratio = rawLength / targetLength;
    for (let i = 0; i < targetLength; i++) {
      const srcIdx = Math.min(Math.floor(i * ratio), rawLength - 1);
      mono[i] = rawMono[srcIdx];
    }
    sampleRate = targetRate;
  } else {
    mono = rawMono;
    sampleRate = srcRate;
  }

  const length = mono.length;
  const numChannels = 1; // mono for smaller payload
  const bitDepth = 16;

  // WAV encode
  const dataLength = length * (bitDepth / 8);
  const totalLength = 44 + dataLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let off = 44;
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }

  // Convert to base64 in safe chunks to avoid call stack overflow and memory pressure
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Transcribe full audio by chunking it into segments.
 */
export async function transcribeFullAudio(
  audioUrl: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ChunkedTranscriptionResult> {
  // 1. Fetch and decode the full audio client-side
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`Failed to fetch audio: ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();

  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  const totalDuration = decoded.duration;
  const sampleRate = decoded.sampleRate;

  // 2. Calculate chunks (90s each)
  const totalChunks = Math.max(1, Math.ceil(totalDuration / CHUNK_DURATION_SEC));
  onProgress?.(0, totalChunks);

  // 3. Process each chunk sequentially with resilient retry
  const allLines: TranscribedLine[] = [];
  let fullText = "";

  for (let i = 0; i < totalChunks; i++) {
    const startSec = i * CHUNK_DURATION_SEC;
    const endSec = Math.min((i + 1) * CHUNK_DURATION_SEC, totalDuration);
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(Math.floor(endSec * sampleRate), decoded.length);

    const chunkBase64 = audioBufferSegmentToBase64Wav(decoded, startSample, endSample);

    let payload: any = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        payload = await api.services.transcribeAudio(chunkBase64, startSec, "ara", "audio/wav");
        break;
      } catch (chunkErr: any) {
        attempts++;
        const isRateLimit = chunkErr?.message?.includes('429') || chunkErr?.message?.includes('تجاوز الحد');
        console.warn(`Chunk ${i + 1}/${totalChunks} attempt ${attempts} warning:`, chunkErr);
        if (attempts >= maxAttempts) {
          break;
        }
        // If rate limited, back off longer
        const delay = isRateLimit ? 2500 * attempts : 1200 * attempts;
        await new Promise((res) => setTimeout(res, delay));
      }
    }

    if (payload?.lines && Array.isArray(payload.lines)) {
      for (const rawLine of payload.lines) {
        const text = String(rawLine.text || '').trim();
        if (!text) continue;
        const rawStart = typeof rawLine.start === 'number' ? rawLine.start : (typeof rawLine.startTime === 'number' ? rawLine.startTime : 0);
        const rawEnd = typeof rawLine.end === 'number' ? rawLine.end : (typeof rawLine.endTime === 'number' ? rawLine.endTime : rawStart + 3.5);

        // Normalize timestamps to global audio timeline
        const finalStart = rawStart >= startSec ? rawStart : startSec + rawStart;
        const finalEnd = rawEnd >= startSec ? rawEnd : startSec + rawEnd;

        allLines.push({
          text,
          start: Math.round(finalStart * 100) / 100,
          end: Math.round(finalEnd * 100) / 100,
        });
      }
    }

    if (payload?.text) {
      fullText += (fullText ? " " : "") + String(payload.text).trim();
    }

    onProgress?.(i + 1, totalChunks);
  }

  ctx.close().catch(() => {});

  return {
    text: fullText || allLines.map((l) => l.text).join(" "),
    lines: allLines,
  };
}

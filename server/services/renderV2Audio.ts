import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http, { type IncomingMessage } from 'node:http';
import { lookup } from 'node:dns/promises';
import { randomBytes, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CatalogError } from './catalogContracts';
import { assertCatalogAudioUrl, isPublicAudioAddress } from './catalogAudioSource';
import { catalogStorageFromEnvironment } from './catalogStorageRuntime';
import type { AudioObjectStorage } from './catalogStorageContracts';
import { getFfmpegBinary, getFfprobeBinary } from './ffmpegBinary';
import { runRenderV2Process } from './renderV2Process';

export interface RenderV2AudioInput {
  allowedHosts: string[];
  sourceIdentity: { kind: 'external_url'; url: string } | { kind: 'licensed_url'; url: string; sha256: string; sourceId: string } | { kind: 'licensed_r2'; objectKey: string; sha256: string; sourceId: string };
  parts: Array<{ url: string; sliceFromMs?: number; sliceToMs?: number }>;
}
export interface AudioFetchRecord { host: string; method: string; range: string | null; status: number; bytes: number; purpose: 'render' | 'reference' }
export interface PreparedRenderV2Audio {
  audioPath: string; referencePcmPath: string; audioBytesFetched: number; referenceBytesFetched: number;
  sourceSizeBytes: number; rangeSupported: boolean; fullDownloadFallback: boolean;
  warnings: string[]; requests: AudioFetchRecord[]; durationMs: number;
  seekMethod: 'qa_packet_index_remote_range' | 'ffmpeg_http_seek' | 'bounded_full_download';
}
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const nextRequest = new Map<string, number>();
const blockedUntil = new Map<string, number>();
interface SourceResponse { body: Readable; status: number; size: number; total: number; contentType: string; etag: string | null; host: string }

function demuxer(contentType: string): string {
  const type = contentType.split(';')[0].toLowerCase();
  const formats: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'mov' };
  if (!formats[type]) throw new CatalogError('AUDIO_DEMUXER_NOT_ALLOWED', 422);
  return formats[type];
}
export function parseAudioByteRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (!match) throw new CatalogError('AUDIO_RANGE_INVALID', 422);
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new CatalogError('AUDIO_RANGE_INVALID', 422);
  return { start, end: Math.min(end, size - 1) };
}

class AudioTransport {
  readonly requests: AudioFetchRecord[] = [];
  private storage: AudioObjectStorage | null = null;
  private total = 0;
  private identityEtag: string | null = null;
  constructor(private readonly input: RenderV2AudioInput, private readonly signal?: AbortSignal) {}
  async open(range: { start: number; end: number } | undefined, purpose: 'render' | 'reference'): Promise<SourceResponse> {
    this.signal?.throwIfAborted();
    const identity = this.input.sourceIdentity;
    let result: SourceResponse;
    if (identity.kind === 'licensed_r2') {
      this.storage ??= catalogStorageFromEnvironment('r2', 'read_only', []);
      if (!this.total) {
        const head = await this.storage.head(identity.objectKey);
        if (!head) throw new CatalogError('LICENSED_AUDIO_UNAVAILABLE', 502);
        this.total = head.sizeBytes; this.identityEtag = head.etag;
      }
      const response = await this.storage.read(identity.objectKey, range);
      result = { body: response.body, size: response.head.sizeBytes, total: this.total, contentType: response.head.contentType, etag: response.head.etag, status: range ? 206 : 200, host: 'licensed_r2' };
    } else {
      let url = assertCatalogAudioUrl(identity.url, this.input.allowedHosts);
      let response: IncomingMessage | undefined;
      for (let hop = 0; hop <= 5; hop++) {
        const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => { throw new CatalogError('AUDIO_DNS_UNAVAILABLE', 502); });
        if (!addresses.length || addresses.some(address => !isPublicAudioAddress(address.address))) throw new CatalogError('AUDIO_DNS_UNSAFE', 422);
        const blocked = blockedUntil.get(url.hostname) ?? 0;
        if (blocked > Date.now()) throw new CatalogError('AUDIO_RATE_LIMITED', 429, { retry_at: new Date(blocked).toISOString() });
        const wait = Math.max(0, (nextRequest.get(url.hostname) ?? 0) - Date.now());
        nextRequest.set(url.hostname, Date.now() + wait + 1000);
        if (wait) await delay(wait, undefined, { signal: this.signal });
        const address = addresses[0];
        response = await new Promise<IncomingMessage>((resolve, reject) => {
          const request = https.request(url, { method: 'GET', agent: false, family: address.family, signal: this.signal, timeout: 20_000,
            lookup: (_host, options, done) => options.all ? done(null, [address]) : done(null, address.address, address.family),
            headers: { 'User-Agent': 'AyahX-D7-RenderLab/2.0', Accept: 'audio/*', 'Accept-Encoding': 'identity', ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) },
          }, resolve);
          request.once('timeout', () => request.destroy());
          request.once('error', () => reject(new CatalogError('AUDIO_REQUEST_FAILED', 502)));
          request.end();
        });
        const status = response.statusCode ?? 0;
        if (status === 429) {
          const raw = String(response.headers['retry-after'] ?? '60');
          const until = /^\d+$/u.test(raw) ? Date.now() + Number(raw) * 1000 : Date.parse(raw);
          const retryAt = Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 60_000;
          blockedUntil.set(url.hostname, retryAt); response.destroy();
          throw new CatalogError('AUDIO_RATE_LIMITED', 429, { retry_at: new Date(retryAt).toISOString() });
        }
        if (status >= 300 && status < 400) {
          const location = response.headers.location; response.destroy();
          if (!location || hop === 5) throw new CatalogError('AUDIO_REDIRECT_INVALID', 502);
          url = assertCatalogAudioUrl(new URL(location, url).href, this.input.allowedHosts);
          continue;
        }
        break;
      }
      if (!response || ![200, 206].includes(response.statusCode ?? 0)) { response?.destroy(); throw new CatalogError('AUDIO_UNAVAILABLE', 502); }
      const size = Number(response.headers['content-length']);
      const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(String(response.headers['content-range'] ?? ''));
      if (response.statusCode === 206 && (!range || !contentRange || Number(contentRange[1]) !== range.start || Number(contentRange[2]) > range.end)) { response.destroy(); throw new CatalogError('AUDIO_RANGE_RESPONSE_INVALID', 502); }
      result = { body: response, status: response.statusCode!, size, total: contentRange ? Number(contentRange[3]) : size, contentType: String(response.headers['content-type'] ?? ''), etag: String(response.headers.etag ?? '') || null, host: url.hostname };
    }
    if (!Number.isSafeInteger(result.total) || result.total < 1 || result.total > MAX_SOURCE_BYTES) { result.body.destroy(); throw new CatalogError('AUDIO_SIZE_LIMIT', 422, {source_bytes:Number.isFinite(result.total)?result.total:null,maximum_bytes:MAX_SOURCE_BYTES}); }
    if (!Number.isSafeInteger(result.size) || result.size < 1) { result.body.destroy(); throw new CatalogError('AUDIO_RESPONSE_LENGTH_REQUIRED', 502); }
    if (this.total && result.total !== this.total || this.identityEtag && result.etag !== this.identityEtag) { result.body.destroy(); throw new CatalogError('AUDIO_SOURCE_CHANGED', 409); }
    this.total = result.total; this.identityEtag ??= result.etag;
    demuxer(result.contentType);
    const record: AudioFetchRecord = { host: result.host, method: 'GET', range: range ? `bytes=${range.start}-${range.end}` : null, status: result.status, bytes: 0, purpose };
    this.requests.push(record);
    result.body.on('data', (chunk: Buffer) => { record.bytes += chunk.length; if (record.bytes > MAX_SOURCE_BYTES) result.body.destroy(new CatalogError('AUDIO_SIZE_LIMIT', 422)); });
    return result;
  }
  close(): void | Promise<void> { return this.storage?.close?.(); }
}

/** Owned per-job scratch files only. No provider asset survives executor cleanup. */
export async function prepareRenderV2Audio(input: RenderV2AudioInput, scratch: string, durationMs: number, signal?: AbortSignal): Promise<PreparedRenderV2Audio> {
  if (input.parts.length !== 1) throw new CatalogError('AUDIO_PLAN_UNSUPPORTED', 422);
  const { sliceFromMs: from, sliceToMs: to } = input.parts[0];
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || Number(from) < 0 || Number(to) <= Number(from) || Number(to) - Number(from) !== durationMs || durationMs > 90_000) throw new CatalogError('AUDIO_PLAN_INVALID', 422);
  const source = new AudioTransport(input, signal);
  const fallbackPath = path.join(scratch, 'source-fallback.bin');
  const referencePath = path.join(scratch, 'reference-source.bin');
  const referencePcmPath = path.join(scratch, 'reference-full.s16le');
  const audioPath = path.join(scratch, 'render-audio.wav');
  let proxy: http.Server | undefined, proxyFailure: unknown;
  try {
    const probe = await source.open({ start: 0, end: 0 }, 'render');
    const rangeSupported = probe.status === 206;
    const format = demuxer(probe.contentType);
    let seekMethod: PreparedRenderV2Audio['seekMethod'] = rangeSupported ? 'ffmpeg_http_seek' : 'bounded_full_download';
    // The lab always needs an independent full-decode QA reference. Its audio is
    // NEVER the render input when Range works. Packet metadata can index VBR MP3
    // exactly, whereas Xing/fastseek positions do not guarantee sample accuracy.
    if (rangeSupported) {
      for await (const _chunk of probe.body) { /* actual one-byte response */ }
      const full = await source.open(undefined, 'reference');
      await pipeline(full.body, fs.createWriteStream(referencePath), { signal });
    }
    let inputPath: string;
    let seekFromMs = Number(from);
    if (!rangeSupported) {
      await pipeline(probe.body, fs.createWriteStream(fallbackPath), { signal });
      inputPath = fallbackPath;
      await fs.promises.copyFile(fallbackPath, referencePath);
    } else if (format === 'mp3') {
      const metadata = await runRenderV2Process(getFfprobeBinary(), ['-v','error','-select_streams','a:0','-show_packets','-show_streams','-show_entries','packet=pos,size,pts_time:stream=codec_name,start_time','-of','json',referencePath], {signal,outputLimitBytes:64*1024*1024,timeoutMs:300_000});
      const index = JSON.parse(metadata.stdout.toString('utf8')) as {streams:Array<{codec_name:string;start_time:string}>;packets:Array<{pos:string;size:string;pts_time:string}>};
      if (index.streams.length !== 1 || index.streams[0].codec_name !== 'mp3' || !index.packets.length) throw new CatalogError('AUDIO_PACKET_INDEX_INVALID',422);
      const origin = Number(index.streams[0].start_time)*1000;
      const packets = index.packets.map(packet=>({pos:Number(packet.pos),size:Number(packet.size),time:Number(packet.pts_time)*1000-origin}));
      if(!Number.isFinite(origin)||packets.some((packet,i)=>!Number.isSafeInteger(packet.pos)||!Number.isSafeInteger(packet.size)||packet.size<1||!Number.isFinite(packet.time)||i>0&&(packet.pos<=packets[i-1].pos||packet.time<=packets[i-1].time)))throw new CatalogError('AUDIO_PACKET_INDEX_INVALID',422);
      const first = packets.findLast(packet=>packet.time<=Number(from)-3000)??packets[0];
      const last = packets.find(packet=>packet.time>=Number(to)+500)??packets[packets.length-1];
      const fragment = await source.open({start:first.pos,end:last.pos+last.size-1},'render');
      if(fragment.status!==206)throw new CatalogError('AUDIO_RANGE_SUPPORT_CHANGED',409);
      inputPath=path.join(scratch,'render-range.mp3');
      await pipeline(fragment.body,fs.createWriteStream(inputPath),{signal});
      seekFromMs=Number(from)-first.time;
      if(seekFromMs<0)throw new CatalogError('AUDIO_PACKET_INDEX_INVALID',422);
      seekMethod='qa_packet_index_remote_range';
    } else {
      for await (const _chunk of probe.body) { /* consume the actual 1-byte range */ }
      const nonce = randomBytes(20).toString('hex');
      proxy = http.createServer(async (request, response) => {
        if (request.url !== `/${nonce}` || !['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(404); response.end(); return; }
        if (request.method === 'HEAD') { response.writeHead(200, { 'Content-Length': probe.total, 'Accept-Ranges': 'bytes', 'Content-Type': probe.contentType }); response.end(); return; }
        let body: Readable | undefined;
        try {
          const range = parseAudioByteRange(request.headers.range, probe.total);
          const upstream = await source.open(range, 'render'); body = upstream.body;
          if (range && upstream.status !== 206) throw new CatalogError('AUDIO_RANGE_SUPPORT_CHANGED', 409);
          response.writeHead(upstream.status, { 'Content-Length': upstream.size, 'Content-Type': upstream.contentType, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${range.start}-${range.start + upstream.size - 1}/${upstream.total}` } : {}) });
          response.once('close', () => body?.destroy());
          await pipeline(body, response);
        } catch (error) {
          body?.destroy();
          // FFmpeg closes completed seek requests deliberately. All other failures stay fatal.
          if (!(error && typeof error === 'object' && 'code' in error && ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'].includes(String(error.code)) && response.destroyed)) proxyFailure ??= error;
          if (!response.headersSent) response.writeHead(502);
          response.end();
        }
      });
      await new Promise<void>((resolve, reject) => { proxy!.once('error', reject); proxy!.listen(0, '127.0.0.1', resolve); });
      const address = proxy.address();
      if (!address || typeof address === 'string') throw new CatalogError('AUDIO_PROXY_UNAVAILABLE', 503);
      inputPath = `http://127.0.0.1:${address.port}/${nonce}`;
    }
    const coarseMs = Math.max(0, seekFromMs - 2000), preciseMs = seekFromMs - coarseMs;
    const remoteInput=seekMethod==='ffmpeg_http_seek';
    await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-y', '-v', 'error', '-threads', '1', '-protocol_whitelist', remoteInput ? 'http,tcp' : 'file', ...(remoteInput ? ['-seekable','1'] : []), '-ss', String(coarseMs / 1000), '-probesize', '32768', '-analyzeduration', '0', '-f', format, '-i', inputPath, '-ss', String(preciseMs / 1000), '-t', String(durationMs / 1000), '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', audioPath], { signal });
    if (proxyFailure) throw proxyFailure;
    // QA independently decodes the ENTIRE source; these bytes are explicitly separate from optimized fetch.
    if (input.sourceIdentity.kind !== 'external_url') {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(referencePath)) hash.update(chunk);
      if (hash.digest('hex') !== input.sourceIdentity.sha256) throw new CatalogError('LICENSED_RECORDING_CHANGED', 409);
    }
    await runRenderV2Process(getFfmpegBinary(), ['-nostdin', '-y', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-f', format, '-i', referencePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', referencePcmPath], { signal, timeoutMs: 300_000 });
    return { audioPath, referencePcmPath, durationMs, seekMethod, sourceSizeBytes: probe.total, rangeSupported, fullDownloadFallback: !rangeSupported, warnings: rangeSupported ? seekMethod==='qa_packet_index_remote_range'?['QA_PACKET_INDEX_FROM_FULL_REFERENCE']:[] : ['AUDIO_RANGE_UNSUPPORTED_FULL_DOWNLOAD'], audioBytesFetched: source.requests.filter(r => r.purpose === 'render').reduce((n, r) => n + r.bytes, 0), referenceBytesFetched: source.requests.filter(r => r.purpose === 'reference').reduce((n, r) => n + r.bytes, 0), requests: source.requests };
  } finally {
    if (proxy) { proxy.closeAllConnections(); await new Promise<void>((resolve, reject) => proxy!.close(error => error ? reject(new CatalogError('AUDIO_PROXY_CLOSE_FAILED', 503)) : resolve())); }
    await source.close();
  }
}

import crypto from 'crypto';
import { validateUrlForSsrf } from './assetCatalogResolver';

export interface AudioFingerprint {
  sha256: string;
  byteLength: number;
  sourceUrl: string;
}

const MAX_AUDIO_FINGERPRINT_BYTES = 96 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: AudioFingerprint }>();
const pending = new Map<string, Promise<AudioFingerprint>>();
// Quran Foundation's documented chapter-recitation response currently uses
// download.quranicaudio.com; retain the other first-party CDN aliases for
// existing catalogued assets. Redirects are re-validated against this same set.
const QURAN_AUDIO_HOSTS = new Set([
  'audio.qurancdn.com',
  'verses.quran.com',
  'download.quranicaudio.com',
]);

function assertTrustedQuranAudioUrl(sourceUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('AUDIO_FINGERPRINT_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || !QURAN_AUDIO_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('AUDIO_FINGERPRINT_SOURCE_NOT_TRUSTED');
  }
  const ssrfCheck = validateUrlForSsrf(sourceUrl);
  if (!ssrfCheck.safe) throw new Error(`AUDIO_FINGERPRINT_SOURCE_UNSAFE:${ssrfCheck.reason || 'unknown'}`);
  return parsed;
}

async function fetchTrustedAudio(url: URL, redirectsRemaining = 3): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: 'audio/*,application/octet-stream;q=0.8,*/*;q=0.1', 'User-Agent': 'AyahX audio identity service' },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirectsRemaining <= 0) throw new Error('AUDIO_FINGERPRINT_TOO_MANY_REDIRECTS');
    const location = response.headers.get('location');
    if (!location) throw new Error('AUDIO_FINGERPRINT_REDIRECT_INVALID');
    const target = assertTrustedQuranAudioUrl(new URL(location, url).toString());
    return fetchTrustedAudio(target, redirectsRemaining - 1);
  }
  return response;
}

async function fingerprintUncached(sourceUrl: string): Promise<AudioFingerprint> {
  const parsed = assertTrustedQuranAudioUrl(sourceUrl);
  const response = await fetchTrustedAudio(parsed);
  if (!response.ok || !response.body) throw new Error(`AUDIO_FINGERPRINT_FETCH_FAILED:${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_FINGERPRINT_BYTES) {
    throw new Error('AUDIO_FINGERPRINT_TOO_LARGE');
  }
  const hash = crypto.createHash('sha256');
  let byteLength = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > MAX_AUDIO_FINGERPRINT_BYTES) {
        throw new Error('AUDIO_FINGERPRINT_TOO_LARGE');
      }
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!byteLength) throw new Error('AUDIO_FINGERPRINT_EMPTY');
  return { sha256: hash.digest('hex'), byteLength, sourceUrl: parsed.toString() };
}

/**
 * Produces the identity used by a TimingMap. The source is allowlisted, all
 * redirects are revalidated, and bytes are streamed rather than buffered.
 */
export async function fingerprintTrustedQuranAudio(sourceUrl: string): Promise<AudioFingerprint> {
  const parsed = assertTrustedQuranAudioUrl(sourceUrl);
  const key = parsed.toString();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key)!;
  const job = fingerprintUncached(key)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      if (cache.size > 100) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

export function clearAudioFingerprintCache(): void {
  cache.clear();
  pending.clear();
}

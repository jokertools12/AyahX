import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import {
  normalizeQuranicToken,
  tokenizeQuranicText,
  validateTimingMap,
  type TimingGap,
  type TimingMap,
  type TimingWord,
} from '../../src/lib/timingMap';

/** Pinned word and optional letter-tier import from QUA's v3 release schema. */
const RELEASE = 'v3.2.0';
const RELEASE_BASE = `https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/${RELEASE}`;
const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CACHED_PACKAGES = 2;

type UniversalReciter = { slug: string; zip: string; sha256: string };

/** SHA-256 values copied from the pinned v3.2.0 manifest.json. */
const QUA_PACKAGE_SHA256: Record<string, string> = {
  abdulbasit_abdulsamad_mujawwad_tarteel: '41ef6119a81562f490a4373882a558b65341e568112e9f64988018d4fadc4f10',
  abdulbasit_abdulsamad_tarteel: 'd3646692f484fff29ea47ffc9b1edfd29198eab7ebdd3c2a132d0a068a46e6ec',
  abdullah_al_qarafi_mp3quran: '6034ed5b43bc0c684552dfad6e243b9e8401a23c4ceda5c112d118532d3a0101',
  abdulwadood_haneef_mp3quran: 'f257a676e492449b23845c43d02cca7355fc55a6c54c8020b2f970652b8affea',
  abdur_rashid_sufi_qdc: '77c4b65cd802ae2ff0ba67d4ca6e0874add54468901ab7c893225c4877e9f1f0',
  abu_bakr_al_shatri_tarteel: 'c644c4b2afee7767c7efa591eef8b6c9914fe9a6ae5688e8a140f7612f623de3',
  ahmed_amer_tvquran: '85f8b2afd876b4f10e3563da6ffbcbf65ffc414b9c20143ba3dd8cdce876c628',
  ahmed_issa_al_maasaraawi_mp3quran: '2db0e118e8183498a910be79ffaab7fe961ba31116d4e35de44aca6b335fc271',
  ahmed_shaheen_mp3quran: 'cd6f4619b46e89b9cc67b2cfc3f1c3a553768e5f46ef71798b6ee9b3019e64ca',
  ali_al_huthaifi_mp3quran: '69538d785009f547305057b68e0028d91a552c0e118a3cfcb0eac1698a42a294',
  islam_sobhi_mp3quran: '6b6cc24872d936ce15f528da5979b24551441deeb6c5141d63181267e075b239',
  khalifa_al_tunaiji_tarteel: '62492ad2a5ff577e824cfce35812b3aeb68afebad447cf65e44044c6e0ef803e',
  maher_al_muaiqly_qdc: '538c8ec00170eacfd908872177d4d5446a062f9a0f98c8ddbad467cd78b9b567',
  mahmoud_abdul_hakam_mp3quran: 'd1174b1045db6863eb53e28e1db8a2cdc9f68ae6f941b5430562076111953bb4',
  mahmoud_ali_al_banna_qdc: '4f3ea23a7b6a11c4e3036e8baee3cbaa23818177e63766bef2b0daa85549a0f3',
  mahmoud_khalil_al_husary_mp3quran: '478e20aa0bdbb3d4a89a55e44788989843e2a46efb99ecd11712791d7b4dbc7e',
  mahmoud_khalil_al_husary_mujawwad_tarteel: 'e7d4ab547f441da2b049a81e5047b88ce20caf42680e8d8de491dc3eb3977f83',
  mishary_rashid_al_afasy_mp3quran: '2ef64637e14b657fc354c6aab718344d61102b6a4934a32ff214c77bd1e3db69',
  mohammed_alghazali_archive: '9e6f74d8b36c68506ff911bb6a92bfedb72ccac45ce1d2a05155dc1395c70d05',
  mohammed_siddiq_al_minshawi_mp3quran: 'c69b69cca4d2b320c1129149c0f81bf63390cb5bc8da4362c7f57d86af54d9ce',
  mustafa_ismail_mp3quran: '61a70baec5b1e008b65fdf52517aa3636ad0f700b819d9062873839da08853ac',
  nasser_al_qatami_mp3quran: '5d1102e89035093062402973162ec96c8b8d00e4f62f29f0e1719e3ecbc99ff0',
  saud_al_shuraim_mp3quran: '0b30f23f92874fc54caf7bb83633f3b62da22f992f95a596c1886a681bd36e56',
};

export const QUA_RECITATIONS: Record<string, UniversalReciter> = Object.fromEntries(
  Object.entries(QUA_PACKAGE_SHA256).map(([slug, sha256]) => [slug, { slug, zip: `${slug}.zip`, sha256 }]),
);

type UniversalCatalog = {
  schema_version: number;
  slug: string;
  audio_category: string;
  riwayah?: string;
  coverage: { ayahs: number; surahs: number };
  audio: {
    chapter_urls?: Record<string, string>;
    chapter_offsets_ms?: Record<string, number>;
    sample_rate_hz?: number;
    channels?: number;
  };
};

type UniversalWordRow = [
  reference: string,
  startMs: number,
  endMs: number,
  canonical: boolean,
  silenceAfterMs: number,
  words: Array<[wordIndex1Based: number, startMs: number, endMs: number]>,
];

type UniversalWordData = {
  _meta: {
    schema_version: number;
    slug: string;
    audio_category: string;
    units: string;
    riwayah: string;
    tier: string;
    script_sha256: string;
  };
  rows: UniversalWordRow[];
};

type UniversalLetterEvent = [wordOccurrenceIndex: number, startMs: number, endMs: number, ownsSound: boolean, paintRanges: Array<[number, number]>];
type UniversalLetterRow = [
  reference: string,
  startMs: number,
  endMs: number,
  canonical: boolean,
  silenceAfterMs: number,
  words: UniversalWordRow[5],
  text: string,
  events: UniversalLetterEvent[],
];
type UniversalLetterData = {
  _meta: {
    schema_version: number;
    slug: string;
    audio_category: string;
    units: string;
    riwayah: string;
    tier: string;
    script_sha256: string;
    script?: string;
    unicode_indexing?: string;
  };
  rows: UniversalLetterRow[];
};

type UniversalPackage = { catalog: UniversalCatalog; word: UniversalWordData; letterGzip?: Uint8Array };

const packageCache = new Map<string, Promise<UniversalPackage>>();
const AUDIO_HOST_SUFFIXES = ['mp3quran.net', 'tarteel.ai', 'quranicaudio.com', 'tvquran.com', 'archive.org'];
const QUA_HAFS_RIWAYAH = 'hafs_an_asim';
const QUA_HAFS_SCRIPT_SHA256 = '19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86';

function catalogAudioUrl(catalog: UniversalCatalog, surahNumber: number): string {
  if (catalog.audio_category !== 'by_surah') throw new Error('UNIVERSAL_ALIGNMENT_AUDIO_LAYOUT_UNSUPPORTED');
  const value = catalog.audio?.chapter_urls?.[String(surahNumber)];
  if (typeof value !== 'string') throw new Error('UNIVERSAL_ALIGNMENT_AUDIO_NOT_AVAILABLE');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('UNIVERSAL_ALIGNMENT_AUDIO_URL_INVALID'); }
  const allowedHost = AUDIO_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password) {
    throw new Error('UNIVERSAL_ALIGNMENT_AUDIO_URL_UNSAFE');
  }
  return url.toString();
}

function catalogAssetHash(slug: string, surahNumber: number, audioUrl: string, offsetMs: number, packageSha256: string): string {
  const assetIdentity = `quranic-universal-audio:${RELEASE}:${slug}:${packageSha256}:${surahNumber}:${audioUrl}:${offsetMs}`;
  return createHash('sha256').update(assetIdentity).digest('hex');
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_PACKAGE_BYTES) throw new Error('UNIVERSAL_ALIGNMENT_PACKAGE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('UNIVERSAL_ALIGNMENT_PACKAGE_TOO_LARGE');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_PACKAGE_BYTES) throw new Error('UNIVERSAL_ALIGNMENT_PACKAGE_TOO_LARGE');
    chunks.push(part.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function parseGzipJson<T>(zip: Record<string, Uint8Array>, fileName: string): T {
  const file = zip[fileName];
  if (!file) throw new Error('UNIVERSAL_ALIGNMENT_DATA_INVALID');
  return JSON.parse(strFromU8(gunzipSync(file))) as T;
}

async function loadPackage(slug: string): Promise<UniversalPackage> {
  const existing = packageCache.get(slug);
  if (existing) {
    const packageData = await existing;
    packageCache.delete(slug);
    packageCache.set(slug, Promise.resolve(packageData));
    return packageData;
  }
  const reciter = QUA_RECITATIONS[slug];
  if (!reciter) throw new Error('UNIVERSAL_ALIGNMENT_RECITER_NOT_SUPPORTED');
  const promise = (async () => {
    const response = await fetch(`${RELEASE_BASE}/${reciter.zip}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`UNIVERSAL_ALIGNMENT_HTTP_${response.status}`);
    const bytes = await readResponseBytes(response);
    const packageSha256 = createHash('sha256').update(bytes).digest('hex');
    if (packageSha256 !== reciter.sha256) throw new Error('UNIVERSAL_ALIGNMENT_PACKAGE_CHECKSUM_MISMATCH');
    const zip = unzipSync(bytes);
    const catalog = JSON.parse(strFromU8(zip['catalog.json'] || new Uint8Array())) as UniversalCatalog;
    const word = parseGzipJson<UniversalWordData>(zip, 'word_timestamps.json.gz');
    if (catalog.schema_version !== 3 || catalog.slug !== reciter.slug || catalog.audio_category !== 'by_surah'
      || catalog.riwayah !== QUA_HAFS_RIWAYAH || !Number.isInteger(catalog.coverage?.ayahs) || catalog.coverage.ayahs < 1
      || !catalog.audio || typeof catalog.audio.chapter_urls !== 'object'
      || word._meta?.schema_version !== 3 || word._meta.slug !== reciter.slug || word._meta.audio_category !== 'by_surah'
      || word._meta.units !== 'ms' || word._meta.riwayah !== 'hafs' || word._meta.tier !== 'word'
      || word._meta.script_sha256 !== QUA_HAFS_SCRIPT_SHA256 || !Array.isArray(word.rows)) {
      throw new Error('UNIVERSAL_ALIGNMENT_CATALOG_INVALID');
    }
    return { catalog, word, letterGzip: zip['letter_timestamps.json.gz'] };
  })();
  packageCache.set(slug, promise);
  try {
    const packageData = await promise;
    packageCache.delete(slug);
    packageCache.set(slug, Promise.resolve(packageData));
    while (packageCache.size > MAX_CACHED_PACKAGES) {
      const oldest = packageCache.keys().next().value;
      if (oldest === undefined) break;
      packageCache.delete(oldest);
    }
    return packageData;
  } catch (error) { packageCache.delete(slug); throw error; }
}

export interface UniversalAlignmentInput {
  reciterId: string;
  reciterSlug: string;
  granularity?: 'word' | 'letter';
  reference: {
    surahNumber: number;
    startAyah: number;
    endAyah: number;
    ayahs: Array<{ numberInSurah: number; text: string }>;
    quranTextVersion?: string;
  };
}

function normalizeLetterProjection(text: string): string {
  // QUA's digital_khatt_v2 uses standard Arabic Yeh, while some Uthmani
  // sources encode Yeh as Arabic Letter Yeh with Hamza Above / Farsi Yeh.
  // Normalize only these presentation-equivalent script forms after the
  // Quran token normalizer has removed recitation marks.
  return normalizeQuranicToken(text)
    .replace(/[ٱ]/g, 'ا')
    .replace(/ی/g, 'ي')
    // Mushaf text services use precomposed hamza-on-waw/ya where QUA's
    // digital_khatt_v2 encodes the equivalent as a combining hamza mark.
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u08D3-\u08FF]/g, '')
    .replace(/[\u200C-\u200F\uFEFF]/g, '');
}

function loadLetterTier(packageData: UniversalPackage, slug: string): UniversalLetterData {
  if (!packageData.letterGzip) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_TIER_NOT_AVAILABLE');
  const letter = JSON.parse(strFromU8(gunzipSync(packageData.letterGzip))) as UniversalLetterData;
  if (letter._meta?.schema_version !== 3 || letter._meta.slug !== slug || letter._meta.audio_category !== 'by_surah'
    || letter._meta.units !== 'ms' || letter._meta.riwayah !== 'hafs' || letter._meta.tier !== 'letter'
    || letter._meta.script !== 'digital_khatt_v2' || letter._meta.script_sha256 !== QUA_HAFS_SCRIPT_SHA256
    || letter._meta.unicode_indexing !== 'scalar'
    || !Array.isArray(letter.rows) || letter.rows.length !== packageData.word.rows.length) {
    throw new Error('UNIVERSAL_ALIGNMENT_LETTER_CATALOG_INVALID');
  }
  return letter;
}

function letterSpansForWord(input: {
  row: UniversalLetterRow;
  wordIndex: number;
  displayToken: string;
  wordStartMs: number;
  wordEndMs: number;
  chapterOffsetMs: number;
  wordOccurrenceId: string;
}): TimingWord['letters'] {
  const { row, wordIndex, displayToken, wordStartMs, wordEndMs, chapterOffsetMs, wordOccurrenceId } = input;
  const scalars = Array.from(row[6]);
  if (scalars.length > 4096 || !Array.isArray(row[7])) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');

  const eventGroups = new Map<string, {
    startMs: number;
    endMs: number;
    ownsSound: boolean;
    paint: Array<{ scalarStart: number; scalarEnd: number; token: string }>;
  }>();
  let previousStartMs = -1;
  for (let eventIndex = 0; eventIndex < row[7].length; eventIndex += 1) {
    const rawEvent = row[7][eventIndex] as unknown;
    if (!Array.isArray(rawEvent) || rawEvent.length !== 5) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
    const [wordOccurrenceIndex, localStartValue, localEndValue, ownsSound, paintRanges] = rawEvent as UniversalLetterEvent;
    const localStart = Number(localStartValue);
    const localEnd = Number(localEndValue);
    if (!Array.isArray(row[5]) || !Number.isInteger(wordOccurrenceIndex) || wordOccurrenceIndex < 0 || wordOccurrenceIndex >= row[5].length
      || typeof ownsSound !== 'boolean' || !Number.isFinite(localStart) || !Number.isFinite(localEnd)
      || localStart < row[1] || localEnd > row[2] || localEnd < localStart || localStart < previousStartMs
      || !Array.isArray(paintRanges)) {
      throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
    }
    previousStartMs = localStart;
    const parsedRanges = paintRanges.map((range) => {
      if (!Array.isArray(range) || range.length !== 2) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
      const [scalarStart, scalarEnd] = range.map(Number);
      if (!Number.isInteger(scalarStart) || !Number.isInteger(scalarEnd)
        || scalarEnd <= scalarStart || scalarEnd > scalars.length) {
        throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
      }
      return { scalarStart, scalarEnd, token: scalars.slice(scalarStart, scalarEnd).join('') };
    });
    if (wordOccurrenceIndex !== wordIndex || parsedRanges.length === 0) continue;

    const startMs = localStart + chapterOffsetMs;
    const endMs = localEnd + chapterOffsetMs;
    const groupKey = `${localStart}:${localEnd}`;
    const group = eventGroups.get(groupKey) || { startMs, endMs, ownsSound: false, paint: [] };
    group.ownsSound ||= ownsSound;
    group.paint.push(...parsedRanges);
    eventGroups.set(groupKey, group);
  }

  // QUA legitimately emits several paint events at the same audio interval
  // (for example, a base glyph and its attached marks). Render those glyphs
  // together as one step; treating each as a sequential span made the
  // canonical interval validator reject valid letter-tier packages.
  const spans: NonNullable<TimingWord['letters']> = Array.from(eventGroups.values())
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .map((group, index) => {
      const orderedPaint = group.paint.sort((left, right) => left.scalarStart - right.scalarStart);
      for (let paintIndex = 1; paintIndex < orderedPaint.length; paintIndex += 1) {
        if (orderedPaint[paintIndex].scalarStart < orderedPaint[paintIndex - 1].scalarEnd) {
          throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
        }
      }
      const flags: string[] = [];
      if (group.startMs === group.endMs) flags.push('instantaneous_paint');
      if (group.startMs < wordStartMs || group.endMs > wordEndMs) flags.push('cross_word_boundary');
      if (!group.ownsSound) flags.push('non_acoustic_paint');
      return {
        occurrenceId: `${wordOccurrenceId}:letter:${index + 1}`,
        token: orderedPaint.map((paint) => paint.token).join(''),
        startMs: group.startMs,
        endMs: group.endMs,
        confidence: 1,
        ...(flags.length > 0 ? { flags } : {}),
      };
    });
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].startMs < spans[index - 1].endMs) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_WORD_RANGE_INVALID');
  }
  const sourceProjection = normalizeLetterProjection(spans.map((span) => span.token).join(''));
  const displayProjection = normalizeLetterProjection(displayToken);
  if (spans.length === 0 || sourceProjection !== displayProjection) return undefined;
  return spans;
}

export async function resolveUniversalQuranAudio(input: UniversalAlignmentInput): Promise<{ timingMap: TimingMap; audioUrl: string; reciter: UniversalReciter & { coverageAyahs: number } }> {
  const reciter = QUA_RECITATIONS[input.reciterSlug];
  if (!reciter) throw new Error('UNIVERSAL_ALIGNMENT_RECITER_NOT_SUPPORTED');
  const { surahNumber, startAyah, endAyah } = input.reference;
  if (input.reference.quranTextVersion && input.reference.quranTextVersion !== 'uthmani_hafs_v1') {
    throw new Error('UNIVERSAL_ALIGNMENT_TEXT_VERSION_UNSUPPORTED');
  }
  const packageData = await loadPackage(input.reciterSlug);
  const letterData = input.granularity === 'letter' ? loadLetterTier(packageData, input.reciterSlug) : undefined;
  const sourceAudioUrl = catalogAudioUrl(packageData.catalog, surahNumber);
  const chapterOffsetMs = Number(packageData.catalog.audio.chapter_offsets_ms?.[String(surahNumber)] || 0);
  if (!Number.isFinite(chapterOffsetMs) || chapterOffsetMs < 0) throw new Error('UNIVERSAL_ALIGNMENT_CATALOG_INVALID');

  const words: TimingWord[] = [];
  const gaps: TimingGap[] = [];
  const compositionOffsets: NonNullable<TimingMap['compositionOffsets']> = [];
  let previousWordEndMs = -1;
  let rangeEndMs = 0;

  for (let index = 0; index <= endAyah - startAyah; index += 1) {
    const ayahNumber = startAyah + index;
    const reference = input.reference.ayahs[index];
    if (!reference || reference.numberInSurah !== ayahNumber) throw new Error('UNIVERSAL_ALIGNMENT_REFERENCE_INVALID');
    const text = reference.text;
    // Standalone waqf symbols are presentation marks, not independently timed words.
    let tokens = tokenizeQuranicText(text);
    if (tokens.length === 0) throw new Error('UNIVERSAL_ALIGNMENT_TEXT_MISMATCH');

    const key = `${surahNumber}:${ayahNumber}`;
    const candidates = packageData.word.rows.filter((row) => Array.isArray(row) && row[0] === key);
    const canonicalRows = candidates.filter((row) => row[3] === true);
    if (canonicalRows.length !== 1) throw new Error('UNIVERSAL_ALIGNMENT_AYAH_NOT_AVAILABLE');
    const [rowKey, rawStart, rawEnd, , , sourceWords] = canonicalRows[0];
    const letterRows = letterData?.rows.filter((row) => Array.isArray(row) && row[0] === key && row[3] === true) || [];
    const startMs = Number(rawStart) + chapterOffsetMs;
    const endMs = Number(rawEnd) + chapterOffsetMs;
    if (ayahNumber === 1 && surahNumber !== 1 && surahNumber !== 9 && Array.isArray(sourceWords) && tokens.length === sourceWords.length + 4) {
      tokens = tokens.slice(4);
    }
    if (rowKey !== key || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || !(endMs > startMs)
      || !Array.isArray(sourceWords) || sourceWords.length === 0) {
      throw new Error('UNIVERSAL_ALIGNMENT_DATA_INVALID');
    }
    if (letterData && letterRows.length !== 1) throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
    const letterRow = letterRows[0];
    if (letterRow && (letterRow.length !== 8 || letterRow[1] !== canonicalRows[0][1]
      || letterRow[2] !== canonicalRows[0][2] || !Array.isArray(letterRow[5])
      || letterRow[5].length !== sourceWords.length || typeof letterRow[6] !== 'string' || !Array.isArray(letterRow[7])
      || letterRow[5].some((letterWord, wordIndex) => (
        !Array.isArray(letterWord) || letterWord.length !== 3 || !Array.isArray(sourceWords[wordIndex])
        || letterWord.some((value, valueIndex) => value !== sourceWords[wordIndex][valueIndex])
      )))) {
      throw new Error('UNIVERSAL_ALIGNMENT_LETTER_DATA_INVALID');
    }
    if (letterRow) {
      const letterTokens = letterRow[6].split(/\s+/).map(normalizeLetterProjection).filter(Boolean);
      if (letterTokens.length !== sourceWords.length
        || letterTokens.some((token, tokenIndex) => {
          const wIdx = Number(sourceWords[tokenIndex][0]);
          return token !== normalizeLetterProjection(tokens[wIdx - 1]);
        })) {
        throw new Error('UNIVERSAL_ALIGNMENT_LETTER_TEXT_MISMATCH');
      }
    }
    compositionOffsets.push({ ayahNumber, startMs, endMs });
    rangeEndMs = Math.max(rangeEndMs, endMs);

    for (let wordOffset = 0; wordOffset < sourceWords.length; wordOffset += 1) {
      const sourceWord = sourceWords[wordOffset];
      if (!Array.isArray(sourceWord) || sourceWord.length !== 3) throw new Error('UNIVERSAL_ALIGNMENT_DATA_INVALID');
      const [wordIndex, rawWordStart, rawWordEnd] = sourceWord.map(Number);
      const wordStartMs = rawWordStart + chapterOffsetMs;
      const wordEndMs = rawWordEnd + chapterOffsetMs;
      // Validate word timestamps and ensure wordIndex points to a valid Quran token in the ayah
      if (!Number.isInteger(wordIndex) || wordIndex < 1 || wordIndex > tokens.length
        || !Number.isFinite(wordStartMs) || !Number.isFinite(wordEndMs)
        || wordStartMs < startMs || wordEndMs > endMs || !(wordEndMs > wordStartMs)
        || wordStartMs < previousWordEndMs) {
        throw new Error('UNIVERSAL_ALIGNMENT_DATA_INVALID');
      }
      if (previousWordEndMs >= 0 && wordStartMs - previousWordEndMs >= 80) {
        gaps.push({ startMs: previousWordEndMs, endMs: wordStartMs, type: 'waqf' });
      }
      const tokenText = tokens[wordIndex - 1];
      const occurrenceId = `${key}:${wordIndex}:qua-${wordStartMs}-${wordEndMs}`;
      const letters = letterRow ? letterSpansForWord({
        row: letterRow,
        wordIndex: wordOffset,
        displayToken: tokenText,
        wordStartMs,
        wordEndMs,
        chapterOffsetMs,
        wordOccurrenceId: occurrenceId,
      }) : undefined;
      words.push({
        canonicalWordKey: `${surahNumber}:${ayahNumber}:${wordIndex}`,
        displayWordIndex: words.length,
        displayToken: tokenText,
        normalizedAlignmentToken: normalizeQuranicToken(tokenText),
        startMs: wordStartMs,
        endMs: wordEndMs,
        // QUA does not publish a numeric confidence field.  This value records
        // that the pinned source timestamp is structurally verified, not model probability.
        confidence: 1,
        occurrenceId,
        letters,
      });
      previousWordEndMs = wordEndMs;
    }
  }

  const hasCompleteLetterTier = words.length > 0 && words.every((word) => Boolean(word.letters?.length));
  if (input.granularity === 'letter' && !hasCompleteLetterTier) {
    throw new Error('UNIVERSAL_ALIGNMENT_LETTER_TIER_INCOMPLETE');
  }

  const audioHash = catalogAssetHash(reciter.slug, surahNumber, sourceAudioUrl, chapterOffsetMs, reciter.sha256);
  const timingMap: TimingMap = {
    schemaVersion: '1.0.0',
    mapId: `tm-qua-${reciter.slug}-${surahNumber}-${startAyah}_${endAyah}-${input.granularity === 'letter' ? 'letter' : 'word'}-${audioHash.slice(0, 12)}`,
    reciterId: input.reciterId,
    sourceId: 'quranic_universal_audio',
    sourceUrlOrImmutableAssetId: sourceAudioUrl,
    audioContentHash: audioHash,
    audioFingerprintKind: 'dataset_asset_identity_sha256',
    decodedDurationMs: rangeEndMs,
    sampleRate: packageData.catalog.audio.sample_rate_hz || 44100,
    channels: packageData.catalog.audio.channels || 2,
    audioProcessingVersion: 'source_audio_unmodified_v1',
    surahNumber,
    ayahRange: { from: startAyah, to: endAyah },
    compositionOffsets,
    quranTextVersion: input.reference.quranTextVersion || 'uthmani_hafs_v1',
    segmentationVersion: 'qpc-hafs-canonical-word-v1',
    alignerVersion: `quranic-universal-audio-${RELEASE}`,
    sourceMethod: 'verified_dataset',
    validationStatus: 'approved',
    alignment: {
      provider: 'quranic_universal_aligner',
      providerVersion: RELEASE,
      requestedGranularity: input.granularity || 'word',
      availableGranularities: hasCompleteLetterTier ? ['word', 'letter'] : ['word'],
      quranEdition: input.reference.quranTextVersion || 'uthmani_hafs_v1',
      riwayah: QUA_HAFS_RIWAYAH,
      license: 'CC-BY-4.0',
      createdBy: 'dataset_import',
    },
    review: {
      status: 'approved',
      reviewerId: `quranic-universal-audio-${RELEASE}-release`,
      note: 'Pinned QUA word tier; canonical rows only; exact catalog audio URL and chapter offset; request passed canonical word-count and monotonic-boundary validation. This is a dataset asset identity, not a downloaded audio-byte hash or an independent AyahX listening review.',
    },
    createdAt: new Date().toISOString(),
    words,
    gaps,
    diagnostics: {
      source: 'quranic-universal-audio',
      release: RELEASE,
      packageSha256: reciter.sha256,
      coverageAyahs: packageData.catalog.coverage.ayahs,
      chapterOffsetMs,
      audioFingerprintKind: 'dataset_asset_identity_sha256',
      sourceAudioBytesVerified: false,
      sourceTimingConfidenceProvided: false,
    },
  };

  const validation = validateTimingMap(timingMap, words.length);
  if (!validation.isValid || validation.validationStatus !== 'approved') throw new Error('UNIVERSAL_ALIGNMENT_TIMING_INVALID');
  timingMap.validationStatus = validation.validationStatus;
  timingMap.diagnostics = { ...(timingMap.diagnostics || {}), validationMetrics: validation.metrics, warnings: validation.warnings };
  return { timingMap, audioUrl: sourceAudioUrl, reciter: { ...reciter, coverageAyahs: packageData.catalog.coverage.ayahs } };
}

export function isUniversalReciter(slug: string | undefined): boolean {
  return Boolean(slug && QUA_RECITATIONS[slug]);
}

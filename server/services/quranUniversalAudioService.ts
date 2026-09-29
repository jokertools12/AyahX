import { gunzipSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildAudioAlignedTimingMap,
  normalizeQuranicToken,
  type TimingMap,
  type TimingSubsegment,
} from '../../src/lib/timingMap';

/**
 * Quranic Universal Audio (QUA) v2.2.0 adapter.
 *
 * The release contains immutable, CC-BY-4.0 word and letter timestamps for
 * 33 recitations.  We fetch only the small timing package for the selected
 * reciter and cache it in-process; audio remains served by the catalogue's
 * original source.  This keeps the application bundle small while avoiding
 * a model warm-up or a best-effort duration estimate.
 */
const RELEASE = 'v2.2.0';
const RELEASE_BASE = `https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/${RELEASE}`;
const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type UniversalReciter = {
  slug: string;
  zip: string;
  /** The catalogue's chapter 1 URL; 001.mp3 is replaced for other chapters. */
  chapterOneUrl: string;
  coverageAyahs: number;
};

/** Direct chapter sources from the QUA catalogue (YouTube/Drive-only entries
 * are intentionally not exposed as playable production sources). */
export const QUA_RECITATIONS: Record<string, UniversalReciter> = {
  abdulbasit_abdulsamad_mujawwad_tarteel: { slug: 'abdulbasit_abdulsamad_mujawwad_tarteel', zip: 'abdulbasit_abdulsamad_mujawwad_tarteel.zip', chapterOneUrl: 'https://audio-cdn.tarteel.ai/quran/surah/abdulBasit/mujawwad/mp3/001.mp3', coverageAyahs: 6236 },
  abdulbasit_abdulsamad_tarteel: { slug: 'abdulbasit_abdulsamad_tarteel', zip: 'abdulbasit_abdulsamad_tarteel.zip', chapterOneUrl: 'https://audio-cdn.tarteel.ai/quran/surah/abdulBasit/murattal/mp3/001.mp3', coverageAyahs: 6236 },
  abdullah_al_qarafi_mp3quran: { slug: 'abdullah_al_qarafi_mp3quran', zip: 'abdullah_al_qarafi_mp3quran.zip', chapterOneUrl: 'https://server16.mp3quran.net/a_alqrafi/Rewayat-Hafs-A-n-Assem/001.mp3', coverageAyahs: 6222 },
  abdulwadood_haneef_mp3quran: { slug: 'abdulwadood_haneef_mp3quran', zip: 'abdulwadood_haneef_mp3quran.zip', chapterOneUrl: 'https://server8.mp3quran.net/wdod/001.mp3', coverageAyahs: 6233 },
  abdur_rashid_sufi_qdc: { slug: 'abdur_rashid_sufi_qdc', zip: 'abdur_rashid_sufi_qdc.zip', chapterOneUrl: 'https://download.quranicaudio.com/quran/abdurrashid_sufi/001.mp3', coverageAyahs: 6236 },
  abu_bakr_al_shatri_tarteel: { slug: 'abu_bakr_al_shatri_tarteel', zip: 'abu_bakr_al_shatri_tarteel.zip', chapterOneUrl: 'https://audio-cdn.tarteel.ai/quran/surah/abuBakrAlShatri/murattal/mp3/001.mp3', coverageAyahs: 6236 },
  ahmed_amer_tvquran: { slug: 'ahmed_amer_tvquran', zip: 'ahmed_amer_tvquran.zip', chapterOneUrl: 'https://download.tvquran.com/download/recitations/197/143/001.mp3', coverageAyahs: 6236 },
  ahmed_issa_al_maasaraawi_mp3quran: { slug: 'ahmed_issa_al_maasaraawi_mp3quran', zip: 'ahmed_issa_al_maasaraawi_mp3quran.zip', chapterOneUrl: 'https://server16.mp3quran.net/a_maasaraawi/Rewayat-Hafs-A-n-Assem/001.mp3', coverageAyahs: 6234 },
  ahmed_shaheen_mp3quran: { slug: 'ahmed_shaheen_mp3quran', zip: 'ahmed_shaheen_mp3quran.zip', chapterOneUrl: 'https://server16.mp3quran.net/shaheen/Rewayat-Hafs-A-n-Assem/001.mp3', coverageAyahs: 6236 },
  ali_al_huthaifi_mp3quran: { slug: 'ali_al_huthaifi_mp3quran', zip: 'ali_al_huthaifi_mp3quran.zip', chapterOneUrl: 'https://server9.mp3quran.net/hthfi/001.mp3', coverageAyahs: 6236 },
  ayman_swed_muallim_tvquran: { slug: 'ayman_swed_muallim_tvquran', zip: 'ayman_swed_muallim_tvquran.zip', chapterOneUrl: 'https://download.tvquran.com/download/recitations/346/270/001.mp3', coverageAyahs: 6213 },
  islam_sobhi_mp3quran: { slug: 'islam_sobhi_mp3quran', zip: 'islam_sobhi_mp3quran.zip', chapterOneUrl: 'https://server14.mp3quran.net/islam/Rewayat-Hafs-A-n-Assem/001.mp3', coverageAyahs: 5334 },
  khalifa_al_tunaiji_tarteel: { slug: 'khalifa_al_tunaiji_tarteel', zip: 'khalifa_al_tunaiji_tarteel.zip', chapterOneUrl: 'https://audio-cdn.tarteel.ai/quran/surah/khalifaAlTunaiji/murattal/mp3/001.mp3', coverageAyahs: 6236 },
  maher_al_muaiqly_qdc: { slug: 'maher_al_muaiqly_qdc', zip: 'maher_al_muaiqly_qdc.zip', chapterOneUrl: 'https://download.quranicaudio.com/quran/maher_almu3aiqly/year1440/001.mp3', coverageAyahs: 6236 },
  mahmoud_abdul_hakam_mp3quran: { slug: 'mahmoud_abdul_hakam_mp3quran', zip: 'mahmoud_abdul_hakam_mp3quran.zip', chapterOneUrl: 'https://server16.mp3quran.net/m_abdelhakam/Rewayat-Hafs-A-n-Assem/001.mp3', coverageAyahs: 6236 },
  mahmoud_ali_al_banna_qdc: { slug: 'mahmoud_ali_al_banna_qdc', zip: 'mahmoud_ali_al_banna_qdc.zip', chapterOneUrl: 'https://download.quranicaudio.com/quran/mahmood_ali_albana/001.mp3', coverageAyahs: 6236 },
  mahmoud_khalil_al_husary_mp3quran: { slug: 'mahmoud_khalil_al_husary_mp3quran', zip: 'mahmoud_khalil_al_husary_mp3quran.zip', chapterOneUrl: 'https://server13.mp3quran.net/husr/001.mp3', coverageAyahs: 6236 },
  mahmoud_khalil_al_husary_mujawwad_tarteel: { slug: 'mahmoud_khalil_al_husary_mujawwad_tarteel', zip: 'mahmoud_khalil_al_husary_mujawwad_tarteel.zip', chapterOneUrl: 'https://audio-cdn.tarteel.ai/quran/surah/husary/mujawwad/mp3/001.mp3', coverageAyahs: 6235 },
  mishary_rashid_al_afasy_mp3quran: { slug: 'mishary_rashid_al_afasy_mp3quran', zip: 'mishary_rashid_al_afasy_mp3quran.zip', chapterOneUrl: 'https://server8.mp3quran.net/afs/001.mp3', coverageAyahs: 6236 },
  mohammed_alghazali_archive: { slug: 'mohammed_alghazali_archive', zip: 'mohammed_alghazali_archive.zip', chapterOneUrl: 'https://ia601406.us.archive.org/16/items/Mohammed-Al-Ghazali/001.mp3', coverageAyahs: 6236 },
  mohammed_siddiq_al_minshawi_mp3quran: { slug: 'mohammed_siddiq_al_minshawi_mp3quran', zip: 'mohammed_siddiq_al_minshawi_mp3quran.zip', chapterOneUrl: 'https://server10.mp3quran.net/minsh/001.mp3', coverageAyahs: 6236 },
  mustafa_ismail_mp3quran: { slug: 'mustafa_ismail_mp3quran', zip: 'mustafa_ismail_mp3quran.zip', chapterOneUrl: 'https://server8.mp3quran.net/mustafa/001.mp3', coverageAyahs: 6236 },
  nasser_al_qatami_mp3quran: { slug: 'nasser_al_qatami_mp3quran', zip: 'nasser_al_qatami_mp3quran.zip', chapterOneUrl: 'https://server6.mp3quran.net/qtm/001.mp3', coverageAyahs: 6235 },
  saud_al_shuraim_mp3quran: { slug: 'saud_al_shuraim_mp3quran', zip: 'saud_al_shuraim_mp3quran.zip', chapterOneUrl: 'https://server7.mp3quran.net/shur/001.mp3', coverageAyahs: 6235 },
};

type UniversalPackage = {
  word: Record<string, [[number, number], Array<[number, number, number]>]>;
  letter: Record<string, [[number, number], Array<[number, number, number]>, Array<[number, string, number, number]>]>;
};

const packageCache = new Map<string, Promise<UniversalPackage>>();

function chapterUrl(chapterOneUrl: string, surahNumber: number): string {
  const padded = String(surahNumber).padStart(3, '0');
  return chapterOneUrl.replace(/001\.mp3(?:$|\?)/, `${padded}.mp3`);
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_PACKAGE_BYTES) throw new Error('UNIVERSAL_ALIGNMENT_PACKAGE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
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
  if (existing) return existing;
  const reciter = QUA_RECITATIONS[slug];
  if (!reciter) throw new Error('UNIVERSAL_ALIGNMENT_RECITER_NOT_SUPPORTED');
  const promise = (async () => {
    const response = await fetch(`${RELEASE_BASE}/${reciter.zip}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`UNIVERSAL_ALIGNMENT_HTTP_${response.status}`);
    const bytes = await readResponseBytes(response);
    const zip = unzipSync(bytes);
    return {
      word: parseGzipJson<UniversalPackage['word']>(zip, 'word_timestamps.json.gz'),
      letter: parseGzipJson<UniversalPackage['letter']>(zip, 'letter_timestamps.json.gz'),
    };
  })();
  packageCache.set(slug, promise);
  try { return await promise; } catch (error) { packageCache.delete(slug); throw error; }
}

export interface UniversalAlignmentInput {
  reciterId: string;
  reciterSlug: string;
  audio: { contentHash?: string; durationMs?: number; sampleRate?: number; channels?: number };
  reference: {
    surahNumber: number;
    startAyah: number;
    endAyah: number;
    ayahs: Array<{ numberInSurah: number; text: string }>;
    quranTextVersion?: string;
  };
}

export async function resolveUniversalQuranAudio(input: UniversalAlignmentInput): Promise<{ timingMap: TimingMap; audioUrl: string; reciter: UniversalReciter }> {
  const reciter = QUA_RECITATIONS[input.reciterSlug];
  if (!reciter) throw new Error('UNIVERSAL_ALIGNMENT_RECITER_NOT_SUPPORTED');
  const { surahNumber, startAyah, endAyah } = input.reference;
  const packageData = await loadPackage(input.reciterSlug);
  const explicitWordSpans: Array<{ ayahNumber: number; wordIndex1Based: number; startMs: number; endMs: number; confidence: number }> = [];
  const lettersByAyahWord = new Map<string, TimingSubsegment[]>();
  const ayahRows: Array<{ numberInSurah: number; text: string; audioStartMs: number; audioEndMs: number }> = [];

  for (let index = 0; index <= endAyah - startAyah; index += 1) {
    const ayahNumber = startAyah + index;
    const key = `${surahNumber}:${ayahNumber}`;
    const row = packageData.word[key];
    if (!row || !Array.isArray(row[0]) || !Array.isArray(row[1]) || row[1].length === 0) {
      throw new Error('UNIVERSAL_ALIGNMENT_AYAH_NOT_AVAILABLE');
    }
    const sourceWords = row[1];
    const text = input.reference.ayahs[index]?.text || '';
    // Quran Foundation's Uthmani text includes standalone waqf marks (ۛ ۖ …)
    // that are not QPC words.  Count the same canonical tokens that the shared
    // renderer uses instead of treating those marks as words.
    const tokens = text.split(/\s+/).filter((token) => normalizeQuranicToken(token).length > 0);
    // QUA deliberately preserves repeated/re-read acoustic occurrences.  A
    // source row can therefore contain more segments than Quran words and may
    // repeat a word index (for example 9:2 contains two occurrences of word 6).
    // The canonical QPC index remains authoritative; only reject impossible
    // indexes that cannot be rendered against the reference text.
    const maxWordIndex = Math.max(...sourceWords.map((word) => Number(word[0])));
    if (tokens.length === 0 || !Number.isFinite(maxWordIndex) || maxWordIndex > tokens.length) {
      throw new Error('UNIVERSAL_ALIGNMENT_TEXT_MISMATCH');
    }
    const from = Number(row[0][0]);
    const to = Number(row[0][1]);
    if (!(to > from)) throw new Error('UNIVERSAL_ALIGNMENT_AYAH_EMPTY');
    ayahRows.push({ numberInSurah: ayahNumber, text, audioStartMs: from, audioEndMs: to });
    for (const word of sourceWords) {
      if (!Array.isArray(word) || word.length !== 3 || !(Number(word[2]) > Number(word[1]))) throw new Error('UNIVERSAL_ALIGNMENT_DATA_INVALID');
      explicitWordSpans.push({ ayahNumber, wordIndex1Based: Number(word[0]), startMs: Number(word[1]), endMs: Number(word[2]), confidence: 0.995 });
    }
    const letterRow = packageData.letter[key];
    if (letterRow?.[2]) {
      for (const letter of letterRow[2]) {
        const [wordIndex, token, startMs, endMs] = letter;
        if (!(Number(endMs) > Number(startMs))) continue;
        const mapKey = `${ayahNumber}:${Number(wordIndex)}`;
        const existing = lettersByAyahWord.get(mapKey) || [];
        existing.push({ occurrenceId: `${surahNumber}:${ayahNumber}:${wordIndex}:letter:${existing.length + 1}`, token: String(token), startMs: Number(startMs), endMs: Number(endMs), confidence: 0.98 });
        lettersByAyahWord.set(mapKey, existing);
      }
    }
  }

  const sourceAudioUrl = chapterUrl(reciter.chapterOneUrl, surahNumber);
  const timingMap = buildAudioAlignedTimingMap({
    reciterId: input.reciterId,
    surahNumber,
    startAyah,
    endAyah,
    audioUrl: sourceAudioUrl,
    audioContentHash: input.audio.contentHash || `qua:${input.reciterSlug}:${surahNumber}`,
    decodedDurationMs: Math.max(Number(input.audio.durationMs || 0), ...ayahRows.map((row) => row.audioEndMs)),
    sampleRate: input.audio.sampleRate || 44100,
    channels: input.audio.channels || 2,
    ayahs: ayahRows,
    explicitWordSpans,
    alignment: {
      provider: 'quranic_universal_aligner',
      providerVersion: RELEASE,
      requestedGranularity: 'letter',
      availableGranularities: ['word', 'letter'],
      quranEdition: input.reference.quranTextVersion || 'uthmani_hafs_v1',
      license: 'CC-BY-4.0',
      inputAudioSha256: input.audio.contentHash,
      createdBy: 'dataset_import',
    },
  });
  for (const word of timingMap.words) {
    const ayahNumber = Number(word.canonicalWordKey.split(':')[1]);
    const wordIndex = Number(word.canonicalWordKey.split(':')[2]);
    const letters = lettersByAyahWord.get(`${ayahNumber}:${wordIndex}`);
    if (letters?.length) word.letters = letters;
  }
  timingMap.sourceId = 'quranic_universal_audio';
  timingMap.sourceMethod = 'verified_dataset';
  timingMap.alignerVersion = `quranic-universal-audio-${RELEASE}`;
  timingMap.segmentationVersion = 'qpc-hafs-word-letter-v1';
  timingMap.review = { status: 'approved', reviewerId: 'quranic-universal-audio-release', reviewedAt: '2026-06-30T14:05:47.000Z', note: 'Immutable QUA v2.2.0 word and letter timestamps paired with the catalogue chapter audio.' };
  timingMap.validationStatus = 'approved';
  timingMap.diagnostics = { ...(timingMap.diagnostics || {}), source: 'quranic-universal-audio', release: RELEASE, coverageAyahs: reciter.coverageAyahs };
  return { timingMap, audioUrl: sourceAudioUrl, reciter };
}

export function isUniversalReciter(slug: string | undefined): boolean {
  return Boolean(slug && QUA_RECITATIONS[slug]);
}

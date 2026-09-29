import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { buildAudioAlignedTimingMap, validateTimingMap, type TimingMap } from '../../src/lib/timingMap';

/**
 * Pinned, offline import of cpfair/quran-align release-2016-11-24.
 *
 * The release contains timing metadata only.  The audio remains on the
 * original EveryAyah host and is never copied into the application.  A map is
 * accepted only when the selected EveryAyah folder is one of the release's
 * exact recitation keys and every requested word has its own source segment.
 * Multi-word source segments are rejected rather than split proportionally.
 */

const RELEASE = 'quran-align@release-2016-11-24';
const DATA_DIR = path.resolve(process.cwd(), 'server/data/quran-align');

type SourceSegment = [number, number, number, number];
type SourceAyah = { surah: number; ayah: number; segments: SourceSegment[]; stats?: Record<string, number> };

const FILE_BY_FOLDER: Record<string, string> = {
  Abdul_Basit_Mujawwad_128kbps: 'Abdul_Basit_Mujawwad_128kbps.json.gz',
  Abdul_Basit_Murattal_64kbps: 'Abdul_Basit_Murattal_64kbps.json.gz',
  'Abdurrahmaan_As-Sudais_192kbps': 'Abdurrahmaan_As-Sudais_192kbps.json.gz',
  'Abu_Bakr_Ash-Shaatree_128kbps': 'Abu_Bakr_Ash-Shaatree_128kbps.json.gz',
  Alafasy_128kbps: 'Alafasy_128kbps.json.gz',
  Hani_Rifai_192kbps: 'Hani_Rifai_192kbps.json.gz',
  Husary_64kbps: 'Husary_64kbps.json.gz',
  Husary_Muallim_128kbps: 'Husary_Muallim_128kbps.json.gz',
  Minshawy_Mujawwad_192kbps: 'Minshawy_Mujawwad_192kbps.json.gz',
  Minshawy_Murattal_128kbps: 'Minshawy_Murattal_128kbps.json.gz',
  Mohammad_al_Tablaway_128kbps: 'Mohammad_al_Tablaway_128kbps.json.gz',
  'Saood_ash-Shuraym_128kbps': 'Saood_ash-Shuraym_128kbps.json.gz',
};

const cache = new Map<string, Map<string, SourceAyah>>();

function loadRecitation(folder: string): Map<string, SourceAyah> {
  const cached = cache.get(folder);
  if (cached) return cached;
  const fileName = FILE_BY_FOLDER[folder];
  if (!fileName) throw new Error('KNOWN_ALIGNMENT_RECITER_NOT_SUPPORTED');
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error('KNOWN_ALIGNMENT_DATA_MISSING');
  let parsed: unknown;
  try {
    parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
  } catch {
    throw new Error('KNOWN_ALIGNMENT_DATA_INVALID');
  }
  if (!Array.isArray(parsed)) throw new Error('KNOWN_ALIGNMENT_DATA_INVALID');
  const byAyah = new Map<string, SourceAyah>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const surah = Number(row.surah);
    const ayah = Number(row.ayah);
    const segments = Array.isArray(row.segments) ? row.segments : [];
    if (!Number.isInteger(surah) || !Number.isInteger(ayah) || !Array.isArray(segments)) continue;
    const normalized = segments.filter((segment): segment is SourceSegment => (
      Array.isArray(segment) && segment.length === 4
      && segment.every((value) => Number.isFinite(Number(value)))
      && Number(segment[1]) > Number(segment[0])
      && Number(segment[3]) > Number(segment[2])
    )).map((segment) => segment.map(Number) as SourceSegment);
    byAyah.set(`${surah}:${ayah}`, { surah, ayah, segments: normalized });
  }
  cache.set(folder, byAyah);
  return byAyah;
}

export interface KnownAlignmentInput {
  reciterId: string;
  everyAyahSubfolder: string;
  audio: {
    contentHash: string;
    durationMs: number;
    sampleRate?: number;
    channels?: number;
  };
  reference: {
    surahNumber: number;
    startAyah: number;
    endAyah: number;
    ayahs: Array<{ numberInSurah: number; text: string }>;
    quranTextVersion?: string;
  };
  /** Decoded concatenated audio offsets, in seconds, one entry per ayah. */
  audioTimestamps: Array<{ from: number; to: number }>;
}

export function resolveKnownQuranAlign(input: KnownAlignmentInput): TimingMap {
  const rows = loadRecitation(input.everyAyahSubfolder);
  const { surahNumber, startAyah, endAyah } = input.reference;
  if (input.audioTimestamps.length !== endAyah - startAyah + 1) {
    throw new Error('KNOWN_ALIGNMENT_AUDIO_RANGE_REQUIRED');
  }

  const explicitWordSpans: Array<{ ayahNumber: number; wordIndex1Based: number; startMs: number; endMs: number; confidence: number }> = [];
  const ayahs = input.reference.ayahs.map((ayah, index) => {
    if (ayah.numberInSurah !== startAyah + index) throw new Error('KNOWN_ALIGNMENT_REFERENCE_NOT_CONTIGUOUS');
    const timing = input.audioTimestamps[index];
    if (!timing || !(timing.to > timing.from)) throw new Error('KNOWN_ALIGNMENT_AUDIO_RANGE_REQUIRED');
    const source = rows.get(`${surahNumber}:${ayah.numberInSurah}`);
    if (!source) throw new Error('KNOWN_ALIGNMENT_AYAH_NOT_AVAILABLE');
    const tokens = ayah.text.split(/\s+/).filter(Boolean);
    const sourceSegments = source.segments;
    const sourceEnd = sourceSegments.length ? Math.max(...sourceSegments.map((segment) => segment[3])) : 0;
    if (!(sourceEnd > 0)) throw new Error('KNOWN_ALIGNMENT_AYAH_EMPTY');
    const requestedWords = sourceSegments.reduce((count, segment) => count + (segment[1] - segment[0]), 0);
    if (requestedWords !== tokens.length || sourceSegments.some((segment) => segment[1] - segment[0] !== 1)) {
      throw new Error('KNOWN_ALIGNMENT_MULTIWORD_SEGMENT');
    }
    const actualFrom = timing.from * 1000;
    const actualTo = timing.to * 1000;
    const scale = (actualTo - actualFrom) / sourceEnd;
    for (const segment of sourceSegments) {
      const wordIndex1Based = segment[0] + 1;
      explicitWordSpans.push({
        ayahNumber: ayah.numberInSurah,
        wordIndex1Based,
        startMs: Math.round(actualFrom + segment[2] * scale),
        endMs: Math.round(actualFrom + segment[3] * scale),
        confidence: 0.995,
      });
    }
    return {
      numberInSurah: ayah.numberInSurah,
      text: ayah.text,
      audioStartMs: actualFrom,
      audioEndMs: actualTo,
    };
  });

  const map = buildAudioAlignedTimingMap({
    reciterId: input.reciterId,
    surahNumber,
    startAyah,
    endAyah,
    audioUrl: `asset:everyayah/${input.everyAyahSubfolder}`,
    audioContentHash: input.audio.contentHash,
    decodedDurationMs: input.audio.durationMs,
    sampleRate: input.audio.sampleRate || 44100,
    channels: input.audio.channels || 2,
    ayahs,
    explicitWordSpans,
    alignment: {
      provider: 'verified_dataset',
      providerVersion: RELEASE,
      requestedGranularity: 'word',
      availableGranularities: ['word'],
      quranEdition: input.reference.quranTextVersion || 'uthmani_hafs_v1',
      license: 'CC-BY-4.0',
      inputAudioSha256: input.audio.contentHash,
      createdBy: 'dataset_import',
    },
  });
  map.sourceId = 'verified_dataset';
  map.sourceMethod = 'verified_dataset';
  map.alignerVersion = RELEASE;
  map.segmentationVersion = 'quran-align-word-v1';
  map.review = {
    status: 'approved',
    reviewerId: 'quran-align-release',
    reviewedAt: '2016-11-24T23:51:54.000Z',
    note: 'Pinned quran-align metadata; exact EveryAyah folder match; no proportional word splitting.',
  };
  const validation = validateTimingMap(map, explicitWordSpans.length);
  if (!validation.isValid || validation.validationStatus !== 'approved') {
    throw new Error('KNOWN_ALIGNMENT_VALIDATION_FAILED');
  }
  map.validationStatus = 'approved';
  map.diagnostics = {
    ...(map.diagnostics || {}),
    knownAlignment: RELEASE,
    sourceFolder: input.everyAyahSubfolder,
    validationMetrics: validation.metrics,
  };
  return map;
}

export function isKnownQuranAlignFolder(folder: string): boolean {
  return Boolean(FILE_BY_FOLDER[folder]);
}

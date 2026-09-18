
export type QuranFoundationRecitation = {
  id: number;
  reciter_name: string;
  style?: string | null;
  translated_name?: {
    name: string;
    language_name: string;
  };
};

export type QuranFoundationTimestamp = {
  verse_key: string; // e.g. "2:255"
  timestamp_from: number; // ms
  timestamp_to: number; // ms
  // segments: [word_index (1-based), start_ms, end_ms]
  segments?: [number, number, number][];
};

export type QuranFoundationChapterAudio = {
  audio_url: string;
  timestamps?: QuranFoundationTimestamp[];
};

export type QuranWord = {
  id: number;
  position: number;
  audio_url?: string;
  char_type_name: string;
  text_uthmani: string;
  text_imlaei?: string;
  location: string;
};

export type QuranVerse = {
  id: number;
  verse_number: number;
  verse_key: string;
  text_uthmani: string;
  words?: QuranWord[];
};

const PUBLIC_API_BASE = 'https://api.quran.com/api/v4';

function normalizeName(s: string) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019`']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch list of recitations, prioritizing the authenticated App Server proxy
 */
export async function fetchRecitations(language: string = 'ar'): Promise<QuranFoundationRecitation[]> {
  try {
    const res = await fetch(`/api/quran/recitations?language=${encodeURIComponent(language)}`);
    if (res.ok) {
      const json = await res.json();
      return Array.isArray(json) ? json : json.recitations;
    }
  } catch (e) {
    console.warn('Proxy recitations fetch failed, falling back to public endpoint', e);
  }

  const res = await fetch(`${PUBLIC_API_BASE}/resources/recitations?language=${encodeURIComponent(language)}`);
  if (!res.ok) throw new Error('فشل في جلب قائمة القراء');
  const json = await res.json();
  return Array.isArray(json) ? json : json.recitations;
}

export function resolveRecitationIdByName(
  recitations: QuranFoundationRecitation[],
  englishName: string
): number | null {
  const needle = normalizeName(englishName);
  if (!needle) return null;

  // Prefer Murattal / null style when multiple exist.
  const scored = recitations
    .map((r) => {
      const name = normalizeName(r.reciter_name || r.translated_name?.name || '');
      const style = normalizeName(r.style || '');
      const nameHit = name.includes(needle) || needle.includes(name);
      const score = (nameHit ? 10 : 0) + (style.includes('murattal') ? 2 : 0) + (style ? 0 : 1);
      return { r, score, name };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.r.id ?? null;
}

/**
 * Fetch chapter recitation audio and millisecond timestamps with word-level segments
 */
export async function fetchChapterRecitationAudio(
  recitationId: number,
  chapterNumber: number,
  segments: boolean = true
): Promise<QuranFoundationChapterAudio> {
  const segParam = segments ? 'true' : 'false';

  try {
    const res = await fetch(`/api/quran/chapter-recitation/${recitationId}/${chapterNumber}?segments=${segParam}`);
    if (res.ok) {
      const json = await res.json();
      const audioFile = json.audio_file ?? json;
      if (audioFile.audio_url) {
        return {
          audio_url: audioFile.audio_url,
          timestamps: audioFile.timestamps,
        };
      }
    }
  } catch (e) {
    console.warn('Proxy audio fetch failed, falling back to public endpoint', e);
  }

  const url = `${PUBLIC_API_BASE}/chapter_recitations/${recitationId}/${chapterNumber}?segments=${segParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('فشل في جلب ملف الصوت وتوقيتاته');
  const json = await res.json();
  const audioFile = json.audio_file ?? json;

  return {
    audio_url: audioFile.audio_url,
    timestamps: audioFile.timestamps,
  };
}

export async function fetchChapterRecitationAudioById(
  recitationId: number,
  chapterNumber: number,
  segments: boolean = true
): Promise<QuranFoundationChapterAudio> {
  return fetchChapterRecitationAudio(recitationId, chapterNumber, segments);
}

/**
 * Fetch chapter verses with full Uthmani text and word tokens
 */
export async function fetchChapterVerses(chapterNumber: number): Promise<QuranVerse[]> {
  try {
    const res = await fetch(`/api/quran/chapter/${chapterNumber}/verses`);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.verses)) {
        return json.verses;
      }
    }
  } catch (e) {
    console.warn('Proxy chapter verses failed, falling back to public endpoint', e);
  }

  const res = await fetch(
    `${PUBLIC_API_BASE}/verses/by_chapter/${chapterNumber}?language=ar&words=true&word_fields=text_uthmani,location&fields=text_uthmani,chapter_id,verse_number,verse_key&per_page=286`
  );
  if (!res.ok) throw new Error('فشل في جلب آيات السورة');
  const json = await res.json();
  return json.verses || [];
}


import { useState, useCallback } from 'react';
import { fetchChapterVerses } from '@/lib/quranFoundationApi';
import { isCompleteAyahRange } from '@/lib/ayahRangeIdentity';
import { normalizeQuranicToken, tokenizeQuranicText } from '@/lib/timingMap';

export interface Ayah {
  number: number;
  numberInSurah: number;
  text: string;
  audio?: string;
  audioSecondary?: string[];
  page: number;
  hizbQuarter: number;
  juz: number;
}

export interface SurahData {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  revelationType: string;
  numberOfAyahs: number;
  ayahs: Ayah[];
}

function stripNonAyahOpeningBasmala(surahNumber: number, ayahNumber: number, text: string): string {
  // AlQuran.cloud includes the opening basmala in the first displayed text of
  // most surahs, although it is not numbered as part of those first ayahs in
  // the paired QUA/Hafs verse tier. Keep Al-Fatiha (where it is ayah 1) and
  // At-Tawbah (which has no opening basmala) untouched.
  if (ayahNumber !== 1 || surahNumber === 1 || surahNumber === 9) return text;
  const tokens = tokenizeQuranicText(text);
  const normalized = tokens.slice(0, 4).map((token) => normalizeQuranicToken(token)
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ی/g, 'ي'));
  if (normalized.join(' ') !== 'بسم الله الرحمن الرحيم') return text;
  return tokens.slice(4).join(' ');
}

interface QuranApiResponse {
  code: number;
  status: string;
  data: SurahData;
}

export function useQuranApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSurah = useCallback(async (surahNumber: number): Promise<SurahData | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://api.alquran.cloud/v1/surah/${surahNumber}`
      );

      if (!response.ok) {
        throw new Error('فشل في جلب بيانات السورة');
      }

      const data: QuranApiResponse = await response.json();

      if (data.code !== 200) {
        throw new Error('خطأ في الاستجابة من API');
      }

      // Try enriching with Quran Foundation official Uthmani text
      try {
        const qfVerses = await fetchChapterVerses(surahNumber);
        if (qfVerses && qfVerses.length > 0) {
          const map = new Map(qfVerses.map(v => [v.verse_number, v.text_uthmani]));
          data.data.ayahs = data.data.ayahs.map(a => ({
            ...a,
            text: map.get(a.numberInSurah) || a.text,
          }));
        }
      } catch (e) {
        console.warn('Could not enrich surah with Quran Foundation Uthmani text', e);
      }

      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAyahs = useCallback(async (
    surahNumber: number,
    startAyah: number,
    endAyah: number
  ): Promise<Ayah[] | null> => {
    setLoading(true);
    setError(null);

    try {
      // First attempt: fetch directly with authentic Uthmani script from Quran Foundation
      try {
        const qfVerses = await fetchChapterVerses(surahNumber);
        if (qfVerses && qfVerses.length > 0) {
          const filtered = qfVerses.filter(
            (v) => v.verse_number >= startAyah && v.verse_number <= endAyah
          );
          const mappedVerses = filtered.map((v) => ({
              number: v.id || v.verse_number,
              numberInSurah: v.verse_number,
              text: v.text_uthmani,
              page: 1,
              hizbQuarter: 1,
              juz: 1,
            }));

          if (isCompleteAyahRange(startAyah, endAyah, mappedVerses)) {
            return mappedVerses;
          }
          console.warn(`Quran Foundation returned an incomplete ayah range ${surahNumber}:${startAyah}-${endAyah}; trying the complete-range fallback`);
        }
      } catch (qfErr) {
        console.warn('Quran Foundation verse fetch failed, using fallback', qfErr);
      }

      // Fallback: alquran.cloud
      const response = await fetch(
        `https://api.alquran.cloud/v1/surah/${surahNumber}`
      );

      if (!response.ok) {
        throw new Error('فشل في جلب الآيات');
      }

      const data: QuranApiResponse = await response.json();

      if (data.code !== 200) {
        throw new Error('خطأ في الاستجابة');
      }

      const ayahs = data.data.ayahs.filter(
        (ayah) => ayah.numberInSurah >= startAyah && ayah.numberInSurah <= endAyah
      ).map((ayah) => ({
        ...ayah,
        text: stripNonAyahOpeningBasmala(surahNumber, ayah.numberInSurah, ayah.text),
      }));

      if (!isCompleteAyahRange(startAyah, endAyah, ayahs)) {
        throw new Error('لم تصل الآيات المطلوبة كاملة وبالترتيب');
      }

      return ayahs;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    fetchSurah,
    fetchAyahs,
  };
}

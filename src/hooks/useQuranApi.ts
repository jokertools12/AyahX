import { useState, useCallback } from 'react';
import { fetchChapterVerses } from '@/lib/quranFoundationApi';

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

          if (filtered.length > 0) {
            return filtered.map((v) => ({
              number: v.id || v.verse_number,
              numberInSurah: v.verse_number,
              text: v.text_uthmani,
              page: 1,
              hizbQuarter: 1,
              juz: 1,
            }));
          }
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
      );

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

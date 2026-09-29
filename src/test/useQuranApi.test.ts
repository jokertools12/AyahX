import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchChapterVerses, type QuranVerse } from '@/lib/quranFoundationApi';
import { useQuranApi } from '@/hooks/useQuranApi';

vi.mock('@/lib/quranFoundationApi', () => ({ fetchChapterVerses: vi.fn() }));

const fetchChapterVersesMock = vi.mocked(fetchChapterVerses);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useQuranApi range completeness', () => {
  it('falls back when the preferred text source returns a partial multi-ayah range', async () => {
    fetchChapterVersesMock.mockResolvedValue([
      { id: 1, verse_number: 63, verse_key: '26:63', text_uthmani: 'آية 63' },
      { id: 2, verse_number: 65, verse_key: '26:65', text_uthmani: 'آية 65' },
    ] satisfies QuranVerse[]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: {
        ayahs: [
          { numberInSurah: 63, text: 'آية 63' },
          { numberInSurah: 64, text: 'آية 64' },
          { numberInSurah: 65, text: 'آية 65' },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useQuranApi());
    let verses: Awaited<ReturnType<typeof result.current.fetchAyahs>>;
    await act(async () => {
      verses = await result.current.fetchAyahs(26, 63, 65);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verses?.map((ayah) => ayah.numberInSurah)).toEqual([63, 64, 65]);
  });

  it('does not accept an incomplete fallback response as a usable range', async () => {
    fetchChapterVersesMock.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { ayahs: [{ numberInSurah: 63, text: 'آية 63' }, { numberInSurah: 65, text: 'آية 65' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const { result } = renderHook(() => useQuranApi());
    let verses: Awaited<ReturnType<typeof result.current.fetchAyahs>>;
    await act(async () => {
      verses = await result.current.fetchAyahs(26, 63, 65);
    });

    expect(verses).toBeNull();
    expect(result.current.error).toContain('كاملة وبالترتيب');
  });

  it('removes a provider-inserted basmala from verse one outside Al-Fatiha only', async () => {
    fetchChapterVersesMock.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: {
        ayahs: [{ numberInSurah: 1, text: 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَـٰنِ ٱلرَّحِیمِ طسۤمۤ' }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const { result } = renderHook(() => useQuranApi());
    let verses: Awaited<ReturnType<typeof result.current.fetchAyahs>>;
    await act(async () => {
      verses = await result.current.fetchAyahs(26, 1, 1);
    });

    expect(verses?.[0].text).toBe('طسۤمۤ');
  });

  it('preserves the Al-Fatiha basmala because it is part of its first ayah', async () => {
    fetchChapterVersesMock.mockResolvedValue([]);
    const basmala = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { ayahs: [{ numberInSurah: 1, text: basmala }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const { result } = renderHook(() => useQuranApi());
    let verses: Awaited<ReturnType<typeof result.current.fetchAyahs>>;
    await act(async () => {
      verses = await result.current.fetchAyahs(1, 1, 1);
    });

    expect(verses?.[0].text).toBe(basmala);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AdminContext } from '../../adminState';
import type { CatalogTiming } from './catalogTypes';
import TimingTimeline from './TimingTimeline';
import TimingsPage from './TimingsPage';
const { rows, paths } = vi.hoisted(() => ({ rows: [] as CatalogTiming[], paths: [] as string[] }));
vi.mock('./catalogHooks', () => ({ useCatalogResource: (path: string) => { paths.push(path); return { data: { data: path.startsWith('/timings?') ? rows : [], meta: { total: 114 } }, isPending: false, error: null, refetch: vi.fn() }; } }));
vi.mock('./TimingDetail', () => ({ default: ({ row }: { row: CatalogTiming }) => <output aria-label="Selected stored verse">{row.ayah}</output> }));
afterEach(() => { cleanup(); rows.length = 0; paths.length = 0; });
const fixture = (): CatalogTiming => ({ id: 'unit-timing', recitation_id: 'unit-recording', surah: 103, ayah: 4, coordinate: 'source_ms', start_ms: 90, end_ms: 360, review_status: 'ready', review_reasons: [], words: [[1, 0, 100, 160], [1, 1, 300, 350], [null, 2, 350, 360]], segments: [[90, 180, false, 0], [290, 360, false, 1]], legal_words: [{ position: 1, text_uthmani: 'كلمة الاختبار' }], missing_words: [], spoken_text: null, coverage_words: 1, expected_words: 1, validation: { valid: true, errors: [] }, word_highlight_enabled: true });
function view(node: React.ReactNode, lang: 'ar' | 'en' = 'en') { return <AdminContext.Provider value={{ user: null, lang, setLang: () => {}, refreshUser: () => {} }}>{node}</AdminContext.Provider>; }
function Location() { return <output aria-label="Unit route selection">{useLocation().search}</output>; }
describe('stored timing accessibility', () => {
  it.each(['ar', 'en'] as const)('gives the scrollable native plot keyboard focus and a localized region name (%s)', lang => {
    render(view(<TimingTimeline row={fixture()} />, lang)); const region = screen.getByRole('region', { name: lang === 'ar' ? 'مخطط التوقيتات المخزّنة القابل للتمرير' : 'Scrollable stored timing plot' }); expect(region).toHaveAttribute('tabindex', '0'); region.focus(); expect(region).toHaveFocus();
    const graphic = screen.getByRole('img'); expect(graphic).toHaveAccessibleDescription(); expect(graphic.querySelector('desc')).toHaveTextContent('source_ms'); expect(graphic.querySelectorAll('text')).toHaveLength(0);
  });
  it('shows exact stored bounds and segment values as HTML, preserving repeated/unmapped bar geometry and source milliseconds', () => {
    const row = fixture(), before = structuredClone(row); render(view(<TimingTimeline row={row} />));
    const terms = screen.getByRole('region', { name: 'Stored plot bounds' }); expect(terms).toHaveTextContent('Plot start90 ms'); expect(terms).toHaveTextContent('Plot end360 ms');
    const legend = screen.getByRole('list', { name: 'Stored segment intervals' }); expect(legend).toHaveTextContent('Segment 1: 90–180 ms'); expect(legend).toHaveTextContent('Segment 2: 290–360 ms'); expect(legend.closest('svg')).toBeNull();
    const graphic = screen.getByRole('img'); expect(graphic.querySelectorAll('rect')).toHaveLength(5); expect(graphic.querySelectorAll('.unmapped')).toHaveLength(1); expect(graphic.querySelector('.segment')).toHaveAttribute('x', '50'); expect(graphic.querySelector('.segment')).toHaveAttribute('width', '300'); expect(graphic).toHaveTextContent('Word 1, occurrence 1: 300–350 ms'); expect(graphic).toHaveTextContent('Unmapped word, occurrence 2: 350–360 ms'); expect(row).toEqual(before);
  });
  it.each(['empty', 'zero', 'reversed', 'fractional', 'not-finite'])('declares an invalid %s interval without drawing or repairing the stored row', corruption => {
    const row = fixture(); if (corruption === 'empty') { row.words = []; row.segments = []; } else if (corruption === 'zero') row.words[0][3] = row.words[0][2]; else if (corruption === 'reversed') row.segments[0][1] = 89; else if (corruption === 'fractional') row.words[0][2] = 100.5; else row.words[0][2] = Number.NaN;
    const before = structuredClone(row); render(view(<TimingTimeline row={row} />)); expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.getByText('No valid timing intervals to draw')).toBeInTheDocument(); expect(row).toEqual(before);
  });
  it.each(['ar', 'en'] as const)('names each native verse button with verse and stored status, keeping exact URL selection and pressed state (%s)', lang => {
    rows.push(fixture(), { ...fixture(), id: 'unit-timing-5', ayah: 5, review_status: 'needs_review' }); render(view(<MemoryRouter initialEntries={['/admin/timings?recitation_id=unit-recording&surah=103&ayah=4']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TimingsPage /><Location /></MemoryRouter>, lang));
    const readyName = lang === 'ar' ? 'الآية 4 جاهزة' : 'Ayah 4 Ready', reviewName = lang === 'ar' ? 'الآية 5 تحتاج مراجعة' : 'Ayah 5 Needs your review';
    const selected = screen.getByRole('button', { name: readyName }), next = screen.getByRole('button', { name: reviewName });
    for (const button of [selected, next]) expect(button.getAttribute('aria-label')!.startsWith(button.textContent!.replace(/\s+/gu, ' ').trim())).toBe(true);
    expect(selected).toHaveAttribute('aria-pressed', 'true'); expect(next).toHaveAttribute('title', reviewName); expect(next.tagName).toBe('BUTTON'); next.focus(); expect(next).toHaveFocus(); fireEvent.click(next);
    expect(screen.getByRole('button', { name: readyName })).toHaveAttribute('aria-pressed', 'false'); expect(screen.getByRole('button', { name: reviewName })).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByLabelText('Selected stored verse')).toHaveTextContent('5'); expect(screen.getByLabelText('Unit route selection')).toHaveTextContent('ayah=5'); expect(screen.getByLabelText('Unit route selection')).toHaveTextContent('recitation_id=unit-recording'); expect(paths.filter(path => path.startsWith('/timings?')).every(path => path.includes('recitation_id=unit-recording&surah=103&from=1&to=50'))).toBe(true);
  });
});

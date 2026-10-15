import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlignmentReviewPanel } from '@/components/AlignmentReviewPanel';
import { api } from '@/lib/api';
import type { TimingMap } from '@/lib/timingMap';

vi.mock('@/lib/api', () => ({ api: { alignments: {
  getProviders: vi.fn(async () => ({ providers: [] })),
  review: vi.fn(async () => ({ document: { documentId: 'aln-new' }, timingMap: { mapId: 'aln-new', words: [] } })),
} } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const timingMap = { mapId: 'aln-original', words: [], validationStatus: 'needs_review', alignment: { provider: 'manual' } } as unknown as TimingMap;
const props = { timingMap, isAuthenticated: true, reciterId: 'fixture', surahNumber: 1,
  startAyah: 1, endAyah: 1, ayahs: [], audioUrl: 'asset:fixture', onTimingMapChange: vi.fn() };

describe('alignment review UI authority', () => {
  it('offers draft editing without claiming ordinary-user approval authority', async () => {
    render(<AlignmentReviewPanel {...props} />);
    expect(screen.queryByRole('button', { name: 'اعتماد بعد التحقق' })).toBeNull();
    expect(screen.getByText(/الاعتماد النهائي للتصدير يتطلب مراجعة الأدمن/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حفظ تعديلات للمراجعة' }));
    await waitFor(() => expect(api.alignments.review).toHaveBeenCalledWith('aln-original', expect.objectContaining({ status: 'needs_review' })));
  });
  it('offers the approval action only with explicit admin capability', async () => {
    render(<AlignmentReviewPanel {...props} canApproveAlignment />);
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد بعد التحقق' }));
    await waitFor(() => expect(api.alignments.review).toHaveBeenCalledWith('aln-original', expect.objectContaining({ status: 'approved' })));
  });
});

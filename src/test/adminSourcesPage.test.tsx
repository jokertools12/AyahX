import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminSourcesPage from '@/pages/AdminSourcesPage';

const fixtures = vi.hoisted(() => ({
  user: { role: 'admin' as const },
  getSources: vi.fn().mockResolvedValue({ status: 'review_pending', sources: [{
    id: 'qud-universal-audio', kinds: ['audio', 'word_timing'], revision: 'v3.2.0', productionEnabled: false,
    endpoint: { status: 'verified', reference: 'fixture-endpoint' }, license: { status: 'needs_review' },
    storage: { status: 'needs_review' }, cors: { status: 'needs_review' }, rateLimits: { status: 'needs_review' }, identity: { status: 'needs_review' },
  }] }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixtures.user, loading: false }) }));
vi.mock('@/lib/api', () => ({ api: { quran: { getSources: fixtures.getSources } } }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('admin source inventory page', () => {
  it('shows a review-only disabled source inventory', async () => {
    render(<MemoryRouter><AdminSourcesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('qud-universal-audio')).toBeInTheDocument());
    expect(screen.getByText('مراجعة فقط')).toBeInTheDocument();
    expect(screen.getByText('معطّل')).toBeInTheDocument();
    expect(fixtures.getSources).toHaveBeenCalledOnce();
  });
});

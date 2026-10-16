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
    activationReady: false, activationGaps: ['production_disabled', 'license_unverified'],
  }] }),
  getOverview: vi.fn().mockResolvedValue({ environment: 'test', database: { status: 'connected', latencyMs: 1 }, storage: { ready: true, driver: 'local' }, renderPolicy: { enabledEngines: ['skia_canvas'], defaultEngine: 'skia_canvas', maxBacklog: 50 }, sources: { total: 13, activationReady: 0, reviewPending: 13 } }),
  getApprovals: vi.fn().mockResolvedValue([{ auditEventId: 'event-1', actorId: 'admin', authorizingGrantId: 'grant-1', approvedAtEpochMs: 1000, requestId: 'request-1', reason: 'fixture approval', subjectKind: 'source', subjectId: 'source-a', subjectRevision: 'v1', subjectSha256: 'a'.repeat(64) }]),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixtures.user, loading: false }) }));
vi.mock('@/lib/api', () => ({ api: { quran: { getSources: fixtures.getSources }, admin: { getOverview: fixtures.getOverview, getApprovals: fixtures.getApprovals } } }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('admin source inventory page', () => {
  it('shows a review-only disabled source inventory', async () => {
    render(<MemoryRouter><AdminSourcesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('qud-universal-audio')).toBeInTheDocument());
    expect(screen.getByText('مراجعة فقط')).toBeInTheDocument();
    expect(screen.getByText('معطّل')).toBeInTheDocument();
    expect(screen.getByText('ما يلزم قبل التفعيل')).toBeInTheDocument();
    expect(screen.getByText('الترخيص غير موثق')).toBeInTheDocument();
    expect(screen.getByText('سجل الاعتمادات المنقحة')).toBeInTheDocument();
    expect(screen.getByText('source · source-a')).toBeInTheDocument();
    expect(fixtures.getSources).toHaveBeenCalledOnce();
  });
});

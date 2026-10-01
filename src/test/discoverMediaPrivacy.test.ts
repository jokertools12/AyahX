import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../server/db', () => ({ query: vi.fn(), getConnection: vi.fn() }));
vi.mock('../../server/services/renderJobQueue', () => ({ renderJobQueue: { getJobById: vi.fn() } }));
vi.mock('../../server/services/renderObservability', () => ({ recordRenderAudit: vi.fn() }));
import { query } from '../../server/db';
import { renderJobQueue } from '../../server/services/renderJobQueue';
import router from '../../server/routes/renderJobs';
const handler = (router as any).stack.find((layer: any) => layer.route?.path === '/:id/download').route.stack[0].handle;
const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
afterEach(() => vi.resetAllMocks());
describe('Discover media publication access', () => {
  it('denies anonymous access to private or revoked output', async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const res = response(); await handler({ params: { id: 'private-job' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(renderJobQueue.getJobById).not.toHaveBeenCalled();
    expect(vi.mocked(query).mock.calls[0][0]).toContain('is_public = 1');
    expect(vi.mocked(query).mock.calls[0][0]).toContain('expires_at > NOW()');
  });
  it('uses only the published record owner for anonymous media lookup', async () => {
    vi.mocked(query).mockResolvedValue([{ user_id: 'published-owner' }] as never);
    vi.mocked(renderJobQueue.getJobById).mockResolvedValue({ status: 'failed' } as never);
    const res = response(); await handler({ params: { id: 'public-job' } }, res);
    expect(renderJobQueue.getJobById).toHaveBeenCalledWith('public-job', 'published-owner', false);
    expect(res.status).toHaveBeenCalledWith(410);
  });
  it('preserves owner checks for authenticated access to a private job', async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    vi.mocked(renderJobQueue.getJobById).mockResolvedValue(null);
    const res = response(); await handler({ params: { id: 'private-job' }, user: { id: 'different-owner', role: 'user' } }, res);
    expect(renderJobQueue.getJobById).toHaveBeenCalledWith('private-job', 'different-owner', false);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

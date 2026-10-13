// @vitest-environment node
// Database/response doubles are unit-only. Browser/real-corpus proof is separate.
import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Request, Response, Router } from 'express';
import { AdminRenderMedia } from '../../server/admin/adminRenderMedia';
import type { AdminEndpointDefinition, AdminRequestContext } from '../../server/admin/adminContracts';
import type { CatalogActor } from '../../server/services/catalogAudit';
import type { CatalogDatabase, CatalogRow } from '../../server/services/catalogContracts';
import { checksumText } from '../../server/services/quranTextImport';
import { RenderLabService } from '../../server/services/renderLabService';
import { registerRenderLabEndpoints } from '../../server/routes/admin/adminRenderLab';
import { createAdminRouter } from '../../server/routes/admin/adminRouter';
import { AdminAccessService } from '../../server/admin/adminAccessService';

const id = '12345678-1234-1234-1234-123456789abc';
const actor: CatalogActor = { id: 'unit-admin', kind: 'human', roleSlug: 'admin', permissions: new Set(['render.test']) };
/** Pure middleware invocation: no socket, HTTP, Redis, database or browser. */
function invoke(router: Router, cookie?: string) {
  const req = Object.assign(Readable.from([]), { method: 'GET', url: `/render-lab/jobs/${id}/captions.vtt`, headers: cookie ? { cookie } : {}, socket: { remoteAddress: '127.0.0.1' }, query: {}, body: {} }) as unknown as Request;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const res = { locals: {}, statusCode: 200, set() { return this; }, status(status: number) { this.statusCode = status; return this; }, json(body: unknown) { resolve({ status: this.statusCode, body }); return this; }, send(body: unknown) { resolve({ status: this.statusCode, body }); return this; } };
    (router as unknown as { handle(req: Request, res: Response, next: (error?: unknown) => void): void }).handle(req, res as unknown as Response, error => reject(error ?? new Error('UNEXPECTED_UNIT_ROUTER_FALLTHROUGH')));
  });
}
function fixture() {
  // Synthetic UNIT text, not a source of canonical application data.
  const corpus: CatalogRow[] = [{ surah: 1, ayah: 1, text_uthmani: 'كلمة أخرى' }, { surah: 1, ayah: 2, text_uthmani: 'نص ثان' }];
  const version = { id: 'unit-version', checksum: checksumText(corpus.map(row => `${row.surah}:${row.ayah}\t${row.text_uthmani}`).join('\n')), riwayah_code: 'hafs_an_asim' };
  const manifest = {
    schemaVersion: '2.0.0', rendererVersion: '2.0.0', renderEngine: 'skia_canvas', repetitionDisplayMode: 'canonical',
    recitation: { id: 'unit-recording', slug: 'unit-recording', reciterId: 'unit-reader', reciterName: 'قارئ الاختبار', providerCode: 'unit-provider' },
    canonicalTextVersion: { id: version.id, checksum: version.checksum },
    canonicalAyahRange: { surahNumber: 1, surahName: 'اختبار', startAyah: 1, endAyah: 2, ayahs: corpus.map(row => ({ numberInSurah: Number(row.ayah), text: String(row.text_uthmani), words: String(row.text_uthmani).split(' ').map((text, index) => ({ wordIndex: index + 1, text, canonicalWordKey: `1:${row.ayah}:${index + 1}` })) })) },
    timeline: { coordinate: 'render_ms', durationMs: 1000, sourceWindow: { fromMs: 60000, toMs: 61000 }, ayahs: [{ ayah: 1, startMs: 150, endMs: 500, highlightMode: 'ayah', words: [] }, { ayah: 2, startMs: 600, endMs: 900, highlightMode: 'ayah', words: [] }], gaps: [{ startMs: 500, endMs: 600, type: 'inter_ayah', evidence: 'source_timestamps' }] },
    audioPlan: { recitationId: 'unit-recording', mode: 'surah_slice', coordinate: 'source_ms', provider: 'unit-provider', license: null, attribution: null, parts: [{ url: 'https://unit.example/audio.mp3', sliceFromMs: 60000, sliceToMs: 61000 }], fallbackUsed: false, allowedHosts: ['unit.example'], sourceIdentity: { kind: 'external_url', url: 'https://unit.example/audio.mp3' } },
    audioPlanHash: 'a'.repeat(64), timingVersionHash: 'b'.repeat(64), options: {}, warnings: [] as Array<{ code: string }>,
  };
  const row: CatalogRow = { id, recitation_id: 'unit-recording', status: 'succeeded', manifest, output_path: '/private/unit-video.mp4', output_size_bytes: 123, artifact_available: 1, expires_at: new Date(Date.now() + 60000).toISOString(), duration_seconds: 1, qa_report_json: null };
  const db: CatalogDatabase = { read: vi.fn(async (sql: string) => { if (sql.includes('FROM render_jobs')) return [row]; if (sql.includes('FROM quran_text_versions')) return [version]; if (sql.includes('FROM quran_ayahs')) return corpus; throw new Error('UNEXPECTED_UNIT_QUERY'); }), execute: vi.fn(), transaction: async work => work(db) };
  const response = { set: vi.fn(), send: vi.fn() }; response.set.mockReturnValue(response);
  return { corpus, version, manifest, row, db, response, media: new AdminRenderMedia(db, {} as never), service: new RenderLabService(db, {} as never, vi.fn()) };
}
describe('authenticated canonical render captions', () => {
  it('serializes exact stored render_ms cues without offsets, invented cue padding or writes', async () => {
    const f = fixture(); await f.media.captions(actor, id, f.response as unknown as Response);
    expect(f.response.send).toHaveBeenCalledWith('WEBVTT\n\n1:1\n00:00:00.150 --> 00:00:00.500\nكلمة أخرى\n\n1:2\n00:00:00.600 --> 00:00:00.900\nنص ثان\n\n');
    expect(f.response.set).toHaveBeenCalledWith('Content-Type', 'text/vtt; charset=utf-8'); expect(f.response.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(f.response.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff'); expect(f.db.execute).not.toHaveBeenCalled();
  });
  it.each([{ kind: 'system' }, { roleSlug: 'analyst' }, { permissions: new Set<string>() }])('rejects unauthorized actors before database access %j', async change => {
    const f = fixture(); await expect(f.media.captions({ ...actor, ...change } as CatalogActor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'CATALOG_PERMISSION_DENIED', status: 403 }); expect(f.db.read).not.toHaveBeenCalled(); expect(f.response.send).not.toHaveBeenCalled();
  });
  it.each(['2000-01-01T00:00:00Z', 'invalid-date', null])('rejects expired or invalid artifact lifetime %s', async expiry => {
    const f = fixture(); f.row.expires_at = expiry; await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_LAB_ARTIFACT_EXPIRED', status: 410 }); expect(f.db.read).toHaveBeenCalledTimes(1); expect(f.response.send).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong-version', 'wrong-coordinate', 'fractional', 'overlap', 'out-of-bounds'])('rejects invalid manifest/timing %s without silent repair', async corruption => {
    const f = fixture();
    if (corruption === 'missing') f.row.manifest = null;
    else if (corruption === 'wrong-version') f.manifest.schemaVersion = '1.0.0';
    else if (corruption === 'wrong-coordinate') f.manifest.timeline.coordinate = 'source_ms';
    else if (corruption === 'fractional') f.manifest.timeline.ayahs[0].startMs = 150.5;
    else if (corruption === 'overlap') f.manifest.timeline.ayahs[1].startMs = 499;
    else f.manifest.timeline.ayahs[1].endMs = 1001;
    await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_CAPTIONS_MANIFEST_INVALID', status: 409 }); expect(f.response.send).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'corpus', 'text', 'recitation', 'riwayah'])('rejects authoritative source mismatch %s', async corruption => {
    const f = fixture();
    if (corruption === 'metadata') f.version.checksum = 'c'.repeat(64);
    else if (corruption === 'corpus') f.corpus[0].text_uthmani = 'فساد';
    else if (corruption === 'text') f.manifest.canonicalAyahRange.ayahs[0].text = 'نص مختلف';
    else if (corruption === 'recitation') f.row.recitation_id = 'different-recording';
    else f.version.riwayah_code = 'different-riwayah';
    await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_CAPTIONS_CANONICAL_MISMATCH', status: 409 }); expect(f.response.send).not.toHaveBeenCalled();
  });
  it.each(['version', 'corpus'])('declares missing authoritative %s rather than borrowing another source', async missing => {
    const f = fixture(), originalRead = f.db.read;
    f.db.read = vi.fn(async (sql, params) => sql.includes(missing === 'version' ? 'FROM quran_text_versions' : 'FROM quran_ayahs') ? [] : originalRead(sql, params));
    await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_CAPTIONS_CANONICAL_MISMATCH', status: 409 }); expect(f.response.send).not.toHaveBeenCalled();
  });
  it('escapes VTT markup losslessly while rejecting injected control lines even if the corpus checksum agrees', async () => {
    for (const text of ['كلمة <i> & أخرى', 'كلمة\n\n00:00:02.000 --> 00:00:03.000']) {
      const f = fixture(); f.corpus[0].text_uthmani = text; f.manifest.canonicalAyahRange.ayahs[0].text = text;
      f.version.checksum = checksumText(f.corpus.map(row => `${row.surah}:${row.ayah}\t${row.text_uthmani}`).join('\n')); f.manifest.canonicalTextVersion.checksum = f.version.checksum;
      if (text.includes('\n')) { await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_CAPTIONS_TEXT_INVALID' }); expect(f.response.send).not.toHaveBeenCalled(); }
      else { await f.media.captions(actor, id, f.response as unknown as Response); expect(f.response.send.mock.calls[0][0]).toContain('كلمة &lt;i&gt; &amp; أخرى'); }
    }
  });
  it.each(['ESTIMATED_TIMING', 'OWNED_NOISE_QA_NOT_QURAN_TIMING', 'CI_VISUAL_ONLY_SYNTHETIC_BLACK'])('does not offer or synthesize captions for %s', async warning => {
    const f = fixture(); f.manifest.warnings.push({ code: warning });
    const result = await f.service.get(actor, id); expect(result).not.toHaveProperty('manifest'); expect(result.artifact).toMatchObject({ playPath: `/api/admin/render-lab/jobs/${id}/media`, captionsUnavailableReason: 'RENDER_CAPTIONS_SOURCE_UNVERIFIED' }); expect(result.artifact).not.toHaveProperty('captionsPath');
    await expect(f.media.captions(actor, id, f.response as unknown as Response)).rejects.toMatchObject({ code: 'RENDER_CAPTIONS_SOURCE_UNVERIFIED', status: 409 });
  });
  it('keeps the explicitly synthetic no-audio CI artifact playable without a captions request', async () => {
    const f = fixture(); f.row.manifest = { schemaVersion: '2.0.0', fixture: 'CI_VISUAL_ONLY_SYNTHETIC_BLACK', actual_quran_render: false, acceptance_evidence: false };
    const result = await f.service.get(actor, id); expect(result.artifact).not.toHaveProperty('captionsPath'); expect(result.artifact).toHaveProperty('captionsUnavailableReason', 'RENDER_CAPTIONS_SOURCE_UNVERIFIED'); expect(result).not.toHaveProperty('manifest');
  });
  it('offers only a protected same-origin captions path on a real structurally valid manifest', async () => {
    const f = fixture(); f.row.manifest = JSON.stringify(f.manifest); const result = await f.service.get(actor, id);
    expect(result.artifact).toHaveProperty('captionsPath', `/api/admin/render-lab/jobs/${id}/captions.vtt`); expect(result).not.toHaveProperty('manifest'); expect(result).not.toHaveProperty('output_path');
  });
  it('registers captions as a read-only authenticated render.test response and retains service RBAC', async () => {
    const f = fixture(), definitions: AdminEndpointDefinition[] = []; registerRenderLabEndpoints(definition => definitions.push(definition), f.service, f.media);
    const endpoint = definitions.find(row => row.path === '/render-lab/jobs/:id/captions.vtt')!; expect(endpoint).toMatchObject({ method: 'get', permission: 'render.test' }); expect(endpoint.writes).toBeUndefined(); expect(endpoint.respond).toBeTypeOf('function');
    await expect(endpoint.respond!({ actor: { ...actor, roleSlug: 'analyst' }, params: { id } } as unknown as AdminRequestContext, {} as Request, f.response as unknown as Response)).rejects.toMatchObject({ code: 'CATALOG_PERMISSION_DENIED' }); expect(f.db.read).not.toHaveBeenCalled();
  });
  it('runs the actual router cookie/permission/read-rate gates before its captions response', async () => {
    const f = fixture(), access = new AdminAccessService(f.db), check = vi.fn(async () => {});
    const authenticated: Awaited<ReturnType<AdminAccessService['authenticate']>> = { user: { id: actor.id, email: 'unit@example.test', displayName: null, roles: ['admin'], permissions: [] }, actor, sessionId: 'unit-session', enrollmentRequired: false };
    access.authenticate = vi.fn(async () => authenticated);
    const router = createAdminRouter({ db: f.db, access, rate: { check }, origins: [], register: register => registerRenderLabEndpoints(register, f.service, f.media) });
    expect(await invoke(router)).toMatchObject({ status: 401, body: { code: 'ADMIN_UNAUTHENTICATED' } }); expect(access.authenticate).not.toHaveBeenCalled(); expect(f.db.read).not.toHaveBeenCalled();
    expect(await invoke(router, 'ayahx_admin_session=unit-token')).toMatchObject({ status: 403, body: { code: 'ADMIN_FORBIDDEN' } }); expect(check).not.toHaveBeenCalled(); expect(f.db.read).not.toHaveBeenCalled();
    authenticated.user.permissions = ['render.test']; const result = await invoke(router, 'ayahx_admin_session=unit-token'); expect(result.status).toBe(200); expect(result.body).toMatch(/^WEBVTT\n/u); expect(check).toHaveBeenCalledWith(actor.id, 'read'); expect(f.db.execute).not.toHaveBeenCalled();
  });
});

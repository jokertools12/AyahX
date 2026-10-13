// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AdminFeedbackService } from '../../server/admin/adminFeedbackService';
import type { CatalogActor } from '../../server/services/catalogAudit';
import type { CatalogDatabase } from '../../server/services/catalogContracts';
import { adminFeedbackMigrationSql, downAdminFeedback } from '../../server/db/migrations/009_addAdminFeedback';

const actor = (id = 'admin-1', roleSlug = 'admin'): CatalogActor => ({ id, kind: 'human', roleSlug, permissions: new Set(['dashboard.read']) });
function database(rows: unknown[][] = []): CatalogDatabase {
  return {
    read: vi.fn(async () => rows.shift() ?? []),
    execute: vi.fn(async () => undefined),
    transaction: async work => work(db),
  } as CatalogDatabase;
}
let db: CatalogDatabase;

describe('admin feedback', () => {
  it('stores only bounded local page diagnostics and appends an audit event', async () => {
    db = database();
    const service = new AdminFeedbackService(db);
    const result = await service.submit(actor(), {
      message: 'النص صغير في هذه الشاشة', category: 'font_small', path: '/admin/reviews',
      viewport_width: 390, viewport_height: 844, device_pixel_ratio: 3, zoom_percent: 150,
      theme: 'dark', language: 'ar', browser: 'Chromium', density: 'comfortable', font_scale: 1.1,
    });
    expect(result).toMatchObject({ status: 'new' });
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_feedback'), expect.arrayContaining(['admin-1', 'النص صغير في هذه الشاشة', 'font_small', '/admin/reviews']));
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), expect.arrayContaining(['admin.feedback.create', 'admin_feedback']));
    expect(db.execute).not.toHaveBeenCalledWith(expect.stringContaining('screenshot'), expect.anything());
  });

  it('keeps status changes behind the administrator role check', async () => {
    db = database();
    await expect(new AdminFeedbackService(db).updateStatus(actor('analyst-1', 'analyst'), false, 'feedback-1', 'done')).rejects.toMatchObject({ code: 'ADMIN_FEEDBACK_MANAGE_DENIED', status: 403 });
  });

  it('limits non-owner reads to their own feedback while admins can list every row', async () => {
    db = database([[{ total: 1 }], [{ id: 'feedback-1', actor_id: 'admin-1', status: 'new' }], [{ total: 2 }], [{ id: 'feedback-2', actor_id: 'other', status: 'in_progress' }]]);
    const service = new AdminFeedbackService(db);
    await service.list(actor('admin-1', 'analyst'), false, { page: 1, limit: 25 });
    expect(db.read).toHaveBeenNthCalledWith(1, expect.stringContaining('actor_id=?'), ['admin-1']);
    await service.list(actor('admin-1', 'admin'), true, { page: 1, limit: 25 });
    expect(db.read).toHaveBeenNthCalledWith(3, expect.not.stringContaining('actor_id=?'), []);
  });

  it('creates an additive table without a foreign key and refuses a nonempty local rollback', async () => {
    const sql = adminFeedbackMigrationSql().join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_feedback');
    expect(sql).not.toMatch(/FOREIGN KEY/iu);
    const rehearsal = { query: vi.fn(async () => undefined) };
    await downAdminFeedback(rehearsal, 'local-rehearsal');
    expect(rehearsal.query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*)=0'));
    await expect(downAdminFeedback(rehearsal, 'production' as never)).rejects.toThrow('DESTRUCTIVE_REHEARSAL_ONLY');
  });
});

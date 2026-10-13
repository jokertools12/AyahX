import { randomUUID } from 'node:crypto';
import { appendCatalogAudit, type CatalogActor } from '../services/catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow } from '../services/catalogContracts';

export const adminFeedbackCategories = ['screen_small', 'font_small', 'colors_annoying', 'confusing', 'not_working'] as const;
export const adminFeedbackStatuses = ['new', 'in_progress', 'done'] as const;
export type AdminFeedbackCategory = (typeof adminFeedbackCategories)[number];
export type AdminFeedbackStatus = (typeof adminFeedbackStatuses)[number];

export interface AdminFeedbackInput {
  message: string;
  category: AdminFeedbackCategory;
  path: string;
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
  zoom_percent: number;
  theme: string;
  language: string;
  browser: string;
  density: string;
  font_scale: number;
}

export interface AdminFeedbackListInput { page: number; limit: number; status?: AdminFeedbackStatus }
export interface AdminFeedbackPage { items: CatalogRow[]; page: number; limit: number; total: number; totalPages: number }

function pageValues(input: Partial<AdminFeedbackListInput>): Required<Pick<AdminFeedbackListInput, 'page' | 'limit'>> {
  const page = Number.isSafeInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit) > 0 ? Math.min(Number(input.limit), 100) : 25;
  return { page, limit };
}

export class AdminFeedbackService {
  constructor(private readonly db: CatalogDatabase) {}

  async submit(actor: CatalogActor, input: AdminFeedbackInput): Promise<CatalogRow> {
    if (actor.kind !== 'human' || !actor.id) throw new CatalogError('ADMIN_FEEDBACK_ACTOR_REQUIRED', 403);
    const id = randomUUID();
    const feedback: CatalogRow = { id, actor_id: actor.id, ...input, status: 'new' };
    await this.db.transaction(async tx => {
      await tx.execute(
        'INSERT INTO admin_feedback(id,actor_id,message,category,path,viewport_width,viewport_height,device_pixel_ratio,zoom_percent,theme,language,browser,density,font_scale,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, actor.id, input.message, input.category, input.path, input.viewport_width, input.viewport_height, input.device_pixel_ratio, input.zoom_percent, input.theme, input.language, input.browser, input.density, input.font_scale, 'new'],
      );
      await appendCatalogAudit(tx, actor, 'admin.feedback.create', 'admin_feedback', id, null, feedback);
    });
    return feedback;
  }

  async list(actor: CatalogActor, canReadAll: boolean, input: Partial<AdminFeedbackListInput> = {}): Promise<AdminFeedbackPage> {
    const { page, limit } = pageValues(input);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!canReadAll) { conditions.push('actor_id=?'); params.push(actor.id); }
    if (input.status) { conditions.push('status=?'); params.push(input.status); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countRows = await this.db.read(`SELECT COUNT(*) AS total FROM admin_feedback${where}`, params);
    const total = Number(countRows[0]?.total ?? 0);
    const rows = await this.db.read(`SELECT id,actor_id,message,category,path,viewport_width,viewport_height,device_pixel_ratio,zoom_percent,theme,language,browser,density,font_scale,status,created_at,updated_at FROM admin_feedback${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    return { items: rows, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async updateStatus(actor: CatalogActor, canManage: boolean, id: string, status: AdminFeedbackStatus): Promise<void> {
    if (!canManage) throw new CatalogError('ADMIN_FEEDBACK_MANAGE_DENIED', 403);
    await this.db.transaction(async tx => {
      const rows = await tx.read('SELECT id,status FROM admin_feedback WHERE id=? FOR UPDATE', [id]);
      if (!rows[0]) throw new CatalogError('ADMIN_FEEDBACK_NOT_FOUND', 404);
      const oldValues: CatalogRow = { status: rows[0].status };
      await tx.execute('UPDATE admin_feedback SET status=? WHERE id=?', [status, id]);
      await appendCatalogAudit(tx, actor, 'admin.feedback.status.update', 'admin_feedback', id, oldValues, { status });
    });
  }
}

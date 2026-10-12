import { z } from 'zod';
import type { AdminRegister } from '../../admin/adminContracts';
import { AdminOwnerWorkspace } from '../../admin/adminOwnerWorkspace';
import { reviewTypes } from '../../admin/adminReviewWorkspace';
import type { ReviewDecisionInput } from '../../../shared/admin/batch5';

const note = z.string().trim().min(1).max(10000);
const ids = z.array(z.string().uuid()).min(1).max(100);
const status = z.enum(['approved', 'rejected', 'deferred']);
const decision = z.object({ display_label_ar: z.string().trim().min(1).max(255).optional(), display_label_en: z.string().max(255).optional(), license_status: z.enum(['permitted', 'restricted']).optional(), rights_evidence_ref: z.string().trim().min(1).max(2000).optional(), rights_status: z.enum(['owner_permission', 'cc_licensed', 'own_content', 'unknown']).optional() }).strict();
export function registerAdminA2bEndpoints(register: AdminRegister, owner: AdminOwnerWorkspace): void {
  register({ method: 'get', path: '/workspace', permission: 'dashboard.read', handler: async () => ({ data: await owner.summary() }) });
  register({ method: 'get', path: '/project-status', permission: 'dashboard.read', handler: async () => ({ data: await owner.project() }) });
  register({ method: 'get', path: '/preferences', permission: 'security.self', handler: async ctx => ({ data: await owner.preferences(ctx.user.id) }) });
  register({ method: 'patch', path: '/preferences', permission: 'security.self', writes: true, body: z.object({ density: z.enum(['comfortable', 'compact']), font_scale: z.union([z.literal(1), z.literal(1.1), z.literal(1.2)]) }).strict(), handler: async ctx => ({ data: await owner.updatePreferences(ctx.actor, ctx.body as unknown as Parameters<AdminOwnerWorkspace['updatePreferences']>[1]) }) });
  register({ method: 'get', path: '/reviews', permission: 'review.read', query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['pending', 'approved', 'rejected', 'deferred']).optional(), type: z.enum(reviewTypes).optional(), q: z.string().max(255).optional(), eligible: z.enum(['true', 'false']).optional() }).strict(), handler: ctx => owner.reviews.list(ctx.query as unknown as Parameters<typeof owner.reviews.list>[0]) });
  register({ method: 'post', path: '/reviews/bulk-preview', permission: 'review.decide', writes: true, body: z.object({ ids, status }).strict(), handler: async ctx => ({ data: await owner.reviews.bulkPreview(ctx.body.ids as string[], ctx.actor) }) });
  register({ method: 'post', path: '/reviews/bulk', permission: 'review.decide', writes: true, body: z.object({ ids, status, notes: note, confirmation: z.string().max(3) }).strict(), handler: async ctx => ({ data: await owner.reviews.bulk(ctx.actor, ctx.body.ids as string[], ctx.body.status as ReviewDecisionInput['status'], String(ctx.body.notes), String(ctx.body.confirmation)) }) });
  register({ method: 'get', path: '/reviews/:id', permission: 'review.read', handler: async ctx => ({ data: await owner.reviews.detail(ctx.params.id) }) });
  register({ method: 'post', path: '/reviews/:id/decision', permission: 'review.decide', writes: true, body: z.object({ status, notes: note, decision: decision.optional(), confirmation: z.string().max(64).optional() }).strict(), handler: async ctx => ({ data: await owner.reviews.decide(ctx.actor, ctx.params.id, ctx.body as unknown as ReviewDecisionInput) }) });
  register({ method: 'post', path: '/reviews/:id/undo', permission: 'review.decide', writes: true, body: z.object({ notes: note }).strict(), handler: async ctx => ({ data: await owner.reviews.undo(ctx.actor, ctx.params.id, String(ctx.body.notes)) }) });
  register({ method: 'get', path: '/listening/:id', permission: 'review.read', handler: async ctx => ({ data: await owner.listening(ctx.params.id) }) });
  register({ method: 'get', path: '/provider-licenses', permission: 'providers.read', handler: async () => ({ data: await owner.providers() }) });
  register({ method: 'get', path: '/labels', permission: 'recitations.read', handler: async () => ({ data: { items: await owner.reviews.labels() } }) });
  register({ method: 'post', path: '/labels/:id/approve', permission: 'review.decide', writes: true, body: z.object({ display_label_ar: z.string().trim().min(1).max(255), display_label_en: z.string().max(255).optional(), notes: note.optional() }).strict(), handler: async ctx => ({ data: await owner.reviews.approveLabel(ctx.actor, ctx.params.id, String(ctx.body.display_label_ar), ctx.body.display_label_en as string | undefined, ctx.body.notes as string | undefined) }) });
  register({ method: 'get', path: '/launch-readiness', permission: 'review.read', handler: async () => ({ data: await owner.launch() }) });
}

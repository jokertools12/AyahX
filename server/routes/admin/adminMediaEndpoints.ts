import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AdminRegister } from '../../admin/adminContracts';
import type { AdminMediaWorkspace } from '../../admin/adminMediaWorkspace';
import type { AdminMediaTasks } from '../../admin/adminMediaTasks';
import { ReciterWizardSchema, type AdminReciterWizard, type ReciterWizardInput } from '../../admin/adminReciterWizard';
import type { BeginLicensedUpload } from '../../services/catalogStorageAdminService';
const empty = z.object({}).strict();
export function registerAdminMediaEndpoints(register: AdminRegister, media: AdminMediaWorkspace, tasks: AdminMediaTasks, wizard: AdminReciterWizard): void {
  register({ method: 'get', path: '/storage', permission: 'storage.manage', handler: async () => ({ data: await media.summary() }) });
  register({ method: 'post', path: '/storage/test', permission: 'storage.manage', writes: true, body: empty, handler: async ctx => ({ data: await media.test(ctx.actor) }) });
  register({ method: 'get', path: '/licensed-audio', permission: 'sources.read', handler: async () => ({ data: await media.list() }) });
  register({ method: 'get', path: '/licensed-audio/:id', permission: 'sources.read', handler: async ctx => ({ data: await media.detail(ctx.params.id) }) });
  register({ method: 'post', path: '/licensed-audio/:id/rights', permission: 'review.decide', writes: true, body: z.object({ status: z.enum(['approved', 'rejected', 'deferred']), rights_status: z.enum(['owner_permission', 'cc_licensed', 'own_content', 'unknown']), rights_evidence_ref: z.string().trim().min(1).max(2000), notes: z.string().trim().min(1).max(10000) }).strict(), handler: async ctx => ({ data: await media.rights(ctx.actor, ctx.params.id, ctx.body as unknown as Parameters<AdminMediaWorkspace['rights']>[2]) }) });
  register({ method: 'post', path: '/storage/uploads', permission: 'storage.manage', writes: true, body: z.object({ recitationId: z.string().uuid(), surah: z.number().int().min(1).max(114), sha256: z.string().regex(/^[a-f0-9]{64}$/u), sizeBytes: z.number().int().min(1).max(1000000000), extension: z.enum(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav']), contentType: z.string().regex(/^audio\/[a-z0-9.+-]{1,50}$/u), rightsRef: z.string().uuid(), multipart: z.boolean() }).strict(), handler: async ctx => ({ data: await media.begin(ctx.actor, ctx.body as unknown as BeginLicensedUpload) }) });
  register({ method: 'post', path: '/storage/uploads/:id/resume', permission: 'storage.manage', writes: true, body: empty, handler: async ctx => ({ data: await media.resume(ctx.actor, ctx.params.id) }) });
  register({ method: 'post', path: '/storage/uploads/:id/parts', permission: 'storage.manage', writes: true, body: z.object({ partNumber: z.number().int().min(1).max(1000) }).strict(), handler: async ctx => ({ data: await media.part(ctx.actor, ctx.params.id, Number(ctx.body.partNumber)) }) });
  register({ method: 'post', path: '/storage/uploads/:id/finish', permission: 'storage.manage', writes: true, body: empty, handler: async ctx => { await media.finish(ctx.actor, ctx.params.id); const task = await tasks.enqueue(ctx.actor, randomUUID(), { type: 'verify_upload', storage_object_id: ctx.params.id }); return { data: { status: 'uploaded', verification_task_id: task.id } }; } });
  register({ method: 'post', path: '/storage/uploads/:id/abort', permission: 'storage.manage', writes: true, body: empty, handler: async ctx => { await media.abort(ctx.actor, ctx.params.id); return { data: { status: 'rejected' } }; } });
  register({ method: 'post', path: '/storage/uploads/:id/verify', permission: 'storage.manage', writes: true, body: z.object({ intent_id: z.string().uuid() }).strict(), handler: async ctx => ({ data: await tasks.enqueue(ctx.actor,String(ctx.body.intent_id),{ type:'verify_upload',storage_object_id:ctx.params.id }) }) });
  register({ method: 'get', path: '/storage/tasks/:id', permission: 'sources.read', handler: async ctx => ({ data: await tasks.get(ctx.params.id) }) });
  register({ method: 'post', path: '/licensed-audio/:id/candidate', permission: 'sources.write', writes: true, body: z.object({ surah: z.number().int().min(1).max(114), url: z.string().url().max(2000), intent_id: z.string().uuid() }).strict(), handler: async ctx => ({ data: await tasks.enqueue(ctx.actor, String(ctx.body.intent_id), { type: 'candidate', recitation_id: ctx.params.id, surah: Number(ctx.body.surah), url: String(ctx.body.url) }) }) });
  register({ method: 'get', path: '/reciter-wizard/options', permission: 'recitations.write', handler: async () => ({ data: await wizard.options() }) });
  register({ method: 'post', path: '/reciter-wizard/validate', permission: 'recitations.write', writes: true, body: ReciterWizardSchema, handler: async ctx => ({ data: await wizard.validateForActor(ctx.actor,ctx.body as unknown as ReciterWizardInput) }) });
  register({ method: 'post', path: '/reciter-wizard', permission: 'recitations.write', writes: true, body: ReciterWizardSchema, handler: async ctx => ({ data: await wizard.create(ctx.actor, ctx.body as unknown as ReciterWizardInput) }) });
}

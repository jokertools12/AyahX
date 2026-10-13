import { createHash } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { CatalogError, type CatalogDatabase, type CatalogRow } from '../services/catalogContracts';
import { appendCatalogAudit, canonicalAuditJson, requireCatalogPermission, type CatalogActor } from '../services/catalogAudit';
import { parsedJson, redactCatalogEvidence } from '../services/adminCatalogUtilities';
import type { AdminMediaWorkspace } from './adminMediaWorkspace';
import type { ActorLoader } from '../services/adminCatalogTasks';
import { logger } from '../logger';
import { validateReviewEvidence } from '../services/humanReviewService';
export type MediaTaskInput = { type: 'verify_upload'; storage_object_id: string } | { type: 'candidate'; recitation_id: string; surah: number; url: string };
const queueName = 'ayahx-admin-media-v1';
export function mediaRedisConnection(raw: string | undefined): ConnectionOptions {
  let url: URL; try { url = new URL(raw ?? ''); } catch { throw new CatalogError('ADMIN_MEDIA_QUEUE_UNAVAILABLE', 503); }
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new CatalogError('ADMIN_MEDIA_QUEUE_UNAVAILABLE', 503);
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isSafeInteger(db) || db < 0) throw new CatalogError('ADMIN_MEDIA_QUEUE_UNAVAILABLE', 503);
  return { host: url.hostname, port: Number(url.port || 6379), ...(url.username ? { username: decodeURIComponent(url.username) } : {}), ...(url.password ? { password: decodeURIComponent(url.password) } : {}), db, maxRetriesPerRequest: null, ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
}
/** Heavy audio work has a separate BullMQ queue; HTTP never decodes audio. */
export class AdminMediaTasks {
  private queue?: Queue;
  private worker?: Worker;
  constructor(private readonly db: CatalogDatabase, private readonly media: AdminMediaWorkspace, private readonly actorForUser: ActorLoader, private readonly env: NodeJS.ProcessEnv = process.env) {}
  start(): void {
    if (this.worker || !this.env.REDIS_URL) return;
    const connection = mediaRedisConnection(this.env.REDIS_URL);
    this.queue = new Queue(queueName, { connection, defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } } });
    this.queue.on('error', () => logger.error('ADMIN_MEDIA_QUEUE_UNAVAILABLE', { code: 'ADMIN_MEDIA_QUEUE_UNAVAILABLE' }));
    this.worker = new Worker(queueName, async job => this.perform(String(job.data.id)), { connection, concurrency: 1, lockDuration: 120000, lockRenewTime: 30000 });
    this.worker.on('error', () => logger.error('ADMIN_MEDIA_WORKER_UNAVAILABLE', { code: 'ADMIN_MEDIA_WORKER_UNAVAILABLE' }));
  }
  async close(): Promise<void> { await this.worker?.close(); await this.queue?.close(); this.worker = undefined; this.queue = undefined; }
  async enqueue(actor: CatalogActor, id: string, input: MediaTaskInput): Promise<CatalogRow> {
    requireCatalogPermission(actor, input.type === 'verify_upload' ? 'storage.manage' : 'recitations.sources.manage', true);
    // Candidate URLs are persisted as task intent. Expiring capabilities and
    // credentials must be rejected before either SQL or Redis can retain them.
    validateReviewEvidence(input);
    this.start(); if (!this.queue) throw new CatalogError('ADMIN_MEDIA_QUEUE_UNAVAILABLE', 503);
    const sha = createHash('sha256').update(canonicalAuditJson(input)).digest('hex');
    await this.db.transaction(async tx => {
      const [old] = await tx.read('SELECT actor_id,request_json FROM admin_media_tasks WHERE id=? FOR UPDATE', [id]);
      if (old) { if (old.actor_id !== actor.id || parsedJson<CatalogRow>(old.request_json).sha256 !== sha) throw new CatalogError('TASK_INTENT_CONFLICT', 409); return; }
      await tx.execute("INSERT INTO admin_media_tasks(id,actor_id,type,status,request_json) VALUES(?,?,?,'pending',?)", [id, actor.id, input.type, JSON.stringify({ ...input, sha256: sha })]);
      await appendCatalogAudit(tx, actor, 'admin.media_task.enqueue', 'admin_media_task', id, null, { type: input.type, status: 'pending', intent_sha256: sha });
    });
    await this.queue.add(input.type, { id }, { jobId: 'media-' + id });
    return this.get(id);
  }
  async get(id: string): Promise<CatalogRow> {
    const [row] = await this.db.read('SELECT id,type,status,result_json,error_code,created_at,updated_at FROM admin_media_tasks WHERE id=?', [id]);
    if (!row) throw new CatalogError('TASK_NOT_FOUND', 404);
    return { ...row, progress: ['completed', 'failed', 'needs_review'].includes(String(row.status)) ? 100 : row.status === 'running' ? null : 0, result: redactCatalogEvidence(parsedJson(row.result_json)) };
  }
  private async perform(id: string): Promise<CatalogRow> {
    const [row] = await this.db.read('SELECT * FROM admin_media_tasks WHERE id=?', [id]);
    if (!row) throw new CatalogError('TASK_NOT_FOUND', 404);
    if (['completed', 'needs_review'].includes(String(row.status))) return this.get(id);
    const input = parsedJson<MediaTaskInput>(row.request_json);
    let actor:CatalogActor={id:'admin_media_worker',kind:'system',permissions:new Set(),requestId:'media-task:'+id};
    try {
      actor=await this.actorForUser(String(row.actor_id),{requestId:'media-task:'+id});
      requireCatalogPermission(actor, input.type === 'verify_upload' ? 'storage.manage' : 'recitations.sources.manage', true);
      await this.db.transaction(async tx => { await tx.execute("UPDATE admin_media_tasks SET status='running',error_code=NULL WHERE id=?", [id]); await appendCatalogAudit(tx, actor, 'admin.media_task.start', 'admin_media_task', id, null, { status: 'running' }); });
      const result = input.type === 'verify_upload' ? (await this.media.verify(actor, input.storage_object_id), { verified: true, storage_object_id: input.storage_object_id }) : await this.media.candidate(actor, input.recitation_id, input.surah, input.url);
      await this.db.transaction(async tx => { await tx.execute("UPDATE admin_media_tasks SET status='completed',result_json=?,error_code=NULL WHERE id=?", [JSON.stringify(result), id]); await appendCatalogAudit(tx, actor, 'admin.media_task.completed', 'admin_media_task', id, null, result); });
      return result;
    } catch (error) {
      const code = error instanceof CatalogError ? error.code : 'ADMIN_MEDIA_TASK_FAILED', needsReview = ['LICENSED_OFFSET_REFERENCE_UNAVAILABLE', 'CANDIDATE_REFERENCE_FINGERPRINT_UNAVAILABLE'].includes(code), status = needsReview ? 'needs_review' : 'failed';
      await this.db.transaction(async tx => { await tx.execute('UPDATE admin_media_tasks SET status=?,error_code=? WHERE id=?', [status, code, id]); await appendCatalogAudit(tx, actor, 'admin.media_task.' + status, 'admin_media_task', id, null, { status, error_code: code }); });
      // The job explicitly fails as well; a needs-review row never implies success.
      throw new CatalogError(code, error instanceof CatalogError ? error.status : 503);
    }
  }
}

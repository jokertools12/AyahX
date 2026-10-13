import { describe, expect, it, vi } from 'vitest';
import { AdminMediaTasks } from '../../server/admin/adminMediaTasks';
import type { AdminMediaWorkspace } from '../../server/admin/adminMediaWorkspace';
import type { AdminReciterWizard } from '../../server/admin/adminReciterWizard';
import type { AdminEndpointDefinition, AdminRequestContext } from '../../server/admin/adminContracts';
import { registerAdminMediaEndpoints } from '../../server/routes/admin/adminMediaEndpoints';
import { CatalogStorageAdminService } from '../../server/services/catalogStorageAdminService';
import type { AudioObjectStorage } from '../../server/services/catalogStorageContracts';
import type { CatalogActor } from '../../server/services/catalogAudit';
import type { CatalogDatabase, CatalogRow } from '../../server/services/catalogContracts';

const objectId = '00000000-0000-4000-8000-000000000001';
const actor: CatalogActor = { id: 'owner', kind: 'human', permissions: new Set(['storage.manage', 'storage.verify']) };

/** In-memory SQL/S3/Redis boundaries, with the actual completion and queue-intent services. */
function recoveryFixture() {
  const object: CatalogRow = { id: objectId, adapter: 'r2', bucket: 'unit', object_key: 'owned/unit.wav', sha256: 'a'.repeat(64), size_bytes: 16, content_type: 'audio/wav', recitation_id: 'recitation', surah: 1, rights_ref: 'review', upload_status: 'pending', upload_id: 'multipart', upload_expires_at: new Date(Date.now() + 60000).toISOString() };
  const intents = new Map<string, CatalogRow>(), audits: string[] = [], jobs = new Map<string, unknown>();
  let rightsApproved = true, completedObject = false;
  const db: CatalogDatabase = {
    async read(sql, params = []) {
      if (sql.startsWith('SELECT * FROM storage_objects')) return [{ ...object }];
      if (sql.startsWith('SELECT h.status')) return rightsApproved ? [{ status: 'approved', decided_by: 'owner', type: 'storage_rights', subject_type: 'recitation', subject_id: 'recitation' }] : [];
      if (sql.includes('FROM admin_media_tasks')) { const intent = intents.get(String(params[0])); return intent ? [{ ...intent }] : []; }
      if (sql.startsWith('SELECT a.hash')) return [];
      throw new Error('UNEXPECTED_UNIT_QUERY');
    },
    async execute(sql, params = []) {
      if (sql.startsWith('UPDATE storage_objects SET upload_status=')) { object.upload_status = 'uploaded'; object.upload_id = null; return; }
      if (sql.startsWith('INSERT INTO admin_media_tasks')) { intents.set(String(params[0]), { id: params[0], actor_id: params[1], type: params[2], status: 'pending', request_json: params[3] }); return; }
      if (sql.startsWith('INSERT INTO audit_logs')) { audits.push(String(params[3])); return; }
      throw new Error('UNEXPECTED_UNIT_WRITE');
    },
    transaction: work => work(db),
  };
  const storage = {
    adapter: 'r2', bucket: 'unit',
    head: vi.fn(async () => completedObject ? { sizeBytes: 16, contentType: 'audio/wav', etag: 'unit' } : null),
    listParts: vi.fn(async () => [{ partNumber: 1, etag: 'unit', sizeBytes: 16 }]),
    completeMultipart: vi.fn(async () => { completedObject = true; }),
    presignPut: vi.fn(), presignPart: vi.fn(), read: vi.fn(),
  } as unknown as AudioObjectStorage;
  const service = new CatalogStorageAdminService(db, storage, { consume: async () => {} }, { verify: async () => { throw new Error('VERIFICATION_MUST_NOT_REPEAT'); } }, { enqueueVoiceReverification: async () => {} }, 'unused-unit-scratch');
  const media = { finish: (who: CatalogActor, id: string) => service.finishUpload(who, id) } as unknown as AdminMediaWorkspace;
  const tasks = new AdminMediaTasks(db, media, async () => actor, {});
  const add = vi.fn(async (_type: string, data: unknown, options: { jobId: string }) => { if (!jobs.has(options.jobId)) jobs.set(options.jobId, data); return {}; });
  Object.assign(tasks, { queue: { add } });
  const routes: AdminEndpointDefinition[] = [];
  registerAdminMediaEndpoints(definition => routes.push(definition), media, tasks, {} as AdminReciterWizard);
  const finish = routes.find(route => route.path === '/storage/uploads/:id/finish')!;
  const context = { actor, params: { id: objectId }, body: {} } as unknown as AdminRequestContext;
  return { object, intents, audits, storage, jobs, add, service, finish: (who = actor) => finish.handler({ ...context, actor: who }), revokeRights: () => { rightsApproved = false; } };
}

describe('licensed upload completion recovery', () => {
  it('recovers after the upload commit succeeds but Redis enqueue fails', async () => {
    const fixture = recoveryFixture();
    fixture.add.mockRejectedValueOnce(new Error('UNIT_REDIS_UNAVAILABLE'));
    await expect(fixture.finish()).rejects.toThrow('UNIT_REDIS_UNAVAILABLE');
    expect(fixture.object.upload_status).toBe('uploaded');
    expect(fixture.intents.size).toBe(1);
    const intentId = [...fixture.intents.keys()][0];
    const reads = vi.mocked(fixture.storage.head).mock.calls.length;
    expect(await fixture.service.resumeUpload(actor, objectId)).toEqual({ parts: [], put: null, completedObject: true });
    expect(await fixture.finish()).toMatchObject({ data: { status: 'uploaded', verification_task_id: intentId } });
    expect(fixture.intents.size).toBe(1);
    expect(fixture.jobs.size).toBe(1);
    expect(fixture.storage.head).toHaveBeenCalledTimes(reads);
    expect(fixture.storage.completeMultipart).toHaveBeenCalledTimes(1);
    expect(fixture.storage.presignPut).not.toHaveBeenCalled();
    expect(fixture.storage.presignPart).not.toHaveBeenCalled();
    expect(fixture.audits.filter(action => action === 'storage.upload_finish')).toHaveLength(1);
  });

  it('returns the same verification intent if the successful HTTP response was lost', async () => {
    const fixture = recoveryFixture(), first = await fixture.finish();
    expect(await fixture.service.resumeUpload(actor, objectId)).toEqual({ parts: [], put: null, completedObject: true });
    expect(await fixture.finish()).toEqual(first);
    expect(fixture.intents.size).toBe(1);
    expect(fixture.jobs.size).toBe(1);
    expect(fixture.storage.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it('treats a verified object as completed without rerunning its media verification', async () => {
    const fixture = recoveryFixture();
    fixture.object.upload_status = 'verified';
    expect(await fixture.service.resumeUpload(actor, objectId)).toEqual({ parts: [], put: null, completedObject: true });
    await fixture.service.finishUpload(actor, objectId);
    await fixture.service.verifyUploaded(actor, objectId);
    expect(fixture.storage.head).not.toHaveBeenCalled();
    expect(fixture.storage.read).not.toHaveBeenCalled();
    expect(fixture.object.upload_status).toBe('verified');
  });

  it('does not let another actor claim or overwrite the persisted verification intent', async () => {
    const fixture = recoveryFixture();
    await fixture.finish();
    await expect(fixture.finish({ ...actor, id: 'other-owner' })).rejects.toThrow('TASK_INTENT_CONFLICT');
    expect(fixture.intents.size).toBe(1);
    expect(fixture.jobs.size).toBe(1);
    expect([...fixture.intents.values()][0].actor_id).toBe(actor.id);
  });

  it('does not recover completed uploads whose rights were revoked or superseded', async () => {
    const fixture = recoveryFixture();
    fixture.object.upload_status = 'uploaded'; fixture.revokeRights();
    await expect(fixture.service.resumeUpload(actor, objectId)).rejects.toThrow('LICENSED_RIGHTS_NOT_APPROVED');
    await expect(fixture.service.finishUpload(actor, objectId)).rejects.toThrow('LICENSED_RIGHTS_NOT_APPROVED');
    fixture.object.upload_status = 'verified';
    await expect(fixture.service.verifyUploaded(actor, objectId)).rejects.toThrow('LICENSED_RIGHTS_NOT_APPROVED');
    expect(fixture.intents.size).toBe(0); expect(fixture.jobs.size).toBe(0);
  });

  it('continues rejecting expired pending and rejected uploads without issuing capabilities', async () => {
    const fixture = recoveryFixture();
    fixture.object.upload_expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(fixture.service.resumeUpload(actor, objectId)).rejects.toThrow('STORAGE_UPLOAD_EXPIRED_OR_FINISHED');
    fixture.object.upload_status = 'rejected';
    await expect(fixture.service.resumeUpload(actor, objectId)).rejects.toThrow('STORAGE_UPLOAD_EXPIRED_OR_FINISHED');
    await expect(fixture.service.finishUpload(actor, objectId)).rejects.toThrow('STORAGE_UPLOAD_STATE_CHANGED');
    expect(fixture.storage.presignPut).not.toHaveBeenCalled(); expect(fixture.storage.presignPart).not.toHaveBeenCalled();
  });
});

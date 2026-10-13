import { randomUUID } from 'node:crypto';
import { CatalogError, type CatalogDatabase, type CatalogRow, type CatalogTx } from './catalogContracts';
import { appendCatalogAudit, requireCatalogPermission, type CatalogActor } from './catalogAudit';
import { AUDIO_MULTIPART_PART_BYTES, licensedObjectKey, assertStorageSize, type AudioObjectStorage, type AudioObjectSpec, type LicensedAudioExtension, type StorageSignedCapability } from './catalogStorageContracts';
import { verifyLicensedAudio, type LicensedOffsetVerifier } from './licensedAudioVerification';
import type { SourceAyahTiming } from '../../shared/timing/toRenderTimeline';

export interface StorageAdmission { consume(actorId: string, action: string): Promise<void> }
export interface LicensedStorageHooks { enqueueVoiceReverification(tx: CatalogTx, recitationId: string, storageObjectId: string): Promise<void> }
export interface BeginLicensedUpload { recitationId: string; surah: number; sha256: string; sizeBytes: number; extension: LicensedAudioExtension; contentType: string; rightsRef: string; multipart: boolean }
export interface LicensedUploadSession { storageObjectId: string; objectKey: string; uploadId: string | null; partSizeBytes: number; partCount: number; put: StorageSignedCapability | null }
/** A1 supplies authenticated actors and a shared rate limiter. No routes are mounted in D4. */
export class CatalogStorageAdminService {
  constructor(private readonly db: CatalogDatabase, private readonly storage: AudioObjectStorage, private readonly admission: StorageAdmission, private readonly offset: LicensedOffsetVerifier, private readonly hooks: LicensedStorageHooks, private readonly scratchRoot: string) {}
  private async authorize(actor: CatalogActor, action: string): Promise<void> {
    requireCatalogPermission(actor, 'storage.manage', true); await this.admission.consume(actor.id, action);
    if (this.storage.adapter === 'url_reference') throw new CatalogError('STORAGE_UPLOAD_NOT_CONFIGURED', 409);
  }
  private async object(tx: CatalogTx, id: string, lock = false): Promise<CatalogRow> {
    const [row] = await tx.read('SELECT * FROM storage_objects WHERE id=?' + (lock ? ' FOR UPDATE' : ''), [id]);
    if (!row || row.adapter !== this.storage.adapter || row.bucket !== this.storage.bucket) throw new CatalogError('STORAGE_OBJECT_NOT_FOUND', 404); return row;
  }
  private spec(row: CatalogRow): AudioObjectSpec { return { objectKey: String(row.object_key), sha256: String(row.sha256), sizeBytes: Number(row.size_bytes), contentType: String(row.content_type) }; }
  private async rights(tx: CatalogTx, reference: string, recitationId: string): Promise<void> {
    const [review] = await tx.read("SELECT h.status,h.decided_by,h.type,COALESCE(h.target_subject_type,h.subject_type) subject_type,COALESCE(h.target_subject_id,h.subject_id) subject_id FROM human_review_items h WHERE h.id=? AND NOT EXISTS(SELECT 1 FROM human_review_items newer WHERE newer.supersedes_id=h.id)", [reference]);
    if (!review || review.status !== 'approved' || !review.decided_by || !['storage_rights', 'youtube_rights'].includes(String(review.type)) || review.subject_type !== 'recitation' || review.subject_id !== recitationId) throw new CatalogError('LICENSED_RIGHTS_NOT_APPROVED', 409);
  }
  async beginUpload(actor: CatalogActor, input: BeginLicensedUpload): Promise<LicensedUploadSession> {
    await this.authorize(actor, 'upload.begin'); assertStorageSize(input.sizeBytes);
    if (!input.rightsRef || !/^audio\/[a-z0-9.+-]{1,50}$/u.test(input.contentType) || typeof input.multipart !== 'boolean') throw new CatalogError('STORAGE_INPUT_INVALID', 422);
    const [r] = await this.db.read('SELECT id,slug FROM recitations WHERE id=?', [input.recitationId]); if (!r) throw new CatalogError('RECITATION_NOT_FOUND', 404);
    const objectKey = licensedObjectKey(String(r.slug), input.surah, input.sha256, input.extension), id = randomUUID();
    await this.db.transaction(async tx => {
      await this.rights(tx, input.rightsRef, input.recitationId);
      const existing = await tx.read('SELECT id FROM storage_objects WHERE adapter=? AND bucket=? AND object_key=? FOR UPDATE', [this.storage.adapter, this.storage.bucket, objectKey]);
      if (existing.length) throw new CatalogError('STORAGE_OBJECT_IMMUTABLE', 409, { storage_object_id: existing[0].id });
      await tx.execute("INSERT INTO storage_objects(id,adapter,bucket,object_key,size_bytes,sha256,content_type,upload_status,uploaded_by,recitation_id,surah,rights_ref,upload_expires_at) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", [id, this.storage.adapter, this.storage.bucket, objectKey, input.sizeBytes, input.sha256, input.contentType, actor.id, input.recitationId, input.surah, input.rightsRef]);
      await appendCatalogAudit(tx, actor, 'storage.upload_begin', 'storage_object', id, null, { recitation_id: input.recitationId, surah: input.surah, object_key: objectKey, size_bytes: input.sizeBytes, rights_ref: input.rightsRef, multipart: input.multipart });
    });
    const spec = { objectKey, sha256: input.sha256, sizeBytes: input.sizeBytes, contentType: input.contentType };
    const uploadId = input.multipart ? await this.storage.beginMultipart(spec) : null;
    if (uploadId) await this.db.transaction(async tx => {
      const row = await this.object(tx, id, true); if (row.upload_status !== 'pending') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409);
      await tx.execute('UPDATE storage_objects SET upload_id=? WHERE id=?', [uploadId, id]);
      await appendCatalogAudit(tx, actor, 'storage.multipart_begin', 'storage_object', id, null, { upload_id: uploadId });
    });
    return { storageObjectId: id, objectKey, uploadId, partSizeBytes: AUDIO_MULTIPART_PART_BYTES, partCount: Math.ceil(input.sizeBytes / AUDIO_MULTIPART_PART_BYTES), put: uploadId ? null : await this.storage.presignPut(spec) };
  }
  async resumeUpload(actor: CatalogActor, id: string): Promise<{ parts: Array<{ partNumber: number; etag: string; sizeBytes: number }>; put: StorageSignedCapability | null; completedObject: boolean }> {
    await this.authorize(actor, 'upload.resume'); const row = await this.object(this.db, id);
    if (row.upload_status === 'uploaded' || row.upload_status === 'verified') {
      // Completion can outlive its HTTP response or the Redis enqueue. Recover
      // the durable object without issuing another upload capability.
      await this.rights(this.db, String(row.rights_ref), String(row.recitation_id));
      return { parts: [], put: null, completedObject: true };
    }
    if (row.upload_status !== 'pending' || !row.upload_expires_at || new Date(String(row.upload_expires_at)).getTime() <= Date.now()) throw new CatalogError('STORAGE_UPLOAD_EXPIRED_OR_FINISHED', 409);
    const head = await this.storage.head(String(row.object_key));
    if (head) { if (head.sizeBytes !== Number(row.size_bytes)) throw new CatalogError('AUDIO_UPLOAD_TRUNCATED', 422); return { parts: [], put: null, completedObject: true }; }
    return { parts: row.upload_id ? await this.storage.listParts(String(row.object_key), String(row.upload_id)) : [], put: row.upload_id ? null : await this.storage.presignPut(this.spec(row)), completedObject: false };
  }
  async partCapability(actor: CatalogActor, id: string, partNumber: number): Promise<StorageSignedCapability> {
    await this.authorize(actor, 'upload.part'); const row = await this.object(this.db, id);
    if (row.upload_status !== 'pending' || !row.upload_id || !row.upload_expires_at || new Date(String(row.upload_expires_at)).getTime() <= Date.now() || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > Math.ceil(Number(row.size_bytes) / AUDIO_MULTIPART_PART_BYTES)) throw new CatalogError('STORAGE_MULTIPART_INVALID', 422);
    const sizeBytes = Math.min(AUDIO_MULTIPART_PART_BYTES, Number(row.size_bytes) - (partNumber - 1) * AUDIO_MULTIPART_PART_BYTES);
    return this.storage.presignPart(String(row.object_key), String(row.upload_id), partNumber, sizeBytes);
  }
  async finishUpload(actor: CatalogActor, id: string): Promise<void> {
    await this.authorize(actor, 'upload.finish'); const row = await this.object(this.db, id);
    if (row.upload_status === 'uploaded' || row.upload_status === 'verified') {
      await this.rights(this.db, String(row.rights_ref), String(row.recitation_id));
      return;
    }
    if (row.upload_status !== 'pending') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409);
    // A crash after S3 completion but before DB commit is resumed from HEAD.
    const completed = await this.storage.head(String(row.object_key));
    if (row.upload_id && !completed) { const parts = await this.storage.listParts(String(row.object_key), String(row.upload_id)); await this.storage.completeMultipart(this.spec(row), String(row.upload_id), parts); }
    const head = await this.storage.head(String(row.object_key)); if (!head || head.sizeBytes !== Number(row.size_bytes)) throw new CatalogError('AUDIO_UPLOAD_TRUNCATED', 422);
    await this.db.transaction(async tx => { const current = await this.object(tx, id, true); if (current.upload_status !== 'pending') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409); await tx.execute("UPDATE storage_objects SET upload_status='uploaded',upload_id=NULL,upload_parts=NULL WHERE id=?", [id]); await appendCatalogAudit(tx, actor, 'storage.upload_finish', 'storage_object', id, { upload_status: 'pending' }, { upload_status: 'uploaded', size_bytes: head.sizeBytes }); });
  }
  async verifyUploaded(actor: CatalogActor, id: string): Promise<void> {
    requireCatalogPermission(actor, 'storage.verify'); const row = await this.object(this.db, id);
    if (row.upload_status === 'verified') {
      await this.rights(this.db, String(row.rights_ref), String(row.recitation_id));
      return;
    }
    if (row.upload_status !== 'uploaded') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409);
    await this.rights(this.db, String(row.rights_ref), String(row.recitation_id));
    const rawTimings = await this.db.read('SELECT ayah,coordinate,source,source_offset_ms,words FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah', [row.recitation_id, row.surah]);
    const timings = rawTimings.map(t => ({ ayah: Number(t.ayah), coordinate: String(t.coordinate), source: String(t.source), source_offset_ms: t.source_offset_ms === null ? null : Number(t.source_offset_ms), words: typeof t.words === 'string' ? JSON.parse(t.words) : t.words })) as SourceAyahTiming[];
    let result;
    try { result = await verifyLicensedAudio(this.storage, { spec: this.spec(row), recitationId: String(row.recitation_id), surah: Number(row.surah), timings, scratchRoot: this.scratchRoot }, this.offset); }
    catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      if(error.code==='LICENSED_OFFSET_REFERENCE_UNAVAILABLE'){
        await this.db.transaction(async tx=>{const current=await this.object(tx,id,true);if(current.upload_status!=='uploaded')throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED',409);await tx.execute('UPDATE storage_objects SET rejection_reason=?,verification_evidence=? WHERE id=?',[error.code,JSON.stringify({sha256:'passed',ffprobe:'passed',offset:'needs_review',reason:error.code}),id]);await appendCatalogAudit(tx,actor,'storage.offset_review_required','storage_object',id,{upload_status:'uploaded'},{upload_status:'uploaded',reason:error.code});});
        throw error;
      }
      await this.db.transaction(async tx => { const current = await this.object(tx, id, true); if (current.upload_status !== 'uploaded') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409); await tx.execute("UPDATE storage_objects SET upload_status='rejected',rejection_reason=? WHERE id=?", [error.code, id]); await appendCatalogAudit(tx, actor, 'storage.verify_rejected', 'storage_object', id, { upload_status: 'uploaded' }, { upload_status: 'rejected', reason: error.code }); });
      throw error;
    }
    await this.db.transaction(async tx => {
      const current = await this.object(tx, id, true); if (current.upload_status !== 'uploaded' || current.sha256 !== result.sha256 || current.recitation_id !== row.recitation_id || Number(current.surah) !== Number(row.surah)) throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409);
      await this.rights(tx, String(row.rights_ref), String(row.recitation_id));
      if (result.offset.method === 'v2') {
        const [review] = await tx.read("SELECT h.id FROM human_review_items h WHERE h.id=? AND h.type='offset_exception' AND h.status='approved' AND h.decided_by IS NOT NULL AND COALESCE(h.target_subject_type,h.subject_type)='recitation' AND COALESCE(h.target_subject_id,h.subject_id)=? AND NOT EXISTS(SELECT 1 FROM human_review_items newer WHERE newer.supersedes_id=h.id) FOR UPDATE", [result.offset.v2Acceptance!.humanReviewId, row.recitation_id]);
        if (!review) throw new CatalogError('LICENSED_V2_REQUIRES_HUMAN_ACCEPTANCE', 409);
      }
      await tx.execute("UPDATE storage_objects SET upload_status='verified',verified_at=UTC_TIMESTAMP(3),duration_ms=?,sample_rate=?,bitrate=?,channels=?,codec=?,content_type=?,verification_evidence=?,rejection_reason=NULL WHERE id=?", [Math.round(result.durationMs), result.sampleRate, result.bitrate, result.channels, result.codec, result.contentType, JSON.stringify({ offset: result.offset, warnings: result.warnings }), id]);
      const previous = await tx.read("SELECT id,storage_object_id FROM recitation_source_urls WHERE recitation_id=? AND surah=? AND kind='licensed_file' AND is_active=1 FOR UPDATE", [row.recitation_id, row.surah]);
      await tx.execute("UPDATE recitation_source_urls SET is_active=0 WHERE recitation_id=? AND surah=? AND kind='licensed_file' AND is_active=1", [row.recitation_id, row.surah]);
      for (const old of previous) if (old.storage_object_id && old.storage_object_id !== id) await tx.execute("UPDATE storage_objects SET upload_status='soft_deleted',soft_deleted_at=UTC_TIMESTAMP(3) WHERE id=? AND upload_status='verified'", [old.storage_object_id]);
      const sourceId = randomUUID();
      // URL remains NULL: runtime capability is issued at read time only.
      await tx.execute("INSERT INTO recitation_source_urls(id,recitation_id,surah,kind,storage_object_id,rights_ref,sha256,duration_ms,verification_status,verification_details,priority,is_active,approved_by) VALUES(?,?,?,'licensed_file',?,?,?,?,'verified',?,0,1,?)", [sourceId, row.recitation_id, row.surah, id, row.rights_ref, result.sha256, Math.round(result.durationMs), JSON.stringify(result.offset), row.uploaded_by]);
      await appendCatalogAudit(tx, actor, 'storage.verified_attach', 'storage_object', id, { upload_status: 'uploaded', prior_sources: previous.map(r => r.id) }, { upload_status: 'verified', source_id: sourceId, sha256: result.sha256, duration_ms: result.durationMs, warnings: result.warnings, offset: result.offset });
      await this.hooks.enqueueVoiceReverification(tx, String(row.recitation_id), id);
    });
  }
  async preview(actor: CatalogActor, id: string): Promise<StorageSignedCapability> {
    requireCatalogPermission(actor, 'storage.preview', true); await this.admission.consume(actor.id, 'preview');
    const row = await this.object(this.db, id); if (row.upload_status !== 'verified') throw new CatalogError('LICENSED_AUDIO_NOT_VERIFIED', 409); await this.rights(this.db, String(row.rights_ref), String(row.recitation_id));
    return this.storage.presignGet(String(row.object_key));
  }
  async abortUpload(actor: CatalogActor, id: string): Promise<void> {
    await this.authorize(actor, 'upload.abort'); const row = await this.object(this.db, id); if (row.upload_status !== 'pending') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409);
    if (row.upload_id) await this.storage.abortMultipart(String(row.object_key), String(row.upload_id));
    await this.db.transaction(async tx => { const current = await this.object(tx, id, true); if (current.upload_status !== 'pending') throw new CatalogError('STORAGE_UPLOAD_STATE_CHANGED', 409); await tx.execute("UPDATE storage_objects SET upload_status='rejected',rejection_reason='UPLOAD_ABORTED',upload_id=NULL WHERE id=?", [id]); await appendCatalogAudit(tx, actor, 'storage.upload_abort', 'storage_object', id, { upload_status: 'pending' }, { upload_status: 'rejected', reason: 'UPLOAD_ABORTED' }); });
  }
  async deleteSoftDeleted(actor: CatalogActor, id: string, confirmation: { objectId: string; sha256: string }): Promise<void> {
    await this.authorize(actor, 'object.delete'); const row = await this.object(this.db, id);
    if (row.upload_status !== 'soft_deleted' || !row.soft_deleted_at || Date.now() - new Date(String(row.soft_deleted_at)).getTime() < 30 * 86400000 || confirmation.objectId !== id || confirmation.sha256 !== row.sha256) throw new CatalogError('STORAGE_DELETE_NOT_CONFIRMED_OR_TOO_EARLY', 409);
    const active = await this.db.read('SELECT id FROM recitation_source_urls WHERE storage_object_id=? AND is_active=1', [id]); if (active.length) throw new CatalogError('STORAGE_OBJECT_STILL_REFERENCED', 409);
    await this.storage.deleteObject(String(row.object_key));
    await this.db.transaction(async tx => { await tx.execute("UPDATE storage_objects SET upload_status='deleted' WHERE id=? AND upload_status='soft_deleted'", [id]); await appendCatalogAudit(tx, actor, 'storage.object_delete', 'storage_object', id, { upload_status: 'soft_deleted' }, { upload_status: 'deleted', sha256: row.sha256 }); });
  }
}

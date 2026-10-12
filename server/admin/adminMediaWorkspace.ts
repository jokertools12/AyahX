import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageSummary } from '../../shared/admin/batch5';
import { appendCatalogAudit, requireCatalogPermission, type CatalogActor } from '../services/catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow } from '../services/catalogContracts';
import { catalogStorageFromEnvironment } from '../services/catalogStorageRuntime';
import { CatalogStorageAdminService, type BeginLicensedUpload } from '../services/catalogStorageAdminService';
import { assertLicensedOffsetEvidence, type LicensedOffsetEvidence } from '../services/licensedAudioVerification';
import { parsedJson, redactCatalogEvidence } from '../services/adminCatalogUtilities';
import { readCatalogSettings } from '../services/recitationCatalogService';
import type { AudioObjectStorage } from '../services/catalogStorageContracts';
import type { CatalogAudioSource } from '../services/catalogAudioSource';
import { youtubeIframePreview } from '../services/catalogYoutubeMetadata';
import { CatalogLicensedSourceResolver } from '../services/licensedSourceResolver';
import { CatalogLicensedChapterReadiness } from '../services/catalogLicensedReadiness';
import { AdminReviewWorkspace } from './adminReviewWorkspace';

export const STORAGE_RENEWAL_STEPS = ['افتح Cloudflare ثم R2 ثم إدارة رموز واجهة التخزين.', 'أنشئ رمز قراءة وكتابة ورمز قراءة فقط لكل حاوية، مقيدين بالحاوية نفسها ولمدة 30 يومًا.', 'احفظ القيم مباشرة في متغيرات Railway السرية للخادم والعمّال؛ لا تُرسلها في الملاحظات أو الصور.', 'حدّث تاريخ انتهاء الرموز غير السري R2_TOKEN_EXPIRES_AT ثم أعد نشر الخدمات المتأثرة.', 'اضغط «اختبار الاتصال» وتحقق من نجاح القراءة والرفع الاختباري المصرح قبل إلغاء الرموز السابقة.'];
export class AdminMediaWorkspace {
  private cache?: { until: number; bytes: number; object_count: number; measured_at: string };
  constructor(private readonly db: CatalogDatabase, private readonly source: CatalogAudioSource, private readonly env: NodeJS.ProcessEnv = process.env) {}
  async withStorage<T>(access: 'read_only' | 'read_write', work: (storage: AudioObjectStorage) => Promise<T>): Promise<T> {
    const settings = await readCatalogSettings(this.db), storage = catalogStorageFromEnvironment(settings.storageAdapter ?? 'url_reference', access, [], this.env);
    try { return await work(storage); } finally { await storage.close?.(); }
  }
  private service(storage: AudioObjectStorage): CatalogStorageAdminService {
    return new CatalogStorageAdminService(this.db, storage, { async consume() { /* HTTP admission already enforces shared authenticated rate limits. */ } }, { verify: async input => {
      // Reuse only an independently verified proof bound to this exact blob/chapter.
      // No timing/source inference and no browser-supplied evidence can grant success.
      const rows = await this.db.read("SELECT verification_details FROM recitation_source_urls WHERE recitation_id=? AND surah=? AND sha256=? AND verification_status='verified' AND kind='licensed_file'", [input.recitationId, input.surah, input.sha256]);
      for (const row of rows) { const evidence = parsedJson<LicensedOffsetEvidence>(row.verification_details); assertLicensedOffsetEvidence(evidence, input.recitationId, input.sha256, input.surah); return evidence; }
      throw new CatalogError('LICENSED_OFFSET_REFERENCE_UNAVAILABLE', 409);
    } }, { enqueueVoiceReverification: async (tx, recitationId, storageObjectId) => {
      await tx.execute("UPDATE recitations SET voice_identity_status='unverified',voice_confirmed_by=NULL,voice_confirmed_at=NULL,is_public=0 WHERE id=?", [recitationId]);
      const id = randomUUID();
      await tx.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,target_subject_type,target_subject_id,evidence,priority,status) VALUES(?,'voice_confirmation','recitation',?,'recitation',?,?,80,'pending')", [id, recitationId + ':' + id, recitationId, JSON.stringify({ reason: 'LICENSED_SOURCE_CHANGED', storage_object_id: storageObjectId })]);
    } }, join(this.env.AYAHX_PRIVATE_SCRATCH_ROOT ?? tmpdir(), 'ayahx-licensed-verification'));
  }
  async summary(): Promise<StorageSummary> {
    const settings = await readCatalogSettings(this.db), adapter = settings.storageAdapter ?? 'url_reference';
    const configured = adapter === 'r2' && Boolean(this.env.R2_BUCKET && this.env.R2_ENDPOINT && this.env.R2_READ_ACCESS_KEY_ID && this.env.R2_READ_SECRET_ACCESS_KEY);
    const [dbUsage] = await this.db.read("SELECT COALESCE(SUM(size_bytes),0) bytes,COUNT(*) object_count FROM storage_objects WHERE upload_status IN ('uploaded','verified','soft_deleted')");
    const uploads = await this.db.read('SELECT id,recitation_id,surah,size_bytes,upload_status,verification_evidence,rejection_reason,created_at FROM storage_objects ORDER BY created_at DESC,id LIMIT 100');
    for (const row of uploads) row.verification_evidence = redactCatalogEvidence(parsedJson(row.verification_evidence));
    const expiration = this.env.R2_TOKEN_EXPIRES_AT && Number.isFinite(Date.parse(this.env.R2_TOKEN_EXPIRES_AT)) ? new Date(this.env.R2_TOKEN_EXPIRES_AT).toISOString() : null;
    const days = expiration ? Math.ceil((Date.parse(expiration) - Date.now()) / 86400000) : null;
    const measuredBucket=Boolean(this.cache&&this.cache.until>Date.now());
    const usage = measuredBucket?this.cache!:{ bytes: Number(dbUsage.bytes), object_count: Number(dbUsage.object_count), measured_at: new Date().toISOString() };
    return { adapter, configured, bucket: this.env.R2_BUCKET ?? null, usage: { bytes: usage.bytes, gb: usage.bytes / 1e9, object_count: usage.object_count, measured_at: usage.measured_at,source:measuredBucket?'r2_list':'database_manifest' }, token_expires_at: expiration, token_days_remaining: days, renewal_steps: STORAGE_RENEWAL_STEPS, uploads, alerts: [...(!configured ? [{ code: 'STORAGE_UNAVAILABLE', message: 'إعدادات الاتصال غير مكتملة.' }] : []), ...(!expiration ? [{ code: 'TOKEN_EXPIRY_UNAVAILABLE', message: 'تاريخ الانتهاء غير مسجل؛ جدّد الرموز قبل 9 نوفمبر وحدّث التاريخ في الخادم.' }] : days !== null && days <= 7 ? [{ code: 'TOKEN_EXPIRY_SOON', message: 'تحتاج رموز التخزين إلى التجديد قريبًا.' }] : []), ...(usage.bytes >= 7e9 ? [{ code: 'STORAGE_FREE_TIER_WARNING', message: 'الاستخدام تجاوز 70% من طبقة التخزين المجانية.' }] : [])] };
  }
  async test(actor: CatalogActor): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'storage.manage', true);
    const objects = await this.withStorage('read_only', storage => storage.listObjects());
    this.cache = { until: Date.now() + 300000, bytes: objects.reduce((sum, object) => sum + object.sizeBytes, 0), object_count: objects.length, measured_at: new Date().toISOString() };
    const result = { connected: true, object_count: this.cache.object_count, bytes: this.cache.bytes, measured_at: this.cache.measured_at };
    await this.db.transaction(tx => appendCatalogAudit(tx, actor, 'storage.connection_test', 'storage_adapter', 'r2', null, result));
    return result;
  }
  async list(): Promise<CatalogRow> {
    const items = await this.db.read("SELECT r.id,r.slug,r.display_label_ar,e.name_ar reciter_name_ar,(SELECT MAX(channel_title) FROM recitation_youtube_sources y WHERE y.recitation_id=r.id) channel_title,(SELECT MIN(rights_status) FROM recitation_youtube_sources y WHERE y.recitation_id=r.id) rights_status,(SELECT COUNT(*) FROM recitation_chapters c WHERE c.recitation_id=r.id) total_chapters,(SELECT COUNT(*) FROM storage_objects o WHERE o.recitation_id=r.id AND o.upload_status='verified') verified_chapters,(SELECT COUNT(*) FROM storage_objects o WHERE o.recitation_id=r.id AND o.upload_status='uploaded') uploaded_chapters,(SELECT COUNT(*) FROM storage_objects o WHERE o.recitation_id=r.id AND o.upload_status='pending') pending_chapters FROM recitations r JOIN reciters e ON e.id=r.reciter_id WHERE r.channel='youtube' OR EXISTS(SELECT 1 FROM storage_objects o WHERE o.recitation_id=r.id) ORDER BY e.name_ar,r.slug");
    for(const row of items){
      let ready=0;
      if(Number(row.verified_chapters)){
        const chapters=await this.db.read("SELECT DISTINCT surah FROM storage_objects WHERE recitation_id=? AND upload_status='verified'",[row.id]);
        for(const chapter of chapters)if(await this.isLicensedChapterReady(String(row.id),Number(chapter.surah)))ready++;
      }
      row.ready_chapters=ready;row.state=ready?'render_ready':Number(row.uploaded_chapters)||Number(row.pending_chapters)?'verifying':'needs_files';
    }
    return {items};
  }
  async isLicensedChapterReady(id:string,surah:number,completeOnly=true):Promise<boolean>{
    return this.withStorage('read_only',storage=>new CatalogLicensedChapterReadiness(this.db,new CatalogLicensedSourceResolver(this.db,storage.adapter==='r2'?storage:null,this.source)).isChapterReady(id,surah,completeOnly));
  }
  async detail(id: string): Promise<CatalogRow> {
    const [recitation] = await this.db.read('SELECT r.id,r.slug,r.display_label_ar,r.channel,e.name_ar reciter_name_ar FROM recitations r JOIN reciters e ON e.id=r.reciter_id WHERE r.id=?', [id]);
    if (!recitation) throw new CatalogError('RECITATION_NOT_FOUND', 404);
    const youtube = await this.db.read('SELECT id,surah,video_id,playlist_id,channel_title,oembed_status,rights_status,rights_evidence_url,rights_evidence_note FROM recitation_youtube_sources WHERE recitation_id=? ORDER BY surah,video_id', [id]);
    for (const row of youtube) row.iframe_url = row.video_id ? youtubeIframePreview('https://www.youtube.com/watch?v=' + row.video_id, 0, null).iframe_url : null;
    const uploads = await this.db.read('SELECT id,surah,size_bytes,sha256,upload_status,rejection_reason,verification_evidence,created_at FROM storage_objects WHERE recitation_id=? ORDER BY surah,created_at', [id]);
    for (const row of uploads) row.verification_evidence = redactCatalogEvidence(parsedJson(row.verification_evidence));
    const [rights] = await this.db.read("SELECT h.id,h.status FROM human_review_items h WHERE h.type IN ('youtube_rights','storage_rights') AND COALESCE(h.target_subject_id,h.subject_id)=? AND NOT EXISTS(SELECT 1 FROM human_review_items newer WHERE newer.supersedes_id=h.id) ORDER BY h.status='approved' DESC,h.created_at DESC LIMIT 1", [id]);
    const chapters = await this.db.read('SELECT c.surah,s.name_ar,c.availability_state,c.audio_status FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id=? ORDER BY c.surah', [id]);
    return { recitation, youtube, uploads, rights_review_id: rights?.id ?? null, rights_approved: rights?.status === 'approved', chapters };
  }
  async rights(actor: CatalogActor, id: string, input: { status: 'approved' | 'rejected' | 'deferred'; rights_status: string; rights_evidence_ref: string; notes: string }): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'recitations.sources.manage', true);
    const detail = await this.detail(id);
    if (!detail.rights_review_id) throw new CatalogError('RIGHTS_REVIEW_NOT_FOUND', 404);
    return new AdminReviewWorkspace(this.db).decide(actor, String(detail.rights_review_id), { status: input.status, notes: input.notes, decision: { rights_status: input.rights_status, rights_evidence_ref: input.rights_evidence_ref } });
  }
  async begin(actor: CatalogActor, input: BeginLicensedUpload) { return this.withStorage('read_write', storage => this.service(storage).beginUpload(actor, input)); }
  async resume(actor: CatalogActor, id: string) { const result=await this.withStorage('read_write', storage => this.service(storage).resumeUpload(actor, id)); await this.db.transaction(tx=>appendCatalogAudit(tx,actor,'storage.upload_resume','storage_object',id,null,{completed_object:result.completedObject,part_count:result.parts.length})); return result; }
  async part(actor: CatalogActor, id: string, part: number) { const result=await this.withStorage('read_write', storage => this.service(storage).partCapability(actor, id, part)); await this.db.transaction(tx=>appendCatalogAudit(tx,actor,'storage.multipart_capability','storage_object',id,null,{part_number:part})); return result; }
  async finish(actor: CatalogActor, id: string) { return this.withStorage('read_write', storage => this.service(storage).finishUpload(actor, id)); }
  async abort(actor: CatalogActor, id: string) { return this.withStorage('read_write', storage => this.service(storage).abortUpload(actor, id)); }
  async verify(actor: CatalogActor, id: string) { return this.withStorage('read_write', storage => this.service(storage).verifyUploaded(actor, id)); }
  async candidate(actor: CatalogActor, recitationId: string, surah: number, url: string): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'recitations.sources.manage', true);
    const [row] = await this.db.read('SELECT c.audio_url,r.channel,p.host_allowlist FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id JOIN audio_providers p ON p.id=r.provider_id WHERE c.recitation_id=? AND c.surah=?', [recitationId, surah]);
    if (!row) throw new CatalogError('RECITATION_CHAPTER_NOT_FOUND', 404);
    const hosts = parsedJson<string[]>(row.host_allowlist);
    if (!Array.isArray(hosts)) throw new CatalogError('AUDIO_PROVIDER_INVALID', 503);
    let evidence;
    if(row.channel==='youtube'){
      const [reference]=await this.db.read("SELECT o.object_key,o.sha256,o.rights_ref,o.adapter,o.bucket,s.verification_details FROM storage_objects o JOIN recitation_source_urls s ON s.storage_object_id=o.id AND s.recitation_id=o.recitation_id AND s.surah=o.surah AND s.sha256=o.sha256 WHERE o.recitation_id=? AND o.surah=? AND o.upload_status='verified' AND s.kind='licensed_file' AND s.verification_status='verified' AND s.is_active=1 ORDER BY o.verified_at DESC LIMIT 1",[recitationId,surah]);
      if(!reference)throw new CatalogError('CANDIDATE_REFERENCE_FINGERPRINT_UNAVAILABLE',409);
      assertLicensedOffsetEvidence(parsedJson<LicensedOffsetEvidence>(reference.verification_details),recitationId,String(reference.sha256),surah);
      const [rights]=await this.db.read("SELECT h.id FROM human_review_items h WHERE h.id=? AND h.type IN ('storage_rights','youtube_rights') AND h.status='approved' AND h.decided_by IS NOT NULL AND COALESCE(h.target_subject_type,h.subject_type)='recitation' AND COALESCE(h.target_subject_id,h.subject_id)=? AND NOT EXISTS(SELECT 1 FROM human_review_items newer WHERE newer.supersedes_id=h.id)",[reference.rights_ref,recitationId]);
      if(!rights)throw new CatalogError('LICENSED_RIGHTS_NOT_APPROVED',409);
      evidence=await this.withStorage('read_only',async storage=>{
        if(storage.adapter!==reference.adapter||storage.bucket!==reference.bucket)throw new CatalogError('CANDIDATE_REFERENCE_FINGERPRINT_UNAVAILABLE',409);
        const {body}=await storage.read(String(reference.object_key));
        return this.source.verifySameRecordingStream(body,url,hosts);
      });
    }else evidence=await this.source.verifySameRecording(String(row.audio_url),url,hosts);
    const result = { matched: true, recitation_id: recitationId, surah, method: evidence.method, sha256: evidence.primarySha256, checked_at: evidence.verifiedAt };
    await this.db.transaction(tx => appendCatalogAudit(tx, actor, 'storage.candidate_fingerprint', 'recitation', recitationId, null, result));
    return result;
  }
}

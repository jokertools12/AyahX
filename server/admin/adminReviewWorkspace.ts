import { randomUUID } from 'node:crypto';
import type { ReviewCount, ReviewDecisionInput, ReviewItem } from '../../shared/admin/batch5';
import { reviewTypes } from '../db/migrations/005_addHumanReviewsAndLicensedSources';
import { appendCatalogAudit, requireCatalogPermission, type CatalogActor } from '../services/catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow } from '../services/catalogContracts';
import { literalLike, parsedJson, redactCatalogEvidence } from '../services/adminCatalogUtilities';
import { HumanReviewService, validateReviewEvidence } from '../services/humanReviewService';

const joins = `FROM human_review_items h LEFT JOIN recitations r ON COALESCE(h.target_subject_type,h.subject_type)='recitation' AND r.id=COALESCE(h.target_subject_id,h.subject_id) LEFT JOIN reciters e ON e.id=r.reciter_id LEFT JOIN audio_providers p ON p.id=CASE WHEN COALESCE(h.target_subject_type,h.subject_type)='audio_provider' THEN COALESCE(h.target_subject_id,h.subject_id) ELSE r.provider_id END`;
const eligible = "(r.status='published' AND r.offset_verified=1)";
const select = `SELECT h.*,r.id recitation_id,e.name_ar reciter_name_ar,r.display_label_ar,p.name provider_name,IFNULL(${eligible},0) eligible ${joins}`;
const normalize = (row: CatalogRow): ReviewItem => ({ ...row, eligible: Number(row.eligible) === 1, evidence: redactCatalogEvidence(parsedJson(row.evidence)), decision: redactCatalogEvidence(parsedJson(row.decision)) }) as unknown as ReviewItem;
/** Only informational reviews support bulk acknowledgement. No rights/voice/timing/basmala mutation. */
export const SAFE_BULK_REVIEW_TYPES = ['near_complete_chapters', 'data_conflict', 'youtube_audio_missing'] as const;
export function assertSafeBulkReviews(rows: readonly CatalogRow[], ids: readonly string[]): void {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || rows.length !== ids.length) throw new CatalogError('REVIEW_BULK_INVALID', 422);
  if (rows.some(row => !SAFE_BULK_REVIEW_TYPES.includes(row.type as typeof SAFE_BULK_REVIEW_TYPES[number]) || !['pending', 'deferred'].includes(String(row.status)))) throw new CatalogError('REVIEW_BULK_UNSAFE', 409);
}
export class AdminReviewWorkspace {
  private readonly decisions: HumanReviewService;
  constructor(private readonly db: CatalogDatabase) { this.decisions = new HumanReviewService(db); }
  async counts(): Promise<ReviewCount[]> {
    const rows = await this.db.read(`SELECT h.type,h.status,COUNT(*) count,SUM(IFNULL(${eligible},0)) eligible_count ${joins} GROUP BY h.type,h.status ORDER BY h.type,h.status`);
    return rows.map(row => ({ ...row, count: Number(row.count), eligible_count: Number(row.eligible_count) })) as unknown as ReviewCount[];
  }
  async list(input: { page: number; limit: number; status?: string; type?: string; q?: string; eligible?: string }): Promise<{ data: ReviewItem[]; meta: CatalogRow }> {
    const where: string[] = [], params: unknown[] = [];
    if (input.status) { where.push('h.status=?'); params.push(input.status); }
    if (input.type) { where.push('h.type=?'); params.push(input.type); }
    if (input.eligible === 'true') where.push(eligible);
    if (input.q) { where.push("(e.name_ar LIKE ? ESCAPE '!' OR r.display_label_ar LIKE ? ESCAPE '!' OR h.subject_id LIKE ? ESCAPE '!' OR p.name LIKE ? ESCAPE '!')"); params.push(...Array(4).fill(literalLike(input.q))); }
    const predicate = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const [count] = await this.db.read(`SELECT COUNT(*) total ${joins}${predicate}`, params);
    const rows = await this.db.read(`${select}${predicate} ORDER BY IFNULL(${eligible},0) DESC,h.priority DESC,h.created_at,h.id LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`, params);
    return { data: rows.map(normalize), meta: { page: input.page, limit: input.limit, total: Number(count.total), counts: await this.counts() } };
  }
  async detail(id: string): Promise<CatalogRow> {
    const [row] = await this.db.read(select + ' WHERE h.id=?', [id]);
    if (!row) throw new CatalogError('REVIEW_NOT_FOUND', 404);
    const subjectId = row.target_subject_id ?? row.subject_id, subjectType = row.target_subject_type ?? row.subject_type;
    let subject: CatalogRow | null = null;
    if (subjectType === 'recitation') [subject] = await this.db.read('SELECT id,slug,reciter_id,display_label_ar,display_label_en,voice_identity_status,needs_label_review,verification_status,offset_verified FROM recitations WHERE id=?', [subjectId]);
    if (subjectType === 'audio_provider') [subject] = await this.db.read('SELECT id,code,name,terms_url,license_status FROM audio_providers WHERE id=?', [subjectId]);
    const history = await this.db.read("SELECT id,action,old_values,new_values,created_at FROM audit_logs WHERE entity_type='human_review_item' AND (entity_id=? OR entity_id IN (SELECT id FROM human_review_items WHERE COALESCE(target_subject_id,subject_id)=? AND type=?)) ORDER BY created_at,id", [id, subjectId, row.type]);
    for (const event of history) for (const key of ['old_values', 'new_values']) event[key] = redactCatalogEvidence(parsedJson(event[key]));
    return { item: normalize(row), evidence: redactCatalogEvidence(parsedJson(row.evidence)), subject: subject ?? null, listening_path: subjectType === 'recitation' ? `/admin/listening/${subjectId}` : null, history, remaining: await this.remaining() };
  }
  private async remaining(): Promise<number> { const [row] = await this.db.read("SELECT COUNT(*) count FROM human_review_items WHERE status IN ('pending','deferred')"); return Number(row.count); }
  async next(except?: string): Promise<string | null> {
    const [row] = await this.db.read(`${select} WHERE h.status='pending' AND h.id<>? ORDER BY IFNULL(${eligible},0) DESC,h.priority DESC,h.created_at,h.id LIMIT 1`, [except ?? '']);
    return row ? String(row.id) : null;
  }
  async decide(actor: CatalogActor, id: string, input: ReviewDecisionInput): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'reviews.decide', true);
    const [row] = await this.db.read('SELECT type,COALESCE(target_subject_id,subject_id) subject_id FROM human_review_items WHERE id=?', [id]);
    if (!row) throw new CatalogError('REVIEW_NOT_FOUND', 404);
    if (row.type === 'provider_license' && input.status !== 'deferred') {
      requireCatalogPermission(actor, 'providers.license.review', true);
      if (actor.roleSlug !== 'super_admin') throw new CatalogError('CATALOG_PERMISSION_DENIED', 403);
      const [provider] = await this.db.read('SELECT code FROM audio_providers WHERE id=?', [row.subject_id]);
      if (!provider || input.confirmation !== provider.code) throw new CatalogError('CONFIRMATION_MISMATCH', 422);
    }
    const result = await this.decisions.decide(actor, id, input);
    return { ...result, next_id: await this.next(id), remaining: await this.remaining() };
  }
  async undo(actor: CatalogActor, id: string, notes: string): Promise<{ id: string }> {
    requireCatalogPermission(actor, 'reviews.decide', true);
    return this.db.transaction(async tx => {
      const [row] = await tx.read('SELECT * FROM human_review_items WHERE id=? FOR UPDATE', [id]);
      if (!row) throw new CatalogError('REVIEW_NOT_FOUND', 404);
      if (!['approved', 'rejected'].includes(String(row.status))) throw new CatalogError('REVIEW_UNDO_NOT_DECIDED', 409);
      if (row.type === 'provider_license') { requireCatalogPermission(actor, 'providers.license.review', true); if (actor.roleSlug !== 'super_admin') throw new CatalogError('CATALOG_PERMISSION_DENIED', 403); }
      if (row.type === 'voice_confirmation') requireCatalogPermission(actor, 'recitations.voice.review', true);
      if (row.type === 'label_review') requireCatalogPermission(actor, 'recitations.manage', true);
      const [existing] = await tx.read("SELECT id FROM human_review_items WHERE supersedes_id=? AND status IN ('pending','deferred') FOR UPDATE", [id]);
      if (existing) return { id: String(existing.id) };
      const newId = randomUUID(), targetType = row.target_subject_type ?? row.subject_type, targetId = row.target_subject_id ?? row.subject_id;
      const evidence = { previous_review_id: id, previous_decision: parsedJson(row.decision) ?? null, previous_status: row.status, reason: notes, original_evidence: parsedJson(row.evidence) ?? null };
      validateReviewEvidence(evidence);
      await tx.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status,supersedes_id,target_subject_type,target_subject_id) VALUES(?,?,?,?,?,?,'pending',?,?,?)", [newId, row.type, row.subject_type, id + ':' + newId, JSON.stringify(evidence), row.priority, id, targetType, targetId]);
      // Undo is conservative: prior decisions remain in history while the live gate is revoked.
      if (row.type === 'voice_confirmation') {
        await tx.execute("UPDATE recitations SET voice_identity_status='unverified',voice_confirmed_by=NULL,voice_confirmed_at=NULL,is_public=0 WHERE id=?", [targetId]);
      } else if (row.type === 'provider_license') await tx.execute("UPDATE audio_providers SET license_status='unreviewed' WHERE id=?", [targetId]);
      else if (row.type === 'label_review') await tx.execute('UPDATE recitations SET needs_label_review=1 WHERE id=?', [targetId]);
      await appendCatalogAudit(tx, actor, 'review.reopened', 'human_review_item', newId, null, { supersedes_id: id, type: row.type, subject_type: targetType, subject_id: targetId, notes, status: 'pending' });
      return { id: newId };
    });
  }
  async bulkPreview(ids: string[], actor?: CatalogActor): Promise<CatalogRow> {
    const rows = await this.db.read(`SELECT id,type,status FROM human_review_items WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    assertSafeBulkReviews(rows, ids); const result = { count: rows.length, types: [...new Set(rows.map(row => row.type))], ids };
    if (actor) await this.db.transaction(tx => appendCatalogAudit(tx, actor, 'review.bulk_preview', 'human_review_selection', actor.requestId ?? actor.id, null, result));
    return result;
  }
  async bulk(actor: CatalogActor, ids: string[], status: ReviewDecisionInput['status'], notes: string, confirmation: string): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'reviews.decide', true);
    if (confirmation !== String(ids.length)) throw new CatalogError('CONFIRMATION_MISMATCH', 422);
    // Validate the whole selection before writing. Each decision is separately audited;
    // a concurrent human decision produces 409 and never gets silently overwritten.
    await this.bulkPreview(ids); let changed = 0;
    for (const id of ids) if ((await this.decide(actor, id, { status, notes })).changed) changed++;
    return { changed, remaining: await this.remaining() };
  }
  async labels(): Promise<CatalogRow[]> {
    return this.db.read("SELECT r.id,r.slug,r.display_label_ar,r.display_label_en,e.name_ar reciter_name_ar,(SELECT h.id FROM human_review_items h WHERE h.type='label_review' AND COALESCE(h.target_subject_id,h.subject_id)=r.id AND h.status IN ('pending','deferred') ORDER BY h.created_at DESC LIMIT 1) review_id FROM recitations r JOIN reciters e ON e.id=r.reciter_id WHERE r.needs_label_review=1 ORDER BY e.name_ar,r.slug");
  }
  async approveLabel(actor: CatalogActor, id: string, ar: string, en?: string, notes?: string): Promise<CatalogRow> {
    const rows = await this.labels(), row = rows.find(item => item.id === id);
    if (!row?.review_id) throw new CatalogError('LABEL_REVIEW_NOT_FOUND', 404);
    return this.decide(actor, String(row.review_id), { status: 'approved', notes: notes?.trim() || 'اعتمد المراجع الاسم الوصفي: ' + ar, decision: { display_label_ar: ar, ...(en === undefined ? {} : { display_label_en: en }) } });
  }
}
export { reviewTypes };

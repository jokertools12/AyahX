import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appendCatalogAudit, canonicalAuditJson, requireCatalogPermission, type CatalogActor } from '../services/catalogAudit';
import { CatalogError, type CatalogDatabase, type CatalogRow } from '../services/catalogContracts';
import { assertCatalogAudioUrl, type CatalogAudioSource } from '../services/catalogAudioSource';
import { humanReviewId } from '../services/humanReviewService';
import { parsedJson } from '../services/adminCatalogUtilities';
import { checkYoutubeOembed, youtubeReference } from '../services/catalogYoutubeMetadata';
import { AdminCatalogImageValidator } from '../services/adminCatalogImageValidator';

const name = z.string().trim().min(1).max(255);
export const ReciterWizardSchema = z.object({
  intent_id: z.string().uuid(),
  reciter: z.object({ id: z.string().uuid().optional(), name_ar: name, name_en: name, country: z.string().max(255).nullable().optional(), photo_url: z.string().url().max(2000).nullable().optional() }).strict(),
  recitation: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,190}$/u), riwayah_code: z.string().max(64), style: z.string().trim().min(1).max(64), recording_year: z.number().int().min(1800).max(2200).nullable().optional(), display_label_ar: name, display_label_en: z.string().max(255).nullable().optional() }).strict(),
  source: z.object({ kind: z.enum(['url_pattern', 'licensed_file', 'youtube', 'qud']), provider_id: z.string().uuid(), url_pattern: z.string().max(2000).optional(), youtube_url: z.string().url().max(2000).optional(), qud_slug: z.string().max(191).optional() }).strict(),
}).strict();
export type ReciterWizardInput = z.infer<typeof ReciterWizardSchema>;
export function expandChapterPattern(pattern: string, surah: number): string {
  const matches = pattern.match(/\{surah(?::03d)?\}/gu);
  if (!matches || matches.length !== 1 || /\{[^}]*\}/gu.test(pattern.replace(matches[0], ''))) throw new CatalogError('WIZARD_URL_PATTERN_INVALID', 422);
  return pattern.replace(matches[0], matches[0] === '{surah:03d}' ? String(surah).padStart(3, '0') : String(surah));
}
export class AdminReciterWizard {
  constructor(private readonly db: CatalogDatabase, private readonly source: CatalogAudioSource, private readonly images = new AdminCatalogImageValidator()) {}
  async options(): Promise<CatalogRow> {
    return { providers: await this.db.read('SELECT id,code,name,is_active,host_allowlist FROM audio_providers ORDER BY name'), riwayat: await this.db.read('SELECT code,name_ar,name_en FROM riwayat ORDER BY code'), imported_qud: await this.db.read("SELECT id,slug,reciter_id,display_label_ar,qud_version FROM recitations WHERE qud_version IS NOT NULL AND status<>'draft' ORDER BY slug") };
  }
  async validate(input: ReciterWizardInput): Promise<CatalogRow> {
    const [provider] = await this.db.read('SELECT id,code,host_allowlist FROM audio_providers WHERE id=?', [input.source.provider_id]);
    if (!provider) throw new CatalogError('PROVIDER_NOT_FOUND', 404);
    const hosts = parsedJson<string[]>(provider.host_allowlist);
    if (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')) throw new CatalogError('AUDIO_PROVIDER_INVALID', 503);
    const [riwayah] = await this.db.read('SELECT id,code FROM riwayat WHERE code=?', [input.recitation.riwayah_code]);
    if (!riwayah) throw new CatalogError('RIWAYAH_NOT_FOUND', 404);
    if (input.reciter.photo_url) await this.images.validate(input.reciter.photo_url);
    if (input.source.kind === 'qud') {
      const [reference] = await this.db.read('SELECT id,slug,riwayah_code,qud_version,provider_id FROM recitations WHERE slug=? AND qud_version IS NOT NULL', [input.source.qud_slug ?? '']);
      if (!reference || reference.riwayah_code !== input.recitation.riwayah_code || reference.provider_id !== provider.id) throw new CatalogError('WIZARD_QUD_REFERENCE_INVALID', 422);
      return { valid: true, checks: [], timing: 'linked_imported_qud', timing_reference: reference.id, reference_slug: reference.slug };
    }
    if (input.source.kind === 'youtube') {
      if (provider.code !== 'youtube' || !youtubeReference(input.source.youtube_url ?? '')) throw new CatalogError('YOUTUBE_REFERENCE_INVALID', 422);
      const metadata=await checkYoutubeOembed(youtubeReference(input.source.youtube_url!)!);
      return { valid: metadata.status==='available', checks: [], youtube_metadata:metadata, timing: 'pending', reason: 'ملف YouTube لا يُستخدم للريندر؛ يحتاج صوتًا مرخّصًا وتوقيتًا موثقًا.' };
    }
    if (input.source.kind === 'licensed_file') return { valid: true, checks: [], timing: 'pending', reason: 'ستُرفع الملفات من صفحة التلاوة بعد اعتماد حقوقها.' };
    const chapters = await this.db.read('SELECT number FROM quran_surahs ORDER BY number');
    if (!chapters.length) throw new CatalogError('CANONICAL_TEXT_UNAVAILABLE', 409);
    const sample = [...new Set([Number(chapters[0].number), Number(chapters[Math.floor(chapters.length / 2)].number), Number(chapters[chapters.length - 1].number)])];
    const checks: CatalogRow[] = [];
    for (const surah of sample) {
      const url = expandChapterPattern(input.source.url_pattern ?? '', surah);
      assertCatalogAudioUrl(url, hosts);
      const check = await this.source.checkLink(url, hosts);
      checks.push({ surah, url, status: check.status, http_status: check.httpStatus, checked_at: check.checkedAt });
    }
    return { valid: checks.every(check => check.status === 'available'), checks, timing: 'pending', reason: 'لا توجد توقيتات مستوردة لهذا المصدر؛ تبقى المسودة غير ظاهرة.' };
  }
  async validateForActor(actor:CatalogActor,input:ReciterWizardInput):Promise<CatalogRow>{
    requireCatalogPermission(actor,'recitations.manage',true);
    const result=await this.validate(input);
    await this.db.transaction(tx=>appendCatalogAudit(tx,actor,'catalog.wizard.source_validated','wizard_intent',input.intent_id,null,{valid:result.valid,source_kind:input.source.kind,checks:result.checks,timing:result.timing}));
    return result;
  }
  async create(actor: CatalogActor, input: ReciterWizardInput): Promise<CatalogRow> {
    requireCatalogPermission(actor, 'recitations.manage', true);
    requireCatalogPermission(actor, 'reciters.write', true);
    const intentHash = createHash('sha256').update(canonicalAuditJson(input)).digest('hex');
    const [existing] = await this.db.read('SELECT id,reciter_id,audit_json FROM recitations WHERE id=?', [input.intent_id]);
    if (existing) { if (parsedJson<CatalogRow>(existing.audit_json)?.wizard_intent_sha256 !== intentHash) throw new CatalogError('WIZARD_INTENT_CONFLICT', 409); return { id: existing.id, reciter_id: existing.reciter_id, status: 'draft', replay: true }; }
    const checked = await this.validate(input);
    if (!checked.valid) throw new CatalogError('WIZARD_SOURCE_CHECK_FAILED', 422, { checks: checked.checks });
    const reciterId = input.reciter.id ?? randomUUID();
    return this.db.transaction(async tx => {
      const [replayed] = await tx.read('SELECT id,reciter_id,audit_json FROM recitations WHERE id=? FOR UPDATE', [input.intent_id]);
      if (replayed) { if (parsedJson<CatalogRow>(replayed.audit_json)?.wizard_intent_sha256 !== intentHash) throw new CatalogError('WIZARD_INTENT_CONFLICT', 409); return { id: replayed.id, reciter_id: replayed.reciter_id, status: 'draft', replay: true }; }
      const [riwayah] = await tx.read('SELECT id FROM riwayat WHERE code=?', [input.recitation.riwayah_code]);
      if (!riwayah) throw new CatalogError('RIWAYAH_NOT_FOUND', 404);
      if (input.reciter.id) { const [reader] = await tx.read('SELECT id FROM reciters WHERE id=? FOR UPDATE', [reciterId]); if (!reader) throw new CatalogError('RECITER_NOT_FOUND', 404); }
      else await tx.execute("INSERT INTO reciters(id,slug,name_ar,name_en,country,photo_url,status,is_visible) VALUES(?,?,?,?,?,?,'needs_review',0)", [reciterId, input.recitation.slug + '-reader', input.reciter.name_ar, input.reciter.name_en, input.reciter.country ?? null, input.reciter.photo_url ?? null]);
      const youtube=input.source.kind==='youtube'?youtubeReference(input.source.youtube_url!)!:null;
      const youtubeUrl=youtube?'https://www.youtube.com/watch?v='+youtube.videoId+(youtube.playlistId?'&list='+youtube.playlistId:''):null;
      const safeSource={...input.source,...(youtubeUrl?{youtube_url:youtubeUrl}:{})};
      const src = input.source.kind === 'url_pattern' ? input.source.url_pattern! : youtubeUrl;
      await tx.execute("INSERT INTO recitations(id,slug,reciter_id,provider_id,riwayah_id,riwayah_code,canonical_text_available,style,channel,audio_category,audio_mode,recording_year,display_label_ar,display_label_en,timing_level,timing_quality,coverage_ayahs,ayahs_complete,basmala_mode,basmala_reason,surah_start_basmala_text_status,source_url,qud_version,catalog_sha256,catalog_raw,audit_json,verification_details,status,is_public,needs_label_review,timing_reference_recitation_id) VALUES(?,?,?,?,?,?,0,?,?,?,'unverified_source',?,?,?,'none','unimported',0,0,NULL,NULL,'unverified',?,NULL,NULL,?,?,?,'draft',0,1,?)", [input.intent_id, input.recitation.slug, reciterId, input.source.provider_id, riwayah.id, input.recitation.riwayah_code, input.recitation.style, input.source.kind === 'youtube' ? 'youtube' : 'admin_draft', input.source.kind, input.recitation.recording_year ?? null, input.recitation.display_label_ar, input.recitation.display_label_en ?? null, src, JSON.stringify({ wizard: true, source: safeSource }), JSON.stringify({ wizard_intent_sha256: intentHash, created_by: actor.id }), JSON.stringify({ status: 'unverified', timing: checked.timing }), checked.timing_reference ?? null]);
      if (input.source.kind === 'url_pattern') {
        const chapters = await tx.read('SELECT number,ayah_count FROM quran_surahs ORDER BY number');
        for (const chapter of chapters) await tx.execute("INSERT INTO recitation_chapters(id,recitation_id,surah,audio_url,chapter_offset_ms,audio_status,expected_ayahs,available_ayahs,missing_verses,ayahs_complete,timing_complete,availability_state,available_runs,run_count,ready_ayahs) VALUES(?,?,?,?,NULL,'unverified',?,0,?,0,0,'unavailable',JSON_ARRAY(),0,0)", [randomUUID(), input.intent_id, chapter.number, expandChapterPattern(input.source.url_pattern!, Number(chapter.number)), chapter.ayah_count, JSON.stringify(Array.from({ length: Number(chapter.ayah_count) }, (_, index) => index + 1))]);
      }
      if(input.source.kind==='youtube'){
        const ref=youtubeReference(input.source.youtube_url!)!,metadata=checked.youtube_metadata as CatalogRow;
        await tx.execute("INSERT INTO recitation_youtube_sources(id,recitation_id,surah,video_id,playlist_id,channel_title,oembed_status,rights_status,rights_evidence_note) VALUES(?,?,NULL,?,?,?,?,'unknown','')",[randomUUID(),input.intent_id,ref.videoId,ref.playlistId,metadata.channel_title??'',metadata.status]);
      }
      const types = ['voice_confirmation', 'label_review', ...(checked.timing === 'pending' ? ['offset_exception'] : []), ...(input.source.kind === 'licensed_file' ? ['storage_rights'] : []), ...(input.source.kind === 'youtube' ? ['youtube_rights', 'youtube_audio_missing', 'storage_rights'] : [])] as const;
      const reviewIds: string[] = [];
      for (const type of types) {
        const review = { type: type as 'voice_confirmation', subject_type: 'recitation', subject_id: input.intent_id }, id = humanReviewId(review);
        await tx.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,?,?,?,?,50,'pending')", [id, type, 'recitation', input.intent_id, JSON.stringify({ source: 'owner_wizard', source_kind: input.source.kind, timing_status: checked.timing, reason: checked.timing === 'pending' ? 'TIMINGS_REQUIRED' : 'IMPORTED_REFERENCE_REQUIRES_RECORDING_REVIEW' })]);
        reviewIds.push(id);
      }
      await appendCatalogAudit(tx, actor, 'catalog.wizard.draft_created', 'recitation', input.intent_id, null, { reciter_id: reciterId, source_kind: input.source.kind, status: 'draft', is_public: false, timing_reference_recitation_id: checked.timing_reference ?? null, review_ids: reviewIds });
      return { id: input.intent_id, reciter_id: reciterId, status: 'draft', is_public: false, timing: checked.timing, review_ids: reviewIds, replay: false };
    });
  }
}

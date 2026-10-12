import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AdminPreferences, LaunchPreview,LaunchReadiness, ListeningRoom, ProviderDigest, WorkspaceSummary } from '../../shared/admin/batch5';
import { appendCatalogAudit, type CatalogActor } from '../services/catalogAudit';
import { CatalogError, isPubliclyVisible, publicVisibilityCodes, type CatalogDatabase, type CatalogRow, type PublicRecitation } from '../services/catalogContracts';
import { readCatalogSettings } from '../services/recitationCatalogService';
import { auditionPreview } from '../services/catalogAuditionSamples';
import { parsedJson, redactCatalogEvidence, safeCatalogUrl } from '../services/adminCatalogUtilities';
import { AdminReviewWorkspace } from './adminReviewWorkspace';
import type { LicensedChapterGate } from '../services/catalogLicensedReadiness';

export const PUBLIC_FLOW_V2_READY = false;
export const PUBLIC_FLOW_BLOCKED_REASON = 'الواجهة الجديدة (D8) لم تُبنَ بعد؛ يبقى الكتالوج مغلقًا.';
export const ProjectRoadmapSchema=z.object({stages:z.array(z.object({id:z.string().min(1),title_ar:z.string().min(1),title_en:z.string().optional(),status:z.enum(['done','in_progress','next','blocked']),summary_ar:z.string(),blockers_ar:z.array(z.string()),evidence:z.array(z.string()).optional()}).passthrough()).min(1),visitor_state:z.unknown(),owner_actions:z.unknown(),public_flow_v2_ready:z.literal(false)}).passthrough();
export function digestProvider(markdown: string, code: string): ProviderDigest {
  const aliases: Record<string, string> = { mp3quran: 'MP3Quran', quranicaudio: 'QuranicAudio', tarteel: 'Tarteel/QUL', way2quran: 'Way2Quran', tvquran: 'TVQuran', archive: 'Internet Archive', google_drive: 'Google Drive', youtube: 'YouTube' };
  const name = aliases[code] ?? code;
  const line = markdown.split(/\r?\n/u).find(row => row.startsWith('| ' + name + ' |'));
  if (!line) return { programmatic: 'لا يوجد ملخص موثق لهذا المزوّد بعد؛ راجع الشروط الأصلية.', commercial: 'لم يُتحقق من السماح التجاري.', attribution: 'يحتاج تحديدًا بشريًا.', terms_url: null };
  const cells = line.split('|').slice(1, -1).map(value => value.trim());
  const text = (value: string) => value.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1');
  const match = /\]\((https:\/\/[^)]+)\)/u.exec(cells[1]);
  return { programmatic: text(cells[1]), commercial: text(cells[2]), attribution: text(cells[3]), terms_url: match ? safeCatalogUrl(match[1]) : null };
}
export class AdminOwnerWorkspace {
  readonly reviews: AdminReviewWorkspace;
  constructor(private readonly db: CatalogDatabase, private readonly root = process.cwd(),private readonly licensed?:LicensedChapterGate) { this.reviews = new AdminReviewWorkspace(db); }
  async preferences(userId: string): Promise<AdminPreferences> {
    const [row] = await this.db.read('SELECT density,font_scale FROM admin_preferences WHERE user_id=?', [userId]);
    return { density: row?.density === 'compact' ? 'compact' : 'comfortable', font_scale: [1, 1.1, 1.2].includes(Number(row?.font_scale)) ? Number(row.font_scale) as AdminPreferences['font_scale'] : 1 };
  }
  async updatePreferences(actor: CatalogActor, input: AdminPreferences): Promise<AdminPreferences> {
    await this.db.transaction(async tx => {
      const [old] = await tx.read('SELECT density,font_scale FROM admin_preferences WHERE user_id=? FOR UPDATE', [actor.id]);
      await tx.execute('INSERT INTO admin_preferences(user_id,density,font_scale) VALUES(?,?,?) ON DUPLICATE KEY UPDATE density=VALUES(density),font_scale=VALUES(font_scale)', [actor.id, input.density, input.font_scale]);
      await appendCatalogAudit(tx, actor, 'admin.preferences.update', 'admin_preferences', actor.id, old ?? null, { ...input });
    });
    return input;
  }
  async launch(): Promise<LaunchReadiness> {
    const settings = await readCatalogSettings(this.db);
    const rows = await this.db.read("SELECT r.id,r.slug,r.status,r.is_public,r.voice_identity_status,r.display_label_ar,r.needs_label_review,r.surah_start_basmala_audio_status,r.channel,r.licensed_publication_details,r.offset_verified,p.license_status,p.code provider,e.name_ar reciter_name_ar,e.is_visible reciter_is_visible,v.is_active riwayah_is_active,(SELECT COUNT(*) FROM recitation_chapters c WHERE c.recitation_id=r.id AND COALESCE(c.is_enabled,1)=1 AND c.availability_state='complete') complete_chapters,(SELECT COUNT(*) FROM recitation_source_urls s WHERE s.recitation_id=r.id AND s.kind='licensed_file' AND s.is_active=1 AND s.verification_status='verified') licensed_chapters FROM recitations r JOIN audio_providers p ON p.id=r.provider_id JOIN reciters e ON e.id=r.reciter_id JOIN riwayat v ON v.id=r.riwayah_id ORDER BY e.name_ar,r.slug");
    const counts = await this.reviews.counts(), pending = counts.filter(row => ['pending', 'deferred'].includes(row.status));
    const count = (type: string) => pending.filter(row => row.type === type).reduce((sum, row) => sum + row.count, 0);
    const checks = [
      { code: 'voice', title: 'تأكيد أصوات القراء', count: count('voice_confirmation'), owner: 'أنت' },
      { code: 'license', title: 'مراجعة حقوق المزوّدين', count: count('provider_license'), owner: 'المدير الأعلى' },
      { code: 'basmala', title: 'مراجعة البسملة المسموعة', count: count('basmala_audio'), owner: 'أنت' },
      { code: 'labels', title: 'مراجعة أسماء التلاوات', count: count('label_review'), owner: 'أنت' },
      { code: 'licensed_files', title: 'توفير ملفات مرخّصة لتلاوات YouTube', count: rows.filter(row => row.channel === 'youtube' && Number(row.licensed_chapters) === 0).length, owner: 'أنت' },
      { code: 'public_flow', title: 'بناء واجهة الاختيار الجديدة (D8)', count: 1, owner: 'فريق التطوير' },
    ].map(check => ({ ...check, complete: check.count === 0 }));
    const preview:LaunchPreview[]=[];
    for(const row of rows){
      const reasons = publicVisibilityCodes(row as unknown as PublicRecitation, true, settings.voiceGatePolicy);
      const chapterPredicate=settings.availabilityMode==='complete_only'?"c.availability_state='complete'":"c.run_count>0 AND c.availability_state IN ('complete','near_complete','partial')";
      const chapters=await this.db.read(`SELECT c.surah FROM recitation_chapters c WHERE c.recitation_id=? AND COALESCE(c.is_enabled,1)=1 AND ${chapterPredicate}`,[row.id]);
      if(!chapters.length)reasons.push('NO_AVAILABLE_CHAPTERS');
      if(row.channel==='youtube'||row.licensed_publication_details&&!Number(row.offset_verified)){
        let licensedReady=false;
        if(this.licensed&&Number(row.licensed_chapters))for(const chapter of chapters)if(await this.licensed.isChapterReady(String(row.id),Number(chapter.surah),settings.availabilityMode==='complete_only')){licensedReady=true;break;}
        if(!licensedReady)reasons.push('LICENSED_SOURCE_NOT_READY');
      }
      const visible = isPubliclyVisible(row as unknown as PublicRecitation, true, settings.voiceGatePolicy) && reasons.length === 0;
      preview.push({ id: String(row.id), slug: String(row.slug), reciter_name_ar: String(row.reciter_name_ar), display_label_ar: row.display_label_ar === null ? null : String(row.display_label_ar), is_visible: visible, reasons });
    }
    const completed = checks.filter(check => check.complete).length;
    return { completed, total: checks.length, percent: Math.round(completed / checks.length * 100), checks, catalog_enabled: settings.enabled, public_flow_v2_ready: false, can_open: false, blocked_reason: PUBLIC_FLOW_BLOCKED_REASON, preview };
  }
  async summary(): Promise<WorkspaceSummary> {
    const review_counts = await this.reviews.counts(), launch = await this.launch();
    const youtube = launch.checks.find(row => row.code === 'licensed_files')!.count;
    return { review_counts, launch, alerts: [{ code: 'R2_TOKEN_RENEWAL', message: 'جدّد رموز التخزين قبل 9 نوفمبر؛ خطوات التجديد في مركز التخزين.', expires_at: '2026-11-09T00:00:00.000Z' }, ...(youtube ? [{ code: 'YOUTUBE_FILES_MISSING', message: 'تلاوات YouTube تحتاج ملفات صوت مرخّصة قبل استخدامها في الفيديو.', count: youtube }] : [])], public_state: { catalog_enabled: launch.catalog_enabled, public_flow_v2_ready: false, message: 'الزوار يرون الموقع الحالي؛ الكتالوج الجديد مغلق ولم يُربط بواجهة الاختيار بعد.' } };
  }
  async project(): Promise<CatalogRow> {
    const [roadmap, guide_markdown] = await Promise.all([readFile(resolve(this.root, 'docs/roadmap.json'), 'utf8'), readFile(resolve(this.root, 'docs/admin-guide.ar.md'), 'utf8')]);
    let parsed: unknown; try { parsed = JSON.parse(roadmap); } catch { throw new CatalogError('PROJECT_ROADMAP_INVALID', 503); }
    const valid=ProjectRoadmapSchema.safeParse(parsed);
    if (!valid.success) throw new CatalogError('PROJECT_ROADMAP_INVALID', 503);
    return { roadmap: valid.data, guide_markdown };
  }
  async listening(id: string): Promise<ListeningRoom> {
    const [recitation] = await this.db.read('SELECT r.id,r.slug,r.reciter_id,r.display_label_ar,r.display_label_en,r.style,r.voice_identity_status,r.voice_auto_evidence,r.verification_details,r.offset_verified,r.verification_status,e.name_ar reciter_name_ar,p.code provider,p.host_allowlist FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id WHERE r.id=?', [id]);
    if (!recitation) throw new CatalogError('RECITATION_NOT_FOUND', 404);
    const hosts = parsedJson<string[]>(recitation.host_allowlist);
    if (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')) throw new CatalogError('AUDIO_PROVIDER_INVALID', 503);
    const rows = await this.db.read('SELECT a.sample_key,a.surah,a.start_ms,a.duration_ms,a.selection_details,c.audio_url,c.chapter_offset_ms FROM recitation_audition_samples a LEFT JOIN recitation_chapters c ON c.recitation_id=a.recitation_id AND c.surah=a.surah WHERE a.recitation_id=? ORDER BY a.sample_key', [id]);
    const samples = rows.map(row => auditionPreview(row, hosts));
    const same_reciter = await this.db.read('SELECT id,display_label_ar,voice_identity_status FROM recitations WHERE reciter_id=? AND id<>? ORDER BY sort_order,slug', [recitation.reciter_id, id]);
    const history = await this.db.read('SELECT v.id,v.status,v.notes,v.created_at,v.reviewer_id,p.display_name reviewer_name FROM recitation_voice_reviews v LEFT JOIN profiles p ON p.user_id=v.reviewer_id WHERE v.recitation_id=? ORDER BY v.created_at DESC,v.id DESC', [id]);
    const [review] = await this.db.read("SELECT id FROM human_review_items WHERE type='voice_confirmation' AND COALESCE(target_subject_id,subject_id)=? AND status IN ('pending','deferred') ORDER BY created_at DESC LIMIT 1", [id]);
    const [next] = await this.db.read("SELECT COALESCE(h.target_subject_id,h.subject_id) id FROM human_review_items h JOIN recitations r ON r.id=COALESCE(h.target_subject_id,h.subject_id) WHERE h.type='voice_confirmation' AND h.status='pending' AND r.id<>? ORDER BY (r.status='published') DESC,h.priority DESC,h.created_at LIMIT 1", [id]);
    const evidence = redactCatalogEvidence({ automatic_voice: parsedJson(recitation.voice_auto_evidence), offset: parsedJson(recitation.verification_details), offset_verified: Boolean(Number(recitation.offset_verified)) });
    delete recitation.host_allowlist; delete recitation.voice_auto_evidence; delete recitation.verification_details;
    return { recitation, samples, same_reciter, evidence, history, review_id: review ? String(review.id) : null, next_id: next ? String(next.id) : null } as unknown as ListeningRoom;
  }
  async providers(): Promise<CatalogRow> {
    const digest_markdown = await readFile(resolve(this.root, 'docs/data/provider-terms-digest.md'), 'utf8');
    const providers = await this.db.read("SELECT p.id,p.code,p.name,p.license_status,p.terms_url,p.attribution_text,(SELECT h.id FROM human_review_items h WHERE h.type='provider_license' AND COALESCE(h.target_subject_id,h.subject_id)=p.id AND h.status IN ('pending','deferred') ORDER BY h.created_at DESC LIMIT 1) review_id FROM audio_providers p ORDER BY p.code");
    return { providers: providers.map(row => ({ ...row, terms_url: safeCatalogUrl(row.terms_url), digest: digestProvider(digest_markdown, String(row.code)) })), digest_markdown };
  }
}

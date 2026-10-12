import { describe, expect, it, vi } from 'vitest';
import { AdminReviewWorkspace, assertSafeBulkReviews } from '../../server/admin/adminReviewWorkspace';
import { AdminOwnerWorkspace, digestProvider } from '../../server/admin/adminOwnerWorkspace';
import { AdminSettingsService } from '../../server/admin/adminSettingsRegistry';
import { adminReviewWorkspaceMigrationSql, downAdminReviewWorkspace } from '../../server/db/migrations/008_addAdminReviewWorkspace';
import type { CatalogDatabase, CatalogRow } from '../../server/services/catalogContracts';
import type { CatalogActor } from '../../server/services/catalogAudit';
import { expandChapterPattern, AdminReciterWizard } from '../../server/admin/adminReciterWizard';
import { parseVideoRange } from '../../server/admin/adminRenderMedia';
import { AdminMediaTasks,mediaRedisConnection } from '../../server/admin/adminMediaTasks';
import { createAdminRouter } from '../../server/routes/admin/adminRouter';
const actor: CatalogActor = { id: 'reviewer', kind: 'human', roleSlug: 'admin', permissions: new Set(['reviews.decide', 'recitations.voice.review', 'recitations.manage']) };
function database(read: (sql: string, params?: unknown[]) => Promise<CatalogRow[]>): CatalogDatabase {
  const db: CatalogDatabase = { read: vi.fn(read), execute: vi.fn(async () => {}), transaction: async work => work(db) }; return db;
}
describe('owner review safety', () => {
  it('rejects bulk voice, license, rights and stale decisions before any write', () => {
    for (const type of ['voice_confirmation', 'provider_license', 'youtube_rights', 'basmala_audio', 'offset_exception']) expect(() => assertSafeBulkReviews([{ id: 'a', type, status: 'pending' }], ['a'])).toThrow('REVIEW_BULK_UNSAFE');
    expect(() => assertSafeBulkReviews([{ id: 'a', type: 'data_conflict', status: 'approved' }], ['a'])).toThrow('REVIEW_BULK_UNSAFE');
    expect(() => assertSafeBulkReviews([{ id: 'a', type: 'data_conflict', status: 'pending' }], ['a', 'a'])).toThrow('REVIEW_BULK_INVALID');
    expect(() => assertSafeBulkReviews([{ id: 'a', type: 'near_complete_chapters', status: 'pending' }], ['a'])).not.toThrow();
  });
  it('cannot approve a provider through generic review permission', async () => {
    const db = database(async () => [{ type: 'provider_license', subject_id: 'provider' }]);
    await expect(new AdminReviewWorkspace(db).decide(actor, 'review', { status: 'approved', notes: 'human note' })).rejects.toThrow('CATALOG_PERMISSION_DENIED');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('cannot change or reopen a label through visibility permission and its broad legacy alias',async()=>{
    const visibilityOnly={...actor,permissions:new Set(['reviews.decide','recitations.visibility','recitations.manage'])};
    const db=database(async sql=>[{id:'label',type:'label_review',subject_id:'recitation',subject_type:'recitation',status:sql.startsWith('SELECT *')?'approved':'pending'}]);
    const reviews=new AdminReviewWorkspace(db);
    await expect(reviews.decide(visibilityOnly,'label',{status:'approved',notes:'rename',decision:{display_label_ar:'اسم جديد'}})).rejects.toThrow('CATALOG_PERMISSION_DENIED');
    await expect(reviews.undo(visibilityOnly,'label','reconsider label')).rejects.toThrow('CATALOG_PERMISSION_DENIED');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('requires typed provider confirmation before changing any state', async () => {
    const db = database(async sql => sql.includes('SELECT code') ? [{ code: 'provider' }] : [{ type: 'provider_license', subject_id: 'provider' }]);
    await expect(new AdminReviewWorkspace(db).decide({ ...actor, roleSlug: 'super_admin', permissions: new Set([...actor.permissions, 'providers.license.review']) }, 'review', { status: 'rejected', notes: 'note', confirmation: 'wrong' })).rejects.toThrow('CONFIRMATION_MISMATCH');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('reopening retains original decision and conservatively revokes the live voice gate', async () => {
    const db = database(async sql => sql.startsWith('SELECT * FROM human_review_items') ? [{ id: 'old', type: 'voice_confirmation', subject_type: 'recitation', subject_id: 'recitation', evidence: {}, decision: {}, status: 'approved', priority: 90 }] : []);
    const result = await new AdminReviewWorkspace(db).undo(actor, 'old', 'recheck');
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/u);
    const calls = vi.mocked(db.execute).mock.calls;
    expect(calls.some(([sql]) => sql.includes('INSERT INTO human_review_items') && sql.includes('supersedes_id'))).toBe(true);
    expect(calls.some(([sql]) => sql.includes("voice_identity_status='unverified'"))).toBe(true);
    expect(calls.some(([sql]) => /DELETE|UPDATE human_review_items/u.test(sql))).toBe(false);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });
  it('quotes search wildcards literally and prioritizes eligible recitations', async () => {
    const db = database(async sql => sql.startsWith('SELECT COUNT(*) total') ? [{ total: 0 }] : []);
    await new AdminReviewWorkspace(db).list({ page: 1, limit: 25, q: 'a%b_c!', status: 'pending' });
    const calls = vi.mocked(db.read).mock.calls;
    expect(calls.find(([sql]) => sql.startsWith('SELECT COUNT(*) total'))?.[1]).toContain('%a!%b!_c!!%');
    expect(calls.some(([sql]) => sql.includes('ORDER BY IFNULL(') && sql.includes('h.priority DESC'))).toBe(true);
  });
  it('refuses reopening an obsolete decision after its replacement was decided',async()=>{
    const db=database(async sql=>sql.startsWith('SELECT * FROM human_review_items')?[{id:'old',type:'voice_confirmation',subject_type:'recitation',subject_id:'recitation',status:'approved'}]:sql.startsWith('SELECT id,status FROM human_review_items WHERE supersedes_id')?[{id:'new',status:'rejected'}]:[]);
    await expect(new AdminReviewWorkspace(db).undo(actor,'old','recheck')).rejects.toThrow('REVIEW_SUPERSEDED');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('persists preferences per authenticated actor only and audits changes', async () => {
    const db = database(async () => []), owner = new AdminOwnerWorkspace(db);
    expect(await owner.preferences('reviewer')).toEqual({ density: 'comfortable', font_scale: 1 });
    await owner.updatePreferences(actor, { density: 'compact', font_scale: 1.2 });
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_preferences'), ['reviewer', 'compact', 1.2]);
    expect(vi.mocked(db.execute).mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });
  it('blocks catalog opening even with obsolete readiness settings', async () => {
    const db = database(async () => [{ key_name: 'public_flow_v2_ready', value_text: 'true', is_secret: 0 }]);
    await expect(new AdminSettingsService(db).update({ actor, params: { key: 'quran_catalog_v2' }, body: { value: true, confirmation: 'quran_catalog_v2' }, user: { id: actor.id, permissions: ['launch.manage'] } } as never, true)).rejects.toThrow('PUBLIC_FLOW_V2_NOT_READY');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('extracts provider terms without fabricating missing permission', () => {
    const digest = digestProvider('| YouTube | [Policy](https://developers.google.com/youtube/terms/developer-policies) embed only | unknown | owner permission |', 'youtube');
    expect(digest.terms_url).toBe('https://developers.google.com/youtube/terms/developer-policies');
    expect(digestProvider('', 'unknown').commercial).toContain('لم يُتحقق');
  });
  it('migration is additive and rollback is local-only', async () => {
    const sql = adminReviewWorkspaceMigrationSql().join('\n');
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE (?:recitations|quran_)/u);
    await expect(downAdminReviewWorkspace({ query: vi.fn() }, 'production' as never)).rejects.toThrow('DESTRUCTIVE_REHEARSAL_ONLY');
  });
  it('URL patterns are explicit and cannot introduce an unknown placeholder',()=>{
    expect(expandChapterPattern('https://audio.example/{surah:03d}.mp3',2)).toBe('https://audio.example/002.mp3');
    expect(expandChapterPattern('https://audio.example/{surah}.mp3',2)).toBe('https://audio.example/2.mp3');
    for(const value of ['https://audio.example/002.mp3','https://audio.example/{surah}/{surah}','https://audio.example/{surah}/{secret}'])expect(()=>expandChapterPattern(value,2)).toThrow('WIZARD_URL_PATTERN_INVALID');
  });
  it('new sources never inherit QUD timing references for another riwayah/provider',async()=>{
    const db=database(async sql=>sql.includes('FROM audio_providers')?[{id:'provider',host_allowlist:['audio.example']}]:sql.includes('FROM riwayat')?[{id:'hafs',code:'hafs_an_asim'}]:[{id:'reference',provider_id:'other',riwayah_code:'hafs_an_asim',qud_version:'v3.2.0'}]);
    await expect(new AdminReciterWizard(db,{} as never).validate({source:{kind:'qud',provider_id:'provider',qud_slug:'existing'},reciter:{name_ar:'قارئ',name_en:'Reader'},recitation:{slug:'draft',riwayah_code:'hafs_an_asim',style:'murattal',display_label_ar:'تلاوة'}} as never)).rejects.toThrow('WIZARD_QUD_REFERENCE_INVALID');
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('video ranges are bounded and reject multi-range or invalid suffixes',()=>{
    expect(parseVideoRange(undefined,100)).toBe(null);
    expect(parseVideoRange('bytes=5-12',100)).toEqual({start:5,end:12});
    expect(parseVideoRange('bytes=-10',100)).toEqual({start:90,end:99});
    expect(parseVideoRange('bytes=90-',100)).toEqual({start:90,end:99});
    for(const value of ['bytes=-0','bytes=100-','bytes=2-1','bytes=1-2,4-5','bytes=-','wrong'])expect(()=>parseVideoRange(value,100)).toThrow('RENDER_MEDIA_RANGE_INVALID');
  });
  it('binary response hooks cannot bypass write auditing',()=>{
    const db=database(async()=>[]);
    expect(()=>createAdminRouter({db,register:register=>register({method:'post',path:'/bad',permission:'security.self',writes:true,handler:async()=>({data:null}),respond:async()=>{}})})).toThrow('ADMIN_BINARY_RESPONSE_GET_ONLY');
  });
  it('media queues validate connection protocol and preserve local test database isolation',()=>{
    expect(mediaRedisConnection('redis://localhost:6380/14')).toMatchObject({host:'localhost',port:6380,db:14,maxRetriesPerRequest:null});
    for(const value of [undefined,'http://localhost','redis://localhost/not-a-db'])expect(()=>mediaRedisConnection(value)).toThrow('ADMIN_MEDIA_QUEUE_UNAVAILABLE');
  });
  it('does not persist signed candidate URLs in database or task queue',async()=>{
    const db=database(async()=>[]),tasks=new AdminMediaTasks(db,{} as never,vi.fn(),{});
    await expect(tasks.enqueue({...actor,permissions:new Set(['recitations.sources.manage'])},'task',{type:'candidate',recitation_id:'r',surah:1,url:'https://audio.example/file.mp3?X-Amz-Signature=private'})).rejects.toThrow('REVIEW_EVIDENCE_SECRET');
    expect(db.read).not.toHaveBeenCalled();expect(db.execute).not.toHaveBeenCalled();
  });
  it('rejects secret source metadata even when the selected wizard source does not use the URL',async()=>{
    const db=database(async()=>[]),wizard=new AdminReciterWizard(db,{} as never);
    const input={intent_id:'00000000-0000-4000-8000-000000000000',source:{kind:'licensed_file',provider_id:'provider',url_pattern:'https://audio.example/file.mp3?X-Amz-Signature=private'},reciter:{name_ar:'قارئ',name_en:'Reader'},recitation:{slug:'draft',riwayah_code:'hafs_an_asim',style:'murattal',display_label_ar:'تلاوة'}};
    await expect(wizard.validate(input as never)).rejects.toThrow('REVIEW_EVIDENCE_SECRET');
    await expect(wizard.create({...actor,permissions:new Set([...actor.permissions,'reciters.write'])},input as never)).rejects.toThrow('REVIEW_EVIDENCE_SECRET');
    expect(db.read).not.toHaveBeenCalled();expect(db.execute).not.toHaveBeenCalled();
  });
});


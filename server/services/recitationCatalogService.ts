import { CatalogError,isPubliclyVisible,publicCatalogSql,parseRuns,type CatalogDatabase,type CatalogSettings,type CatalogRow,type PublicRecitation,type CatalogAudioResolver,type AudioPlanInput } from './catalogContracts';
import { isRangeAvailable } from './recitationAvailability';
import { auditionPreview } from './catalogAuditionSamples';
const chapterSql=(settings:CatalogSettings):string=>settings.availabilityMode==='complete_only'?"c.availability_state='complete'":"c.run_count>0 AND c.availability_state IN ('complete','near_complete','partial')";
export async function readCatalogSettings(db: Pick<CatalogDatabase,'read'>):Promise<CatalogSettings>{
  const rows=await db.read("SELECT key_name,value_text,is_secret FROM system_settings WHERE key_name IN ('quran_catalog_v2','availability_mode','voice_gate_policy','storage_adapter')");
  const values=new Map(rows.map(r=>[String(r.key_name),r]));
  for(const row of rows)if(Number(row.is_secret)!==0)throw new CatalogError('CATALOG_SETTING_INVALID',503);
  const policy=values.get('voice_gate_policy')?.value_text??'allow_auto_verified';
  if(!['allow_auto_verified','require_confirmed'].includes(String(policy)))throw new CatalogError('CATALOG_SETTING_INVALID',503);
  const storage=values.get('storage_adapter')?.value_text??'url_reference';if(!['url_reference','r2'].includes(String(storage)))throw new CatalogError('CATALOG_SETTING_INVALID',503);
  const flag=values.get('quran_catalog_v2')?.value_text??'false';const mode=values.get('availability_mode')?.value_text??'complete_only';
  if(!['true','false','1','0'].includes(String(flag))||!['complete_only','ayah_ranges'].includes(String(mode)))throw new CatalogError('CATALOG_SETTING_INVALID',503);
  return {enabled:flag==='true'||flag==='1',availabilityMode:mode as CatalogSettings['availabilityMode'],voiceGatePolicy:policy as CatalogSettings['voiceGatePolicy'],storageAdapter:storage as CatalogSettings['storageAdapter']};
}
export class RecitationCatalogService {
  constructor(private readonly db:CatalogDatabase,private readonly settings:()=>Promise<CatalogSettings>,private readonly audio:CatalogAudioResolver){}
  async configuration():Promise<CatalogSettings>{return this.settings();}
  async requireEnabled():Promise<CatalogSettings>{const settings=await this.settings();if(!settings.enabled)throw new CatalogError('QURAN_CATALOG_DISABLED',404);return settings;}
  async listReciters():Promise<CatalogRow[]>{
    const settings=await this.requireEnabled();
    return this.db.read(`SELECT e.id,e.slug,e.name_ar,e.name_en,e.country,e.photo_url,e.is_featured,e.sort_order,COUNT(DISTINCT r.id) public_recitations,MAX((SELECT COUNT(*) FROM recitation_chapters x WHERE x.recitation_id=r.id AND x.availability_state='complete')) best_complete_chapters FROM reciters e JOIN recitations r ON r.reciter_id=e.id JOIN audio_providers p ON p.id=r.provider_id WHERE ${publicCatalogSql(settings.voiceGatePolicy)} AND EXISTS(SELECT 1 FROM recitation_chapters c WHERE c.recitation_id=r.id AND ${chapterSql(settings)}) GROUP BY e.id ORDER BY COALESCE(e.is_featured,0) DESC,COALESCE(e.sort_order,2147483647),e.slug`);
  }
  async listRecitationsForReciter(slug:string):Promise<CatalogRow[]>{
    const settings=await this.requireEnabled();
    const recitations=await this.db.read(`SELECT r.id,r.slug,r.display_label_ar,r.display_label_en,r.style,r.channel,r.recording_year,r.recording_context,r.quality_note,r.source_note,r.is_default_for_reciter,r.sort_order,r.timing_level,r.timing_quality,r.riwayah_code,r.attribution_text,p.name provider_name,p.license_text FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id WHERE e.slug=? AND ${publicCatalogSql(settings.voiceGatePolicy)} AND EXISTS(SELECT 1 FROM recitation_chapters c WHERE c.recitation_id=r.id AND ${chapterSql(settings)}) ORDER BY COALESCE(r.is_default_for_reciter,0) DESC,COALESCE(r.sort_order,2147483647),r.slug`,[slug]);
    for(const r of recitations){
      r.availability=(await this.db.read("SELECT availability_state,COUNT(*) chapters,SUM(ready_ayahs) ready_ayahs,MAX(max_run_ayahs) max_run_ayahs FROM recitation_chapters WHERE recitation_id=? GROUP BY availability_state ORDER BY availability_state",[r.id]));
      const samples=await this.db.read("SELECT a.sample_key,a.surah,a.start_ms,a.duration_ms,a.selection_details,c.audio_url,c.chapter_offset_ms,p.host_allowlist FROM recitation_audition_samples a LEFT JOIN recitation_chapters c ON c.recitation_id=a.recitation_id AND c.surah=a.surah JOIN recitations r ON r.id=a.recitation_id JOIN audio_providers p ON p.id=r.provider_id WHERE a.recitation_id=? ORDER BY a.sample_key",[r.id]);
      r.audition_samples=samples.map(sample=>{const hosts=typeof sample.host_allowlist==='string'?JSON.parse(sample.host_allowlist):sample.host_allowlist;if(!Array.isArray(hosts)||hosts.some(h=>typeof h!=='string'))throw new CatalogError('AUDIO_PROVIDER_INVALID',503);return auditionPreview(sample,hosts);});
    }
    return recitations;
  }
  private async publicRecitation(slug:string):Promise<CatalogRow>{
    const settings=await this.requireEnabled();
    const rows=await this.db.read('SELECT r.id,r.slug,r.status,r.is_public,r.voice_identity_status,p.license_status FROM recitations r JOIN audio_providers p ON p.id=r.provider_id WHERE r.slug=?',[slug]);
    if(!rows.length||!isPubliclyVisible(rows[0] as unknown as PublicRecitation,settings.enabled,settings.voiceGatePolicy))throw new CatalogError('RECITATION_NOT_PUBLIC',404);
    return rows[0];
  }
  async listSurahsForRecitation(slug:string):Promise<CatalogRow[]>{
    const recitation=await this.publicRecitation(slug);const settings=await this.settings();
    const rows=await this.db.read(`SELECT c.surah,s.name_ar,s.name_en,s.ayah_count,c.availability_state,c.available_runs,c.ready_ayahs,c.max_run_ayahs FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id=? AND ${chapterSql(settings)} ORDER BY c.surah`,[recitation.id]);
    return rows.map(r=>({...r,available_runs:parseRuns(r.available_runs)}));
  }
  async getAvailability(slug:string,surah:number):Promise<CatalogRow>{
    if(!Number.isSafeInteger(surah)||surah<1)throw new CatalogError('RANGE_NOT_AVAILABLE',422,{available_runs:[]});
    const r=await this.publicRecitation(slug);const settings=await this.settings();
    const chapters=await this.db.read('SELECT surah,availability_state,available_runs,ready_ayahs,max_run_ayahs,near_complete_missing FROM recitation_chapters WHERE recitation_id=? AND surah=?',[r.id,surah]);
    if(!chapters.length)throw new CatalogError('RANGE_NOT_AVAILABLE',422,{available_runs:[]});
    const chapter=chapters[0];const runs=parseRuns(chapter.available_runs);
    const usable=settings.availabilityMode==='ayah_ranges'||chapter.availability_state==='complete';
    return {...chapter,available_runs:usable?runs:[],availability_mode:settings.availabilityMode};
  }
  async resolveAudioPlan(input:AudioPlanInput):Promise<Awaited<ReturnType<CatalogAudioResolver['resolveAudioPlan']>>>{
    const [row]=await this.db.read('SELECT slug FROM recitations WHERE id=?',[input.recitationId]);
    if(!row)throw new CatalogError('RECITATION_NOT_PUBLIC',404);
    const availability=await this.getAvailability(String(row.slug),input.surah);const runs=parseRuns(availability.available_runs);
    if(!isRangeAvailable(runs,input.from,input.to))throw new CatalogError('RANGE_NOT_AVAILABLE',422,{available_runs:runs});
    return this.audio.resolveAudioPlan(input);
  }
}

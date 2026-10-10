import { randomUUID } from 'node:crypto';
import { CatalogError,type CatalogDatabase,type CatalogTx,type CatalogRow,type AvailabilityMode } from './catalogContracts';
import { appendCatalogAudit,requireCatalogPermission,type CatalogActor } from './catalogAudit';
export interface AlternateRecordingProof {
  primaryUrl:string; primarySha256:string; alternateSha256:string; verifiedAt:string;
  method:'decoded_audio_sha256';
}
export interface AdminSourceValidator {
  validate(url:string,hosts:string[]):Promise<void>;
  verifySameRecording(primaryUrl:string,alternateUrl:string,hosts:string[]):Promise<AlternateRecordingProof>;
}
/** A2 RBAC adapter supplies actor permissions. No role bypass, no admin routes. */
export class RecitationAdminService {
  constructor(private readonly db:CatalogDatabase,private readonly sources:AdminSourceValidator){}
  private async recitation(tx:CatalogTx,id:string):Promise<CatalogRow>{const [row]=await tx.read('SELECT * FROM recitations WHERE id=? FOR UPDATE',[id]);if(!row)throw new CatalogError('RECITATION_NOT_FOUND',404);return row;}
  async updatePresentation(actor:CatalogActor,id:string,patch:{display_label_ar?:string|null;display_label_en?:string|null;sort_order?:number;quality_note?:string|null;source_note?:string|null}):Promise<void>{
    requireCatalogPermission(actor,'recitations.manage');const entries=Object.entries(patch);
    const allowed=new Set(['display_label_ar','display_label_en','sort_order','quality_note','source_note']);
    if(!entries.length||entries.some(([k,v])=>!allowed.has(k)||(k==='sort_order'? !Number.isSafeInteger(v):v!==null&&(typeof v!=='string'||v.length>(k.startsWith('display_label')?255:10000)))))throw new CatalogError('CATALOG_INPUT_INVALID',422);
    await this.db.transaction(async tx=>{const old=await this.recitation(tx,id);await tx.execute('UPDATE recitations SET '+entries.map(([k])=>k+'=?').join(',')+' WHERE id=?',[...entries.map(([,v])=>v),id]);await appendCatalogAudit(tx,actor,'recitation.presentation','recitation',id,Object.fromEntries(entries.map(([k])=>[k,old[k]])),patch);});
  }
  async setDefault(actor:CatalogActor,id:string):Promise<void>{
    requireCatalogPermission(actor,'recitations.manage');
    await this.db.transaction(async tx=>{const row=await this.recitation(tx,id);const previous=await tx.read('SELECT id FROM recitations WHERE reciter_id=? AND is_default_for_reciter=1 FOR UPDATE',[row.reciter_id]);await tx.execute('UPDATE recitations SET is_default_for_reciter=0 WHERE reciter_id=? AND is_default_for_reciter=1',[row.reciter_id]);await tx.execute('UPDATE recitations SET is_default_for_reciter=1 WHERE id=?',[id]);await appendCatalogAudit(tx,actor,'recitation.default','reciter',String(row.reciter_id),{ids:previous.map(r=>r.id)},{id});});
  }
  async setPublic(actor:CatalogActor,id:string,visible:boolean):Promise<void>{
    requireCatalogPermission(actor,'recitations.manage');if(typeof visible!=='boolean')throw new CatalogError('CATALOG_INPUT_INVALID',422);
    await this.db.transaction(async tx=>{const row=await this.recitation(tx,id);if(visible){const [provider]=await tx.read('SELECT license_status FROM audio_providers WHERE id=?',[row.provider_id]);if(row.status!=='published'||row.voice_identity_status!=='confirmed'||provider?.license_status!=='permitted')throw new CatalogError('RECITATION_PUBLIC_GATES_INCOMPLETE',409);}await tx.execute('UPDATE recitations SET is_public=? WHERE id=?',[visible,id]);await appendCatalogAudit(tx,actor,'recitation.public','recitation',id,{is_public:row.is_public},{is_public:visible});});
  }
  async reviewVoice(actor:CatalogActor,id:string,status:'unverified'|'confirmed'|'mismatch',notes:string):Promise<void>{
    requireCatalogPermission(actor,'recitations.voice.review',true);if(!['unverified','confirmed','mismatch'].includes(status)||!notes?.trim()||notes.length>10000)throw new CatalogError('CATALOG_INPUT_INVALID',422);
    await this.db.transaction(async tx=>{const row=await this.recitation(tx,id);await tx.execute('INSERT INTO recitation_voice_reviews(id,recitation_id,status,reviewer_id,notes) VALUES(?,?,?,?,?)',[randomUUID(),id,status,actor.id,notes]);await tx.execute("UPDATE recitations SET voice_identity_status=?,voice_confirmed_by=?,voice_confirmed_at=CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END,voice_notes=?,is_public=CASE WHEN ?='confirmed' THEN is_public ELSE 0 END WHERE id=?",[status,status==='confirmed'?actor.id:null,status,notes,status,id]);await appendCatalogAudit(tx,actor,'recitation.voice_review','recitation',id,{status:row.voice_identity_status},{status,notes});});
  }
  async moveRecitation(actor:CatalogActor,id:string,reciterId:string,reason:string):Promise<void>{
    requireCatalogPermission(actor,'recitations.move',true);if(!reason?.trim())throw new CatalogError('CATALOG_INPUT_INVALID',422);
    await this.db.transaction(async tx=>{const row=await this.recitation(tx,id);const [target]=await tx.read('SELECT id FROM reciters WHERE id=? FOR UPDATE',[reciterId]);if(!target)throw new CatalogError('RECITER_NOT_FOUND',404);
      await tx.execute("UPDATE recitations SET reciter_id=?,is_default_for_reciter=0,is_public=0,voice_identity_status='unverified',voice_confirmed_by=NULL,voice_confirmed_at=NULL WHERE id=?",[reciterId,id]);
      await tx.execute('INSERT INTO recitation_voice_reviews(id,recitation_id,status,reviewer_id,notes) VALUES(?,?,\'unverified\',?,?)',[randomUUID(),id,actor.id,'RECITER_CHANGED: '+reason]);
      await appendCatalogAudit(tx,actor,'recitation.move','recitation',id,{reciter_id:row.reciter_id,voice_identity_status:row.voice_identity_status},{reciter_id:reciterId,voice_identity_status:'unverified',is_public:false,reason});});
  }
  async addAlternate(actor:CatalogActor,input:{recitationId:string;surah:number;url:string;priority:number}):Promise<string>{
    requireCatalogPermission(actor,'recitations.sources.manage',true);
    if(!Number.isSafeInteger(input.surah)||input.surah<1||!Number.isSafeInteger(input.priority))throw new CatalogError('CATALOG_INPUT_INVALID',422);
    const [source]=await this.db.read('SELECT r.provider_id,c.audio_url,p.host_allowlist FROM recitations r JOIN recitation_chapters c ON c.recitation_id=r.id JOIN audio_providers p ON p.id=r.provider_id WHERE r.id=? AND c.surah=?',[input.recitationId,input.surah]);
    if(!source||source.audio_url===input.url)throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
    const hosts=typeof source.host_allowlist==='string'?JSON.parse(source.host_allowlist):source.host_allowlist;
    if(!Array.isArray(hosts)||hosts.some(h=>typeof h!=='string'))throw new CatalogError('AUDIO_PROVIDER_INVALID',503);
    await this.sources.validate(input.url,hosts);
    // Server-computed evidence only. Never trust a checksum submitted by a browser.
    // Network/decoding happens outside the audit/DB lock, then source is rechecked.
    const proof=await this.sources.verifySameRecording(String(source.audio_url),input.url,hosts);
    if(proof.primaryUrl!==source.audio_url||proof.method!=='decoded_audio_sha256'||!/^[a-f0-9]{64}$/u.test(proof.primarySha256)||proof.primarySha256!==proof.alternateSha256||!Number.isFinite(Date.parse(proof.verifiedAt)))throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
    const id=randomUUID();
    await this.db.transaction(async tx=>{const r=await this.recitation(tx,input.recitationId);const [chapter]=await tx.read('SELECT audio_url FROM recitation_chapters WHERE recitation_id=? AND surah=?',[r.id,input.surah]);if(!chapter||chapter.audio_url!==proof.primaryUrl||input.url===proof.primaryUrl)throw new CatalogError('ALTERNATE_RECORDING_MISMATCH',422);
      if(r.provider_id!==source.provider_id)throw new CatalogError('ALTERNATE_SOURCE_CHANGED',409);
      const duplicate=await tx.read('SELECT r.reciter_id,r.slug FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id WHERE BINARY c.audio_url=BINARY ? UNION ALL SELECT r.reciter_id,r.slug FROM recitation_source_urls u JOIN recitations r ON r.id=u.recitation_id WHERE BINARY u.url=BINARY ?',[input.url,input.url]);
      if(duplicate.some(d=>d.reciter_id!==r.reciter_id))throw new CatalogError('CROSS_RECITER_AUDIO_DUPLICATE_STOP',409);
      await tx.execute('INSERT INTO recitation_source_urls(id,recitation_id,surah,url,priority,is_active,recording_sha256,identity_evidence,approved_by) VALUES(?,?,?,?,?,1,?,?,?)',[id,r.id,input.surah,input.url,input.priority,proof.primarySha256,JSON.stringify(proof),actor.id]);
      await appendCatalogAudit(tx,actor,'recitation.alternate_add','recitation_source_url',id,null,{recitation_id:r.id,surah:input.surah,url:input.url,recording_sha256:proof.primarySha256,approved_by:actor.id});
    });return id;
  }
  async disableAlternate(actor:CatalogActor,id:string):Promise<void>{
    requireCatalogPermission(actor,'recitations.sources.manage');await this.db.transaction(async tx=>{const [row]=await tx.read('SELECT recitation_id,is_active FROM recitation_source_urls WHERE id=? FOR UPDATE',[id]);if(!row)throw new CatalogError('ALTERNATE_NOT_FOUND',404);await tx.execute('UPDATE recitation_source_urls SET is_active=0 WHERE id=?',[id]);await appendCatalogAudit(tx,actor,'recitation.alternate_disable','recitation_source_url',id,row,{...row,is_active:false});});
  }
  async setAvailabilityMode(actor:CatalogActor,mode:AvailabilityMode):Promise<void>{
    requireCatalogPermission(actor,'settings.catalog.manage',true);if(!['complete_only','ayah_ranges'].includes(mode))throw new CatalogError('CATALOG_INPUT_INVALID',422);
    await this.db.transaction(async tx=>{const [old]=await tx.read("SELECT value_text FROM system_settings WHERE key_name='availability_mode' FOR UPDATE");await tx.execute("INSERT INTO system_settings(key_name,value_text,is_secret,category) VALUES('availability_mode',?,0,'quran_catalog') ON DUPLICATE KEY UPDATE value_text=VALUES(value_text)",[mode]);await appendCatalogAudit(tx,actor,'catalog.availability_mode','system_setting','availability_mode',old??null,{value_text:mode});});
  }
}

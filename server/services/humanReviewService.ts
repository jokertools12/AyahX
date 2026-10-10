import {createHash,randomUUID} from 'node:crypto';
import {reviewTypes} from '../db/migrations/005_addHumanReviewsAndLicensedSources';
import {appendCatalogAudit,canonicalAuditJson,requireCatalogPermission,type CatalogActor} from './catalogAudit';
import {CatalogError,type CatalogDatabase,type CatalogRow,type CatalogTx} from './catalogContracts';
export type HumanReviewType=typeof reviewTypes[number];
export interface ReviewInput {type:HumanReviewType;subject_type:string;subject_id:string;evidence:CatalogRow;priority:number}
export interface ReviewDecision {status:'approved'|'rejected'|'deferred';notes:string;decision?:CatalogRow}
export function humanReviewId(input:Pick<ReviewInput,'type'|'subject_type'|'subject_id'>):string{
  const hash=createHash('sha256').update(canonicalAuditJson({type:input.type,subject_type:input.subject_type,subject_id:input.subject_id})).digest('hex').slice(0,32);return [hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-');
}
export const jsonReviewValue=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value;
/** Review evidence is metadata only. Never store credentials or expiring media URLs. */
export function validateReviewEvidence(value:unknown):void{
  canonicalAuditJson(value);
  const walk=(item:unknown):void=>{
    if(typeof item==='string'){
      if(/(?:mysql|redis|rediss):\/\/|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})/u.test(item))throw new CatalogError('REVIEW_EVIDENCE_SECRET',422);
      if(/^https?:\/\//u.test(item)){const url=new URL(item);if(url.username||url.password||[...url.searchParams.keys()].some(k=>/token|secret|signature|credential|expires|^sig$|^api[_-]?key$|^x-amz-/iu.test(k)))throw new CatalogError('REVIEW_EVIDENCE_SECRET',422);}
    }else if(Array.isArray(item))item.forEach(walk);
    else if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){if(/^(?:password|secret|access_key|connection_string|api_key)$/iu.test(key))throw new CatalogError('REVIEW_EVIDENCE_SECRET',422);walk(child);}
  };walk(value);if(Buffer.byteLength(JSON.stringify(value))>256*1024)throw new CatalogError('REVIEW_EVIDENCE_TOO_LARGE',422);
}
export function validateReviewInput(input:ReviewInput):void{
  if(!reviewTypes.includes(input.type)||!/^[a-z][a-z_]{0,63}$/u.test(input.subject_type)||!input.subject_id||input.subject_id.length>128||!Number.isSafeInteger(input.priority)||input.priority<0||input.priority>65535)throw new CatalogError('REVIEW_INPUT_INVALID',422);
  validateReviewEvidence(input.evidence);
}
/** No routes. The A2 RBAC adapter must supply a real authenticated actor. */
export class HumanReviewService {
  constructor(private readonly db:CatalogDatabase){}
  async enqueue(actor:CatalogActor,input:ReviewInput):Promise<{id:string;changed:boolean}>{
    requireCatalogPermission(actor,'reviews.enqueue');validateReviewInput(input);
    return this.db.transaction(async tx=>{
      const [old]=await tx.read('SELECT * FROM human_review_items WHERE type=? AND subject_type=? AND subject_id=? FOR UPDATE',[input.type,input.subject_type,input.subject_id]);
      const id=old?String(old.id):humanReviewId({type:input.type,subject_type:input.subject_type,subject_id:input.subject_id});
      // A automated rerun cannot reopen or overwrite an administrator's decision.
      if(old&&(old.status!=='pending'||(canonicalAuditJson(jsonReviewValue(old.evidence))===canonicalAuditJson(input.evidence)&&Number(old.priority)===input.priority)))return {id,changed:false};
      if(old)await tx.execute('UPDATE human_review_items SET evidence=?,priority=? WHERE id=?',[JSON.stringify(input.evidence),input.priority,id]);
      else await tx.execute("INSERT INTO human_review_items(id,type,subject_type,subject_id,evidence,priority,status) VALUES(?,?,?,?,?,?,'pending')",[id,input.type,input.subject_type,input.subject_id,JSON.stringify(input.evidence),input.priority]);
      await appendCatalogAudit(tx,actor,'review.enqueue','human_review_item',id,old?{evidence:jsonReviewValue(old.evidence),priority:old.priority}:null,{...input,status:'pending'});return {id,changed:true};
    });
  }
  async decide(actor:CatalogActor,id:string,input:ReviewDecision):Promise<{changed:boolean}>{
    requireCatalogPermission(actor,'reviews.decide',true);
    if(!['approved','rejected','deferred'].includes(input.status)||!input.notes?.trim()||input.notes.length>10000)throw new CatalogError('REVIEW_DECISION_INVALID',422);
    validateReviewEvidence(input.decision??{});
    return this.db.transaction(async tx=>{
      const [row]=await tx.read('SELECT * FROM human_review_items WHERE id=? FOR UPDATE',[id]);if(!row)throw new CatalogError('REVIEW_NOT_FOUND',404);
      if(row.status===input.status&&row.notes===input.notes&&row.decided_by===actor.id&&canonicalAuditJson(jsonReviewValue(row.decision)??{})===canonicalAuditJson(input.decision??{}))return {changed:false};
      if(row.status!=='pending'&&row.status!=='deferred')throw new CatalogError('REVIEW_ALREADY_DECIDED',409);
      if(input.status!=='deferred')await this.applyDecision(tx,actor,row,input);
      await tx.execute('UPDATE human_review_items SET status=?,decided_by=?,decided_at=CURRENT_TIMESTAMP(3),notes=?,decision=? WHERE id=?',[input.status,actor.id,input.notes,JSON.stringify(input.decision??{}),id]);
      await appendCatalogAudit(tx,actor,'review.decide','human_review_item',id,{status:row.status,decision:jsonReviewValue(row.decision)??null},{...input,decision:input.decision??{},decided_by:actor.id});return {changed:true};
    });
  }
  private async applyDecision(tx:CatalogTx,actor:CatalogActor,row:CatalogRow,input:ReviewDecision):Promise<void>{
    if(row.type==='voice_confirmation'){
      requireCatalogPermission(actor,'recitations.voice.review',true);if(row.subject_type!=='recitation')throw new CatalogError('REVIEW_SUBJECT_INVALID',422);
      const [subject]=await tx.read('SELECT id,voice_identity_status FROM recitations WHERE id=? FOR UPDATE',[row.subject_id]);if(!subject)throw new CatalogError('RECITATION_NOT_FOUND',404);
      const status=input.status==='approved'?'confirmed':'mismatch';
      await tx.execute('INSERT INTO recitation_voice_reviews(id,recitation_id,status,reviewer_id,notes) VALUES(?,?,?,?,?)',[randomUUID(),subject.id,status,actor.id,input.notes]);
      await tx.execute("UPDATE recitations SET voice_identity_status=?,voice_confirmed_by=?,voice_confirmed_at=CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END,voice_notes=?,is_public=CASE WHEN ?='confirmed' THEN is_public ELSE 0 END WHERE id=?",[status,status==='confirmed'?actor.id:null,status,input.notes,status,subject.id]);
      await appendCatalogAudit(tx,actor,'recitation.voice_review','recitation',String(subject.id),{status:subject.voice_identity_status},{status,notes:input.notes,review_item:row.id});
    }else if(row.type==='provider_license'){
      requireCatalogPermission(actor,'providers.license.review',true);if(row.subject_type!=='audio_provider')throw new CatalogError('REVIEW_SUBJECT_INVALID',422);
      const status=input.status==='rejected'?'restricted':input.decision?.license_status;
      if(!['permitted','restricted'].includes(String(status))||(status==='permitted'&&!input.decision?.rights_evidence_ref))throw new CatalogError('LICENSE_EVIDENCE_REQUIRED',422);
      const [subject]=await tx.read('SELECT id,license_status FROM audio_providers WHERE id=? FOR UPDATE',[row.subject_id]);if(!subject)throw new CatalogError('PROVIDER_NOT_FOUND',404);
      await tx.execute('UPDATE audio_providers SET license_status=? WHERE id=?',[status,subject.id]);await appendCatalogAudit(tx,actor,'provider.license_review','audio_provider',String(subject.id),{license_status:subject.license_status},{license_status:status,evidence:input.decision??{},review_item:row.id});
    }else if(row.type==='label_review'){
      requireCatalogPermission(actor,'recitations.manage',true);if(row.subject_type!=='recitation')throw new CatalogError('REVIEW_SUBJECT_INVALID',422);
      if(input.status==='approved'){
        const ar=input.decision?.display_label_ar,en=input.decision?.display_label_en;if(typeof ar!=='string'||!ar.trim()||ar.length>255||(en!==undefined&&(typeof en!=='string'||en.length>255)))throw new CatalogError('LABEL_DECISION_REQUIRED',422);
        const [subject]=await tx.read('SELECT display_label_ar,display_label_en,needs_label_review FROM recitations WHERE id=? FOR UPDATE',[row.subject_id]);if(!subject)throw new CatalogError('RECITATION_NOT_FOUND',404);
        await tx.execute('UPDATE recitations SET display_label_ar=?,display_label_en=?,needs_label_review=0 WHERE id=?',[ar,en??null,row.subject_id]);await appendCatalogAudit(tx,actor,'recitation.label_review','recitation',String(row.subject_id),subject,{display_label_ar:ar,display_label_en:en??null,needs_label_review:false});
      }
    }
    // All other approvals record a human decision only. No hidden timing, rights,
    // storage, basmala or catalog mutation occurs without the dedicated service.
  }
}

import { randomUUID,createHash } from 'node:crypto';
import { CatalogError,type CatalogRow,type CatalogTx } from './catalogContracts';
export interface CatalogActor { id:string; kind:'human'|'system'; permissions:ReadonlySet<string>; roleSlug?:string; requestId?:string; ipAddress?:string }
export function requireCatalogPermission(actor:CatalogActor,permission:string,humanOnly=false):void{
  if(!actor.id||!actor.permissions.has(permission)||(humanOnly&&actor.kind!=='human'))throw new CatalogError('CATALOG_PERMISSION_DENIED',403);
}
export function canonicalAuditJson(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalAuditJson).join(',')+']';
  if(typeof value==='object'&&value){const row=value as CatalogRow;return '{'+Object.keys(row).sort().map(k=>JSON.stringify(k)+':'+canonicalAuditJson(row[k])).join(',')+'}';}
  throw new Error('AUDIT_VALUE_NOT_SERIALIZABLE');
}
/** All writers use catalogDatabaseFromPool's audit lock, held through COMMIT. */
export async function appendCatalogAudit(tx:CatalogTx,actor:CatalogActor,action:string,entityType:string,entityId:string,oldValues:CatalogRow|null,newValues:CatalogRow|null):Promise<void>{
  // Existing created_at has second precision and IDs are random: timestamp/
  // UUID sorting is not append order. Follow the unique unreferenced tail.
  const tails=await tx.read('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL FOR UPDATE');
  if(tails.length>1)throw new Error('AUDIT_CHAIN_CORRUPT');const last=tails[0];
  const prev=last?String(last.hash):'0'.repeat(64);const id=randomUUID();
  const payload={id,actor:actor.kind==='human'?actor.id:null,role:actor.roleSlug??null,action,entityType,entityId,oldValues,newValues,prev};
  const hash=createHash('sha256').update(canonicalAuditJson(payload)).digest('hex');
  const values=[id,payload.actor,payload.role,action,entityType,entityId,oldValues===null?null:JSON.stringify(oldValues),newValues===null?null:JSON.stringify(newValues),hash,prev];
  // Old CLI/system writers remain compatible before migration006; request
  // metadata is nullable and does not rewrite the historical hash format.
  if(actor.requestId)await tx.execute('INSERT INTO audit_logs(id,user_id,role_slug,action,entity_type,entity_id,old_values,new_values,hash,prev_hash,request_id,ip_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[...values,actor.requestId,actor.ipAddress??null]);
  else await tx.execute('INSERT INTO audit_logs(id,user_id,role_slug,action,entity_type,entity_id,old_values,new_values,hash,prev_hash) VALUES(?,?,?,?,?,?,?,?,?,?)',values);
}

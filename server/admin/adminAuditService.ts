import type { CatalogDatabase } from '../services/catalogContracts';
import { ADMIN_SETTINGS } from './adminSettingsRegistry';
const confidential = /password|secret|token|credential|authorization|recovery_code|backup_code|otpauth|api_key|signed_url/i;
export function redactAdminAudit(value:unknown):unknown {
 if(Array.isArray(value))return value.map(redactAdminAudit);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,confidential.test(key)?'[REDACTED]':redactAdminAudit(child)]));
 if(typeof value==='string'&&/https?:\/\/[^\s]+(?:X-Amz-|[?&](?:token|signature|key)=)/i.test(value))return '[REDACTED_URL]';
 return value;
}
const json=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value;
export class AdminAuditService {
 constructor(private readonly db:CatalogDatabase){}
 async list(query:Record<string,unknown>){
  const page=Number(query.page),limit=Number(query.limit),clauses:string[]=[],params:unknown[]=[];
  if(query.q){clauses.push('(action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR request_id LIKE ?)');const term='%'+String(query.q)+'%';params.push(term,term,term,term);}
  for(const [key,column]of Object.entries({action:'action',entityType:'entity_type',entityId:'entity_id',actorId:'user_id'}))if(query[key]){clauses.push(column+'=?');params.push(query[key]);}
  for(const [key,operator]of Object.entries({from:'>=',to:'<='}))if(query[key]){clauses.push('created_at'+operator+'?');params.push(String(query[key]).replace('T',' ').replace('Z',''));}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const [count]=await this.db.read('SELECT COUNT(*) total FROM audit_logs'+where,params);
  const rows=await this.db.read('SELECT id,user_id,role_slug,action,entity_type,entity_id,old_values,new_values,request_id,ip_address,created_at,hash,prev_hash FROM audit_logs'+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',[...params,limit,(page-1)*limit]);
  return {data:rows.map(row=>{const secretSetting=row.entity_type==='system_setting'&&(confidential.test(String(row.entity_id))||ADMIN_SETTINGS.some(def=>def.key===row.entity_id&&def.isSecret));return{id:row.id,userId:row.user_id,roleSlug:row.role_slug,action:row.action,entityType:row.entity_type,entityId:row.entity_id,before:secretSetting?{redacted:true}:redactAdminAudit(json(row.old_values)),after:secretSetting?{redacted:true}:redactAdminAudit(json(row.new_values)),requestId:row.request_id,ipAddress:row.ip_address,createdAt:row.created_at,hash:row.hash,prevHash:row.prev_hash};}),meta:{page,limit,total:Number(count?.total||0)}};
 }
}

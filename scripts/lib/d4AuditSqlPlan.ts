import {createHash} from 'node:crypto';
import {canonicalAuditJson} from '../../server/services/catalogAudit';
import {sqlLiteral as rawLiteral} from '../../server/services/qudCatalogSql';
import type {CatalogRow} from '../../server/services/catalogContracts';
export const d4Literal=(value:string|number|boolean|null)=>rawLiteral(value)+(typeof value==='string'?' COLLATE utf8mb4_unicode_ci':'');
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** Deterministic audit chain for a reviewed CLI plan, guarded through commit. */
export class D4AuditSqlPlan {
  readonly statements:string[]=[];
  readonly mutations:CatalogRow[]=[];
  private previous:string;
  constructor(private readonly seed:string){if(!/^[a-f0-9]{64}$/u.test(seed))throw new Error('INVALID_AUDIT_SEED');this.previous=seed;}
  append(action:string,table:string,id:string,oldValues:CatalogRow|null,newValues:CatalogRow|null):void{
    const raw=sha256(canonicalAuditJson({action,table,id,oldValues,newValues,previous:this.previous})).slice(0,32);
    const auditId=[raw.slice(0,8),raw.slice(8,12),raw.slice(12,16),raw.slice(16,20),raw.slice(20)].join('-');
    const payload={id:auditId,actor:null,role:null,action,entityType:table,entityId:id,oldValues,newValues,prev:this.previous};
    const hash=sha256(canonicalAuditJson(payload));
    this.statements.push(`INSERT INTO audit_logs(id,user_id,role_slug,action,entity_type,entity_id,old_values,new_values,hash,prev_hash) VALUES(${[auditId,null,null,action,table,id,oldValues===null?null:JSON.stringify(oldValues),newValues===null?null:JSON.stringify(newValues),hash,this.previous].map(d4Literal).join(',')});`);
    this.mutations.push({action,table,id,audit_id:auditId,audit_hash:hash});this.previous=hash;
  }
  finish():{sql:string;sql_sha256:string;sql_bytes:number;audit_seed:string;audit_tail:string;mutations:CatalogRow[]}{
    const guard=`CREATE TEMPORARY TABLE ayahx_d4_data_guard(ok BOOLEAN NOT NULL CHECK(ok=1));\nSET time_zone='+00:00';\nSET @ayahx_d4_lock=GET_LOCK('ayahx_audit_chain',10);\nINSERT INTO ayahx_d4_data_guard VALUES(IF(@ayahx_d4_lock=1,1,0));\nSTART TRANSACTION;\nINSERT INTO ayahx_d4_data_guard SELECT IF(COUNT(*)=${this.seed==='0'.repeat(64)?0:1} AND COALESCE(MAX(a.hash),REPEAT('0',64))=${d4Literal(this.seed)},1,0) FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL;`;
    const sql=guard+'\n'+this.statements.join('\n')+'\nCOMMIT;\nSELECT RELEASE_LOCK(\'ayahx_audit_chain\');\n';
    return {sql,sql_sha256:sha256(sql),sql_bytes:Buffer.byteLength(sql),audit_seed:this.seed,audit_tail:this.previous,mutations:this.mutations};
  }
}

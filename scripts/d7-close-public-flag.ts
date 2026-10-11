/** Root SSH: enforce the explicit D7 OFF requirement using the audited A1 service. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/db';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { AdminAccessService } from '../server/admin/adminAccessService';
import { AdminSettingsService } from '../server/admin/adminSettingsRegistry';
async function main(){
 assert.ok(process.argv.includes('--root-operated'),'ROOT_OPT_IN_REQUIRED');
 const db=catalogDatabaseFromPool(pool);
 try{
  assert.equal((await db.read('SELECT VERSION() version'))[0].version,'9.7.2');
  const [row]=await db.read("SELECT value_text,is_secret FROM system_settings WHERE key_name='quran_catalog_v2'");
  assert.ok(!row||Number(row.is_secret)===0,'FLAG_NOT_PUBLIC_SETTING');
  const before=['true','1'].includes(String(row?.value_text??'false'));
  if(before){
   const [owner]=await db.read("SELECT user_id FROM user_roles WHERE role='super_admin' ORDER BY user_id LIMIT 1");assert.ok(owner,'SUPER_ADMIN_REQUIRED');
   const access=new AdminAccessService(db),user=await access.identityForUser(String(owner.user_id));
   const requestId=randomUUID(),actor=await access.actorForUser(user.id,{requestId});
   const auditBefore=Number((await db.read('SELECT COUNT(*) n FROM audit_logs'))[0].n);
   await new AdminSettingsService(db).update({actor,user,sessionId:'root-ssh-operator',requestId,ip:'root-ssh',params:{key:'quran_catalog_v2'},body:{value:false,confirmation:'quran_catalog_v2'},query:{}},true);
   const [after]=await db.read("SELECT value_text FROM system_settings WHERE key_name='quran_catalog_v2'");assert.equal(after.value_text,'false');
   const audits=await db.read("SELECT action FROM audit_logs WHERE request_id=?",[requestId]);assert.equal(audits.length,1);assert.equal(audits[0].action,'admin.flag.update');
   console.log(JSON.stringify({before:true,after:false,delegation:'explicit_D7_catalog_OFF_requirement',own_audit_rows:audits.length,total_audit_delta:Number((await db.read('SELECT COUNT(*) n FROM audit_logs'))[0].n)-auditBefore}));
  }else console.log(JSON.stringify({before:false,after:false,production_writes:0}));
 }finally{await pool.end();}
}
void main().catch(()=>{console.error('D7_FLAG_CLOSE_FAILED');process.exitCode=1;});

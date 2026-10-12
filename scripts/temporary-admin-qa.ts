/** Root-operated QA lifecycle. Credentials never enter output or audit payloads. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import type {CatalogDatabase,CatalogTx} from '../server/services/catalogContracts';
import {appendCatalogAudit} from '../server/services/catalogAudit';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {ENVIRONMENTS} from './lib/railwayQuranOps';

export interface QaAccount {id:string;email:string;password:string;eventName:string;createdAt:string;expiresAt:string;environment:'production'|'local';state:'prepared'|'active'|'deleted'}
export function prepareQaAccount(environment:QaAccount['environment'],ttlMs=11*3600000,now=Date.now()):QaAccount {
 assert.ok(Number.isSafeInteger(ttlMs)&&ttlMs>=1000&&ttlMs<=12*3600000,'QA_TTL_INVALID');
 const id=randomUUID();return {id,email:`qa-${id}@admin-qa.example.test`,password:randomBytes(36).toString('base64url'),eventName:'ayahx_qa_expire_'+id.replaceAll('-',''),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+ttlMs).toISOString(),environment,state:'prepared'};
}
function ownedAccount(account:QaAccount){
 assert.match(account.id,/^[0-9a-f-]{36}$/u);assert.equal(account.email,`qa-${account.id}@admin-qa.example.test`);
 assert.equal(account.eventName,'ayahx_qa_expire_'+account.id.replaceAll('-',''));assert.ok(account.password.length>=32);
 const ttl=Date.parse(account.expiresAt)-Date.parse(account.createdAt);assert.ok(ttl>0&&ttl<=43200000,'QA_TTL_INVALID');
}
const actor=()=>({id:'batch5-qa-ssh',kind:'system' as const,permissions:new Set<string>(),requestId:randomUUID()});
export async function createQaAccount(db:CatalogDatabase,account:QaAccount):Promise<void>{
 ownedAccount(account);assert.equal(account.state,'prepared');assert.ok(Date.parse(account.expiresAt)>Date.now(),'QA_ALREADY_EXPIRED');
 const [scheduler]=await db.read('SELECT @@event_scheduler enabled');assert.equal(scheduler.enabled,'ON','QA_AUTOMATIC_EXPIRY_REQUIRED');
 const [old]=await db.read('SELECT id FROM users WHERE id=? OR email=?',[account.id,account.email]);assert.equal(old,undefined,'QA_ACCOUNT_COLLISION');
 const hash=await bcrypt.hash(account.password,12),expires=account.expiresAt.slice(0,19).replace('T',' ');
 // Install expiry BEFORE creating any credential or role. MySQL persists this
 // one-shot event across application restarts; its identity is strictly owned.
 const body=`BEGIN START TRANSACTION; UPDATE users SET is_banned=1,ban_reason='TEMPORARY_QA_EXPIRED',password_hash='!TEMPORARY_QA_EXPIRED' WHERE id='${account.id}'; DELETE FROM admin_sessions WHERE user_id='${account.id}'; DELETE FROM user_roles WHERE user_id='${account.id}'; COMMIT; END`;
 const [existingEvent]=await db.read('SELECT EVENT_DEFINITION,DATE_FORMAT(EXECUTE_AT,\'%Y-%m-%d %H:%i:%s\') expires FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE() AND EVENT_NAME=?',[account.eventName]);
 if(existingEvent){assert.equal(existingEvent.EVENT_DEFINITION,body,'QA_EXPIRY_EVENT_MISMATCH');assert.equal(existingEvent.expires,expires,'QA_EXPIRY_DEADLINE_MISMATCH');}
 else await db.execute(`CREATE EVENT \`${account.eventName}\` ON SCHEDULE AT '${expires}' ON COMPLETION PRESERVE DO ${body}`);
 const [event]=await db.read('SELECT STATUS,TIME_ZONE FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE() AND EVENT_NAME=?',[account.eventName]);
 assert.equal(event?.STATUS,'ENABLED','QA_EXPIRY_EVENT_NOT_ENABLED');assert.equal(event?.TIME_ZONE,'+00:00','QA_EXPIRY_EVENT_NOT_UTC');
 await db.transaction(async tx=>{
  await tx.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[account.id,account.email,hash]);
  await tx.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),account.id,'حساب تحقق مؤقت — قراءة فقط']);
  await tx.execute("INSERT INTO user_roles(id,user_id,role) VALUES(?,?,'admin')",[randomUUID(),account.id]);
  await appendCatalogAudit(tx,actor(),'admin.qa_created','temporary_admin_qa',account.id,null,{expires_at:account.expiresAt,event_name:account.eventName,scope:'read_only_browser_qa',original_admins_unchanged:true});
 });account.state='active';
}
export async function deleteQaAccount(db:CatalogDatabase,account:QaAccount):Promise<{deleted:true;sessions:number;auditRetained:number}>{
 ownedAccount(account);const [created]=await db.read("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='temporary_admin_qa' AND entity_id=? AND action='admin.qa_created'",[account.id]);
 assert.equal(Number(created.n),1,'QA_CREATION_AUDIT_REQUIRED');
 const [preferencesTable]=await db.read("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_preferences'");
 const [tasksTable]=await db.read("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_media_tasks'");
 if(Number(tasksTable.n)){const [tasks]=await db.read('SELECT COUNT(*) n FROM admin_media_tasks WHERE actor_id=?',[account.id]);assert.equal(Number(tasks.n),0,'QA_UNEXPECTED_MEDIA_TASK');}
 await db.transaction(async tx=>{
  const [user]=await tx.read('SELECT id,email FROM users WHERE id=? FOR UPDATE',[account.id]);if(user)assert.equal(user.email,account.email,'QA_IDENTITY_MISMATCH');
  await tx.execute('DELETE FROM admin_sessions WHERE user_id=?',[account.id]);
  await tx.execute('DELETE FROM admin_user_extensions WHERE user_id=?',[account.id]);
  if(Number(preferencesTable.n))await tx.execute('DELETE FROM admin_preferences WHERE user_id=?',[account.id]);
  await tx.execute('DELETE FROM user_roles WHERE user_id=?',[account.id]);
  await tx.execute('DELETE FROM profiles WHERE user_id=?',[account.id]);
  await tx.execute('DELETE FROM users WHERE id=? AND email=?',[account.id,account.email]);
  await appendCatalogAudit(tx,actor(),'admin.qa_deleted','temporary_admin_qa',account.id,{temporary_account:true},{account_deleted:true,sessions_deleted:true,history_retained:true});
 });
 await db.execute(`DROP EVENT IF EXISTS \`${account.eventName}\``);
 const [remaining]=await db.read('SELECT (SELECT COUNT(*) FROM users WHERE id=?) users,(SELECT COUNT(*) FROM admin_sessions WHERE user_id=?) sessions,(SELECT COUNT(*) FROM user_roles WHERE user_id=?) roles,(SELECT COUNT(*) FROM audit_logs WHERE entity_type=\'temporary_admin_qa\' AND entity_id=?) audit',[account.id,account.id,account.id,account.id]);
 assert.equal(Number(remaining.users)+Number(remaining.sessions)+Number(remaining.roles),0,'QA_DELETION_FAILED');assert.ok(Number(remaining.audit)>=2,'QA_AUDIT_NOT_RETAINED');account.state='deleted';
 return {deleted:true,sessions:Number(remaining.sessions),auditRetained:Number(remaining.audit)};
}
async function main(){
 const args=process.argv.slice(2),operation=args[0];assert.ok(['create','delete','verify'].includes(operation),'QA_OPERATION_REQUIRED');
 const production=args.includes('--confirm-production');assert.ok(args.includes('--apply')||operation==='verify','QA_APPLY_REQUIRED');
 const directory=join(process.env.LOCALAPPDATA!,'AyahX','private-backups');await mkdir(directory,{recursive:true});
 const file=join(directory,production?'batch5-production-qa.json':'batch5-local-qa.json');
 let account:QaAccount;
 if(operation==='create'){
  let old:QaAccount|undefined;try{old=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  assert.ok(!old||old.state==='deleted'||old.state==='prepared','QA_EXISTING_LIFECYCLE_REQUIRED');
  account=old?.state==='prepared'?old:prepareQaAccount(production?'production':'local');await writeFile(file,JSON.stringify(account),{mode:0o600});
 }else account=JSON.parse(await readFile(file,'utf8'));
 assert.equal(account.environment,production?'production':'local','QA_ENVIRONMENT_MISMATCH');
 if(production&&operation==='create'){
  const backup=JSON.parse(await readFile(join(directory,'batch5-preqa-backup-verified.json'),'utf8'));assert.equal(backup.restored_and_verified,true,'QA_VERIFIED_BACKUP_REQUIRED');assert.ok(Date.now()-Date.parse(backup.checked_at)<3600000,'QA_FRESH_BACKUP_REQUIRED');
 }
 const session=production?await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:operation!=='verify'}):null;
 const pool=!production?mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d2_batch5_qa_restored_v2_20261012',timezone:'Z',connectionLimit:1}):null;
 const format=(sql:string,params:unknown[])=>{const formatted=mysql.format(sql,params as Parameters<typeof mysql.format>[1]).trimEnd().replace(/;?$/u,';');return /^CREATE EVENT /u.test(formatted)?'DELIMITER $$\n'+formatted.slice(0,-1)+'$$\nDELIMITER ;':formatted;};
 const executor:CatalogTx=session?{read:async(sql,params=[])=>{
  const formatted=format(sql,params);
  const raw=/\sFOR UPDATE;$/u.test(formatted)?await session.readForUpdate(formatted):await session.read(formatted);
  // The audited CLI accepts only its own fixed query/result allowlist.
  return parseQaRows(sql,raw);
 },execute:async(sql,params=[])=>{await session.executeStatements([{sql:format(sql,params),rowCount:1}]);}}:catalogDatabaseFromPool(pool!);
 const db:CatalogDatabase=session?{...executor,transaction:async work=>{
  const lock=await executor.read("SELECT GET_LOCK('ayahx_audit_chain',10) acquired");assert.equal(Number(lock[0]?.acquired),1,'QA_AUDIT_LOCK_REQUIRED');await executor.execute('START TRANSACTION;');
  try{const result=await work(executor);await session.commit();return result;}catch(error){await executor.execute('ROLLBACK;');throw error;}finally{await executor.read("SELECT RELEASE_LOCK('ayahx_audit_chain') released");}
 }}:catalogDatabaseFromPool(pool!);
 try{
  if(operation!=='verify')await db.execute("SET time_zone='+00:00'");
  if(operation==='create')await createQaAccount(db,account);
  const result=operation==='delete'?await deleteQaAccount(db,account):operation==='verify'?await db.read('SELECT id,is_banned FROM users WHERE id=?',[account.id]):{active:true,expiresAt:account.expiresAt};
  await writeFile(file,JSON.stringify(account),{mode:0o600});
  const proof={operation,environment:account.environment,account_id:account.id,expires_at:account.expiresAt,result,credential_values_logged:false,checked_at:new Date().toISOString()};
  await writeFile(join(directory,'batch5-qa-'+operation+'-'+account.environment+'.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }finally{if(session)await session.close();if(pool)await pool.end();}
}
/** Fixed allowlist of result shapes; never logs raw rows or credentials. */
function parseQaRows(sql:string,raw:string){
 const columns=/GET_LOCK/u.test(sql)?['acquired']:/RELEASE_LOCK/u.test(sql)?['released']:/@@event_scheduler/u.test(sql)?['enabled']:/SELECT EVENT_DEFINITION/u.test(sql)?['EVENT_DEFINITION','expires']:/information_schema.EVENTS/u.test(sql)?['STATUS','TIME_ZONE']:/SELECT a.hash/u.test(sql)?['hash']:/COUNT\(\*\) n/u.test(sql)?['n']:/SELECT \(SELECT COUNT/u.test(sql)?['users','sessions','roles','audit']:/SELECT id,email/u.test(sql)?['id','email']:/SELECT id,is_banned/u.test(sql)?['id','is_banned']:/SELECT id FROM users/u.test(sql)?['id']:null;
 assert.ok(columns,'QA_SQL_RESULT_SHAPE_UNREGISTERED');return raw.trimEnd()?raw.trimEnd().split(/\r?\n/u).map(line=>Object.fromEntries(line.split('\t').map((value,index)=>[columns[index],value==='NULL'?null:value]))):[];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{const code=error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error?error.message:'';console.error(JSON.stringify({code:/^[A-Z0-9_:]+$/u.test(code)?code:'TEMPORARY_QA_OPERATION_FAILED',assertion:error?.name==='AssertionError'&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:null}));process.exitCode=1;});

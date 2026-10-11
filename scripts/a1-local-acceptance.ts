/** Opt-in destructive acceptance for a disposable local MySQL9.7.2 restore.
 * Root executes this; implementation alone does not claim database evidence.
 * No fixture credential or token is printed or written to disk.
 */
import { randomBytes,randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeFile,mkdir } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import mysql,{type Pool} from 'mysql2/promise';
import Redis from 'ioredis';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { createAdminApplicationRouter } from '../server/routes/admin/adminA1Endpoints';
import { adminEndpointInventory } from '../server/routes/admin/adminRouter';
import { ADMIN_ROLES,DEFAULT_ROLE_PERMISSIONS,type AdminRole } from '../server/admin/adminPermissions';
import { totp } from '../server/admin/adminTotp';
import { grantSuperAdmin } from './grant-super-admin';
import { RedisAdminRateGate } from '../server/admin/adminRateGate';
import type { CatalogDatabase,CatalogRow } from '../server/services/catalogContracts';
interface Fixture {id:string;role:AdminRole;email:string;password:string;cookie?:string;sessionId?:string}
type Result={name:string;passed:true;detail?:Record<string,unknown>};
type JsonResponse={status:number;body:Record<string,unknown>;cookie?:string;headers:Headers};
export async function createAdminAcceptanceFixtures(db:CatalogDatabase):Promise<Fixture[]> {
 const fixtures:Fixture[]=[];
 for(const role of ADMIN_ROLES){const id=randomUUID(),password=randomBytes(24).toString('base64url'),email=`a1-${id}@example.test`,passwordHash=await bcrypt.hash(password,10);
  await db.execute('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)',[id,email,passwordHash]);
  await db.execute('INSERT INTO profiles(id,user_id,display_name) VALUES(?,?,?)',[randomUUID(),id,'Local A1 acceptance']);
  await db.execute('INSERT INTO user_roles(id,user_id,role) VALUES(?,?,?)',[randomUUID(),id,role]);fixtures.push({id,role,email,password});
 }return fixtures;
}
/** Reusable real-HTTP checker; no production allow switch exists. */
export async function runAdminLocalAcceptance(pool:Pool,redis:Redis,env:NodeJS.ProcessEnv):Promise<Result[]> {
 const [versionRows]=await pool.query('SELECT VERSION() version,DATABASE() db');const version=(versionRows as CatalogRow[])[0];
 assert.match(String(version.version),/^9\.7\.2/,'REAL_MYSQL_9_7_2_REQUIRED');assert.match(String(version.db),/^ayahx_.*(?:verified|rehearsal|local|test|migration_final)/i,'DISPOSABLE_LOCAL_SCHEMA_REQUIRED');
 assert.equal(await redis.ping(),'PONG','REAL_REDIS_REQUIRED');
 const db=catalogDatabaseFromPool(pool),fixtures=await createAdminAcceptanceFixtures(db),results:Result[]=[],allowedWrites=new Set<string>();
 const rate=new RedisAdminRateGate(env),app=express();app.set('trust proxy','loopback');app.use(express.json());const router=createAdminApplicationRouter({db,env,rate,origins:['http://localhost']});app.use('/api/admin',router);
 const server:Server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/admin`;
 const check=(name:string,detail?:Record<string,unknown>)=>results.push({name,passed:true,detail});
 const data=(response:JsonResponse)=>response.body.data as Record<string,unknown>;
 async function request(path:string,method='GET',body?:unknown,fixture?:Fixture,origin:string|null='http://localhost'):Promise<JsonResponse>{
  const headers:Record<string,string>={'content-type':'application/json','x-forwarded-for':`127.0.0.${fixture?ADMIN_ROLES.indexOf(fixture.role)+2:1}`};if(origin!==null)headers.origin=origin;if(fixture?.cookie)headers.cookie=fixture.cookie;
  const response=await fetch(base+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body??{})});const cookie=response.headers.get('set-cookie')?.split(';')[0];return{status:response.status,body:await response.json() as Record<string,unknown>,cookie,headers:response.headers};
 }
 async function clearLocalRate(){let cursor='0';do{const[next,keys]=await redis.scan(cursor,'MATCH','ayahx:admin-rate:*','COUNT',100);cursor=next;if(keys.length)await redis.del(...keys);}while(cursor!=='0');}
 async function login(fixture:Fixture){await clearLocalRate();const response=await request('/auth/login','POST',{email:fixture.email,password:fixture.password},fixture);assert.equal(response.status,200);assert(response.cookie);fixture.cookie=response.cookie;fixture.sessionId=String(data(response).sessionId);assert(!JSON.stringify(response.body).includes('token'));return response;}
 async function auditCount(){const[row]=await db.read('SELECT COUNT(*) count FROM audit_logs');return Number(row.count);}
 async function write(path:string,method:string,body:unknown,fixture:Fixture){await clearLocalRate();const before=await auditCount(),response=await request(path,method,body,fixture);assert.equal(response.status,200,`${method} ${path}: ${response.body.code}`);assert.equal(await auditCount(),before+1,'ONE_IMMUTABLE_AUDIT_PER_MUTATION');const[audit]=await db.read('SELECT request_id,ip_address FROM audit_logs a LEFT JOIN (SELECT prev_hash FROM audit_logs) b ON b.prev_hash=a.hash WHERE b.prev_hash IS NULL');assert(audit.request_id);assert(audit.ip_address);const endpoint=adminEndpointInventory(router).find(item=>item.method.toUpperCase()===method&&new RegExp('^'+item.path.replace(/:[a-z]+/g,'[^/]+')+'$').test(path));assert(endpoint);allowedWrites.add(fixture.role+':'+endpoint.method+':'+endpoint.path);return response;}
 try{
  const endpoints=adminEndpointInventory(router);assert.equal(endpoints.length,21);
  for(const endpoint of endpoints){const path=endpoint.path.replace(/:[a-z]+/g,'missing');const response=await request(path,endpoint.method.toUpperCase(),{});assert.equal(response.status,401,`UNAUTH:${path}`);assert.equal(response.headers.get('cache-control'),'no-store');}check('all_unauthenticated_endpoints_401',{endpoints:endpoints.length});
  for(const fixture of fixtures)await login(fixture);check('seven_real_role_logins',{roles:fixtures.length});
  let denied=0,allowedReads=0;
  for(const fixture of fixtures){for(const endpoint of endpoints){await clearLocalRate();const allowed=DEFAULT_ROLE_PERMISSIONS[fixture.role].includes(endpoint.permission)&&(!endpoint.superAdminOnly||fixture.role==='super_admin'),path=endpoint.path.replace(/:slug/g,'moderator').replace(/:id/g,fixture.sessionId!).replace(/:key/g,'admin_idle_timeout_ms');
    if(!allowed){const response=await request(path,endpoint.method.toUpperCase(),{},fixture);assert.equal(response.status,403,`${fixture.role}:${path}`);assert.equal(response.body.code,'ADMIN_FORBIDDEN');denied++;}
    else if(endpoint.method==='get'){const response=await request(path,'GET',undefined,fixture);assert.equal(response.status,200,`${fixture.role}:${path}:${response.body.code}`);allowedReads++;}
   }}check('real_rbac_denied_and_allowed_reads',{roles:7,endpoints:endpoints.length,denied,allowedReads});
  const owner=fixtures[0],ordinary=fixtures[4];
  let response=await request('/settings/admin_idle_timeout_ms','PATCH',{value:1800000},owner,'https://untrusted.example');assert.equal(response.status,403);assert.equal(response.body.code,'ADMIN_ORIGIN_DENIED');response=await request('/settings/admin_idle_timeout_ms','PATCH',{value:1800000},owner,null);assert.equal(response.status,403);check('origin_rejects_foreign_and_missing');
  response=await request('/users?limit=101','GET',undefined,owner);assert.equal(response.status,422);response=await request('/settings/admin_idle_timeout_ms','PATCH',{value:1},owner);assert.equal(response.status,422);check('zod_validation_and_maximum_100');
  await write('/roles/moderator/permissions','PUT',{permissions:DEFAULT_ROLE_PERMISSIONS.moderator,confirmation:'moderator'},owner);
  await write(`/users/${ordinary.id}/roles`,'PUT',{roles:['support'],confirmation:ordinary.id},owner);
  await write('/settings/admin_idle_timeout_ms','PATCH',{value:1800000},owner);
  await write('/flags/quran_catalog_v2','PATCH',{value:false,confirmation:'quran_catalog_v2'},owner);check('role_user_setting_flag_mutations_audited');
  await write('/settings/admin_idle_timeout_ms','PATCH',{value:1800000},fixtures[1]);await write('/flags/quran_catalog_v2','PATCH',{value:false,confirmation:'quran_catalog_v2'},fixtures[1]);
  response=await request('/roles/super_admin/permissions','PUT',{permissions:['roles.manage'],confirmation:'super_admin'},owner);assert.equal(response.status,409);
  response=await request(`/users/${owner.id}/roles`,'PUT',{roles:['user'],confirmation:owner.id},owner);assert.equal(response.status,409);check('super_admin_access_cannot_be_reduced');
  const secretRows=await request('/settings','GET',undefined,owner);assert.equal(secretRows.status,200);for(const row of secretRows.body.data as CatalogRow[])if(row.isSecret){assert.equal(row.value,null);assert(!row.masked||row.masked==='••••••••');}check('secret_registry_never_returns_values');
  // Functional security acceptance for every role. Recovery factors avoid a
  // artificial wait for the next TOTP tick while exercising one-use hashes.
  for(const fixture of fixtures){await login(fixture);const second=await login({...fixture});const oldSession=String(data(second).sessionId);
   const enrollment=await write('/security/totp/enroll','POST',{},fixture);const secret=String(data(enrollment).secret);assert(String(data(enrollment).otpauthUri).startsWith('otpauth://totp/'));
   const usedEnrollmentCode=totp(secret),confirmation=await write('/security/totp/confirm','POST',{code:usedEnrollmentCode},fixture);const codes=data(confirmation).recoveryCodes as string[];assert.equal(codes.length,10);
   const[stored]=await db.read('SELECT two_factor_secret_encrypted,recovery_code_hashes FROM admin_user_extensions WHERE user_id=?',[fixture.id]);assert(!String(stored.two_factor_secret_encrypted).includes(secret));assert(!JSON.stringify(stored.recovery_code_hashes).includes(codes[0]));
   const[revoked]=await db.read('SELECT is_revoked FROM admin_sessions WHERE id=?',[oldSession]);assert.equal(Number(revoked.is_revoked),1);
   response=await request('/security/totp/recovery','POST',{code:usedEnrollmentCode},fixture);assert.equal(response.status,422,'USED_TOTP_REJECTED');
   const regenerated=await write('/security/totp/recovery','POST',{code:codes[0]},fixture),newCodes=data(regenerated).recoveryCodes as string[];
   response=await request('/security/totp/disable','POST',{code:codes[0]},fixture);assert.equal(response.status,422,'OLD_RECOVERY_REJECTED');
   await write('/security/totp/disable','POST',{code:newCodes[0]},fixture);await clearLocalRate();response=await request('/security/sessions','GET',undefined,fixture);assert.equal(response.status,200);
   await write(`/security/sessions/${fixture.sessionId}`,'DELETE',{},fixture);await login(fixture);await write('/auth/logout','POST',{},fixture);await login(fixture);
  }check('totp_enrollment_replay_recovery_disable_all_roles',{roles:fixtures.length});
  const expectedWrites=fixtures.flatMap(fixture=>endpoints.filter(endpoint=>endpoint.method!=='get'&&DEFAULT_ROLE_PERMISSIONS[fixture.role].includes(endpoint.permission)&&(!endpoint.superAdminOnly||fixture.role==='super_admin')).map(endpoint=>fixture.role+':'+endpoint.method+':'+endpoint.path));for(const key of expectedWrites)assert(allowedWrites.has(key),'ALLOWED_WRITE_RBAC_NOT_EXERCISED:'+key);check('all_allowed_role_write_endpoints_real_200_and_one_audit',{allowedWrites:allowedWrites.size});
  // A complete login cycle exercises actual persisted encryption/counters and
  // recovery hash consumption, rather than only owner-session setup actions.
  await login(owner);const provision=await write('/security/totp/enroll','POST',{},owner),loginSecret=String(data(provision).secret),usedConfirmationCode=totp(loginSecret);const confirmed=await write('/security/totp/confirm','POST',{code:usedConfirmationCode},owner),loginRecovery=data(confirmed).recoveryCodes as string[];await write('/auth/logout','POST',{},owner);await clearLocalRate();
  response=await request('/auth/login','POST',{email:owner.email,password:owner.password},owner);assert.equal(response.status,401);assert.equal(response.body.code,'ADMIN_TOTP_REQUIRED');
  response=await request('/auth/login','POST',{email:owner.email,password:owner.password,code:usedConfirmationCode},owner);assert.equal(response.status,401,'CONFIRMATION_TOTP_REPLAY_LOGIN_REJECTED');
  response=await request('/auth/login','POST',{email:owner.email,password:owner.password,code:loginRecovery[0]},owner);assert.equal(response.status,200);assert(response.cookie);owner.cookie=response.cookie;owner.sessionId=String(data(response).sessionId);await clearLocalRate();
  response=await request('/auth/login','POST',{email:owner.email,password:owner.password,code:loginRecovery[0]},owner);assert.equal(response.status,401,'CONSUMED_RECOVERY_LOGIN_REJECTED');
  // Wait for a real next TOTP window; never manufacture a reusable counter.
  const waitMs=30000-Date.now()%30000+50;await delay(waitMs);await clearLocalRate();
  const usedLoginCode=totp(loginSecret);response=await request('/auth/login','POST',{email:owner.email,password:owner.password,code:usedLoginCode},owner);assert.equal(response.status,200);assert(response.cookie);owner.cookie=response.cookie;owner.sessionId=String(data(response).sessionId);
  response=await request('/auth/login','POST',{email:owner.email,password:owner.password,code:usedLoginCode},owner);assert.equal(response.status,401,'LOGIN_TOTP_REPLAY_REJECTED');await write('/security/totp/disable','POST',{code:loginRecovery[1]},owner);check('real_totp_and_recovery_login_with_replay_rejection',{actualNextWindowWaitMs:waitMs});
  await login(owner);await clearLocalRate();for(let i=0;i<60;i++){response=await request('/auth/me','GET',undefined,owner);assert.equal(response.status,200);}response=await request('/auth/me','GET',undefined,owner);assert.equal(response.status,429);assert.equal(response.body.code,'ADMIN_RATE_LIMITED');check('real_redis_read_rate_60_per_minute');
  await clearLocalRate();const locked=fixtures[3];for(let i=0;i<5;i++){response=await request('/auth/login','POST',{email:locked.email,password:'incorrect-password'},locked);assert.equal(response.status,401);}response=await request('/auth/login','POST',{email:locked.email,password:locked.password},locked);assert.equal(response.status,429);assert.equal(response.body.code,'ADMIN_LOGIN_LOCKED');check('five_failed_logins_lock_account');
  await login(owner);await write(`/security/sessions/${owner.sessionId}`,'DELETE',{},owner);response=await request('/auth/me','GET',undefined,owner);assert.equal(response.status,401);check('revoked_cookie_is_rejected');
  await login(owner);await db.execute('UPDATE admin_sessions SET last_active_at=UTC_TIMESTAMP()-INTERVAL 31 MINUTE WHERE id=?',[owner.sessionId]);response=await request('/auth/me','GET',undefined,owner);assert.equal(response.status,401);check('idle_timeout_real_stored_session');
  await login(owner);await write('/auth/logout','POST',{},owner);response=await request('/auth/me','GET',undefined,owner);assert.equal(response.status,401);check('logout_revokes_real_session');
  const [tail]=await db.read('SELECT a.id FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert(tail);
  for(const sql of ['UPDATE audit_logs SET action=action WHERE id=?','DELETE FROM audit_logs WHERE id=?']){await assert.rejects(db.execute(sql,[tail.id]),error=>error instanceof Error&&error.message.includes('AUDIT_LOG_IMMUTABLE'));}check('audit_update_delete_triggers_reject_real_sql');
  const emergency=fixtures[5],dry=await grantSuperAdmin(db,emergency.id);assert.equal(dry.action,'would_grant');const before=await auditCount();await grantSuperAdmin(db,emergency.id,true);assert.equal(await auditCount(),before+1);const roles=await db.read('SELECT role FROM user_roles WHERE user_id=?',[emergency.id]);assert(roles.some(row=>row.role==='super_admin'));assert(roles.some(row=>row.role==='finance'));check('emergency_grant_preserves_existing_roles_and_audits');
  const [chain]=await db.read('SELECT COUNT(*) count FROM audit_logs a LEFT JOIN audit_logs b ON b.hash=a.prev_hash WHERE a.prev_hash<>REPEAT(\'0\',64) AND b.id IS NULL');assert.equal(Number(chain.count),0);check('audit_chain_has_no_missing_predecessor');
  return results;
 }finally{await rate.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
async function main(){
 if(!process.argv.includes('--local-rehearsal'))throw new Error('LOCAL_REHEARSAL_OPT_IN_REQUIRED');
 const host=process.env.A1_TEST_DB_HOST??'127.0.0.1',port=Number(process.env.A1_TEST_DB_PORT??33319),database=process.env.A1_TEST_DB_NAME??'ayahx_d2_a1_verified_20261011',redisUrl=process.env.A1_TEST_REDIS_URL??'redis://127.0.0.1:6380';
 assert(['127.0.0.1','localhost','::1'].includes(host));assert(['127.0.0.1','localhost','[::1]'].includes(new URL(redisUrl).hostname));
 const pool=mysql.createPool({host,port,database,user:'root',password:process.env.A1_TEST_DB_PASSWORD??'',connectionLimit:3,dateStrings:true});const redis=new Redis(redisUrl,{maxRetriesPerRequest:1});
 const env:NodeJS.ProcessEnv={NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),ADMIN_2FA_ENC_KEY:randomBytes(32).toString('hex'),REDIS_URL:redisUrl,STORAGE_VOLUME_BYTES:'5000000000'};
 try{const results=await runAdminLocalAcceptance(pool,redis,env),report={scope:'local-rehearsal',observedAt:new Date().toISOString(),passed:results.length,results};const output=JSON.stringify(report,null,2),index=process.argv.indexOf('--report');if(index>=0){assert(process.argv[index+1],'REPORT_PATH_REQUIRED');const path=resolve(process.argv[index+1]);await mkdir(dirname(path),{recursive:true});await writeFile(path,output+'\n','utf8');}console.log(output);}finally{await pool.end();redis.disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message.replace(/a1-[a-f0-9-]+@example\.test/g,'[fixture]'):'LOCAL_ACCEPTANCE_FAILED');process.exitCode=1;});

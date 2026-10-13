/** Real MySQL expiry/deletion acceptance; local restored database only. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {prepareQaAccount,createQaAccount,deleteQaAccount} from './temporary-admin-qa';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {AdminAccessService} from '../server/admin/adminAccessService';
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d2_batch5_qa_restored_v2_20261012',timezone:'Z',connectionLimit:1});
// Provisioning requires at least 120 seconds on MySQL's UTC clock. Give the
// actual expiry event five seconds of setup margin; never fake its clock.
const db=catalogDatabaseFromPool(pool),account=prepareQaAccount('local',125000),nearExpiry=prepareQaAccount('local',15000),proof:Record<string,unknown>={passed:false,local_only:true};
try{
 const [version]=await db.read('SELECT VERSION() version');assert.equal(version.version,'9.7.2');await db.execute("SET time_zone='+00:00'");
 const before=await db.read('SELECT u.id,u.password_hash,u.email,r.role FROM users u JOIN user_roles r ON r.user_id=u.id ORDER BY u.id,r.role');
 await assert.rejects(()=>createQaAccount(db,nearExpiry),/QA_PROVISIONING_WINDOW_REQUIRED/u);
 const [negative]=await db.read('SELECT (SELECT COUNT(*) FROM users WHERE id=?) users,(SELECT COUNT(*) FROM user_roles WHERE user_id=?) roles,(SELECT COUNT(*) FROM admin_sessions WHERE user_id=?) sessions,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE() AND EVENT_NAME=?) events',[nearExpiry.id,nearExpiry.id,nearExpiry.id,nearExpiry.eventName]);
 assert.equal(Number(negative.users)+Number(negative.roles)+Number(negative.sessions)+Number(negative.events),0,'NEAR_EXPIRY_QA_CREATED');
 assert.deepEqual(await db.read('SELECT u.id,u.password_hash,u.email,r.role FROM users u JOIN user_roles r ON r.user_id=u.id ORDER BY u.id,r.role'),before,'NEAR_EXPIRY_OWNER_ACCOUNTS_CHANGED');
 Object.assign(proof,{near_expiry_rejected:true,near_expiry_user_roles_sessions_events_zero:true,minimum_provisioning_ms:120000});
 await createQaAccount(db,account);
 const access=new AdminAccessService(db,{NODE_ENV:'test',JWT_SECRET:'local-qa-acceptance-only-not-production'});assert.deepEqual((await access.identityForUser(account.id)).roles,['admin']);
 await db.execute("INSERT INTO admin_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))",[randomUUID(),account.id,'0'.repeat(64)]);
 let expired=false;const deadline=Date.now()+135000;
 while(Date.now()<deadline){const [user]=await db.read('SELECT is_banned FROM users WHERE id=?',[account.id]);if(Number(user?.is_banned)===1){expired=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.equal(expired,true,'REAL_EVENT_DID_NOT_EXPIRE');
 await assert.rejects(()=>access.identityForUser(account.id),/ADMIN_FORBIDDEN/u);
 const [sessions]=await db.read('SELECT COUNT(*) n FROM admin_sessions WHERE user_id=?',[account.id]);assert.equal(Number(sessions.n),0);
 Object.assign(proof,{automatic_expiry:true,account_disabled:true,sessions_removed:true,identity_rejected:true,ttl_ms:125000});
 const deletion=await deleteQaAccount(db,account);assert.equal(deletion.deleted,true);
 assert.deepEqual(await db.read('SELECT u.id,u.password_hash,u.email,r.role FROM users u JOIN user_roles r ON r.user_id=u.id ORDER BY u.id,r.role'),before,'ORIGINAL_ACCOUNTS_CHANGED');
 Object.assign(proof,{passed:true,deletion,original_accounts_unchanged:true});
}finally{await pool.end();await writeFile('docs/data/admin-qa-lifecycle-local.json',JSON.stringify({...proof,checked_at:new Date().toISOString()},null,2)+'\n');}
console.log(JSON.stringify(proof));

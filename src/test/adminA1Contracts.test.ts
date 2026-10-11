// @vitest-environment node
import { describe,it,expect } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createAdminApplicationRouter } from '../../server/routes/admin/adminA1Endpoints';
import { adminEndpointInventory } from '../../server/routes/admin/adminRouter';
import { ADMIN_ROLES,DEFAULT_ROLE_PERMISSIONS,type AdminRole } from '../../server/admin/adminPermissions';
import { AdminAccessService } from '../../server/admin/adminAccessService';
import { AdminSettingsService,ADMIN_SETTINGS } from '../../server/admin/adminSettingsRegistry';
import { redactAdminAudit,AdminAuditService } from '../../server/admin/adminAuditService';
import { publicRole } from '../../server/admin/adminPublicRole';
import { AdminRoleService } from '../../server/admin/adminRoleService';
import { grantSuperAdmin } from '../../scripts/grant-super-admin';
import type { CatalogDatabase } from '../../server/services/catalogContracts';
import type { AdminRequestContext } from '../../server/admin/adminContracts';
const forbiddenDb:CatalogDatabase={read:async()=>{throw new Error('UNEXPECTED_DB_CALL');},execute:async()=>{throw new Error('UNEXPECTED_DB_WRITE');},transaction:async()=>{throw new Error('UNEXPECTED_TRANSACTION');}};
const ctx=(role:AdminRole):AdminRequestContext=>({user:{id:'fixture',email:'fixture@example.test',displayName:'fixture',roles:[role],permissions:[...DEFAULT_ROLE_PERMISSIONS[role]]},actor:{id:'fixture',kind:'human',permissions:new Set(DEFAULT_ROLE_PERMISSIONS[role]),requestId:'fixture-request'},sessionId:'fixture-session',params:{},body:{},query:{},requestId:'fixture-request',ip:'127.0.0.1'});
describe('A1 endpoint contracts',()=>{
 it('has 21 finite registrations and every mutation declares audit',()=>{const inventory=adminEndpointInventory(createAdminApplicationRouter({db:forbiddenDb}));expect(inventory).toHaveLength(21);expect(inventory.filter(row=>row.method!=='get').every(row=>row.writes)).toBe(true);for(const row of inventory)expect(ADMIN_ROLES.some(role=>DEFAULT_ROLE_PERMISSIONS[role].includes(row.permission))).toBe(true);});
 it('rejects unauthenticated requests before payload or database checks for every endpoint',async()=>{
  const app=express();app.use(express.json());const router=createAdminApplicationRouter({db:forbiddenDb});app.use('/api/admin',router);
  const server:Server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try{const address=server.address();if(!address||typeof address==='string')throw new Error('PORT');for(const row of adminEndpointInventory(router)){const path=row.path.replace(/:slug/g,'admin').replace(/:id/g,'missing').replace(/:key/g,'missing');const response=await fetch(`http://127.0.0.1:${address.port}/api/admin${path}`,{method:row.method.toUpperCase(),headers:{'content-type':'application/json'},body:row.method==='get'?undefined:'{}'});expect(response.status,row.path).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json()).code).toBe('ADMIN_UNAUTHENTICATED');}}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
 it.each(ADMIN_ROLES)('rejects denied endpoints for %s before validators/handlers',async role=>{
  const access=new AdminAccessService(forbiddenDb);access.authenticate=async()=>({...ctx(role),enrollmentRequired:false});
  const app=express();app.use(express.json());const router=createAdminApplicationRouter({db:forbiddenDb,access,rate:{check:async()=>{}},origins:['http://localhost']});app.use('/api/admin',router);
  const server:Server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try{const address=server.address();if(!address||typeof address==='string')throw new Error('PORT');for(const row of adminEndpointInventory(router)){if(DEFAULT_ROLE_PERMISSIONS[role].includes(row.permission)&&(!row.superAdminOnly||role==='super_admin'))continue;const path=row.path.replace(/:[a-z]+/g,'missing');const response=await fetch(`http://127.0.0.1:${address.port}/api/admin${path}`,{method:row.method.toUpperCase(),headers:{cookie:'ayahx_admin_session=fixture',origin:'http://localhost','content-type':'application/json'},body:row.method==='get'?undefined:'{}'});expect(response.status,row.path).toBe(403);expect((await response.json()).code).toBe('ADMIN_FORBIDDEN');}}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
 it('keeps upgraded administrator public owner permissions independent of row order',()=>{expect(publicRole(['user','super_admin'])).toBe('admin');expect(publicRole(['user','moderator'])).toBe('moderator');expect(publicRole(['finance'])).toBe('user');});
 it('masks secrets and marks unconsumed historic settings read-only',async()=>{
  const db={...forbiddenDb,read:async()=>[{key_name:'OPENROUTER_API_KEY',value_text:'sensitive-value',is_secret:1,category:'ai'},{key_name:'REELS_DEFAULT_FPS',value_text:'30',is_secret:0,category:'render'},{key_name:'OLD_TOKEN',value_text:'historic-sensitive-value',is_secret:0,category:'legacy'}]};
  const settings=await new AdminSettingsService(db,{}).list();expect(JSON.stringify(settings)).not.toContain('sensitive-value');expect(settings.find(row=>row.key==='OPENROUTER_API_KEY')).toMatchObject({value:null,isSet:true,masked:'••••••••'});expect(settings.find(row=>row.key==='REELS_DEFAULT_FPS')).toMatchObject({readOnly:true,diagnostic:'NO_RUNTIME_CONSUMER',consumer:[]});
 });
 it('registers real consumers only for mutable settings',()=>{expect(ADMIN_SETTINGS.every(def=>def.readOnly||def.consumer.length>0)).toBe(true);});
 it('refuses flags without launch permission and explicit confirmation before writes',async()=>{const service=new AdminSettingsService(forbiddenDb),context=ctx('analyst');context.params.key='quran_catalog_v2';context.body={value:true,confirmation:'quran_catalog_v2'};await expect(service.update(context,true)).rejects.toMatchObject({code:'ADMIN_FORBIDDEN'});const admin=ctx('super_admin');admin.params.key='quran_catalog_v2';admin.body={value:true,confirmation:'wrong'};await expect(service.update(admin,true)).rejects.toMatchObject({code:'ADMIN_CONFIRMATION_REQUIRED'});});
 it('never allows reduction of super-admin matrix',async()=>{const context=ctx('super_admin');context.params.slug='super_admin';context.body={permissions:['roles.manage'],confirmation:'super_admin'};await expect(new AdminRoleService(forbiddenDb).update(context)).rejects.toMatchObject({code:'ADMIN_SUPER_ADMIN_PROTECTED'});});
 it('redacts nested credentials and signed capabilities',()=>{expect(redactAdminAudit({password:'secret',nested:{api_key:'secret'},url:'https://x.test/audio?X-Amz-Signature=abc'})).toEqual({password:'[REDACTED]',nested:{api_key:'[REDACTED]'},url:'[REDACTED_URL]'});});
 it('redacts historic secret-setting value_text in audit',async()=>{let reads=0;const db={...forbiddenDb,read:async()=>++reads===1?[{total:1}]:[{entity_type:'system_setting',entity_id:'OPENROUTER_API_KEY',old_values:'{"value_text":"historic-secret"}',new_values:'{"value_text":"new-secret"}'}]};expect(JSON.stringify(await new AdminAuditService(db).list({page:1,limit:25}))).not.toContain('secret');});
 it('emergency command defaults to dry-run without touching password/profile or roles',async()=>{const sql:string[]=[];const db={...forbiddenDb,read:async(statement:string)=>{sql.push(statement);return statement.includes('FROM users')?[{id:'owner'}]:[{role:'user'}];}};expect(await grantSuperAdmin(db,'owner')).toMatchObject({action:'would_grant'});expect(sql.every(statement=>statement.startsWith('SELECT'))).toBe(true);expect(sql.join(' ')).not.toMatch(/password|profiles/);});
});

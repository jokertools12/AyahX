/** Root only. Real HTTP sessions, MySQL9.7.2 and Redis; disposable restore only. */
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,randomInt } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import express from 'express';
import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import { config } from '../server/config';
import { createAdminAcceptanceFixtures } from './a1-local-acceptance';
import { createAdminApplicationRouter } from '../server/routes/admin/adminA1Endpoints';
import { registerRenderLabEndpoints } from '../server/routes/admin/adminRenderLab';
import { RenderLabService } from '../server/services/renderLabService';
import { CatalogRenderManifestService } from '../server/services/catalogRenderManifest';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { RedisAdminRateGate } from '../server/admin/adminRateGate';
import { enqueueRenderJob,closeRenderQueue,getRenderQueue } from '../server/services/renderQueueBroker';
const option=(name:string)=>{const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
assert.ok(process.argv.includes('--local-rehearsal'));
const schema=process.env.AYAHX_D7_LOCAL_SCHEMA??'ayahx_d2_d7_restored_20261011';assert.match(schema,/^ayahx_d2_d7_restored_\d{8}$/u);
const redisUrl='redis://127.0.0.1:6380/14';config.queue.redisUrl=redisUrl;
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database:schema,connectionLimit:3,dateStrings:true});
const db=catalogDatabaseFromPool(pool),redis=new Redis(redisUrl,{maxRetriesPerRequest:1});
const env:NodeJS.ProcessEnv={NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex'),ADMIN_2FA_ENC_KEY:randomBytes(32).toString('hex'),REDIS_URL:redisUrl};
const rate=new RedisAdminRateGate(env),builder=new CatalogRenderManifestService({db,source:new CatalogAudioSource()});
const lab=new RenderLabService(db,builder,id=>enqueueRenderJob(id,'skia_canvas',0,{attempts:1}));
const app=express();app.set('trust proxy','loopback');app.use('/api/admin',createAdminApplicationRouter({db,env,rate,origins:['http://localhost'],register:register=>registerRenderLabEndpoints(register,lab)}));
const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/admin`;
const results:Array<{name:string;passed:true;detail?:unknown}>=[];
const matrix=JSON.parse(await readFile(option('--matrix'),'utf8'));
const requestBody=matrix.cases.find((item:{id:string})=>item.id==='mp3quran-short-complete').request;
const check=(name:string,detail?:unknown)=>results.push({name,passed:true,detail});
const countAudit=async()=>Number((await db.read('SELECT COUNT(*) count FROM audit_logs'))[0].count);
const fixtureJobs:string[]=[];
const testIp=`127.0.${randomInt(2,250)}.${randomInt(2,250)}`;
try{
 assert.equal(await redis.ping(),'PONG');assert.equal((await db.read('SELECT VERSION() version'))[0].version,'9.7.2');
 const fixtures=await createAdminAcceptanceFixtures(db);
 async function request(path:string,method='GET',body?:unknown,cookie?:string,origin:string|null='http://localhost'){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-forwarded-for':testIp,...(origin?{origin}:{}),...(cookie?{cookie}:{})},body:method==='GET'?undefined:JSON.stringify(body??{})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const unauth=await request('/render-lab/jobs','POST',requestBody);assert.equal(unauth.status,401);check('unauthenticated_401');
 for(const fixture of fixtures){const login=await request('/auth/login','POST',{email:fixture.email,password:fixture.password});assert.equal(login.status,200);assert.ok(login.cookie);fixture.cookie=login.cookie;}
 for(const fixture of fixtures){
  const allowed=['super_admin','admin'].includes(fixture.role),before=await countAudit();
  const created=await request('/render-lab/jobs','POST',requestBody,fixture.cookie);
  assert.equal(created.status,allowed?202:403,fixture.role+':'+created.body.code);
  if(allowed){
   assert.equal(await countAudit(),before+1);const id=String(created.body.data.id);fixtureJobs.push(id);
   const queued=await getRenderQueue('skia_canvas').getJob('render-'+id);assert.ok(queued);assert.equal(queued.opts.attempts,1);assert.equal(await queued.getState(),'waiting');
   const status=await request('/render-lab/jobs/'+id,'GET',undefined,fixture.cookie);assert.equal(status.status,200);assert.equal(status.body.data.status,'queued');
   assert.equal('manifest' in status.body.data,false);assert.equal('output_path' in status.body.data,false);
   const busy=await request('/render-lab/jobs','POST',requestBody,fixture.cookie);assert.equal(busy.status,409);assert.equal(busy.body.code,'RENDER_LAB_BUSY');assert.equal(await countAudit(),before+1);
   await queued.remove();await db.execute("UPDATE render_jobs SET status='cancelled',active_user_id=NULL,enqueue_state='cancelled',completed_at=UTC_TIMESTAMP() WHERE id=? AND status='queued'",[id]);
  }else assert.equal(await countAudit(),before);
  check('rbac_'+fixture.role,{expected:allowed?202:403});
 }
 const owner=fixtures[0];
 for(const origin of [null,'https://untrusted.example']){const response=await request('/render-lab/jobs','POST',requestBody,owner.cookie,origin);assert.equal(response.status,403);assert.equal(response.body.code,'ADMIN_ORIGIN_DENIED');}check('missing_and_foreign_origin_403');
 for(const injected of [{audioUrl:'http://127.0.0.1/private'},{timingMap:{words:[]}}, {audioPlan:{parts:[]}}]){const response=await request('/render-lab/jobs','POST',{...requestBody,...injected},owner.cookie);assert.equal(response.status,422);}check('client_audio_timing_and_plan_rejected_before_fetch');
 const analyst=fixtures[6],grantId=randomUUID();
 await db.execute("INSERT INTO admin_permissions(id,role_slug,resource,action,permission_key) VALUES(?,'analyst','render','test','render.test')",[grantId]);
 try{const denied=await request('/render-lab/jobs','POST',requestBody,analyst.cookie);assert.equal(denied.status,403);check('hard_role_boundary_even_with_accidental_grant');}finally{await db.execute('DELETE FROM admin_permissions WHERE id=?',[grantId]);}
 const queue=getRenderQueue('skia_canvas');assert.equal(await queue.getWaitingCount(),0);check('only_owned_test_queue_entries_removed');
 let rateDenied=false;
 for(let attempt=0;attempt<35;attempt++){
  const response=await request('/render-lab/jobs','POST',{},owner.cookie);
  if(response.status===429){assert.equal(response.body.code,'ADMIN_RATE_LIMITED');rateDenied=true;break;}
  assert.equal(response.status,422);
 }
 assert.equal(rateDenied,true);check('render_lab_write_rate_enforced_by_real_redis');
 const proof={checked_at:new Date().toISOString(),passed:true,mysql:'9.7.2',redis:'real_6380_db14',http:'real_express_sessions',results,fixture_jobs:fixtureJobs,production_writes:0};
 await writeFile('docs/data/d7-render-lab-rbac-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,checks:results.length,roles:7,real_queue_jobs:fixtureJobs.length,production_writes:0}));
}finally{await rate.close();await closeRenderQueue();redis.disconnect();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();}

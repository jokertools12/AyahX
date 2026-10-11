/** ROOT ONLY: smoke the actual server entry point on a disposable local restore. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const schema='ayahx_d2_a1_migration_final_20261011';
const privateDir=join(process.env.LOCALAPPDATA,'AyahX/private-backups');
const secret=JSON.parse(await readFile(join(privateDir,'a1-local-admin-runtime.json'),'utf8'));
const child=spawn(process.execPath,['--import','tsx','--import','data:text/javascript,process.on("message",m=>{if(m==="local-smoke-shutdown")process.emit("SIGTERM")})','server/index.ts'],{env:{...process.env,NODE_ENV:'production',PORT:'3002',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'33319',MYSQL_USER:'root',MYSQL_PASSWORD:'',MYSQL_DATABASE:schema,MYSQL_POOL_SIZE:'3',JWT_SECRET:secret.jwt,ADMIN_2FA_ENC_KEY:secret.totp,REDIS_URL:'redis://127.0.0.1:6380/12',CORS_ORIGIN:'http://localhost:3002',STORAGE_VOLUME_BYTES:'5000000000',RENDER_QUEUE_DRIVER:'bullmq',RENDER_BACKGROUND_MAINTENANCE:'false',RAILWAY_AUTOSCALER_ENABLED:'false',OBJECT_STORAGE_DRIVER:'local',OPENROUTER_API_KEY:'',GEMINI_API_KEY:'',OPENAI_API_KEY:'',LOVABLE_API_KEY:''},stdio:['ignore','pipe','pipe','ipc']});
let logs='',exit;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);const closed=new Promise(resolve=>child.once('close',code=>{exit=code;resolve();}));
const checks=[];
try{
 let ready=false;for(let n=0;n<60;n++){try{const res=await fetch('http://localhost:3002/api/health/ready');if(res.status===200){ready=true;break;}}catch{/* Startup wait only; final assertion fails if never ready. */}if(exit!==undefined)break;await delay(500);}assert(ready,'ACTUAL_ENTRYPOINT_READY_REQUIRED');
 for(const path of ['/api/health','/api/health/ready']){const res=await fetch('http://localhost:3002'+path);assert.equal(res.status,200);checks.push({path,status:res.status});}
 for(const path of ['/api/admin/auth/me','/api/admin/catalog/reciters','/api/admin/not-a-route','/API/ADMIN/catalog/reciters']){const res=await fetch('http://localhost:3002'+path);assert.equal(res.status,401);assert.equal(res.headers.get('cache-control'),'no-store');const body=await res.json();assert.equal(body.code,'ADMIN_UNAUTHENTICATED');checks.push({path,status:res.status,code:body.code});}
 const unauth=await fetch('http://localhost:3002/api/admin/catalog/reciters/not-an-id/profile',{method:'PATCH',headers:{origin:'http://localhost:3002','content-type':'application/json'},body:'{'});assert.equal(unauth.status,401);checks.push({name:'authentication_before_malformed_json',status:unauth.status});
 const foreign=await fetch('http://localhost:3002/api/admin/auth/login',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{'});assert.equal(foreign.status,403);checks.push({name:'origin_before_login_parser',status:foreign.status});
 const malformed=await fetch('http://localhost:3002/api/admin/auth/login',{method:'POST',headers:{origin:'http://localhost:3002','content-type':'application/json'},body:'{'});assert.equal(malformed.status,422);checks.push({name:'sanitized_login_parse_failure',status:malformed.status});
 const page=await fetch('http://localhost:3002/admin/reciters');assert.equal(page.status,200);assert((await page.text()).includes('id="root"'));checks.push({name:'actual_static_admin_spa',status:200});
}finally{
 child.send('local-smoke-shutdown');await Promise.race([closed,delay(15000)]);if(exit===undefined){child.kill('SIGKILL');await closed;}
 await writeFile(join(privateDir,'a1-actual-server-local.log'),logs,{mode:0o600});
}
assert.equal(exit,0,'GRACEFUL_SHUTDOWN_REQUIRED');
const report={observed_at:new Date().toISOString(),local_only:true,entrypoint:'server/index.ts',mysql:'9.7.2',redis:'real local isolated DB12',catalog_flag:'off',checks,graceful_exit:exit,shutdown_method:'actual SIGTERM handler dispatched over local IPC on Windows',raw_logs_private:true,passed:true};await writeFile('docs/data/a1-actual-server-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

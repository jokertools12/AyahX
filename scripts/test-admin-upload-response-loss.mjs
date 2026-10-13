/** Root-only real transport failure; mutations are confined to tagged local clones. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {Queue} from 'bullmq';
import {chromium} from '../tooling/e2e/node_modules/playwright-core/index.mjs';
import {assertPrivatePath,validateHumanManifest,allowedHumanApplicationWrite} from '../tooling/e2e/helpers/adminHumanAcceptance.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error('PRIVATE_OPTION_REQUIRED');return assertPrivatePath(args[i+1]);};
const manifest=validateHumanManifest(JSON.parse(await readFile(option('--manifest'),'utf8'))),out=option('--out');
if(!manifest.prepared||manifest.cleaned||!/^ayahx_d2_batch5_.*restored.*$/u.test(manifest.schema))throw new Error('OWNED_ACTIVE_RESTORED_FIXTURE_REQUIRED');
await mkdir(dirname(out),{recursive:true,mode:0o700});
const auth=JSON.parse(await readFile(manifest.authFile,'utf8')),base=manifest.baseUrl,target=manifest.targets.youtube;
const report={version:1,local_only:true,synthetic_audio:'owned_white_noise',youtube_extracted:false,production_writes:false,started_at:new Date().toISOString(),passed:false,puts:0,prepares:0,parts:0,resumes:0,finishes:0,blocked:[],api_errors:[]};
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:manifest.schema,timezone:'Z'});
let queue,paused=false,browser,context,page,storageId=null,firstTaskId=null,resumedTaskId=null,lossCommitted=false,resumeCompleted=false;
const check=(condition,code)=>{if(!condition)throw new Error(code);};
try{
 const [identity]=await db.query('SELECT VERSION() version,@@hostname hostname,@@server_uuid uuid');
 check(identity[0].version==='9.7.2'&&String(identity[0].hostname).toLowerCase()===hostname().toLowerCase()&&identity[0].uuid===manifest.serverUuid,'LOCAL_MYSQL_IDENTITY_REQUIRED');
 const [users]=await db.execute('SELECT email FROM users WHERE id=?',[manifest.owned.userId]);
 check(users.length===1&&users[0].email===manifest.runTag+'@example.test'&&!manifest.original.users.includes(manifest.owned.userId),'OWNED_ACTOR_REQUIRED');
 queue=new Queue('ayahx-admin-media-v1',{connection:{host:'127.0.0.1',port:6380,db:13,maxRetriesPerRequest:null}});
 check(await queue.getActiveCount()===0&&await queue.getWaitingCount()===0&&await queue.getDelayedCount()===0,'EMPTY_ISOLATED_MEDIA_QUEUE_REQUIRED');
 await queue.pause();paused=true;report.real_media_queue_paused_for_transport_test=true;
 const bytes=await readFile(target.audioFile);check(createHash('sha256').update(bytes).digest('hex')===target.sha256,'OWNED_FILE_SHA_REQUIRED');
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1366,height:768},locale:'ar-EG'});page=await context.newPage();
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();let body;
  try{body=request.postDataJSON();}catch{/* A malformed body grants no capability. */}
  if(url.origin===base){
   if(!storageId&&method==='POST'&&/^\/api\/admin\/storage\/uploads\/[^/]+\/(?:parts|finish|resume)$/u.test(url.pathname)){for(let attempt=0;attempt<100&&!storageId;attempt++)await new Promise(resolve=>setTimeout(resolve,20));}
   const lifecycle=storageId&&['parts','finish','resume'].some(action=>url.pathname===`/api/admin/storage/uploads/${storageId}/${action}`)&&method==='POST';
   if(!['GET','HEAD','OPTIONS'].includes(method)&&!lifecycle&&!allowedHumanApplicationWrite(method,url.pathname,manifest,body)){report.blocked.push({method,path:url.pathname});return route.abort();}
   if(url.pathname==='/api/admin/storage/uploads'&&method==='POST')report.prepares++;
   if(lifecycle&&url.pathname.endsWith('/parts'))report.parts++;
   if(lifecycle&&url.pathname.endsWith('/resume'))report.resumes++;
   if(lifecycle&&url.pathname.endsWith('/finish')){
    report.finishes++;
    if(!lossCommitted){
     // The original real HTTP request reaches MySQL/R2/Redis. Only its
     // successful response is lost; no fabricated response is supplied.
     const upstream=await route.fetch();check(upstream.ok(),'REAL_COMPLETION_REJECTED');
     const json=await upstream.json();firstTaskId=json.data?.verification_task_id;check(typeof firstTaskId==='string','REAL_VERIFICATION_INTENT_REQUIRED');
     lossCommitted=true;return route.abort('failed');
    }
   }
  }else if(['http:','https:'].includes(url.protocol)){
   const read=['GET','HEAD','OPTIONS'].includes(method)&&manifest.allowedReadOrigins?.includes(url.origin);
   const put=method==='PUT'&&manifest.allowedUploadOrigins?.includes(url.origin);
   if(!read&&!put){report.blocked.push({method,origin:url.origin});return route.abort();}
   if(put)report.puts++;
  }
  return route.continue();
 });
 context.on('response',async response=>{
  const url=new URL(response.url());if(url.origin!==base)return;
  if(url.pathname.startsWith('/api/')&&response.status()>=400)report.api_errors.push({path:url.pathname,status:response.status()});
  if(response.request().method()!=='POST'||!response.ok())return;
  if(url.pathname==='/api/admin/storage/uploads'){const json=await response.json();storageId=json.data?.storageObjectId;}
  if(storageId&&url.pathname===`/api/admin/storage/uploads/${storageId}/resume`){const json=await response.json();resumeCompleted=json.data?.completedObject===true;}
  if(storageId&&url.pathname===`/api/admin/storage/uploads/${storageId}/finish`){const json=await response.json();resumedTaskId=json.data?.verification_task_id;}
 });
 await page.goto(base+'/admin');await page.locator('#admin-email').fill(auth.email);await page.locator('#admin-password').fill(auth.password);
 await page.locator('form button[type=submit]').click();await page.getByRole('heading',{level:1,name:'ابدأ من هنا',exact:true}).waitFor();report.api_errors=[];
 await page.goto(base+'/admin/licensed-audio/'+target.recitationId);
 await page.locator(`#decision-evidence-${target.rightsReviewId}`).fill(target.rightsEvidenceRef);
 await page.locator(`#decision-note-${target.rightsReviewId}`).fill('BATCH5_HUMAN_QA: owned noise only; local transport failure acceptance.');
 await page.getByRole('region',{name:'قرار المراجعة'}).getByRole('button',{name:'موافق',exact:true}).click();
 const file=page.locator('#licensed-audio-files');await page.waitForFunction(()=>!document.querySelector('#licensed-audio-files')?.disabled);
 await file.setInputFiles(target.audioFile);
 const start=page.getByRole('button',{name:'ابدأ الرفع أو استأنف',exact:true});await start.click();
 await page.getByRole('alert').filter({hasText:'لم يكتمل الرفع'}).waitFor({timeout:120000});
 check(lossCommitted&&storageId&&firstTaskId,'REAL_COMMIT_BEFORE_LOSS_REQUIRED');
 const [committed]=await db.execute('SELECT upload_status,uploaded_by,sha256 FROM storage_objects WHERE id=?',[storageId]);
 check(committed.length===1&&committed[0].uploaded_by===manifest.owned.userId&&committed[0].sha256===target.sha256&&['uploaded','needs_review','verified'].includes(committed[0].upload_status),'OWNED_UPLOAD_COMMIT_REQUIRED');
 const transfers={puts:report.puts,prepares:report.prepares,parts:report.parts};
 await start.click();
 await page.getByRole('button',{name:'أوقف النقل مع حفظ الاستئناف',exact:true}).waitFor({state:'hidden',timeout:120000});
 await page.getByRole('alert').filter({hasText:'لم يكتمل الرفع'}).waitFor({state:'hidden'});
 const deadline=Date.now()+10000;while(!resumedTaskId&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 check(resumeCompleted&&resumedTaskId===firstTaskId,'SAME_REAL_COMPLETED_OBJECT_INTENT_REQUIRED');
 check(report.puts===transfers.puts&&report.prepares===transfers.prepares&&report.parts===transfers.parts,'NO_REAL_RETRANSMISSION_REQUIRED');
 const [tasks]=await db.execute('SELECT id,actor_id,type,status FROM admin_media_tasks WHERE actor_id=?',[manifest.owned.userId]);
 check(tasks.length===1&&tasks[0].id===firstTaskId&&tasks[0].type==='verify_upload','ONE_OWNED_VERIFICATION_TASK_REQUIRED');
 check(report.finishes===2&&report.resumes===1&&!report.blocked.length&&!report.api_errors.length,'REAL_TRANSPORT_GATES_REQUIRED');
 Object.assign(report,{passed:true,real_commit_before_lost_response:true,checkpoint_resumed_completed_object:true,same_verification_task:true,one_owned_task:true,no_second_r2_put:true,old_error_cleared_after_success:true,mysql_version:'9.7.2',task_status:tasks[0].status});
}catch(error){report.failure={code:/^[A-Z][A-Z0-9_]{2,100}$/u.test(String(error.message))?error.message:'LOCAL_UPLOAD_RESPONSE_LOSS_ACCEPTANCE_FAILED'};process.exitCode=1;}
finally{if(paused){await queue.resume();report.real_media_queue_resumed=true;}await queue?.close();await context?.close();await browser?.close();await db.end();report.finished_at=new Date().toISOString();await writeFile(out,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));}

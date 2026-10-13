/** Aggregate-only strict acceptance. Two native browser children, one real CI DB/Redis. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,realpath,open} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {buildAdminVisualRoutes,buildAdminVisualDialogs} from '../tooling/e2e/helpers/adminVisualInventory.mjs';
import {aggregateAdminVisualShards,adminVisualCaseKey,adminVisualCaseName,ADMIN_VISUAL_SHARD_COUNT} from '../tooling/e2e/helpers/adminVisualSharding.mjs';

import {requireAdminVisualTier} from '../tooling/e2e/helpers/adminVisualTiers.mjs';
const tier=requireAdminVisualTier(process.env.AYAHX_ADMIN_VISUAL_TIER??'tier1');
if(process.env.CI!=='true'||process.env.AYAHX_ADMIN_VISUAL_CI!=='1')throw new Error('EPHEMERAL_CI_ONLY');
if(process.env.DATABASE_URL||process.env.MYSQL_URL||process.env.RAILWAY_ENVIRONMENT_ID)throw new Error('EXTERNAL_DATABASE_ENV_FORBIDDEN');
if(!process.env.AYAHX_ADMIN_CI_PRIVATE_DIR)throw new Error('PRIVATE_DIRECTORY_OUTSIDE_GIT_REQUIRED');
const root=await realpath(process.cwd()),directory=await realpath(resolve(process.env.AYAHX_ADMIN_CI_PRIVATE_DIR));
const outside=relative(root,directory);
if(!outside||!outside.startsWith('..')&&!isAbsolute(outside))throw new Error('PRIVATE_DIRECTORY_OUTSIDE_GIT_REQUIRED');
const output=join(directory,'evidence');await mkdir(output,{recursive:true,mode:0o700});
const reportPath=join(output,'report.json'),startedAt=new Date().toISOString();
const running=new Set();let interrupted=false;
const stopChildren=()=>{for(const child of running)child.kill('SIGTERM');};
const interrupt=()=>{interrupted=true;process.exitCode=1;stopChildren();};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
async function adminSources(path){const files=[];for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())files.push(...await adminSources(child));else if(entry.name.endsWith('.tsx')&&!/\.(test|spec)\.tsx$/u.test(entry.name))files.push({path:child,source:await readFile(child,'utf8')});}return files;}
async function runChild(index,privateDirectory){
 // Browser profiles, cookies, passwords and raw crash logs are private and
 // excluded from the workflow artifact paths. Only evidence JSON is uploaded.
 const log=await open(join(privateDirectory,'child.log'),'wx',0o600);
 try{
  return await new Promise(resolve=>{
   const child=spawn(process.execPath,[join(root,'scripts/admin-visual-ci.mjs')],{cwd:root,env:{...process.env,AYAHX_ADMIN_CI_PRIVATE_DIR:privateDirectory,AYAHX_ADMIN_VISUAL_SHARD_INDEX:String(index),AYAHX_ADMIN_VISUAL_SHARD_COUNT:String(ADMIN_VISUAL_SHARD_COUNT)},stdio:['ignore',log.fd,log.fd]});
   running.add(child);let spawnFailed=false;
   const configured=process.env.AYAHX_ADMIN_VISUAL_BUDGET_MINUTES,budget=configured===undefined?(tier==='tier1'?35:Infinity):Number(configured);
   if(budget!==Infinity&&(!Number.isInteger(budget)||budget<1)){child.kill('SIGTERM');spawnFailed=true;}
   // Kill only this owned browser child after its budget plus bounded cleanup.
   const hardTimer=Number.isFinite(budget)?setTimeout(()=>child.kill('SIGKILL'),budget*60000+45000):null;hardTimer?.unref();
   child.once('error',()=>{spawnFailed=true;});
   child.once('close',(exitCode,signal)=>{clearTimeout(hardTimer);running.delete(child);resolve({index,exitCode:spawnFailed?null:exitCode,signal:signal??null,spawnFailed});});
  });
 }finally{await log.close();}
}
let aggregate={version:'admin-visual-ci-all-2',acceptanceScope:'incomplete-route-matrix',mode:'strict',tier,startedAt,passed:false,shards:[]};
try{
 const source=await readFile(join(directory,'fixture.json'),'utf8'),seed=JSON.parse(source);
 if(!Array.isArray(seed.shardActors)||seed.shardActors.length!==ADMIN_VISUAL_SHARD_COUNT)throw new Error('DISTINCT_ADMIN_VISUAL_SHARD_ACTORS_REQUIRED');
 for(const field of ['id','email','password','renderJobId'])if(new Set(seed.shardActors.map(actor=>actor[field])).size!==ADMIN_VISUAL_SHARD_COUNT)throw new Error('DISTINCT_ADMIN_VISUAL_SHARD_ACTORS_REQUIRED');
 if(seed.shardActors.some(actor=>typeof actor.password!=='string'||actor.password.length<32||typeof actor.id!=='string'||typeof actor.email!=='string'||typeof actor.renderJobId!=='string'))throw new Error('PRIVATE_ADMIN_VISUAL_SHARD_ACTOR_INVALID');
 const fixtures=seed.shardActors.map(actor=>{const fixture={...seed,...actor};delete fixture.shardActors;return fixture;});
 const routeSource=await readFile('src/admin/AdminRoot.tsx','utf8'),inventories=fixtures.map(fixture=>buildAdminVisualRoutes(routeSource,fixture));
 const dialogInventory=buildAdminVisualDialogs(await adminSources('src/admin'));
 const privateDirectories=[];
 await mkdir(join(directory,'shards'),{mode:0o700});
 for(let index=0;index<ADMIN_VISUAL_SHARD_COUNT;index++){
  const child=join(directory,'shards','shard-'+index);await mkdir(child,{mode:0o700});
  await writeFile(join(child,'fixture.json'),JSON.stringify(fixtures[index]),{flag:'wx',mode:0o600});privateDirectories.push(child);
 }
 const exits=await Promise.all(privateDirectories.map((child,index)=>runChild(index,child)));
 // Preserve every finished child's sanitized progress, including timeout/failure.
 // A partial Tier 2 run is evidence of incompleteness, never acceptance.
 aggregate.partialReports=[];
 for(const exit of exits){
  try{const childReport=JSON.parse(await readFile(join(privateDirectories[exit.index],'evidence','report.json'),'utf8'));
   aggregate.partialReports.push({index:exit.index,expectedCases:childReport.expectedCases??0,measuredCases:childReport.matrix?.length??0,failedCases:childReport.matrix?.filter(row=>!row.passed).length??0,phase:childReport.phase,shardComplete:childReport.shardComplete,failure:childReport.failure??null});
  }catch{aggregate.partialReports.push({index:exit.index,code:'ADMIN_VISUAL_CHILD_REPORT_UNAVAILABLE'});}
 }
 aggregate.shards=exits;
 if(interrupted)throw new Error('ADMIN_VISUAL_AGGREGATE_INTERRUPTED');
 const children=[];
 for(const exit of exits){
  if(exit.exitCode!==0||exit.spawnFailed||exit.signal)throw new Error('ADMIN_VISUAL_CHILD_EXIT_FAILED');
  const evidenceDirectory=await realpath(join(privateDirectories[exit.index],'evidence'));
  const report=JSON.parse(await readFile(join(evidenceDirectory,'report.json'),'utf8')),caseEvidence=new Map();
  if(!Array.isArray(report.matrix))throw new Error('ADMIN_VISUAL_CHILD_MATRIX_REQUIRED');
  for(const row of report.matrix){
   const name=adminVisualCaseName(row);
   if(row.caseId!==name||!/^[a-zA-Z0-9_.-]+$/u.test(name))throw new Error('ADMIN_VISUAL_CASE_FILE_NAME_INVALID');
   const file=await realpath(join(evidenceDirectory,name+'.json'));
   if(relative(evidenceDirectory,file)!==name+'.json')throw new Error('ADMIN_VISUAL_CASE_FILE_PATH_INVALID');
   const key=adminVisualCaseKey(row);if(caseEvidence.has(key))throw new Error('ADMIN_VISUAL_DUPLICATE_CASE');
   caseEvidence.set(key,JSON.parse(await readFile(file,'utf8')));
  }
  children.push({report,exitCode:exit.exitCode,caseEvidence});
 }
 aggregate={...aggregate,...aggregateAdminVisualShards(children,inventories,dialogInventory,tier),startedAt};
}catch(error){
 const code=typeof error?.message==='string'?error.message.split(':')[0]:'';
 aggregate.failure={code:/^[A-Z0-9_]{1,100}$/u.test(code)?code:'ADMIN_VISUAL_AGGREGATE_VALIDATION_FAILED'};
 process.exitCode=1;
}finally{
 stopChildren();process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
 if(interrupted){aggregate.passed=false;aggregate.acceptanceScope='incomplete-route-matrix';aggregate.failure={code:'ADMIN_VISUAL_AGGREGATE_INTERRUPTED'};}
 aggregate.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(aggregate,null,2),{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({acceptanceScope:aggregate.acceptanceScope,passed:aggregate.passed,routes:aggregate.routeInventory?.length??0,cases:aggregate.expectedCases??0,shards:aggregate.shards.map(shard=>({index:shard.index,exitCode:shard.exitCode}))}));

import {writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

/** evaluate has no Playwright action timeout. Bound it and retain fixed codes. */
export async function withAdminVisualDeadline(operation,{code='ADMIN_VISUAL_EVALUATE_TIMEOUT',timeoutMs=30000,remainingMs=()=>Infinity}={}){
 const remaining=remainingMs();
 if(remaining<=0)throw new Error('ADMIN_VISUAL_BUDGET_EXHAUSTED');
 const budgetLimited=remaining<=timeoutMs,limit=Math.min(timeoutMs,remaining);
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(budgetLimited?'ADMIN_VISUAL_BUDGET_EXHAUSTED':code)),limit);})]);}
 finally{clearTimeout(timer);}
}
export function guardAdminVisualEvaluate(target,options){
 const original=target.evaluate;
 target.evaluate=(...args)=>withAdminVisualDeadline(()=>original.apply(target,args),options);
 return()=>{target.evaluate=original;};
}
const guardedNativeWorkers=new WeakSet();
export async function acquireAdminVisualNativeWorker(context,{expectedUrl,remainingMs=()=>Infinity}={}){
 const matches=worker=>/^chrome-extension:\/\/[^/]+\/background\.js$/u.test(worker.url())&&(!expectedUrl||worker.url()===expectedUrl);
 const candidates=context.serviceWorkers().filter(matches);
 if(candidates.length>1)throw new Error('ADMIN_VISUAL_NATIVE_WORKER_AMBIGUOUS');
 let worker=candidates[0];
 if(!worker){
  try{worker=await withAdminVisualDeadline(()=>context.waitForEvent('serviceworker',{predicate:matches,timeout:30000}),{code:'ADMIN_VISUAL_NATIVE_WORKER_UNAVAILABLE',remainingMs});}
  catch(error){throw new Error(error.message==='ADMIN_VISUAL_BUDGET_EXHAUSTED'?error.message:'ADMIN_VISUAL_NATIVE_WORKER_UNAVAILABLE');}
 }
 if(!guardedNativeWorkers.has(worker)){guardAdminVisualEvaluate(worker,{code:'ADMIN_VISUAL_NATIVE_ZOOM_TIMEOUT',remainingMs});guardedNativeWorkers.add(worker);}
 return worker;
}
/** A bounded, separate progress file is diagnostic evidence, never acceptance. */
export function startAdminVisualProgressCheckpoint(report,directory,{intervalMs=30000,onError=()=>{}}={}){
 let pending=Promise.resolve(),stopped=false;
 const checkpoint=()=>{
  const current=report.currentCase;
  const snapshot={version:'admin-visual-progress-1',tier:report.tier,shard:{index:report.shard.index,count:report.shard.count},phase:report.phase,currentCase:current?{route:current.route,size:current.size,zoom:current.zoom,theme:current.theme,lang:current.lang}:null,activeDialog:report.activeDialog,measurement:report.currentMeasurement??null,measuredCases:report.matrix.length,expectedCases:report.expectedCases??null,at:new Date().toISOString(),acceptance:false};
  pending=pending.then(async()=>{await writeFile(join(directory,'progress.pending.json'),JSON.stringify(snapshot),{mode:0o600});await rename(join(directory,'progress.pending.json'),join(directory,'progress.json'));}).catch(()=>onError());
  return pending;
 };
 const timer=setInterval(()=>{if(!stopped)void checkpoint();},intervalMs);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);await checkpoint();await pending;};
}

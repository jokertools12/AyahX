// @vitest-environment node
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {withAdminVisualDeadline,guardAdminVisualEvaluate,startAdminVisualProgressCheckpoint,acquireAdminVisualNativeWorker} from '../../tooling/e2e/helpers/adminVisualRuntimeGuards.mjs';
afterEach(()=>vi.useRealTimers());
describe('visual runtime bounds and private progress',()=>{
 it('terminates an unresolved evaluate instead of waiting forever for fonts/paused animations',async()=>{
  vi.useFakeTimers();const operation=vi.fn(()=>new Promise(()=>{})),result=withAdminVisualDeadline(operation,{timeoutMs:30000});
  const rejected=expect(result).rejects.toThrow('ADMIN_VISUAL_EVALUATE_TIMEOUT');await vi.advanceTimersByTimeAsync(30000);await rejected;
 });
 it('uses the remaining overall budget and never starts an expired operation',async()=>{
  vi.useFakeTimers();const operation=vi.fn(()=>new Promise(()=>{})),result=withAdminVisualDeadline(operation,{remainingMs:()=>5000});
  const rejected=expect(result).rejects.toThrow('ADMIN_VISUAL_BUDGET_EXHAUSTED');await vi.advanceTimersByTimeAsync(5000);await rejected;
  const expired=vi.fn();await expect(withAdminVisualDeadline(expired,{remainingMs:()=>0})).rejects.toThrow('BUDGET_EXHAUSTED');expect(expired).not.toHaveBeenCalled();
 });
 it('preserves evaluate receiver, arguments, success, errors and restores the original method',async()=>{
  const target={marker:42,evaluate:vi.fn(function(this:{marker:number},input:number){return Promise.resolve(this.marker+input);})},original=target.evaluate;
  const restore=guardAdminVisualEvaluate(target,{code:'ADMIN_VISUAL_NATIVE_ZOOM_TIMEOUT'});
  expect(await target.evaluate(8)).toBe(50);restore();expect(target.evaluate).toBe(original);
  await expect(withAdminVisualDeadline(()=>Promise.reject(new Error('REAL_FAILURE')))).rejects.toThrow('REAL_FAILURE');
 });
 it('refreshes the actual extension worker after replacement and never substitutes another extension',async()=>{
  const url='chrome-extension://owned-extension/background.js',first={url:()=>url,evaluate:vi.fn(async()=>1)},replacement={url:()=>url,evaluate:vi.fn(async()=>1.5)};
  let workers=[first];const context={serviceWorkers:()=>workers,waitForEvent:vi.fn(async(_event:string,_options:{predicate:(worker:{url:()=>string})=>boolean;timeout:number})=>replacement)};
  expect(await acquireAdminVisualNativeWorker(context,{expectedUrl:url})).toBe(first);
  const guarded=first.evaluate;expect(await acquireAdminVisualNativeWorker(context,{expectedUrl:url})).toBe(first);expect(first.evaluate).toBe(guarded);
  workers=[replacement];const current=await acquireAdminVisualNativeWorker(context,{expectedUrl:url});expect(current).toBe(replacement);expect(await current.evaluate()).toBe(1.5);
  workers=[];await acquireAdminVisualNativeWorker(context,{expectedUrl:url});expect(context.waitForEvent).toHaveBeenCalledWith('serviceworker',expect.objectContaining({timeout:30000}));
  const predicate=context.waitForEvent.mock.calls[0][1].predicate;
  expect(predicate({url:()=>url})).toBe(true);expect(predicate({url:()=>url.replace('owned-extension','other-extension')})).toBe(false);
 });
 it('serializes a separate progress file without credentials or falsely claiming acceptance',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ayahx-visual-progress-'));
  try{
   const report={tier:'tier1',shard:{index:0,count:2},phase:'page-scanner',currentCase:{route:'/admin',zoom:1},activeDialog:null,matrix:[],expectedCases:195,password:'NEVER_EXPORTED',fixture:{email:'NEVER_EXPORTED'}};
   const stop=startAdminVisualProgressCheckpoint(report,directory,{intervalMs:30000});report.phase='dialog-axe';await stop();
   const raw=await readFile(join(directory,'progress.json'),'utf8'),snapshot=JSON.parse(raw);
   expect(snapshot).toMatchObject({phase:'dialog-axe',measuredCases:0,expectedCases:195,acceptance:false});expect(raw).not.toContain('NEVER_EXPORTED');
  }finally{await rm(directory,{recursive:true,force:true});}
 });
});

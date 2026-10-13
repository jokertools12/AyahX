// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {createAdminReadWindows} from '../../tooling/e2e/helpers/adminReadWindows.mjs';
import {classifyAdminLighthouseFailure,createAdminLighthouseProgress} from '../../tooling/e2e/helpers/adminLighthouseProgress.mjs';
const origin='http://127.0.0.1:3005';

describe('observed admin read windows before measurements',()=>{
 it('counts only own-origin admin GET responses, including bootstrap and discovery',async()=>{
  const sleep=vi.fn(async()=>{}),budget=createAdminReadWindows({origin,now:()=>1000,sleep});
  expect(budget.observe('GET',origin+'/api/admin/auth/me')).toBe(true);
  expect(budget.observe('GET',origin+'/api/admin/catalog/recitations?limit=1')).toBe(true);
  expect(budget.observe('POST',origin+'/api/admin/auth/login')).toBe(false);
  expect(budget.observe('GET',origin+'/api/health')).toBe(false);
  expect(budget.observe('GET','https://other.example/api/admin/auth/me')).toBe(false);
  const snapshot=await budget.before('discovery');
  expect(snapshot).toMatchObject({scope:'this_browser_responses_only',setupWaitMs:0,readWindows:[{windowStartMs:0,observedReadRequests:2}],rateLimitUnchanged:true});
  expect(sleep).not.toHaveBeenCalled();
 });
 it('waits at18 actual responses until the next fixed minute+100ms using bounded Node timer chunks',async()=>{
  let now=1000;const entries:unknown[]=[],sleep=vi.fn(async(ms:number)=>{now+=ms;});
  const budget=createAdminReadWindows({origin,now:()=>now,sleep,onWait:async entry=>{entries.push({...entry});}});
  for(let count=0;count<17;count++)budget.observe('GET',origin+'/api/admin/read');
  await budget.before('page','/admin/storage');expect(sleep).not.toHaveBeenCalled();
  budget.observe('GET',origin+'/api/admin/auth/me');const result=await budget.before('page','/admin/storage');
  expect(now).toBe(60100);expect(sleep.mock.calls.map(([ms])=>ms)).toEqual([30000,29100]);
  expect(result.setupWaitMs).toBe(59100);expect(entries.at(-1)).toMatchObject({beforePhase:'page',path:'/admin/storage',observedReadRequests:18,scheduledUntilMs:60100,waitMs:59100,complete:true,rateLimitUnchanged:true});
  budget.observe('GET',origin+'/api/admin/read');expect(budget.snapshot().readWindows).toEqual([{windowStartMs:0,observedReadRequests:18},{windowStartMs:60000,observedReadRequests:1}]);
 });
 it('rechecks the actual clock rather than trusting a timer duration or old window',async()=>{
  let now=59000;const sleep=vi.fn(async(ms:number)=>{now+=ms+250;});
  const budget=createAdminReadWindows({origin,now:()=>now,sleep});for(let count=0;count<18;count++)budget.observe('GET',origin+'/api/admin/read');
  const result=await budget.before('lighthouse','/admin/storage');expect(now).toBe(60350);expect(result.setupWaitMs).toBe(1350);
  await budget.before('lighthouse','/admin/storage');expect(sleep).toHaveBeenCalledTimes(1);
 });
 it('stops when the real remaining job budget expires, without clearing counts or retrying requests',async()=>{
  let now=1000;const sleep=vi.fn(async(ms:number)=>{now+=ms;});
  const budget=createAdminReadWindows({origin,now:()=>now,sleep,remainingMs:()=>2000-now});for(let count=0;count<18;count++)budget.observe('GET',origin+'/api/admin/read');
  await expect(budget.before('page','/admin/storage')).rejects.toThrow('ADMIN_VISUAL_BUDGET_EXHAUSTED');expect(sleep.mock.calls).toEqual([[1000]]);
  expect(budget.snapshot().readWindows[0].observedReadRequests).toBe(18);
 });
 it('persists wait phase and keeps429 fail-closed even when other measurements passed',async()=>{
  const progress=createAdminLighthouseProgress(async()=>{});await progress.checkpoint('rate_window_wait');
  progress.report.apiErrors.push({path:'/api/admin/auth/me',status:429});await progress.fail(new Error('LIGHTHOUSE_API_RATE_LIMITED'));
  expect(progress.report).toMatchObject({complete:false,passed:false,failure:{code:'LIGHTHOUSE_API_RATE_LIMITED',category:'rate_limit',phase:'rate_window_wait'}});
  expect(classifyAdminLighthouseFailure(new Error('LIGHTHOUSE_API_RATE_LIMITED'),{phase:'navigate'}).category).toBe('rate_limit');
 });
 it('source gates setup before page and discovery, records waits outside Lighthouse, and never changes Redis limits',()=>{
  const source=readFileSync('scripts/measure-admin-lighthouse.mjs','utf8');
  expect(source).toContain("beforeReadWindow('bootstrap','/admin')");expect(source).toContain("beforeReadWindow('discovery')");expect(source).toContain("beforeReadWindow('page',path)");expect(source).toContain("beforeReadWindow('lighthouse',path)");
  expect(source).toContain('readWindows.observe(response.request().method(),response.url())');expect(source).toContain('measurementThrottled:false');expect(source).toContain('assertNoRateLimit()');
  expect(source).not.toMatch(/flushdb|flushall|\.del\(|MAX_RETRIES|retryAfter/u);
 });
});

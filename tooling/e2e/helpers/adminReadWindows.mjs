import {setTimeout as nodeWait} from 'node:timers/promises';

/**
 * Observe this browser's real GET responses, never Redis or another actor.
 * Fixed-minute windows match the server gate;18 is conservative setup headroom,
 * not a change to its limit. Wait only outside the Lighthouse measurement.
 * @param {{origin: string, now?: () => number, sleep?: (ms: number) => Promise<void>, remainingMs?: () => number, onWait?: (entry: Record<string, unknown>) => Promise<void>}} options
 */
export function createAdminReadWindows({origin,now=Date.now,sleep=async ms=>{await nodeWait(ms);},remainingMs=()=>Infinity,onWait=async()=>{}}){
 const base=new URL(origin);if(base.origin!==origin)throw new Error('READ_WINDOW_ORIGIN_REQUIRED');
 const windows=new Map();let setupWaitMs=0;
 /** @param {string} method @param {string} url */
 const observe=(method,url)=>{
  const parsed=new URL(url);
  if(method!=='GET'||parsed.origin!==origin||!parsed.pathname.startsWith('/api/admin/'))return false;
  const bucket=Math.floor(now()/60000);windows.set(bucket,(windows.get(bucket)??0)+1);return true;
 };
 const snapshot=()=>({setupWaitMs,readWindows:[...windows].map(([bucket,observedReadRequests])=>({windowStartMs:bucket*60000,observedReadRequests})),scope:'this_browser_responses_only',rateLimitUnchanged:true});
 /** @param {string} beforePhase @param {string|null} [path] */
 const before=async(beforePhase,path=null)=>{
  if(!['bootstrap','discovery','page','lighthouse'].includes(beforePhase))throw new Error('READ_WINDOW_PHASE_INVALID');
  while((windows.get(Math.floor(now()/60000))??0)>=18){
   const bucket=Math.floor(now()/60000),started=now(),until=(bucket+1)*60000+100;
   const entry={beforePhase,path,windowStartMs:bucket*60000,observedReadRequests:windows.get(bucket),scheduledUntilMs:until,startedAt:new Date(started).toISOString(),waitMs:0,complete:false,rateLimitUnchanged:true};
   await onWait(entry);
   while(now()<until){
    const remaining=remainingMs();if(remaining<=0)throw new Error('ADMIN_VISUAL_BUDGET_EXHAUSTED');
    // At most30s per Node timer, always recheck the actual clock and job budget.
    await sleep(Math.min(30000,until-now(),remaining));
    entry.waitMs=Math.max(0,now()-started);await onWait(entry);
   }
   entry.waitMs=Math.max(0,now()-started);entry.complete=true;setupWaitMs+=entry.waitMs;await onWait(entry);
  }
  return snapshot();
 };
 return{observe,before,snapshot};
}

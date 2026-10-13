// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {classifyAdminLighthouseFailure,createAdminLighthouseProgress} from '../../tooling/e2e/helpers/adminLighthouseProgress.mjs';
import {summarizeAdminLighthouse} from '../../tooling/e2e/helpers/adminLighthouse.mjs';
const routes=Array.from({length:10},(_,i)=>'/admin/page-'+i);
const summary=(path:string,score=.95)=>summarizeAdminLighthouse({categories:{accessibility:{score},'best-practices':{score:.95}},audits:{'cumulative-layout-shift':{numericValue:.1}}},path);

describe('bounded safe Lighthouse diagnostics',()=>{
 it('preserves five measured pages and the actual failing phase instead of dropping a partial run',async()=>{
  const snapshots:unknown[]=[];let now=1000;
  const progress=createAdminLighthouseProgress(async value=>{snapshots.push(JSON.parse(JSON.stringify(value)));},{now:()=>now});
  Object.assign(progress.report,{expectedRoutes:routes});
  for(const path of routes.slice(0,5)){await progress.checkpoint('navigate',path);now+=10;await progress.checkpoint('lighthouse',path);now+=20;await progress.page(summary(path));}
  await progress.checkpoint('navigate',routes[5]);now+=60000;
  const error=new Error('Navigation timeout of 60000 ms exceeded token=PRIVATE_HEADER');error.name='TimeoutError';
  await progress.fail(error);
  expect(progress.report).toMatchObject({complete:false,passed:false,status:'failed',failure:{code:'LIGHTHOUSE_PHASE_TIMEOUT',errorClass:'TimeoutError',category:'timeout',phase:'navigate',path:routes[5],elapsedMs:60000}});
  expect(progress.report.pages).toHaveLength(5);expect(snapshots).toHaveLength(17);
  expect(JSON.stringify(snapshots)).not.toContain('PRIVATE_HEADER');
 });
 it('classifies protocol, missing measurements, input syntax and unknown errors without raw details',()=>{
  const protocol=Object.assign(new Error('Protocol error: Target closed; cookie=SECRET'),{name:'ProtocolError'});
  expect(classifyAdminLighthouseFailure(protocol,{phase:'lighthouse'})).toMatchObject({code:'LIGHTHOUSE_PROTOCOL_ERROR',category:'browser_closed',errorClass:'ProtocolError'});
  expect(classifyAdminLighthouseFailure(new Error('LIGHTHOUSE_RESULT_MISSING'),{phase:'summarize'})).toMatchObject({category:'measurement_schema',code:'LIGHTHOUSE_RESULT_MISSING'});
  expect(classifyAdminLighthouseFailure(new SyntaxError('Unexpected token PRIVATE_JSON'))).toMatchObject({category:'schema',code:'LIGHTHOUSE_INPUT_SCHEMA_ERROR'});
  expect(classifyAdminLighthouseFailure(new TypeError('PRIVATE_DOM_NODE'))).toMatchObject({category:'type_error',code:'LIGHTHOUSE_TYPE_ERROR'});
  const unknown=classifyAdminLighthouseFailure(Object.assign(new Error('SUPER_SECRET_TOKEN'),{name:'PRIVATE_ERROR_CLASS'}),{phase:'lighthouse'});
  expect(unknown).toMatchObject({code:'LIGHTHOUSE_EXECUTION_FAILED',errorClass:'UnknownError'});expect(JSON.stringify(unknown)).not.toMatch(/SECRET|PRIVATE/);
 });
 it('retains the original failure when cleanup also fails, and never passes afterwards',async()=>{
  const progress=createAdminLighthouseProgress(async()=>{});
  await progress.checkpoint('lighthouse');await progress.fail(new Error('LIGHTHOUSE_RESULT_MISSING'));
  await progress.checkpoint('cleanup');await progress.fail(Object.assign(new Error('Target closed'),{name:'ProtocolError'}));
  expect(progress.report).toMatchObject({complete:false,passed:false,failure:{phase:'lighthouse',code:'LIGHTHOUSE_RESULT_MISSING'},secondaryFailures:[{phase:'cleanup',code:'LIGHTHOUSE_PROTOCOL_ERROR'}]});
 });
 it('does not declare complete with a missing page, a failed threshold, a runtime failure or dirty API/write gates',async()=>{
  const incomplete=createAdminLighthouseProgress(async()=>{});Object.assign(incomplete.report,{expectedRoutes:routes});await incomplete.page(summary(routes[0]));
  await expect(incomplete.finish()).rejects.toThrow('LIGHTHOUSE_ROUTE_COVERAGE_INCOMPLETE');expect(incomplete.report).toMatchObject({passed:false,complete:false,status:'failed',failure:{code:'LIGHTHOUSE_ROUTE_COVERAGE_INCOMPLETE',phase:'finalize'}});
  for(const reason of ['threshold','runtime','api','write']){
   const progress=createAdminLighthouseProgress(async()=>{});Object.assign(progress.report,{expectedRoutes:routes});
   for(const path of routes)await progress.page(summary(path,reason==='threshold'&&path===routes[0]?.949:.95));
   if(reason==='runtime')Object.assign(progress.report.pages[0],{runtimeError:{code:'NO_FCP'},passed:false});
   if(reason==='api')progress.report.apiErrors.push({path:'/api/admin/read',status:503});
   if(reason==='write')progress.report.blockedWrites.push({path:'/api/admin/write',method:'POST'});
   expect(await progress.finish()).toBe(false);expect(progress.report.complete).toBe(false);
  }
 });
 it('only passes after all real summaries meet exact acceptance and clean read/write gates',async()=>{
  const persist=vi.fn(async()=>{}),progress=createAdminLighthouseProgress(persist);Object.assign(progress.report,{expectedRoutes:routes});
  for(const path of routes)await progress.page(summary(path));await progress.checkpoint('cleanup');
  expect(progress.report.passed).toBe(false);expect(await progress.finish()).toBe(true);
  expect(progress.report).toMatchObject({status:'complete',passed:true,complete:true,measurementFailures:[]});expect(persist).toHaveBeenCalledTimes(13);
 });
 it('rejects arbitrary phase/route diagnostics and caps the history',async()=>{
  const progress=createAdminLighthouseProgress(async()=>{});
  await expect(progress.checkpoint('PRIVATE_HEADER')).rejects.toThrow('LIGHTHOUSE_PROGRESS_PHASE_INVALID');
  await expect(progress.checkpoint('navigate','/admin?token=PRIVATE_HEADER')).rejects.toThrow('LIGHTHOUSE_PROGRESS_ROUTE_INVALID');
  progress.report.phases.length=1024;await expect(progress.checkpoint('navigate','/admin')).rejects.toThrow('LIGHTHOUSE_PROGRESS_LIMIT_REACHED');
 });
 it('source persists before navigation/measurement/settle and bounds native worker replacement without retries',()=>{
  const lighthouse=readFileSync('scripts/measure-admin-lighthouse.mjs','utf8'),capture=readFileSync('scripts/capture-admin-visual-truth.mjs','utf8');
  expect(lighthouse).toContain("progress.checkpoint('navigate',path)");expect(lighthouse).toContain("progress.checkpoint('lighthouse',path)");expect(lighthouse).toContain("progress.checkpoint('settle',path)");
  expect(lighthouse).toContain('progress.page(summarizeAdminLighthouse');expect(lighthouse).toContain('progress.fail(error)');expect(lighthouse).not.toContain('JSON.stringify(result.lhr');expect(lighthouse).not.toContain('error.stack');
  expect(capture).toContain('acquireAdminVisualNativeWorker(context,{expectedUrl:nativeWorkerUrl})');expect(capture).toContain('chrome.runtime.getPlatformInfo()');expect(capture).toContain('},20000)');
 });
});

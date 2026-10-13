// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {setAdminVisualScanPhase,diagnoseAdminVisualPaintDocument,collectAdminVisualFailureDiagnostic} from '../../tooling/e2e/helpers/adminVisualScanProgress.mjs';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('exact visual scan phase diagnostics',()=>{
 it('distinguishes paint from synchronous scanner work with only numeric scroll metadata',()=>{
  const report={activeDialog:null,phase:'page-scanner',currentMeasurement:null};
  setAdminVisualScanPhase(report,'document-paint',{documentTop:400,total:1000,step:400,password:'NEVER_EXPORTED'});
  expect(report.phase).toBe('page-scanner-document-paint');expect(report.currentMeasurement).toMatchObject({documentTop:400,total:1000,step:400});expect(report.currentMeasurement).not.toHaveProperty('password');
  setAdminVisualScanPhase(report,'raw-evaluate',report.currentMeasurement);expect(report.phase).toBe('page-scanner-raw-evaluate');
  const modal={activeDialog:'review-bulk-confirm',phase:'',currentMeasurement:null};setAdminVisualScanPhase(modal,'panel-paint',{panelId:2,panelTop:300});expect(modal.phase).toBe('dialog-scanner-panel-paint');
  expect(()=>setAdminVisualScanPhase(report,'unsafe operation')).toThrow('OPERATION_INVALID');
 });
 it('reads paused/infinite motion and pending fonts without waiting for or settling them',()=>{
  const paused={playState:'paused',pending:false,currentTime:123,playbackRate:0,effect:{target:{tagName:'DIV',id:'NEVER_EXPORTED'},getTiming:()=>({iterations:1,duration:400})},finished:new Promise(()=>{})};
  const infinite={...paused,playState:'running',effect:{getTiming:()=>({iterations:Infinity,duration:1000})}};
  const fonts=Object.assign([{status:'loading'},{status:'error'}],{status:'loading',ready:new Promise(()=>{})});
  vi.stubGlobal('document',{fonts,getAnimations:()=>[paused,infinite]});vi.stubGlobal('innerWidth',911);vi.stubGlobal('innerHeight',512);vi.stubGlobal('devicePixelRatio',1.5);
  const result=diagnoseAdminVisualPaintDocument();expect(result).toMatchObject({acceptance:false,fonts:{status:'loading',loading:1,error:1},animationCount:2});
  expect(result.animations[0]).toMatchObject({playState:'paused',iterations:1,playbackRate:0});expect(result.animations[1].infinite).toBe(true);expect(JSON.stringify(result)).not.toContain('NEVER_EXPORTED');
  const standalone=new Function(`return (${diagnoseAdminVisualPaintDocument.toString()});`)();expect(standalone()).toEqual(result);
 });
 it('bounds the failure diagnostic itself if the browser thread is blocked',async()=>{
  vi.useFakeTimers();const page={evaluate:vi.fn(()=>new Promise(()=>{}))},result=collectAdminVisualFailureDiagnostic(page);
  await vi.advanceTimersByTimeAsync(3000);expect(await result).toMatchObject({acceptance:false,code:'ADMIN_VISUAL_FAILURE_DIAGNOSTIC_UNAVAILABLE'});
 });
});

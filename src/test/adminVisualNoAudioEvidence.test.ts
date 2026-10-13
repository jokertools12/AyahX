// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {assertAdminVisualNoAudioProof} from '../../tooling/e2e/helpers/adminVisualNoAudioProof.mjs';
import {collectAdminVisualNoAudioEvidence,summarizeAdminVisualNoAudioProbe} from '../../tooling/e2e/helpers/adminVisualNoAudioEvidence.mjs';
import {assertAdminVisualDirectEvidence} from '../../tooling/e2e/helpers/adminVisualEvidenceValidation.mjs';

// Synthetic process/page/file doubles verify the contract, never live media.
const job='12345678-1234-1234-1234-123456789012',base='http://127.0.0.1:3005',url=base+'/api/admin/render-lab/jobs/'+job+'/media',target=['#player'];
const bytes=Buffer.from('synthetic-unit-media'),hash=createHash('sha256').update(bytes).digest('hex');
const source={tag:'VIDEO',currentSrc:url,connected:true,inActiveScope:true};
const probe={source:'REAL_FFPROBE_LOCAL_ENCODED_ARTIFACT',durationSeconds:1,bytes:bytes.length,streams:[{codec_type:'video',width:320,height:180}]};
const proof=()=>({ruleId:'video-caption',target,resolved:true,reason:'NO_AUDIO_TRACK_IS_NOT_APPLICABLE',fixtureTag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',actual_quran_render:false,human_acceptance:false,before:{...source},after:{...source},probe:structuredClone(probe),media:{jobId:job,method:'AUTHENTICATED_FULL_MEDIA_GET',status:200,contentType:'video/mp4',currentSrc:url,responseUrl:url,bytes:bytes.length},artifact:{sha256:hash,seedSha256:hash,localBeforeSha256:hash,localAfterSha256:hash,authenticatedGetSha256:hash,bytes:bytes.length}});
const raw=()=>({violations:[],originalIncomplete:[{id:'video-caption',nodes:[{target}]}],incomplete:[{id:'video-caption',nodes:[{target}]}],remeasurements:[]});
const fixture=()=>({id:'ci-user',renderJobId:job,visualMedia:{jobId:job,fixtureTag:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',localPath:resolve('uploads','ci-user','admin-visual-ci',job+'.mp4'),sha256:hash,actual_quran_render:false,human_acceptance:false}});
const dependencies=()=>({realpath:vi.fn(async(path:string)=>path),stat:vi.fn(async()=>({isFile:()=>true,size:bytes.length})),readFile:vi.fn(async()=>bytes),probeFile:vi.fn(async()=>structuredClone(probe))});
const page=()=>({evaluate:vi.fn(async()=>({...source})),request:{get:vi.fn(async()=>({status:()=>200,url:()=>url,headers:()=>({'content-type':'video/mp4','content-length':String(bytes.length)}),body:async()=>bytes,dispose:vi.fn(async()=>{})}))}});
describe('exact silent CI artifact proof',()=>{
 it('accepts only typed matching encoded bytes and the original video target',()=>{
  const report={...raw(),incomplete:[],remeasurements:[proof()]};expect(()=>assertAdminVisualDirectEvidence(report)).not.toThrow();
  report.remeasurements[0].target=['#another-player'];expect(()=>assertAdminVisualDirectEvidence(report)).toThrow('REMEASUREMENT_REQUIRED');
 });
 it.each(['seedSha256','localBeforeSha256','localAfterSha256','authenticatedGetSha256'])('rejects substituted %s',key=>{
  const value=proof();value.artifact[key]='b'.repeat(64);expect(()=>assertAdminVisualNoAudioProof(value)).toThrow('ARTIFACT_MISMATCH');
 });
 it('rejects an audio stream even when metadata claims no audio',()=>{
  const value=proof();value.probe.streams.push({codec_type:'audio',width:320,height:180});expect(()=>assertAdminVisualNoAudioProof(value)).toThrow('PROBE_REQUIRED');
 });
 it.each([0,NaN,Infinity,3])('rejects invalid/foreign duration %s',duration=>{const value=proof();value.probe.durationSeconds=duration;expect(()=>assertAdminVisualNoAudioProof(value)).toThrow('PROBE_REQUIRED');});
 it('rejects unknown probe, no video, missing stream type, wrong dimensions and truncated body',()=>{
  for(const mutate of [(v:ReturnType<typeof proof>)=>{v.probe.source='DOM_MUTED';},(v:ReturnType<typeof proof>)=>{v.probe.streams=[];},(v:ReturnType<typeof proof>)=>{v.probe.streams[0].codec_type='';},(v:ReturnType<typeof proof>)=>{v.probe.streams[0].width=1920;},(v:ReturnType<typeof proof>)=>{v.media.bytes--; }]){const value=proof();mutate(value);expect(()=>assertAdminVisualNoAudioProof(value)).toThrow();}
 });
 it('rejects source/job substitution, redirects, external URL and changed element',()=>{
  for(const mutate of [(v:ReturnType<typeof proof>)=>{v.media.jobId='22345678-1234-1234-1234-123456789012';},(v:ReturnType<typeof proof>)=>{v.media.responseUrl=base+'/redirect';},(v:ReturnType<typeof proof>)=>{v.media.currentSrc=url.replace('127.0.0.1','example.com');},(v:ReturnType<typeof proof>)=>{v.after.currentSrc=base+'/other';},(v:ReturnType<typeof proof>)=>{v.after.inActiveScope=false;},(v:ReturnType<typeof proof>)=>{v.before.tag='IFRAME';}]){const value=proof();mutate(value);expect(()=>assertAdminVisualNoAudioProof(value)).toThrow();}
 });
 it('rejects invented Quran/acceptance claims and other unresolved rules',()=>{
  const value=proof();value.actual_quran_render=true;expect(()=>assertAdminVisualNoAudioProof(value)).toThrow('CI_SCOPE');
  const report={...raw(),incomplete:[],originalIncomplete:[{id:'other-rule',nodes:[{target}]}],remeasurements:[proof()]};expect(()=>assertAdminVisualDirectEvidence(report)).toThrow('UNRESOLVED_RULE');
 });
 it('collects fresh local probe + authenticated full GET, preserving originals',async()=>{
  const browser=page(),io=dependencies(),initial=raw(),result=await collectAdminVisualNoAudioEvidence(browser,{accessibility:initial,fixture:fixture(),base},io);
  expect(result.incomplete).toEqual([]);expect(result.originalIncomplete).toEqual(initial.originalIncomplete);expect(initial.incomplete).toHaveLength(1);
  expect(io.probeFile).toHaveBeenCalledTimes(1);expect(io.readFile).toHaveBeenCalledTimes(2);expect(browser.evaluate).toHaveBeenCalledTimes(2);expect(browser.request.get).toHaveBeenCalledWith(url,{timeout:10000,maxRedirects:0});
  expect(()=>assertAdminVisualDirectEvidence(result)).not.toThrow();expect(JSON.stringify(result)).not.toContain('localPath');
 });
 it('retains UNKNOWN on real-probe audio and never overrides any violation',async()=>{
  const io=dependencies();io.probeFile.mockResolvedValue({...probe,streams:[{codec_type:'audio',width:320,height:180}]});
  expect((await collectAdminVisualNoAudioEvidence(page(),{accessibility:raw(),fixture:fixture(),base},io)).incomplete).toHaveLength(1);
  const initial=raw();initial.violations=[{id:'video-caption',nodes:[{target}]}];const browser=page();const result=await collectAdminVisualNoAudioEvidence(browser,{accessibility:initial,fixture:fixture(),base},dependencies());
  expect(result.violations).toEqual(initial.violations);expect(browser.request.get).not.toHaveBeenCalled();expect(result.incomplete).toHaveLength(1);
 });
 it('does not use absent/private restored nominations or escape the actor uploads boundary',async()=>{
  for(const nominated of [{...fixture(),seedProofSource:'restored-private-backup'},{id:'ci-user',renderJobId:job},{...fixture(),visualMedia:{...fixture().visualMedia,localPath:resolve('outside',job+'.mp4')}}]){
   const browser=page();expect((await collectAdminVisualNoAudioEvidence(browser,{accessibility:raw(),fixture:nominated,base},dependencies())).incomplete).toHaveLength(1);expect(browser.request.get).not.toHaveBeenCalled();
  }
 });
 it('summarizes actual streams, ignoring unsafe metadata without inferring absence',()=>{
  expect(summarizeAdminVisualNoAudioProbe({format:{duration:'1',size:'20',filename:'PRIVATE'},streams:[{codec_type:'audio',tags:{secret:'PRIVATE'}}]})).toEqual({...probe,bytes:20,streams:[{codec_type:'audio',width:undefined,height:undefined}]});
  expect(summarizeAdminVisualNoAudioProbe({format:{duration:'1',size:'20'}}).streams).toBeNull();
 });
});

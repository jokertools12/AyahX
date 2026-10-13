import {readFile,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,relative,isAbsolute,basename,dirname} from 'node:path';
import ffprobeStatic from 'ffprobe-static';
import {assertAdminVisualNoAudioProof} from './adminVisualNoAudioProof.mjs';

const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const run=promisify(execFile);
export function summarizeAdminVisualNoAudioProbe(raw){
 return{source:'REAL_FFPROBE_LOCAL_ENCODED_ARTIFACT',durationSeconds:Number(raw?.format?.duration),bytes:Number(raw?.format?.size),streams:Array.isArray(raw?.streams)?raw.streams.map(stream=>({codec_type:stream.codec_type,width:stream.width,height:stream.height})):null};
}
/** Read-only exact target identity; no text, auth, DOM changes, or track inference. */
export function measureAdminVisualVideoSource(selector){
 let matches=[];try{matches=[...document.querySelectorAll(selector)];}catch{return null;}
 if(matches.length!==1)return null;
 const el=matches[0],active=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(dialog=>{const rect=dialog.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(dialog).visibility==='visible';}).at(-1),scope=active??document.querySelector('.admin-app');
 return{tag:el.tagName,currentSrc:el.currentSrc,connected:el.isConnected,inActiveScope:!!scope?.contains(el)};
}
async function probeFile(path){
 const {stdout}=await run(ffprobeStatic.path,['-v','error','-show_format','-show_streams','-of','json',path],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});
 return summarizeAdminVisualNoAudioProbe(JSON.parse(stdout));
}

/** Only private CI seed metadata can nominate an artifact; every call probes
 * its real bytes and fetches the actual authenticated player source again. */
export async function collectAdminVisualNoAudioEvidence(page,{accessibility,fixture,base,workspace=process.cwd()},dependencies={}){
 const result=structuredClone(accessibility),seed=fixture?.visualMedia;
 if(!seed||fixture.seedProofSource==='restored-private-backup')return result;
 const io={readFile,realpath,stat,probeFile,...dependencies};
 for(const rule of result.incomplete){
  if(rule.id!=='video-caption')continue;
  for(const node of rule.nodes){
   if(!Array.isArray(node.target)||node.target.length!==1||typeof node.target[0]!=='string'||result.violations.some(violation=>violation.nodes.some(item=>JSON.stringify(item.target)===JSON.stringify(node.target))))continue;
   const proof={ruleId:rule.id,target:node.target,resolved:false,reason:'NO_AUDIO_DIRECT_EVIDENCE_UNAVAILABLE',fixtureTag:seed.fixtureTag,actual_quran_render:false,human_acceptance:false};
   try{
    if(seed.fixtureTag!=='CI_VISUAL_ONLY_SYNTHETIC_BLACK'||seed.actual_quran_render!==false||seed.human_acceptance!==false||seed.jobId!==fixture.renderJobId)throw new Error('CI_SCOPE');
    const path=await io.realpath(seed.localPath),root=await io.realpath(resolve(workspace,'uploads',fixture.id,'admin-visual-ci')),location=relative(root,path);
    if(isAbsolute(location)||location.startsWith('..')||basename(path)!==fixture.renderJobId+'.mp4'||dirname(path)!==root)throw new Error('CI_PATH');
    const file=await io.stat(path);if(!file.isFile()||file.size<=0||file.size>10*1024*1024)throw new Error('CI_SIZE');
    const beforeBytes=await io.readFile(path),probe=await io.probeFile(path),afterBytes=await io.readFile(path);
    const before=await page.evaluate(measureAdminVisualVideoSource,node.target[0]),expected=`${base}/api/admin/render-lab/jobs/${fixture.renderJobId}/media`;
    if(before?.currentSrc!==expected||before.tag!=='VIDEO'||!before.connected||!before.inActiveScope)throw new Error('CI_SOURCE');
    const response=await page.request.get(expected,{timeout:10000,maxRedirects:0});
    try{
     if(response.status()!==200||response.url()!==expected||response.headers()['content-type']?.split(';')[0]!=='video/mp4'||Number(response.headers()['content-length'])!==file.size)throw new Error('CI_GET');
     const body=await response.body(),after=await page.evaluate(measureAdminVisualVideoSource,node.target[0]);
     Object.assign(proof,{resolved:true,reason:'NO_AUDIO_TRACK_IS_NOT_APPLICABLE',before,after,probe,media:{jobId:fixture.renderJobId,method:'AUTHENTICATED_FULL_MEDIA_GET',status:response.status(),contentType:'video/mp4',currentSrc:expected,responseUrl:response.url(),bytes:body.length},artifact:{sha256:digest(beforeBytes),seedSha256:seed.sha256,localBeforeSha256:digest(beforeBytes),localAfterSha256:digest(afterBytes),authenticatedGetSha256:digest(body),bytes:beforeBytes.length}});
     assertAdminVisualNoAudioProof(proof);
    }finally{await response.dispose();}
   }catch{proof.resolved=false;proof.reason='NO_AUDIO_DIRECT_EVIDENCE_NOT_PROVEN';}
   result.remeasurements.push(proof);
  }
 }
 result.incomplete=result.incomplete.map(rule=>({...rule,nodes:rule.nodes.filter(node=>!result.remeasurements.some(proof=>proof.ruleId===rule.id&&proof.resolved&&JSON.stringify(proof.target)===JSON.stringify(node.target)))})).filter(rule=>rule.nodes.length);
 return result;
}

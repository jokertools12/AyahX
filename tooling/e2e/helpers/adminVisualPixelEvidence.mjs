import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectAdminVisualPng} from './adminVisualPixelContrast.mjs';
import {assertAdminVisualPixelProof,assertAdminVisualAxNameProof,normalizeAdminVisualLabel} from './adminVisualEvidenceValidation.mjs';
export {assertAdminVisualDirectEvidence,assertAdminVisualScanEvidence} from './adminVisualEvidenceValidation.mjs';

/** Self contained browser preparation; no PNG logic, synthetic AX or aria-label reads. */
export async function measureAdminVisualEvidenceTarget({selector,action='measure',scrollState}){
 const paint=async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
 let matches=[];try{matches=[...document.querySelectorAll(selector)];}catch{return{ready:false,reason:'INVALID_TARGET_SELECTOR'};}
 if(matches.length!==1)return{ready:false,reason:'EXACT_TARGET_REQUIRED'};
 const el=matches[0],parents=[];for(let p=el.parentElement;p;p=p.parentElement)parents.push(p);
 if(action==='restore'){
  parents.forEach((parent,index)=>{const position=scrollState?.parents?.[index];if(position){parent.scrollLeft=position.left;parent.scrollTop=position.top;}});
  if(scrollState?.window)scrollTo({...scrollState.window,behavior:'instant'});await paint();return{restored:true};
 }
 const saved={window:{left:scrollX,top:scrollY},parents:parents.map(parent=>({left:parent.scrollLeft,top:parent.scrollTop}))};
 if(action==='prepare')el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
 await paint();
 const failure=reason=>({ready:false,reason,scrollState:saved});
 const active=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(dialog=>{const r=dialog.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(dialog).visibility==='visible';}).at(-1);
 const scope=active??document.querySelector('.admin-app');
 if(!scope?.contains(el)||!el.isConnected)return failure('TARGET_OUTSIDE_ACTIVE_SCOPE');
 const visible=node=>{
  for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0||p.hasAttribute('hidden')||p.hasAttribute('inert')||s.clip==='rect(0px, 0px, 0px, 0px)'||/inset\(50%\)/.test(s.clipPath))return false;}
  return true;
 };
 const rectVisible=(rect,node)=>{
  const tolerance=.0001;
  if(rect.width<=0||rect.height<=0||rect.left<-tolerance||rect.top<-tolerance||rect.right>innerWidth+tolerance||rect.bottom>innerHeight+tolerance||!visible(node))return false;
  for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();
   if(/hidden|clip|auto|scroll/.test(s.overflowX)&&(rect.left<r.left+(parseFloat(s.borderLeftWidth)||0)-tolerance||rect.right>r.right-(parseFloat(s.borderRightWidth)||0)+tolerance))return false;
   if(/hidden|clip|auto|scroll/.test(s.overflowY)&&(rect.top<r.top+(parseFloat(s.borderTopWidth)||0)-tolerance||rect.bottom>r.bottom-(parseFloat(s.borderBottomWidth)||0)+tolerance))return false;
  }
  if(typeof document.elementsFromPoint!=='function')return false;
  const cx=(rect.left+rect.right)/2,cy=(rect.top+rect.bottom)/2;
  return[[cx,cy],[cx,rect.top+.1],[rect.right-.1,cy],[cx,rect.bottom-.1],[rect.left+.1,cy]].every(([x,y])=>{const top=document.elementsFromPoint(x,y)[0];return top&&(top===el||el.contains(top));});
 };
 if(!rectVisible(el.getBoundingClientRect(),el))return failure('TARGET_NOT_FULLY_VISIBLE');
 const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),rects=[],texts=[];
 while(walker.nextNode()){
  const text=walker.currentNode,parent=text.parentElement;if(!text.textContent.trim()||!parent||!visible(parent))continue;
  const range=document.createRange();range.selectNodeContents(text);
  const lines=[...range.getClientRects()];if(!lines.length||lines.some(rect=>!rectVisible(rect,parent)))return failure('TEXT_NOT_FULLY_VISIBLE');
  rects.push(...lines.map(rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height})));texts.push(text.textContent);
 }
 // Generated labels and overlapping Range fragments cannot be distinguished
 // from unrelated pixels by a text-only crop; leave them unresolved.
 for(const node of [el,...el.querySelectorAll('*')])for(const pseudo of ['::before','::after']){const content=getComputedStyle(node,pseudo).content;if(content&&!['none','normal','""',"''"].includes(content))return failure('GENERATED_VISIBLE_CONTENT');}
 if(!rects.length||rects.length>100)return failure('TEXT_RANGE_REQUIRED');
 for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++){const x=rects[a],y=rects[b];if(Math.min(x.x+x.width,y.x+y.width)>Math.max(x.x,y.x)+.0001&&Math.min(x.y+x.height,y.y+y.height)>Math.max(x.y,y.y)+.0001)return failure('OVERLAPPING_TEXT_RANGES');}
 return{ready:true,reason:'VISIBLE_TEXT_RANGES',visibleText:texts.join(''),rects,dpr:devicePixelRatio,scrollState:saved,paint:{fontsReady:true,finiteAnimationsSettled:true,framesAfter:2}};
}

const simpleTarget=target=>Array.isArray(target)&&target.length===1&&typeof target[0]==='string';
const hasViolation=(accessibility,target)=>accessibility?.violations?.some(rule=>rule.nodes?.some(node=>isDeepStrictEqual(node.target,target)));
const valid=validator=>proof=>{try{validator(proof);return true;}catch{return false;}};

async function collectTarget(page,{selector,target,ruleId,evidenceDir,caseId,axOnly=false}){
 const proof={selector,...(target?{target}:{}),...(ruleId?{ruleId}:{}),resolved:false,fullyVisibleBeforeRun:false,fullyVisibleAfterRun:false,reason:'DIRECT_EVIDENCE_UNAVAILABLE'};
 let prepared;
 try{
  prepared=await page.evaluate(measureAdminVisualEvidenceTarget,{selector,action:'prepare'});
  proof.fullyVisibleBeforeRun=prepared.ready===true;if(!prepared.ready){proof.reason=prepared.reason;return proof;}
  proof.paint=prepared.paint;proof.visibleText=prepared.visibleText;
  if(axOnly){
   const session=await page.context().newCDPSession(page);
   try{
    const {root}=await session.send('DOM.getDocument',{depth:0}),{nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    if(!nodeId){proof.reason='DIRECT_AX_DOM_TARGET_MISSING';return proof;}
    const {node}=await session.send('DOM.describeNode',{nodeId}),{nodes}=await session.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
    const exact=nodes.filter(ax=>ax.backendDOMNodeId===node.backendNodeId&&ax.ignored===false);
    if(exact.length!==1||typeof exact[0].name?.value!=='string'){proof.reason='DIRECT_AX_EXACT_NAME_REQUIRED';return proof;}
    proof.ax={method:'CDP.Accessibility.getPartialAXTree',nodeId,backendDOMNodeId:node.backendNodeId,ignored:false,accessibleName:exact[0].name.value};
    proof.normalizedVisibleText=normalizeAdminVisualLabel(prepared.visibleText);proof.normalizedAccessibleName=normalizeAdminVisualLabel(proof.ax.accessibleName);
   }finally{await session.detach();}
  }else{
   proof.captureMethod='PLAYWRIGHT_TEXT_RANGE_PNG';proof.images=[];
   for(const [index,rect] of prepared.rects.entries()){
    const png=await page.screenshot({type:'png',clip:rect,scale:'device',animations:'allow'}),measurement=await inspectAdminVisualPng(png,{kind:'text'});
    const name=createHash('sha256').update(JSON.stringify([caseId,selector,index,measurement.sha256])).digest('hex')+'.png';
    await writeFile(join(evidenceDir,name),png,{mode:0o600});proof.images.push({...measurement,rect,dpr:prepared.dpr,file:name});
   }
  }
  const after=await page.evaluate(measureAdminVisualEvidenceTarget,{selector});
  proof.fullyVisibleAfterRun=after.ready===true&&after.visibleText===prepared.visibleText&&isDeepStrictEqual(after.rects,prepared.rects)&&after.dpr===prepared.dpr;
  proof.reason=axOnly?'DIRECT_AX_VISIBLE_LABEL_PREFIX':'PIXEL_VISIBLE_CONTRAST_PASS';proof.resolved=true;
  if(!valid(axOnly?assertAdminVisualAxNameProof:assertAdminVisualPixelProof)(proof)){proof.resolved=false;proof.reason=axOnly?'DIRECT_AX_VISIBLE_PREFIX_NOT_PROVEN':'PIXEL_CONTRAST_NOT_PROVEN';}
 }catch{proof.resolved=false;proof.reason=axOnly?'DIRECT_AX_UNAVAILABLE':'PIXEL_CAPTURE_UNAVAILABLE';}
 finally{if(prepared?.scrollState)await page.evaluate(measureAdminVisualEvidenceTarget,{selector,action:'restore',scrollState:prepared.scrollState});}
 return proof;
}

/** Explicit regression probe for a visible control, even when axe is decisive.
 * This returns evidence only; it cannot override an existing axe violation.
 */
export async function collectAdminVisualAxLabelEvidence(page,{selector,caseId}){
 if(typeof selector!=='string'||!selector||typeof caseId!=='string'||!caseId)throw new Error('ADMIN_VISUAL_AX_EXACT_TARGET_REQUIRED');
 return collectTarget(page,{selector,target:[selector],ruleId:'label-content-name-mismatch',caseId,axOnly:true});
}

/** Call immediately after the raw scanner or measureAdminVisualAccessibility.
 * Does not rerun/replace other rules, change preferences or grant a rule pass.
 * Raw images stay in the explicitly supplied private directory outside Git.
 */
export async function collectAdminVisualEvidence(page,{evidenceDir,caseId,accessibility,scanner}){
 const moduleUrl=import.meta.url;
 const workspace=fileURLToPath(new URL('../../../',moduleUrl)),directory=resolve(evidenceDir??''),location=relative(workspace,directory);
 if(!evidenceDir||!isAbsolute(evidenceDir)||(!location.startsWith('..')&&!isAbsolute(location)))throw new Error('ADMIN_VISUAL_PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
 if(typeof caseId!=='string'||!caseId)throw new Error('ADMIN_VISUAL_EVIDENCE_CASE_REQUIRED');
 await mkdir(directory,{recursive:true,mode:0o700});
 const evidence=[],output={accessibility:accessibility?structuredClone(accessibility):undefined,scanner:scanner?structuredClone(scanner):undefined,evidence};
 if(output.accessibility){
  const result=output.accessibility;
  for(const rule of result.incomplete){
   if(!['color-contrast','label-content-name-mismatch'].includes(rule.id))continue;
   for(const node of rule.nodes){
    if(!simpleTarget(node.target)||hasViolation(result,node.target))continue;
    const proof=await collectTarget(page,{selector:node.target[0],target:node.target,ruleId:rule.id,evidenceDir:directory,caseId,axOnly:rule.id==='label-content-name-mismatch'});
    evidence.push(proof);
    const existing=result.remeasurements.findIndex(row=>isDeepStrictEqual(row.target,node.target)&&(row.ruleId??'color-contrast')===rule.id);
    if(existing>=0){proof.originalRemeasurement=result.remeasurements[existing];result.remeasurements[existing]=proof;}else result.remeasurements.push(proof);
   }
  }
  result.incomplete=result.incomplete.map(rule=>({...rule,nodes:rule.nodes.filter(node=>!evidence.some(proof=>proof.ruleId===rule.id&&proof.resolved&&isDeepStrictEqual(proof.target,node.target)))})).filter(rule=>rule.nodes.length);
 }
 if(output.scanner){
  const result=output.scanner;result.originalIndeterminate=structuredClone(result.indeterminate);result.pixelEvidence=[];
  for(const [index,issue] of result.originalIndeterminate.entries()){
   if(issue.code!=='CONTRAST_UNRESOLVED'||issue.minimum!==4.5||issue.contrastKind!=='text'||result.violations.some(violation=>violation.selector===issue.selector))continue;
   const proof=await collectTarget(page,{selector:issue.selector,evidenceDir:directory,caseId});proof.originalIssueIndex=index;result.pixelEvidence.push(proof);evidence.push(proof);
  }
  result.indeterminate=result.indeterminate.filter((_,index)=>!result.pixelEvidence.some(proof=>proof.originalIssueIndex===index&&proof.resolved));
  result.compliant=!result.violations.length&&!result.indeterminate.length;result.shouldFail=result.mode==='strict'&&!result.compliant;
 }
 return output;
}

/** Self-contained browser evaluator; axe is the real injected engine. */
export async function measureAdminVisualAccessibility(){
 const progress=(stage,position={})=>{globalThis.__AYAHX_ADMIN_VISUAL_AXE_PROGRESS__={acceptance:false,stage,startedAtMs:performance.now(),...position};};
 progress('initial-axe');
 const dialogs=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(el).visibility!=='hidden';});
 const scope=dialogs.at(-1)??document.querySelector('.admin-app');
 const summarize=rule=>({id:rule.id,...(rule.impact?{impact:rule.impact}:{}),...(rule.help?{help:rule.help,helpUrl:rule.helpUrl}:{}),nodes:rule.nodes.map(node=>({target:node.target}))});
 const result=await axe.run(scope,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},elementRef:true});
 progress('initial-axe-complete');
 const violations=result.violations.map(summarize),originalIncomplete=result.incomplete.map(summarize),incomplete=[],remeasurements=[];
 const paint=async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));while(document.getAnimations().some(animation=>animation.effect?.getTiming().iterations!==Infinity&&(animation.pending||!['finished','idle'].includes(animation.playState))))await new Promise(resolve=>requestAnimationFrame(resolve));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
 let visibilityDiagnostic=null;
 const pack=rect=>rect?{x:rect.x??rect.left,y:rect.y??rect.top,width:rect.width,height:rect.height}:null;
 const fullyVisible=el=>{
  visibilityDiagnostic=null;
  const reject=(code,rect,extra={})=>{visibilityDiagnostic={code,rect:pack(rect),targetTag:el.tagName,viewport:{width:innerWidth,height:innerHeight},...extra};return false;};
  if(!el.isConnected||!scope.contains(el))return reject('TARGET_OUTSIDE_ACTIVE_SCOPE',el.getBoundingClientRect());
  // DPR geometry can represent a shared CSS edge a few millionths of a pixel
  // differently. This bounded tolerance cannot hide a 0.001px clipping defect.
  const tolerance=0.0001;
  const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return reject('EMPTY_RECT',r);if(r.left < -tolerance||r.top < -tolerance||r.right>innerWidth+tolerance||r.bottom>innerHeight+tolerance)return reject('VIEWPORT_CLIPPING',r);
  for(let p=el;p;p=p.parentElement){
   const s=getComputedStyle(p),b=p.getBoundingClientRect();
   const ancestor={ancestorTag:p.tagName,ancestorRect:pack(b),overflowX:s.overflowX,overflowY:s.overflowY,borders:{left:parseFloat(s.borderLeftWidth)||0,right:parseFloat(s.borderRightWidth)||0,top:parseFloat(s.borderTopWidth)||0,bottom:parseFloat(s.borderBottomWidth)||0},scroll:{left:p.scrollLeft,top:p.scrollTop}};
   if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)!==1||p.hasAttribute('hidden'))return reject('ANCESTOR_NOT_VISIBLE',r,{...ancestor,display:s.display,visibility:s.visibility,opacity:s.opacity,hidden:p.hasAttribute('hidden')});
   // A painted target border box cannot clip itself at its inner border edge.
   // Ancestors still clip this box; exact axe then checks the actual content.
   if(p===el)continue;
   if(/hidden|clip|auto|scroll/.test(s.overflowX)&&(r.left<b.left+(parseFloat(s.borderLeftWidth)||0)-tolerance||r.right>b.right-(parseFloat(s.borderRightWidth)||0)+tolerance))return reject('ANCESTOR_CLIPPING_X',r,ancestor);
   if(/hidden|clip|auto|scroll/.test(s.overflowY)&&(r.top<b.top+(parseFloat(s.borderTopWidth)||0)-tolerance||r.bottom>b.bottom-(parseFloat(s.borderBottomWidth)||0)+tolerance))return reject('ANCESTOR_CLIPPING_Y',r,ancestor);
  }
  // A rectangular viewport inclusion alone cannot prove paint through an
  // independent overlay. Require the reported target to own every hit point.
  if(typeof document.elementsFromPoint!=='function')return reject('HIT_TEST_UNAVAILABLE',r);
  // Rounded controls do not paint their rectangular corners. Test the center
  // and the four edge midpoints, which remain inside their actual hit shape.
  const cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
  return [[cx,cy],[cx,r.top+.1],[r.right-.1,cy],[cx,r.bottom-.1],[r.left+.1,cy]].every(([x,y])=>{const hit=document.elementsFromPoint(x,y)[0];return !!hit&&(hit===el||el.contains(hit))||reject('HIT_TARGET_NOT_OWNED',r,{point:{x,y},hitTopTag:hit?.tagName??null,hitTopRect:pack(hit?.getBoundingClientRect())});});
 };
 for(const rule of result.incomplete){
  if(rule.id!=='color-contrast'){incomplete.push(summarize(rule));continue;}
  const unresolved=[];
  for(const [nodeIndex,node] of rule.nodes.entries()){
   const nodeStartedAt=performance.now(),nodeProgress={ruleId:'color-contrast',nodeIndex,nodesTotal:rule.nodes.length};progress('node-identify',nodeProgress);
   const evidence={target:node.target,resolved:false,fullyVisibleBeforeRun:false,fullyVisibleAfterRun:false,reason:'TARGET_NOT_IDENTIFIED',passTargets:[],violations:[],incomplete:[]};remeasurements.push(evidence);
   // Frame/shadow paths require their own browser surface and cannot be
   // certified by a document selector. All such targets remain unresolved.
   const simple=Array.isArray(node.target)&&node.target.length===1&&typeof node.target[0]==='string';
   let matches=[];if(simple)try{matches=[...document.querySelectorAll(node.target[0])];}catch{/* Invalid selector remains unknown. */}
   const el=node.element;
   if(!simple||matches.length!==1||matches[0]!==el||!(el instanceof Element)||!scope.contains(el)){unresolved.push({target:node.target});continue;}
   const ancestors=[];for(let p=el.parentElement;p;p=p.parentElement)ancestors.push({element:p,left:p.scrollLeft,top:p.scrollTop});
   const windowPosition={left:scrollX,top:scrollY};
   try{
    progress('node-prepare-paint',{...nodeProgress,targetTag:el.tagName});el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});await paint();
    const bounds=el.getBoundingClientRect();evidence.measuredRect={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
    evidence.scrollMoves=ancestors.filter(position=>position.left!==position.element.scrollLeft||position.top!==position.element.scrollTop).map(position=>({tag:position.element.tagName,before:{left:position.left,top:position.top},after:{left:position.element.scrollLeft,top:position.element.scrollTop}}));
    evidence.fullyVisibleBeforeRun=fullyVisible(el);
    if(visibilityDiagnostic)evidence.visibilityDiagnostic=visibilityDiagnostic;
    if(!evidence.fullyVisibleBeforeRun){evidence.reason='TARGET_NOT_FULLY_VISIBLE';unresolved.push({target:node.target});continue;}
    progress('node-axe',{...nodeProgress,targetTag:el.tagName});const measured=await axe.run(el,{runOnly:{type:'rule',values:['color-contrast']},elementRef:true,resultTypes:['violations','incomplete','passes']});
    evidence.fullyVisibleAfterRun=fullyVisible(el);
    if(visibilityDiagnostic)evidence.afterVisibilityDiagnostic=visibilityDiagnostic;
    evidence.violations=measured.violations.map(summarize);evidence.incomplete=measured.incomplete.map(summarize);
    evidence.passTargets=measured.passes.filter(pass=>pass.id==='color-contrast').flatMap(pass=>pass.nodes.map(passed=>passed.target));
    violations.push(...evidence.violations);
    // No violations, no applicable node, or a descendant's pass never proves
    // the initially incomplete target. Require this exact DOM element's PASS.
    const exactPass=measured.passes.some(pass=>pass.id==='color-contrast'&&pass.nodes.some(passed=>passed.element===el));
    evidence.resolved=evidence.fullyVisibleAfterRun&&exactPass&&!measured.violations.length&&!measured.incomplete.length;
    evidence.reason=evidence.resolved?'EXACT_VISIBLE_CONTRAST_PASS':'EXACT_VISIBLE_CONTRAST_PASS_REQUIRED';
    if(!evidence.resolved)unresolved.push({target:node.target});
   }finally{
    progress('node-restore-paint',{...nodeProgress,targetTag:el.tagName});
    for(const position of ancestors){position.element.scrollLeft=position.left;position.element.scrollTop=position.top;}
    scrollTo({left:windowPosition.left,top:windowPosition.top,behavior:'instant'});await paint();
    evidence.durationMs=performance.now()-nodeStartedAt;progress('node-complete',{...nodeProgress,targetTag:el.tagName,durationMs:evidence.durationMs});
   }
  }
  if(unresolved.length)incomplete.push({...summarize(rule),nodes:unresolved});
 }
 progress('complete');return{violations,incomplete,originalIncomplete,remeasurements};
}

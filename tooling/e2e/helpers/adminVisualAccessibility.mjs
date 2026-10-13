/** Self-contained browser evaluator; axe is the real injected engine. */
export async function measureAdminVisualAccessibility(){
 const dialogs=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(el).visibility!=='hidden';});
 const scope=dialogs.at(-1)??document.querySelector('.admin-app');
 const summarize=rule=>({id:rule.id,...(rule.impact?{impact:rule.impact}:{}),...(rule.help?{help:rule.help,helpUrl:rule.helpUrl}:{}),nodes:rule.nodes.map(node=>({target:node.target}))});
 const result=await axe.run(scope,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},elementRef:true});
 const violations=result.violations.map(summarize),originalIncomplete=result.incomplete.map(summarize),incomplete=[],remeasurements=[];
 const paint=async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
 const fullyVisible=el=>{
  if(!el.isConnected||!scope.contains(el))return false;
  const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return false;
  for(let p=el;p;p=p.parentElement){
   const s=getComputedStyle(p),b=p.getBoundingClientRect();
   if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)!==1||p.hasAttribute('hidden'))return false;
   if(/hidden|clip|auto|scroll/.test(s.overflowX)&&(r.left<b.left+(parseFloat(s.borderLeftWidth)||0)||r.right>b.right-(parseFloat(s.borderRightWidth)||0)))return false;
   if(/hidden|clip|auto|scroll/.test(s.overflowY)&&(r.top<b.top+(parseFloat(s.borderTopWidth)||0)||r.bottom>b.bottom-(parseFloat(s.borderBottomWidth)||0)))return false;
  }
  // A rectangular viewport inclusion alone cannot prove paint through an
  // independent overlay. Require the reported target to own every hit point.
  if(typeof document.elementsFromPoint!=='function')return false;
  return [[(r.left+r.right)/2,(r.top+r.bottom)/2],[r.left+.1,r.top+.1],[r.right-.1,r.top+.1],[r.left+.1,r.bottom-.1],[r.right-.1,r.bottom-.1]].every(([x,y])=>{const hit=document.elementsFromPoint(x,y)[0];return !!hit&&(hit===el||el.contains(hit));});
 };
 for(const rule of result.incomplete){
  if(rule.id!=='color-contrast'){incomplete.push(summarize(rule));continue;}
  const unresolved=[];
  for(const node of rule.nodes){
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
    el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});await paint();
    const bounds=el.getBoundingClientRect();evidence.measuredRect={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
    evidence.scrollMoves=ancestors.filter(position=>position.left!==position.element.scrollLeft||position.top!==position.element.scrollTop).map(position=>({tag:position.element.tagName,before:{left:position.left,top:position.top},after:{left:position.element.scrollLeft,top:position.element.scrollTop}}));
    evidence.fullyVisibleBeforeRun=fullyVisible(el);
    if(!evidence.fullyVisibleBeforeRun){evidence.reason='TARGET_NOT_FULLY_VISIBLE';unresolved.push({target:node.target});continue;}
    const measured=await axe.run(el,{runOnly:{type:'rule',values:['color-contrast']},elementRef:true,resultTypes:['violations','incomplete','passes']});
    evidence.fullyVisibleAfterRun=fullyVisible(el);
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
    for(const position of ancestors){position.element.scrollLeft=position.left;position.element.scrollTop=position.top;}
    scrollTo({left:windowPosition.left,top:windowPosition.top,behavior:'instant'});await paint();
   }
  }
  if(unresolved.length)incomplete.push({...summarize(rule),nodes:unresolved});
 }
 return{violations,incomplete,originalIncomplete,remeasurements};
}

import {withAdminVisualDeadline} from './adminVisualRuntimeGuards.mjs';

export function setAdminVisualScanPhase(report,operation,position={}){
 if(!/^[a-z-]{1,50}$/u.test(operation))throw new Error('ADMIN_VISUAL_SCAN_OPERATION_INVALID');
 const scope=report.activeDialog?'dialog':'page';
 report.phase=scope+'-scanner-'+operation;
 report.currentMeasurement={scope,operation,startedAt:new Date().toISOString(),...Object.fromEntries(['documentTop','panelId','panelTop','total','step'].filter(key=>Number.isFinite(position[key])).map(key=>[key,position[key]]))};
}

/** Synchronous read-only diagnostic: it never waits for fonts/animations or
 * pretends that paused finite motion has settled. No text or DOM IDs returned. */
export function diagnoseAdminVisualPaintDocument(){
 const all=document.getAnimations(),fonts=[...document.fonts];
 return{version:'admin-visual-paint-diagnostic-1',acceptance:false,
  fonts:{status:document.fonts.status,total:fonts.length,loading:fonts.filter(font=>font.status==='loading').length,error:fonts.filter(font=>font.status==='error').length},
  viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
  animationCount:all.length,animations:all.slice(0,64).map(animation=>{
   const timing=animation.effect?.getTiming();
   return{playState:animation.playState,pending:animation.pending===true,currentTime:typeof animation.currentTime==='number'?animation.currentTime:null,
    iterations:Number.isFinite(timing?.iterations)?timing.iterations:null,infinite:timing?.iterations===Infinity,
    duration:typeof timing?.duration==='number'?timing.duration:null,playbackRate:animation.playbackRate,
    targetTag:animation.effect?.target?.tagName??null};
  }),truncated:all.length>64};
}

export async function collectAdminVisualFailureDiagnostic(page){
 try{return await withAdminVisualDeadline(()=>page.evaluate(diagnoseAdminVisualPaintDocument),{timeoutMs:3000,code:'ADMIN_VISUAL_FAILURE_DIAGNOSTIC_TIMEOUT'});}
 catch{return{version:'admin-visual-paint-diagnostic-1',acceptance:false,code:'ADMIN_VISUAL_FAILURE_DIAGNOSTIC_UNAVAILABLE'};}
}

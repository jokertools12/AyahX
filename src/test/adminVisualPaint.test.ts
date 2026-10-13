import {afterEach,describe,expect,it,vi} from 'vitest';
import {waitForAdminVisualPaint} from '../../tooling/e2e/helpers/adminVisualPaint.mjs';
import {withAdminVisualDeadline} from '../../tooling/e2e/helpers/adminVisualRuntimeGuards.mjs';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('native visual paint evidence',()=>{
 it('uses actual finished state even when the captured finished promise never resolves',async()=>{
  const stale=vi.fn(()=>new Promise(()=>{})),animation={playState:'finished',pending:false,effect:{getTiming:()=>({iterations:1})},get finished(){return stale();}};let frames=0;
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},getAnimations:()=>[animation]});vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames++;callback(0);return frames;});
  await withAdminVisualDeadline(waitForAdminVisualPaint,{timeoutMs:100});expect(frames).toBe(3);expect(stale).not.toHaveBeenCalled();
 });
 it('collects after the first frame and polls running/pending finite motion until actually finished, then paints two frames',async()=>{
  let frames=0;const animation={playState:'running',pending:true,effect:{getTiming:()=>({iterations:1})},get finished(){throw new Error('Do not capture finished promises');}};
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},getAnimations:()=>[animation,{playState:'running',effect:{getTiming:()=>({iterations:Infinity})}}]});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames++;if(frames===2){animation.playState='finished';animation.pending=false;}callback(0);return frames;});
  await waitForAdminVisualPaint();expect(frames).toBe(4);expect(animation.playState).toBe('finished');
 });
 it.each(['paused','running'])('keeps %s finite motion unsettled until the outer deadline, without cancelling or changing it',async playState=>{
  vi.useFakeTimers();const animation={playState,pending:false,effect:{getTiming:()=>({iterations:1})}};
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},getAnimations:()=>[animation]});vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),16));
  const waiting=withAdminVisualDeadline(waitForAdminVisualPaint,{timeoutMs:100}),rejected=expect(waiting).rejects.toThrow('ADMIN_VISUAL_EVALUATE_TIMEOUT');await vi.advanceTimersByTimeAsync(100);await rejected;expect(animation.playState).toBe(playState);
 });
 it('is self-contained for browser evaluation without animation or motion mutation',async()=>{
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},getAnimations:()=>[]});vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
  const native=new Function(`return (${waitForAdminVisualPaint.toString()});`)();await expect(native()).resolves.toBeUndefined();
 });
});

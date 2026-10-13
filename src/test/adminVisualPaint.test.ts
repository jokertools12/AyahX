import {afterEach,describe,expect,it,vi} from 'vitest';
import {waitForAdminVisualPaint} from '../../tooling/e2e/helpers/adminVisualPaint.mjs';
afterEach(()=>vi.unstubAllGlobals());
describe('native visual paint evidence',()=>{
 it('collects hover transitions after the first frame, waits their actual completion and paints two final frames',async()=>{
  const events:string[]=[];let finish!:()=>void;
  const finished=new Promise<void>(resolve=>{finish=()=>{events.push('animation-finished');resolve();};});
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve().then(()=>events.push('fonts-ready'))},getAnimations:()=>{events.push('collect-native-animations');return[{effect:{getTiming:()=>({iterations:1})},finished},{effect:{getTiming:()=>({iterations:Infinity})},finished:new Promise(()=>{})}];}});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{events.push('frame');callback(0);return 1;});
  const waiting=waitForAdminVisualPaint();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  expect(events).toEqual(['fonts-ready','frame','collect-native-animations']);finish();await waiting;
  expect(events).toEqual(['fonts-ready','frame','collect-native-animations','animation-finished','frame','frame']);
 });
 it('is self-contained for browser evaluation without animation or motion mutation',async()=>{
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},getAnimations:()=>[]});vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
  const native=new Function(`return (${waitForAdminVisualPaint.toString()});`)();await expect(native()).resolves.toBeUndefined();
 });
});

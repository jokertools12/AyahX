// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {adminVisualNativePixelClip,assertAdminVisualNativePixelDimensions,captureAdminVisualNativeZoomTextPng} from '../../tooling/e2e/helpers/adminVisualNativePixelCapture.mjs';

// Protocol/PNG doubles verify geometry only; root owns actual native zoom proof.
const rect={x:40,y:150,width:89.708,height:28},metrics=(zoom=1.5)=>({cssVisualViewport:{pageX:5,pageY:100,clientWidth:260,clientHeight:562,scale:1,zoom}});
const png=(width=134,height=42)=>createCanvas(width,height).toBuffer('image/png');
describe('candidate actual native zoom DIP capture',()=>{
 it.each([1,1.25,1.5,2])('converts CSS range plus actual document scroll to DIP at %s, keeping scale1',zoom=>{
  expect(adminVisualNativePixelClip(rect,metrics(zoom),zoom)).toEqual({x:45*zoom,y:250*zoom,width:89.708*zoom,height:28*zoom,scale:1});
 });
 it('rejects unavailable native zoom, pinch zoom, off-screen and empty ranges',()=>{
  for(const value of [{...metrics(),cssVisualViewport:{...metrics().cssVisualViewport,zoom:undefined}},{...metrics(),cssVisualViewport:{...metrics().cssVisualViewport,scale:1.2}}])expect(()=>adminVisualNativePixelClip(rect,value,1.5)).toThrow('CSS_METRICS_REQUIRED');
  expect(()=>adminVisualNativePixelClip({...rect,x:-1},metrics(),1.5)).toThrow('OUTSIDE_VIEWPORT');expect(()=>adminVisualNativePixelClip({...rect,width:0},metrics(),1.5)).toThrow('RECT_REQUIRED');
  expect(()=>adminVisualNativePixelClip(rect,metrics(1),1.5)).toThrow('ZOOM_MISMATCH');
 });
 it('rejects the actual reported 89×28 defect, accepting only actual134×42 bytes without resizing',()=>{
  expect(()=>assertAdminVisualNativePixelDimensions(png(89,28),rect,1.5)).toThrow('DIMENSIONS_MISMATCH');expect(assertAdminVisualNativePixelDimensions(png(),rect,1.5)).toEqual({width:134,height:42});
  expect(()=>assertAdminVisualNativePixelDimensions(Buffer.from('not png'),rect,1.5)).toThrow('PNG_REQUIRED');
 });
 it('requests only real CDP metrics/surface capture, preserves returned PNG bytes and detaches',async()=>{
  const encoded=png(),send=vi.fn(async(method:string)=>method==='Page.getLayoutMetrics'?metrics():{data:encoded.toString('base64')}),detach=vi.fn(async()=>{}),page={context:()=>({newCDPSession:vi.fn(async()=>({send,detach}))})};
  const result=await captureAdminVisualNativeZoomTextPng(page,rect,{dpr:1.5});expect(result.png).toEqual(encoded);expect(result.geometry).toMatchObject({method:'CDP_DIP_TEXT_RANGE_PNG',width:134,height:42,dpr:1.5,zoom:1.5});
  expect(send.mock.calls.map(row=>row[0])).toEqual(['Page.getLayoutMetrics','Page.captureScreenshot']);expect(send).toHaveBeenLastCalledWith('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:adminVisualNativePixelClip(rect,metrics(),1.5)});expect(detach).toHaveBeenCalledTimes(1);
 });
 it('never falls back to Playwright screenshots or resampling on bad CDP bytes',async()=>{
  const send=vi.fn(async(method:string)=>method==='Page.getLayoutMetrics'?metrics():{data:png(89,28).toString('base64')}),detach=vi.fn(async()=>{}),screenshot=vi.fn(),page={context:()=>({newCDPSession:vi.fn(async()=>({send,detach}))}),screenshot};
  await expect(captureAdminVisualNativeZoomTextPng(page,rect,{dpr:1.5})).rejects.toThrow('DIMENSIONS_MISMATCH');expect(detach).toHaveBeenCalledTimes(1);expect(screenshot).not.toHaveBeenCalled();
 });
});

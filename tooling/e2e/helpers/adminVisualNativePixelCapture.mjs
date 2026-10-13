import {withAdminVisualDeadline} from './adminVisualRuntimeGuards.mjs';

const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
/** Root proved real native-zoom pixel position and dimensions. CDP clips use DIP, while Range
 * rectangles and cssVisualViewport offsets use CSS pixels.
 * https://chromedevtools.github.io/devtools-protocol/tot/Page/#type-Viewport */
export function adminVisualNativePixelClip(rect,metrics,dpr){
 requireProof(rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>0&&rect.height>0&&Number.isFinite(dpr)&&dpr>0,'ADMIN_VISUAL_NATIVE_PIXEL_RECT_REQUIRED');
 const viewport=metrics?.cssVisualViewport,zoom=viewport?.zoom;
 requireProof(viewport&&['pageX','pageY','clientWidth','clientHeight','scale','zoom'].every(key=>Number.isFinite(viewport[key]))&&zoom>0&&viewport.scale===1,'ADMIN_VISUAL_NATIVE_PIXEL_CSS_METRICS_REQUIRED');
 requireProof(Math.abs(zoom-dpr)<=.02,'ADMIN_VISUAL_NATIVE_PIXEL_ZOOM_MISMATCH');
 requireProof(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.clientWidth+.0001&&rect.y+rect.height<=viewport.clientHeight+.0001,'ADMIN_VISUAL_NATIVE_PIXEL_OUTSIDE_VIEWPORT');
 return{x:(rect.x+viewport.pageX)*zoom,y:(rect.y+viewport.pageY)*zoom,width:rect.width*zoom,height:rect.height*zoom,scale:1};
}
export function assertAdminVisualNativePixelDimensions(png,rect,dpr){
 requireProof(Buffer.isBuffer(png)&&png.length>=24&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.toString('ascii',12,16)==='IHDR','ADMIN_VISUAL_NATIVE_PIXEL_PNG_REQUIRED');
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 // Same existing capture rounding allowance; no image resize/resampling.
 requireProof(width>0&&height>0&&Math.abs(width-rect.width*dpr)<=2&&Math.abs(height-rect.height*dpr)<=2,'ADMIN_VISUAL_NATIVE_PIXEL_DIMENSIONS_MISMATCH');
 return{width,height};
}
export async function captureAdminVisualNativeZoomTextPng(page,rect,{dpr}){
 const bounded=operation=>withAdminVisualDeadline(operation,{timeoutMs:10000,code:'ADMIN_VISUAL_NATIVE_PIXEL_CAPTURE_TIMEOUT'});
 const session=await bounded(()=>page.context().newCDPSession(page));
 try{
  const metrics=await bounded(()=>session.send('Page.getLayoutMetrics')),clip=adminVisualNativePixelClip(rect,metrics,dpr);
  const {data}=await bounded(()=>session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip}));
  requireProof(typeof data==='string'&&data.length>0,'ADMIN_VISUAL_NATIVE_PIXEL_PNG_REQUIRED');
  const png=Buffer.from(data,'base64'),dimensions=assertAdminVisualNativePixelDimensions(png,rect,dpr);
  const cssVisualViewport=Object.fromEntries(['pageX','pageY','clientWidth','clientHeight','scale','zoom'].map(key=>[key,metrics.cssVisualViewport[key]]));
  return{png,geometry:{method:'CDP_DIP_TEXT_RANGE_PNG',rect:{...rect},dpr,zoom:cssVisualViewport.zoom,cssVisualViewport,clip,...dimensions}};
 }finally{await bounded(()=>session.detach());}
}

import {createHash} from 'node:crypto';

const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
export function adminVisualContrastRatio(a,b){
 const luminance=color=>color.map(channel=>channel/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
 const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+.05)/(values[1]+.05);
}

/** Dominant opaque background and farthest repeatedly painted foreground.
 * Near colors (4/255 per channel) tolerate PNG/antialias rounding. Mixtures
 * along the foreground/background segment are antialiasing, not a new color.
 * Noise, missing solid glyph cores and multiple paint colors remain UNKNOWN.
 */
export function inspectAdminVisualPixels({data,width,height},{kind='text'}={}){
 if(!['text','nontext'].includes(kind))throw new Error('ADMIN_VISUAL_PIXEL_KIND_REQUIRED');
 const minimum=kind==='text'?4.5:3,total=width*height;
 const base={version:'admin-pixel-1',kind,minimum,width,height,totalPixels:total,antialiasTolerance:16,colorTolerance:4};
 const unknown=reason=>({...base,status:'ambiguous',passed:false,reason});
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||total>8_000_000||data?.length!==total*4)return unknown('INVALID_PIXEL_RECT');
 const histogram=new Map(),pixels=[];
 for(let offset=0;offset<data.length;offset+=4){
  if(data[offset+3]!==255)return unknown('TRANSPARENT_PIXEL');
  const color=[data[offset],data[offset+1],data[offset+2]],key=color.map(value=>Math.round(value/4)).join(',');pixels.push(color);
  const bin=histogram.get(key)??{color:[0,0,0],count:0};bin.count++;color.forEach((value,index)=>bin.color[index]+=value);histogram.set(key,bin);
 }
 const bins=[...histogram.values()].map(bin=>({...bin,color:bin.color.map(value=>value/bin.count)})).sort((a,b)=>b.count-a.count);
 const background=bins[0];
 if(background.count/total<.5)return unknown('NO_DOMINANT_BACKGROUND');
 // Text Range line boxes have whitespace around their glyphs. A second
 // background occupying their perimeter is a gradient/image, not antialias.
 // Otherwise a black glyph on a dark gradient stop could be certified using
 // only the dominant white stop. Such paint needs more specific evidence.
 let perimeterPixels=0,backgroundPerimeterPixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||y===0||x===width-1||y===height-1){perimeterPixels++;if(distance(pixels[y*width+x],background.color)<=7)backgroundPerimeterPixels++;}
 if(backgroundPerimeterPixels/perimeterPixels<.85)return unknown('AMBIGUOUS_BACKGROUND_PERIMETER');
 const support=Math.max(3,Math.ceil(total*.002)),candidates=bins.filter(bin=>bin.count>=support&&distance(bin.color,background.color)>16);
 if(!candidates.length)return unknown('NO_SUPPORTED_FOREGROUND');
 const foreground=candidates.sort((a,b)=>distance(b.color,background.color)-distance(a.color,background.color))[0];
 const vector=foreground.color.map((value,index)=>value-background.color[index]),length=vector.reduce((sum,value)=>sum+value*value,0);
 let unexplained=0;
 for(const color of pixels){
  const fraction=color.reduce((sum,value,index)=>sum+(value-background.color[index])*vector[index],0)/length;
  const closest=background.color.map((value,index)=>value+Math.max(0,Math.min(1,fraction))*vector[index]);
  if(fraction<-.05||fraction>1.05||distance(color,closest)>16)unexplained++;
 }
 // A rare farthest pixel never grants a pass. Competing paint/gradient/noise
 // must be investigated instead of selecting whichever color looks best.
 if(unexplained>Math.max(1,total*.005))return unknown('AMBIGUOUS_MULTICOLOR_PAINT');
 const ratio=adminVisualContrastRatio(foreground.color,background.color);
 const measured={...base,ratio,background:background.color,foreground:foreground.color,backgroundPixels:background.count,foregroundPixels:foreground.count,unexplainedPixels:unexplained,perimeterPixels,backgroundPerimeterPixels};
 if(ratio<minimum)return{...measured,status:'fail',passed:false,reason:'PIXEL_CONTRAST_BELOW_MINIMUM'};
 // Collinearity alone cannot distinguish antialias from another grayscale
 // glyph/gradient core. Antialias must border the actually supported solid
 // foreground meeting this exact rule's contrast minimum. Fine strokes may
 // have readable solid paint without matching the farthest color cluster.
 // Independently supported low-contrast intermediate paint remains UNKNOWN.
 const core=Uint8Array.from(pixels,color=>adminVisualContrastRatio(color,background.color)>=minimum?1:0);
 let intermediatePixelsWithoutCore=0;
 for(let index=0;index<pixels.length;index++){
  if(core[index]||distance(pixels[index],background.color)<=7)continue;
  const x=index%width,y=Math.floor(index/width);let adjacent=false;
  for(let dy=-1;dy<=1&&!adjacent;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<width&&ny>=0&&ny<height&&core[ny*width+nx]){adjacent=true;break;}}
  if(!adjacent)intermediatePixelsWithoutCore++;
 }
 if(intermediatePixelsWithoutCore>=support)return{...unknown('AMBIGUOUS_INTERMEDIATE_CORE'),intermediatePixelsWithoutCore};
 return{...measured,status:'pass',passed:true,reason:'PIXEL_CONTRAST_PASS',antialiasSupportMethod:'ADJACENT_READABLE_FOREGROUND_PIXEL',intermediatePixelsWithoutCore};
}

export async function inspectAdminVisualPng(png,options){
 const sha256=createHash('sha256').update(png).digest('hex');
 // Node decoding stays outside serialized browser evaluators.
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 try{
  const image=await loadImage(png),canvas=createCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);
  return{...inspectAdminVisualPixels(context.getImageData(0,0,image.width,image.height),options),sha256};
 }catch{return{version:'admin-pixel-1',status:'ambiguous',passed:false,reason:'PNG_DECODE_FAILED',sha256};}
}

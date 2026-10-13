import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectAdminVisualPixels,inspectAdminVisualPng,adminVisualContrastRatio} from '../../tooling/e2e/helpers/adminVisualPixelContrast.mjs';
import {collectAdminVisualEvidence,collectAdminVisualAxLabelEvidence,measureAdminVisualEvidenceTarget} from '../../tooling/e2e/helpers/adminVisualPixelEvidence.mjs';
import {assertAdminVisualDirectEvidence,assertAdminVisualScanEvidence,assertAdminVisualPixelProof,assertAdminVisualAxNameProof,normalizeAdminVisualLabel} from '../../tooling/e2e/helpers/adminVisualEvidenceValidation.mjs';

// These are synthetic images and synthetic protocol/page doubles. Only root's
// real browser acceptance can prove production paint and Accessibility names.
const image=(foreground='#000',background='#fff',antialias=false)=>{
 const canvas=createCanvas(100,20),context=canvas.getContext('2d');context.fillStyle=background;context.fillRect(0,0,100,20);
 context.fillStyle=foreground;for(let x=10;x<85;x+=15)context.fillRect(x,4,5,12);
 if(antialias){context.fillStyle='#808080';for(let x=10;x<85;x+=15)context.fillRect(x+5,4,1,12);}
 return{png:canvas.toBuffer('image/png'),pixels:context.getImageData(0,0,100,20)};
};
const target=['#target'],unknown=(id='color-contrast')=>({id,nodes:[{target}]}),rect={x:10,y:10,width:100,height:20};
const accessibility=(id='color-contrast')=>({violations:[],incomplete:[unknown(id)],originalIncomplete:[unknown(id)],remeasurements:[]});
const scanner=(code='CONTRAST_UNRESOLVED')=>({version:'admin-visual-1',mode:'strict',violations:[],indeterminate:[{code,selector:'#target',reason:'Unsupported paint',rect,minimum:4.5,contrastKind:'text'}],compliant:false,shouldFail:true});
const prepared={ready:true,reason:'VISIBLE_TEXT_RANGES',rects:[rect],visibleText:'EN',dpr:1,paint:{fontsReady:true,finiteAnimationsSettled:true,framesAfter:2},scrollState:{window:{left:0,top:0},parents:[]}};
const fakePage=(png=image().png,name='EN — Change language')=>{
 const send=vi.fn(async(method:string)=>method==='DOM.getDocument'?{root:{nodeId:1}}:method==='DOM.querySelector'?{nodeId:2}:method==='DOM.describeNode'?{node:{backendNodeId:3}}:method==='Accessibility.getPartialAXTree'?{nodes:[{backendDOMNodeId:3,ignored:false,name:{value:name}}]}:{});
 const detach=vi.fn(async()=>{}),evaluate=vi.fn(async(_fn:unknown,args:{action?:string})=>args.action==='restore'?{restored:true}:structuredClone(prepared));
 return{evaluate,screenshot:vi.fn(async()=>png),context:()=>({newCDPSession:vi.fn(async()=>({send,detach}))}),send,detach};
};
const privateDirectories:string[]=[];
const directory=async()=>{const path=await mkdtemp(join(tmpdir(),'ayahx-pixel-unit-'));privateDirectories.push(path);return path;};
afterEach(async()=>{for(const path of privateDirectories.splice(0))await rm(path,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});

describe('dominant background / supported farthest foreground PNG proof',()=>{
 it.each([['#000','#fff'],['#fff','#000']])('passes actual synthetic %s on %s with SHA-256',async(fg,bg)=>{
  const {png}=image(fg,bg),proof=await inspectAdminVisualPng(png,{kind:'text'});
  expect(proof).toMatchObject({passed:true,status:'pass',ratio:21,minimum:4.5,width:100,height:20});expect(proof.sha256).toBe(createHash('sha256').update(png).digest('hex'));
 });
 it('retains a repeated glyph core while tolerating antialias mixtures',()=>{expect(inspectAdminVisualPixels(image('#000','#fff',true).pixels)).toMatchObject({passed:true,ratio:21,unexplainedPixels:0});});
 it('fails low contrast and never rounds 4.499 up to 4.5',()=>{
  expect(inspectAdminVisualPixels(image('#aaa').pixels)).toMatchObject({passed:false,status:'fail'});
  expect(adminVisualContrastRatio([119,119,119],[255,255,255])).toBeLessThan(4.5);expect(inspectAdminVisualPixels(image('#777').pixels).passed).toBe(false);
 });
 it('uses 3 only for explicit nontext evidence; same gray text fails 4.5',()=>{
  const {pixels}=image('#888');expect(inspectAdminVisualPixels(pixels,{kind:'nontext'})).toMatchObject({passed:true,minimum:3});expect(inspectAdminVisualPixels(pixels,{kind:'text'})).toMatchObject({passed:false,minimum:4.5});
 });
 it('rejects a blank crop, transparent pixels, rare farthest noise and mixed color paint',()=>{
  const {pixels}=image('#fff');expect(inspectAdminVisualPixels(pixels).reason).toBe('NO_SUPPORTED_FOREGROUND');
  pixels.data[3]=0;expect(inspectAdminVisualPixels(pixels).reason).toBe('TRANSPARENT_PIXEL');
  const sparse=image('#fff').pixels;sparse.data.set([0,0,0,255],0);expect(inspectAdminVisualPixels(sparse).passed).toBe(false);
  const mixed=image().pixels;for(let offset=0;offset<80;offset+=4)mixed.data.set([255,0,0,255],offset);expect(inspectAdminVisualPixels(mixed).reason).toBe('AMBIGUOUS_MULTICOLOR_PAINT');
 });
 it('rejects distributed image noise instead of granting a pass to the extreme pixel',()=>{
  const {pixels}=image();for(let offset=0;offset<pixels.data.length;offset+=4)pixels.data.set([(offset*7)%256,(offset*13)%256,(offset*23)%256,255],offset);
  expect(inspectAdminVisualPixels(pixels)).toMatchObject({status:'ambiguous',passed:false,reason:'NO_DOMINANT_BACKGROUND'});
 });
 it('rejects a dark background stop that resembles an antialias shade instead of certifying only the dominant white stop',()=>{
  const canvas=createCanvas(100,20),context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,100,20);context.fillStyle='#555';context.fillRect(70,0,30,20);context.fillStyle='#000';context.fillRect(10,4,8,12);context.fillRect(80,4,8,12);
  expect(inspectAdminVisualPixels(context.getImageData(0,0,100,20))).toMatchObject({passed:false,status:'ambiguous',reason:'AMBIGUOUS_BACKGROUND_PERIMETER'});
 });
 it('reports undecodable PNG as ambiguous with its original byte hash',async()=>{expect(await inspectAdminVisualPng(Buffer.from('invalid'))).toMatchObject({passed:false,reason:'PNG_DECODE_FAILED',sha256:createHash('sha256').update('invalid').digest('hex')});});
});

describe('Node adapter retains the original unknown and only accepts direct evidence',()=>{
 it('captures only measured text rectangles after preparation and restores the scroll',async()=>{
  const page=fakePage(),evidenceDir=await directory(),raw=accessibility(),result=await collectAdminVisualEvidence(page,{evidenceDir,caseId:'synthetic',accessibility:raw});
  expect(result.accessibility.incomplete).toEqual([]);expect(result.accessibility.originalIncomplete).toEqual(raw.originalIncomplete);expect(raw.incomplete).toHaveLength(1);
  expect(page.screenshot).toHaveBeenCalledWith({type:'png',clip:rect,scale:'device',animations:'allow'});expect(page.evaluate.mock.calls.at(-1)?.[1]).toMatchObject({action:'restore'});
  const proof=result.accessibility.remeasurements[0];expect(()=>assertAdminVisualDirectEvidence(result.accessibility)).not.toThrow();
  expect(createHash('sha256').update(await readFile(join(evidenceDir,proof.images[0].file))).digest('hex')).toBe(proof.images[0].sha256);
 });
 it('fails a low contrast crop without converting an unknown to a pass',async()=>{
  const result=await collectAdminVisualEvidence(fakePage(image('#aaa').png),{evidenceDir:await directory(),caseId:'synthetic',accessibility:accessibility()});
  expect(result.accessibility.incomplete).toHaveLength(1);expect(result.evidence[0]).toMatchObject({resolved:false,reason:'PIXEL_CONTRAST_NOT_PROVEN'});expect(()=>assertAdminVisualDirectEvidence(result.accessibility)).toThrow();
 });
 it.each(['target-clipped','moved-after-capture'])('does not accept %s geometry',async(kind)=>{
  const page=fakePage();if(kind==='target-clipped')page.evaluate.mockResolvedValueOnce({...prepared,ready:false,reason:'TEXT_NOT_FULLY_VISIBLE'});else page.evaluate.mockResolvedValueOnce(prepared).mockResolvedValueOnce({...prepared,rects:[{...rect,x:11}]});
  const result=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',accessibility:accessibility()});expect(result.accessibility.incomplete).toHaveLength(1);expect(result.evidence[0].resolved).toBe(false);
 });
 it('reads the exact live AX node name via CDP without deriving it from DOM labels',async()=>{
  const page=fakePage(),raw=accessibility('label-content-name-mismatch'),result=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',accessibility:raw});
  expect(result.accessibility.incomplete).toEqual([]);expect(page.send).toHaveBeenCalledWith('Accessibility.getPartialAXTree',{nodeId:2,fetchRelatives:false});expect(page.detach).toHaveBeenCalled();expect(page.screenshot).not.toHaveBeenCalled();expect(()=>assertAdminVisualDirectEvidence(result.accessibility)).not.toThrow();
 });
 it('offers a direct AX regression probe without manufacturing an axe result',async()=>{
  const proof=await collectAdminVisualAxLabelEvidence(fakePage(),{selector:'#target',caseId:'synthetic'});expect(()=>assertAdminVisualAxNameProof(proof)).not.toThrow();
 });
 it('keeps a name containing the visible label later in the name unresolved',async()=>{
  const result=await collectAdminVisualEvidence(fakePage(undefined,'Change language EN'),{evidenceDir:await directory(),caseId:'synthetic',accessibility:accessibility('label-content-name-mismatch')});expect(result.accessibility.incomplete).toHaveLength(1);
 });
 it('cannot use an ancestor or ignored AX node as the target name',async()=>{
  const page=fakePage();page.send.mockImplementation(async(method:string)=>method==='DOM.getDocument'?{root:{nodeId:1}}:method==='DOM.querySelector'?{nodeId:2}:method==='DOM.describeNode'?{node:{backendNodeId:3}}:{nodes:[{backendDOMNodeId:4,ignored:false,name:{value:'EN — Change language'}}]});
  const result=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',accessibility:accessibility('label-content-name-mismatch')});expect(result.accessibility.incomplete).toHaveLength(1);
 });
 it('never processes other axe unknowns, frame targets or actual violations',async()=>{
  const raw=accessibility();raw.incomplete.push(unknown('scrollable-region-focusable'));raw.originalIncomplete.push(unknown('scrollable-region-focusable'));raw.violations.push(unknown() as never);
  const page=fakePage(),result=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',accessibility:raw});expect(result.accessibility.violations).toEqual(raw.violations);expect(result.accessibility.incomplete).toEqual(raw.incomplete);expect(page.screenshot).not.toHaveBeenCalled();
  const frame=accessibility();frame.incomplete[0].nodes[0].target=['iframe','#target'];const framed=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',accessibility:frame});expect(framed.accessibility.incomplete).toEqual(frame.incomplete);
 });
 it('bridges only scanner color text unknowns and preserves their original issue',async()=>{
  const raw=scanner(),result=await collectAdminVisualEvidence(fakePage(),{evidenceDir:await directory(),caseId:'synthetic',scanner:raw});expect(result.scanner).toMatchObject({indeterminate:[],originalIndeterminate:raw.indeterminate,compliant:true,shouldFail:false});expect(()=>assertAdminVisualScanEvidence(result.scanner)).not.toThrow();expect(raw.indeterminate).toHaveLength(1);
  const unsupported=await collectAdminVisualEvidence(fakePage(),{evidenceDir:await directory(),caseId:'synthetic',scanner:scanner('TEXT_OVERLAP')});expect(unsupported.scanner.indeterminate).toHaveLength(1);
 });
 it('does not use text pixels for unknown nontext boundaries or missing issue kind',async()=>{
  const raw=scanner();raw.indeterminate[0].contrastKind='nontext';raw.indeterminate[0].minimum=3;
  const page=fakePage(),result=await collectAdminVisualEvidence(page,{evidenceDir:await directory(),caseId:'synthetic',scanner:raw});expect(result.scanner.indeterminate).toHaveLength(1);expect(page.screenshot).not.toHaveBeenCalled();
 });
});

describe('serialized real browser text-range guard (synthetic DOM unit geometry)',()=>{
 let element:HTMLElement,frames:number,finished:ReturnType<typeof vi.fn>;
 const bounds=(x=10,y=10,width=120,height=40)=>({x,y,width,height,left:x,top:y,right:x+width,bottom:y+height});
 beforeEach(()=>{
  document.body.innerHTML='<main class="admin-app"><div id="panel"><button id="target"><span>EN</span><span class="sr-only">Hidden accessible text</span></button></div></main>';
  element=document.getElementById('target')!;frames=0;finished=vi.fn(async()=>{});
  vi.stubGlobal('innerWidth',800);vi.stubGlobal('innerHeight',600);vi.stubGlobal('devicePixelRatio',1.5);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames++;callback(0);return frames;});
  vi.stubGlobal('getComputedStyle',(node:Element)=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0',clip:node.classList.contains('sr-only')?'rect(0px, 0px, 0px, 0px)':'auto',clipPath:'none',content:'none'}));
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
  Object.defineProperty(document,'getAnimations',{configurable:true,value:()=>[{playState:'finished',pending:false,effect:{getTiming:()=>({iterations:1})},get finished(){return finished();}},{effect:{getTiming:()=>({iterations:Infinity})},get finished(){throw new Error('Infinite animation must not be awaited');}}]});
  Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[element]});
  Object.defineProperty(window,'scrollTo',{configurable:true,value:vi.fn()});
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>bounds() as DOMRect);
  Object.defineProperty(element,'scrollIntoView',{configurable:true,value:vi.fn()});
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[bounds(20,20,100,20)]});
 });
 it('serializes without module closures, centers, waits fonts/finite motion/two frames and reports only painted text',async()=>{
  const standalone=new Function(`return (${measureAdminVisualEvidenceTarget.toString()});`)(),proof=await standalone({selector:'#target',action:'prepare'});
  expect(proof).toMatchObject({ready:true,visibleText:'EN',rects:[{x:20,y:20,width:100,height:20}],dpr:1.5,paint:{fontsReady:true,finiteAnimationsSettled:true,framesAfter:2}});
  expect(element.scrollIntoView).toHaveBeenCalledWith({block:'center',inline:'center',behavior:'instant'});expect(finished).not.toHaveBeenCalled();expect(frames).toBe(3);
 });
 it('retains actual text clipping, overlays, ambiguous selectors and targets outside active scope',async()=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(node:Element)=>({...style(node),overflowY:node.id==='panel'?'hidden':'visible'}));
  vi.spyOn(document.getElementById('panel')!,'getBoundingClientRect').mockReturnValue(bounds(10,10,120,10) as DOMRect);
  expect(await measureAdminVisualEvidenceTarget({selector:'#target'})).toMatchObject({ready:false,reason:'TARGET_NOT_FULLY_VISIBLE',visibilityDiagnostic:{code:'ANCESTOR_CLIPPING_Y',ancestorTag:'DIV',overflowY:'hidden',ancestorRect:{height:10},rect:{height:40}}});
  expect(await measureAdminVisualEvidenceTarget({selector:'span'})).toMatchObject({ready:false,reason:'EXACT_TARGET_REQUIRED'});
  expect(await measureAdminVisualEvidenceTarget({selector:'body'})).toMatchObject({ready:false,reason:'TARGET_OUTSIDE_ACTIVE_SCOPE'});
 });
 it('rejects an independent overlay even if the text rectangle fits in the viewport',async()=>{
  Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[document.body,element]});expect(await measureAdminVisualEvidenceTarget({selector:'#target'})).toMatchObject({ready:false,reason:'TARGET_NOT_FULLY_VISIBLE',visibilityDiagnostic:{code:'HIT_TARGET_NOT_OWNED',targetTag:'BUTTON',hitTopTag:'BODY',point:{x:70,y:30}}});
 });
 it('reports the exact failed text Range rather than the still-visible control box',async()=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(node:Element)=>({...style(node),overflowY:node.id==='panel'?'auto':'visible'}));
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[bounds(20,9,100,25.5)]});
  const measured=await measureAdminVisualEvidenceTarget({selector:'#target'});
  expect(measured).toMatchObject({ready:false,reason:'TEXT_NOT_FULLY_VISIBLE',visibilityDiagnostic:{code:'ANCESTOR_CLIPPING_Y',targetTag:'BUTTON',nodeTag:'SPAN',ancestorTag:'DIV',rect:{x:20,y:9,width:100,height:25.5},ancestorRect:{x:10,y:10,width:120,height:40}}});
  expect(JSON.stringify(measured.visibilityDiagnostic)).not.toContain('Hidden accessible text');expect(JSON.stringify(measured.visibilityDiagnostic)).not.toContain('#target');
 });
 it('cannot crop generated or overlapping text as if it were ordinary glyph paint',async()=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(node:Element,pseudo?:string)=>({...style(node),content:pseudo?'"Badge"':'none'}));expect(await measureAdminVisualEvidenceTarget({selector:'#target'})).toMatchObject({ready:false,reason:'GENERATED_VISIBLE_CONTENT'});
 });
 it('restores both window and ancestor scrolling from the recorded positions',async()=>{
  await measureAdminVisualEvidenceTarget({selector:'#target',action:'restore',scrollState:{window:{left:5,top:6},parents:[{left:7,top:8}]}});expect(document.getElementById('panel')!.scrollTop).toBe(8);expect(window.scrollTo).toHaveBeenCalledWith({left:5,top:6,behavior:'instant'});
 });
});

describe('aggregate evidence cannot silently suppress unresolved findings',()=>{
 it('normalizes NFC and Arabic harakat and requires the full visible prefix',()=>{
  expect(normalizeAdminVisualLabel(' عَ   — تبديلُ اللغة ')).toBe('ع — تبديل اللغة');
  const proof={resolved:true,reason:'DIRECT_AX_VISIBLE_LABEL_PREFIX',fullyVisibleBeforeRun:true,fullyVisibleAfterRun:true,visibleText:'عَ',normalizedVisibleText:'ع',normalizedAccessibleName:'ع — تبديل اللغة',ax:{method:'CDP.Accessibility.getPartialAXTree',nodeId:2,backendDOMNodeId:3,ignored:false,accessibleName:'عَ — تبديلُ اللغة'}};
  expect(()=>assertAdminVisualAxNameProof(proof)).not.toThrow();expect(()=>assertAdminVisualAxNameProof({...proof,ax:{...proof.ax,method:'DOM.ariaLabel'}})).toThrow();
 });
 it('accepts the original strict exact-node axe pass without changing its threshold',()=>{
  const result={...accessibility(),incomplete:[],remeasurements:[{target,resolved:true,reason:'EXACT_VISIBLE_CONTRAST_PASS',fullyVisibleBeforeRun:true,fullyVisibleAfterRun:true,violations:[],incomplete:[],passTargets:[target]}]};expect(()=>assertAdminVisualDirectEvidence(result)).not.toThrow();
  result.remeasurements[0].passTargets=[['#descendant']];expect(()=>assertAdminVisualDirectEvidence(result)).toThrow();
 });
 it('rejects missing hash, inflated ratio, crop mismatch, and lowered thresholds',async()=>{
  const result=await collectAdminVisualEvidence(fakePage(),{evidenceDir:await directory(),caseId:'synthetic',accessibility:accessibility()}),proof=result.evidence[0];
  for(const change of [{sha256:''},{ratio:22},{minimum:3},{width:999}])expect(()=>assertAdminVisualPixelProof({...proof,images:[{...proof.images[0],...change}]})).toThrow();
 });
 it('requires proof for every original scanner unknown and other axe rules remain blockers',()=>{
  const result={...scanner(),compliant:true,shouldFail:false,indeterminate:[],originalIndeterminate:scanner().indeterminate,pixelEvidence:[]};expect(()=>assertAdminVisualScanEvidence(result)).toThrow();
  const axe={...accessibility('button-name'),incomplete:[]};expect(()=>assertAdminVisualDirectEvidence(axe)).toThrow('ADMIN_VISUAL_AXE_UNRESOLVED_RULE');
 });
});

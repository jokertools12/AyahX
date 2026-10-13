import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {measureAdminVisualAccessibility} from '../../tooling/e2e/helpers/adminVisualAccessibility.mjs';

// Unit engines/layout are synthetic. Acceptance uses real axe in root's browser.
const rect=(y=30)=>({x:20,y,width:100,height:30,left:20,top:y,right:120,bottom:y+30});
const node=(element:Element,target=['#target'])=>({element,target});
const result=(values:Record<string,unknown>={})=>({violations:[],incomplete:[],passes:[],...values});
let target:HTMLElement,other:HTMLElement,run:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 document.body.innerHTML='<main class="admin-app"><div id="panel"><p id="target">Readable text</p><p id="other">Other text</p></div></main>';
 target=document.getElementById('target')!;other=document.getElementById('other')!;
 vi.stubGlobal('innerWidth',800);vi.stubGlobal('innerHeight',600);
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
 vi.stubGlobal('getComputedStyle',()=>({visibility:'visible',display:'block',opacity:'1',overflowX:'visible',overflowY:'visible',borderLeftWidth:'0',borderRightWidth:'0',borderTopWidth:'0',borderBottomWidth:'0'}));
 Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 Object.defineProperty(document,'getAnimations',{configurable:true,value:()=>[]});
 Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[target]});
 Object.defineProperty(window,'scrollTo',{configurable:true,value:vi.fn()});
 vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>rect() as DOMRect);
 Object.defineProperty(target,'scrollIntoView',{configurable:true,value:vi.fn()});
 run=vi.fn();vi.stubGlobal('axe',{run});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
describe('real contrast remeasurement acceptance',()=>{
 it('serializes without module closures for native page evaluation',async()=>{
  run.mockResolvedValue(result());
  const standalone=new Function(`return (${measureAdminVisualAccessibility.toString()});`)();
  expect(await standalone()).toEqual({violations:[],incomplete:[],originalIncomplete:[],remeasurements:[]});
 });
 it('retains initial evidence and resolves only a measured fully visible exact node pass',async()=>{
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]})).mockResolvedValueOnce(result({passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();
  expect(measured.incomplete).toEqual([]);expect(measured.originalIncomplete).toHaveLength(1);expect(measured.remeasurements).toEqual([expect.objectContaining({target:['#target'],resolved:true,fullyVisibleBeforeRun:true,fullyVisibleAfterRun:true})]);
  expect(run.mock.calls[1][0]).toBe(target);expect(run.mock.calls[1][1]).toMatchObject({runOnly:{type:'rule',values:['color-contrast']},elementRef:true,resultTypes:['violations','incomplete','passes']});
  expect(target.scrollIntoView).toHaveBeenCalledWith({block:'center',inline:'center',behavior:'instant'});
 });
 it.each(['no-pass','different-node','wrong-rule','still-incomplete'])('keeps %s unresolved even when there are no violations',async(kind)=>{
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]}));
  run.mockResolvedValueOnce(kind==='no-pass'?result():kind==='different-node'?result({passes:[{id:'color-contrast',nodes:[node(other,['#other'])]}]}):kind==='wrong-rule'?result({passes:[{id:'button-name',nodes:[node(target)]}]}):result({passes:[{id:'color-contrast',nodes:[node(target)]}],incomplete:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toHaveLength(1);expect(measured.remeasurements[0].resolved).toBe(false);
 });
 it('cannot resolve an offscreen node',async()=>{
  vi.spyOn(target,'getBoundingClientRect').mockImplementation(()=>rect(-100) as DOMRect);
  run.mockResolvedValue(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}],passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toHaveLength(1);expect(run).toHaveBeenCalledTimes(1);expect(measured.remeasurements[0].reason).toBe('TARGET_NOT_FULLY_VISIBLE');
  expect(measured.remeasurements[0].visibilityDiagnostic).toMatchObject({code:'VIEWPORT_CLIPPING',targetTag:'P',rect:{y:-100},viewport:{width:800,height:600}});
 });
 it('cannot resolve a node still clipped by an overflow ancestor',async()=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(el:Element)=>({...style(el),overflowY:el.id==='panel'?'auto':'visible'}));
  vi.spyOn(document.getElementById('panel')!,'getBoundingClientRect').mockImplementation(()=>({...rect(),height:10,bottom:40}) as DOMRect);
  run.mockResolvedValue(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}],passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toHaveLength(1);expect(run).toHaveBeenCalledTimes(1);expect(measured.remeasurements[0].fullyVisibleBeforeRun).toBe(false);
  expect(measured.remeasurements[0].visibilityDiagnostic).toMatchObject({code:'ANCESTOR_CLIPPING_Y',ancestorTag:'DIV',overflowY:'auto',rect:{height:30},ancestorRect:{height:10}});
 });
 it('does not classify a visible own border box as clipped by its own one-pixel border',async()=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(el:Element)=>({...style(el),...(el===target?{overflowX:'auto',overflowY:'auto',borderLeftWidth:'1px',borderRightWidth:'1px',borderTopWidth:'1px',borderBottomWidth:'1px'}:{})}));
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]})).mockResolvedValueOnce(result({passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toEqual([]);expect(measured.remeasurements[0].resolved).toBe(true);expect(run).toHaveBeenCalledTimes(2);
 });
 it.each([0.0000038,0.001])('accepts only floating shared-edge noise, never actual clipping (%s px)',async(difference)=>{
  const style=getComputedStyle;vi.stubGlobal('getComputedStyle',(el:Element)=>({...style(el),overflowX:el.id==='panel'?'auto':'visible'}));
  vi.spyOn(document.getElementById('panel')!,'getBoundingClientRect').mockImplementation(()=>({...rect(),right:120-difference,width:100-difference}) as DOMRect);
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]})).mockResolvedValueOnce(result({passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.remeasurements[0].resolved).toBe(difference<0.0001);expect(measured.incomplete).toHaveLength(difference<0.0001?0:1);
 });
 it('does not grant a pass to a geometrically visible node hidden behind an overlay',async()=>{
  Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[other,target]});
  run.mockResolvedValue(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}],passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toHaveLength(1);expect(run).toHaveBeenCalledTimes(1);
  expect(measured.remeasurements[0].visibilityDiagnostic).toMatchObject({code:'HIT_TARGET_NOT_OWNED',targetTag:'P',hitTopTag:'P',point:{x:70,y:45}});
 });
 it('requires real contrast proof at painted points of a rounded target, whose empty corners hit its parent',async()=>{
  Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:(x:number,y:number)=>((x<22||x>118)&&(y<32||y>58))?[target.parentElement!]:[target]});
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]})).mockResolvedValueOnce(result({passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.incomplete).toEqual([]);expect(measured.remeasurements[0].resolved).toBe(true);expect(run).toHaveBeenCalledTimes(2);
 });
 it('preserves original and newly measured violations even alongside exact passes',async()=>{
  const initial={id:'button-name',nodes:[node(other,['#other'])]},actual={id:'color-contrast',nodes:[node(target)]};
  run.mockResolvedValueOnce(result({violations:[initial],incomplete:[actual]})).mockResolvedValueOnce(result({violations:[actual],passes:[{id:'color-contrast',nodes:[node(target)]}]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.violations.map(rule=>rule.id)).toEqual(['button-name','color-contrast']);expect(measured.incomplete).toHaveLength(1);
 });
 it('retains every unknown or non-contrast node and all actual violations',async()=>{
  const violation={id:'color-contrast',nodes:[node(target)]},unknown={id:'color-contrast',nodes:[{target:['iframe','#target']},{target:['#missing']}]},nonContrast={id:'scrollable-region-focusable',nodes:[node(target)]};
  run.mockResolvedValue(result({violations:[violation],incomplete:[unknown,nonContrast]}));
  const measured=await measureAdminVisualAccessibility();expect(measured.violations).toHaveLength(1);expect(measured.incomplete).toEqual([{id:unknown.id,nodes:unknown.nodes},{id:nonContrast.id,nodes:[{target:['#target']}]}]);expect(run).toHaveBeenCalledTimes(1);expect(measured.remeasurements).toHaveLength(2);
 });
 it('remeasures every reported contrast target rather than granting a rule-wide pass',async()=>{
  Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[target,other]});
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target),node(other,['#other'])]}]})).mockResolvedValueOnce(result({passes:[{id:'color-contrast',nodes:[node(target)]}]})).mockResolvedValueOnce(result());
  Object.defineProperty(other,'scrollIntoView',{configurable:true,value:vi.fn()});
  const measured=await measureAdminVisualAccessibility();expect(measured.remeasurements).toHaveLength(2);expect(measured.incomplete).toEqual([{id:'color-contrast',nodes:[{target:['#other']}]}]);
 });
 it('exposes per-node real axe phase without text, selectors or private attributes',async()=>{
  let observed:unknown;target.dataset.private='PRIVATE';
  run.mockResolvedValueOnce(result({incomplete:[{id:'color-contrast',nodes:[node(target)]}]})).mockImplementationOnce(async()=>{observed=(globalThis as unknown as Record<string,{stage:string;[key:string]:unknown}>).__AYAHX_ADMIN_VISUAL_AXE_PROGRESS__;return result({passes:[{id:'color-contrast',nodes:[node(target)]}]});});
  const measured=await measureAdminVisualAccessibility();expect(observed).toMatchObject({acceptance:false,stage:'node-axe',ruleId:'color-contrast',nodeIndex:0,nodesTotal:1,targetTag:'P'});expect(measured.remeasurements[0].durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(observed)).not.toMatch(/Readable|PRIVATE|#target/);expect((globalThis as unknown as Record<string,{stage:string;[key:string]:unknown}>).__AYAHX_ADMIN_VISUAL_AXE_PROGRESS__.stage).toBe('complete');
 });
});

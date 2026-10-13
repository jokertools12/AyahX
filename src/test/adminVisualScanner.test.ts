import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanAdminVisualDocument } from '../../tooling/e2e/helpers/adminVisualScanner';

// jsdom has no layout. Synthetic rectangle fixtures exercise scanner decisions,
// not browser acceptance; the real-browser matrix is a separate root-owned gate.
const box = (x: number, y: number, width: number, height: number): DOMRect => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({ x, y, width, height }) });
function layout(html: string, positions: Record<string, number[]> = {}): void {
  document.body.innerHTML = html;
  for (const [id, rect] of Object.entries(positions)) document.getElementById(id)!.setAttribute('data-box', rect.join(','));
}
const codes = () => scanAdminVisualDocument({ touch: false }).violations.map(x => x.code);

beforeEach(() => {
  Object.defineProperties(document.documentElement, { clientWidth: { configurable: true, value: 800 }, scrollWidth: { configurable: true, value: 800 } });
  Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 800 });
  vi.stubGlobal('innerHeight', 600); vi.stubGlobal('innerWidth', 800); vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const values = this.getAttribute('data-box')?.split(',').map(Number);
    return values ? box(values[0], values[1], values[2], values[3]) : box(0, 0, 800, 600);
  });
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => {
    const defaults: Record<string, string> = { display: 'block', visibility: 'visible', opacity: '1', position: 'static', fontSize: '15px', lineHeight: '25.5px', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', overflowX: 'visible', overflowY: 'visible', filter: 'none', backdropFilter: 'none', mixBlendMode: 'normal' };
    const resolve = (name: string): string => {
      const kebab = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      return (name === 'backdropFilter' ? el.getAttribute('data-backdrop-filter') : null) || el.style?.getPropertyValue(kebab) || defaults[name] || '';
    };
    return new Proxy({ getPropertyValue: (name: string) => resolve(name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())) }, { get(target, key) { return key === 'getPropertyValue' ? target.getPropertyValue : resolve(String(key)); } });
  });
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selected: Node | null = null;
    return { selectNodeContents: (node: Node) => { selected = node; }, getClientRects: () => {
      const parent = selected!.parentElement!;
      const r = parent.getBoundingClientRect();
      const textBox = parent.getAttribute('data-text-box')?.split(',').map(Number);
      if (textBox) return [box(textBox[0], textBox[1], textBox[2], textBox[3])];
      return [box(r.x, r.y, Math.min(r.width, (selected!.textContent?.length ?? 0) * 7), Math.min(r.height, 25.5))];
    } } as unknown as Range;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('admin visual document scanner', () => {
  it.each(['blur(0px)', 'blur(-0em)', 'brightness(1)', 'brightness(100%)', 'contrast(+01.000)', 'opacity(1)', 'saturate(100%)', 'grayscale(0)', 'invert(0%)', 'sepia(0.0)', 'hue-rotate(0deg)', 'blur(0px) brightness(1) grayscale(0)'])('measures exact identity filter %s without inventing an effective layer', filter => {
    layout(`<p id="identity" style="filter:${filter};background-color:rgb(255,255,255)">Readable</p>`, {identity:[10,20,200,30]});
    expect(scanAdminVisualDocument({touch:false}).indeterminate).toEqual([]);
    document.getElementById('identity')!.style.color='rgb(200,200,200)';
    expect(codes()).toContain('TEXT_CONTRAST');
  });
  it.each(['blur(0.00001px)', 'brightness(0.999999999999999999999)', 'brightness(1.000000000000000001)', 'grayscale(0.000001)', 'contrast(99.999%)', 'hue-rotate(1deg)', 'url(#unknown)', 'drop-shadow(0 0 transparent)', 'brightness(1) blur(1px)', 'unknown(0)', 'brightness(calc(1))', 'brightness(1e0)', 'blur()', 'none blur(0px)'])('retains indeterminate contrast for effective or unsupported filter %s', filter => {
    layout(`<p id="effective" style="filter:${filter};background-color:rgb(255,255,255)">Readable</p>`, {effective:[10,20,200,30]});
    expect(scanAdminVisualDocument({touch:false}).indeterminate.some(issue=>issue.code==='CONTRAST_UNRESOLVED')).toBe(true);
  });
  it('accepts exact backdrop identities and opacity one but retains translucent ancestors',()=>{
    layout('<section id="layer" data-backdrop-filter="blur(0px) brightness(100%)" style="opacity:1"><p id="text">Readable</p></section>',{layer:[0,0,400,100],text:[10,20,200,30]});
    expect(scanAdminVisualDocument({touch:false}).indeterminate).toEqual([]);
    document.getElementById('layer')!.style.opacity='0.999';
    expect(scanAdminVisualDocument({touch:false}).indeterminate.some(issue=>issue.code==='CONTRAST_UNRESOLVED')).toBe(true);
    document.getElementById('layer')!.style.opacity='1';document.getElementById('layer')!.setAttribute('data-backdrop-filter','blur(0.01px)');
    expect(scanAdminVisualDocument({touch:false}).indeterminate.some(issue=>issue.code==='CONTRAST_UNRESOLVED')).toBe(true);
  });
  it('does not call a populated table empty while its rows are below the viewport', () => {
    layout('<table id="table"><thead><tr><th>Heading</th></tr></thead><tbody><tr id="row"><td>Existing data</td></tr></tbody></table>', {table:[10,570,500,300],row:[10,640,500,52]});
    expect(codes()).not.toContain('EMPTY_TABLE_NO_HELP');
    document.getElementById('row')!.style.display='none';
    expect(codes()).toContain('EMPTY_TABLE_NO_HELP');
  });
  it('can be serialized for browser evaluate without module closures and never mutates DOM', () => {
    layout('<p id="safe">Readable text</p>', { safe: [10, 20, 200, 30] });
    const before = document.body.outerHTML;
    const standalone = new Function(`return (${scanAdminVisualDocument.toString()});`)() as typeof scanAdminVisualDocument;
    expect(standalone({ touch: false })).toEqual(scanAdminVisualDocument({ touch: false }));
    expect(document.body.outerHTML).toBe(before);
  });
  it('keeps identical mandatory thresholds in report-only and enforcing modes', () => {
    layout('<p id="small" style="font-size:14px">Readable report</p>', { small: [10, 20, 200, 30] });
    const baseline = scanAdminVisualDocument({ mode: 'baseline', touch: false });
    const strict = scanAdminVisualDocument({ mode: 'strict', touch: false });
    expect(baseline.thresholds).toEqual(strict.thresholds);
    expect(baseline.violations).toEqual(strict.violations);
    expect(baseline.compliant).toBe(false); expect(baseline.shouldFail).toBe(false); expect(strict.shouldFail).toBe(true);
    expect(JSON.parse(JSON.stringify(strict)).violations[0]).toMatchObject({ selector: '#small', actual: 14, minimum: 15, rect: { x: 10, y: 20 } });
  });
  it('applies semantic table/secondary/base font limits without weakening the absolute minimum', () => {
    layout('<p id="base">Base</p><small id="secondary" style="font-size:13px">Hint</small><small id="tiny" style="font-size:11px">Tiny</small><table id="table"><tbody><tr id="row"><td id="cell" style="font-size:14.5px">Cell</td></tr></tbody></table>', {
      base: [10, 10, 100, 30], secondary: [10, 60, 100, 30], tiny: [10, 100, 100, 30], table: [10, 160, 300, 60], row: [10, 160, 300, 52], cell: [10, 160, 100, 52],
    });
    expect(scanAdminVisualDocument({ touch: false }).violations.filter(x => x.code === 'FONT_TOO_SMALL').map(x => x.selector)).toEqual(['#tiny']);
  });
  it('requires Arabic line-height 1.7 and reports unresolved normal line-height', () => {
    layout('<p id="short" style="line-height:24px">نص عربي</p><p id="normal" style="line-height:normal">نص آخر</p>', { short: [10, 10, 200, 30], normal: [10, 60, 200, 30] });
    const report = scanAdminVisualDocument({ touch: false });
    expect(report.violations.find(x => x.code === 'ARABIC_LINE_HEIGHT')?.actual).toBe(1.6);
    expect(report.indeterminate.some(x => x.code === 'ARABIC_LINE_HEIGHT_UNRESOLVED')).toBe(true);
  });
  it('does not call naturally below-fold content offscreen or inspect hidden text', () => {
    layout('<p id="below" style="font-size:8px">Below</p><p id="hidden" style="display:none;font-size:8px">Hidden</p><p id="visible">Visible</p>', { below: [10, 700, 100, 20], hidden: [10, 10, 100, 20], visible: [10, 50, 100, 30] });
    const report = scanAdminVisualDocument({ touch: false });
    expect(report.scanned.textNodes).toBe(1); expect(report.violations).toEqual([]);
  });
  it('does not inspect retained Range boxes inside closed details except its first summary',()=>{
    layout('<details id="details"><summary id="summary">Visible summary</summary><p id="closed" style="font-size:8px">Not painted</p><button id="closed-button">Hidden control</button></details>',{summary:[10,10,180,44],closed:[10,30,180,30],'closed-button':[10,60,100,10]});
    const closed=scanAdminVisualDocument({touch:false});expect(closed.scanned.textNodes).toBe(1);expect(closed.scanned.controls).toBe(0);expect(closed.violations).toEqual([]);
    document.getElementById('details')!.setAttribute('open','');expect(codes()).toEqual(expect.arrayContaining(['FONT_TOO_SMALL','CONTROL_HEIGHT']));
  });
  it('does not inspect text fully occluded by an opaque sticky header', () => {
    layout('<p id="row" style="font-size:8px">Covered</p><header id="cover" style="position:sticky;background-color:rgb(255,255,255)">Header</header>', { row: [10, 10, 100, 20], cover: [0, 0, 800, 60] });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [document.getElementById('cover')!, document.getElementById('row')!, document.body] });
    expect(scanAdminVisualDocument({ touch: false }).violations.some(x => x.selector === '#row')).toBe(false);
    document.getElementById('cover')!.style.backgroundColor = 'rgba(255,255,255,0.5)';
    expect(scanAdminVisualDocument({ touch: false }).violations.some(x => x.selector === '#row' && x.code === 'FONT_TOO_SMALL')).toBe(true);
    document.getElementById('cover')!.style.backgroundColor = 'rgb(255,255,255)';
    document.getElementById('cover')!.setAttribute('data-box', '0,0,40,60');
    expect(scanAdminVisualDocument({ touch: false }).violations.some(x => x.selector === '#row' && x.code === 'FONT_TOO_SMALL')).toBe(true);
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });
  it('retains actual opaque control overlap rather than mistaking it for a sticky cover', () => {
    layout('<button id="a">First</button><button id="b" style="background-color:rgb(255,255,255)">Second</button>', { a: [10, 10, 100, 44], b: [10, 10, 100, 44] });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [document.getElementById('b')!, document.getElementById('a')!, document.body] });
    expect(codes()).toContain('CONTENT_OVERLAP');
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });
  it('proves pointer-events-none occlusion only with a higher independent stacking context',()=>{
    layout('<button id="under" style="pointer-events:none;font-size:8px">Disabled under</button><header id="cover" style="position:sticky;z-index:20;background-color:rgb(255,255,255)">Header</header>',{under:[10,10,100,44],cover:[0,0,800,60]});
    Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[document.getElementById('cover')!,document.body]});
    expect(scanAdminVisualDocument({touch:false}).violations.some(issue=>issue.selector==='#under')).toBe(false);
    document.getElementById('under')!.style.position='relative';document.getElementById('under')!.style.zIndex='30';
    expect(codes()).toContain('FONT_TOO_SMALL');
    document.getElementById('under')!.style.zIndex='20';expect(codes()).toContain('FONT_TOO_SMALL');
    Reflect.deleteProperty(document,'elementsFromPoint');
  });
  it('does not let z-index escape a modern containing stacking context',()=>{
    layout('<button id="under" style="pointer-events:none;font-size:8px">Under</button><div id="container"><header id="cover" style="position:sticky;z-index:20;background-color:rgb(255,255,255)">Header</header></div>',{under:[10,10,100,44],container:[0,0,800,60],cover:[0,0,800,60]});
    Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[document.getElementById('cover')!,document.body]});
    const previous=getComputedStyle;
    vi.stubGlobal('getComputedStyle',(el:Element)=>new Proxy(previous(el),{get(target,key){if(key==='getPropertyValue')return(name:string)=>el.id==='container'&&name==='container-type'?'inline-size':target.getPropertyValue(name);return Reflect.get(target,key);}}));
    expect(codes()).toContain('FONT_TOO_SMALL');
    Reflect.deleteProperty(document,'elementsFromPoint');
  });
  it('keeps a partially covered text run measurable but ignores only its sticky covered intersection', () => {
    layout('<p id="row" style="font-size:8px">Partly covered</p><header id="cover" style="position:sticky;background-color:rgb(255,255,255)">Header</header>', { row: [10, 50, 100, 30], cover: [0, 0, 800, 60] });
    document.getElementById('cover')!.setAttribute('data-text-box', '10,50,80,10');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: (_x: number, y: number) => y < 60 ? [document.getElementById('cover')!, document.getElementById('row')!, document.body] : [document.getElementById('row')!, document.body] });
    expect(codes()).toContain('FONT_TOO_SMALL'); expect(codes()).not.toContain('CONTENT_OVERLAP');
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });
  it('enforces real desktop/touch control heights and 8px adjacent gaps', () => {
    layout('<div><button id="a">First</button><button id="b">Second</button></div>', { a: [10, 10, 100, 40], b: [114, 10, 100, 40] });
    expect(codes()).toContain('CONTROL_GAP'); expect(codes()).not.toContain('CONTROL_HEIGHT');
    expect(scanAdminVisualDocument({ touch: true }).violations.filter(x => x.code === 'CONTROL_HEIGHT')).toHaveLength(2);
  });
  it('finds cramped controls even when each has a different wrapper', () => {
    layout('<div><div><button id="a">First</button></div><div><button id="b">Second</button></div></div>', { a: [10, 10, 100, 44], b: [114, 10, 100, 44] });
    expect(codes()).toContain('CONTROL_GAP');
  });
  it('measures overlap and gaps only inside actual ancestor overflow clips',()=>{
    layout('<input id="search"/><p id="heading">Heading</p><div id="panel" style="overflow-y:auto"><button id="hidden-row">Hidden result</button><button id="part-row">Part result</button><button id="next-row">Next result</button></div>',{search:[10,100,300,44],heading:[10,60,300,30],panel:[10,160,300,150],'hidden-row':[10,55,300,44],'part-row':[10,135,300,44],'next-row':[10,183,300,44]});
    const report=scanAdminVisualDocument({touch:false});
    expect(report.violations.filter(issue=>issue.code==='CONTENT_OVERLAP')).toEqual([]);
    expect(report.violations.filter(issue=>issue.code==='CONTROL_GAP')).toHaveLength(1);
    expect(report.violations.find(issue=>issue.code==='CONTROL_GAP')).toMatchObject({selector:'#part-row',relatedSelector:'#next-row',actual:4});
    expect(report.violations.some(issue=>issue.selector==='#hidden-row')).toBe(false);
    document.getElementById('panel')!.style.overflowY='visible';expect(codes()).toContain('CONTENT_OVERLAP');
  });
  it('preserves the 8px gap with only a bounded floating point comparison tolerance',()=>{
    layout('<button id="a">A</button><button id="b">B</button>',{a:[10,10,100,44],b:[117.999969482421875,10,100,44]});
    expect(codes()).not.toContain('CONTROL_GAP');
    document.getElementById('b')!.setAttribute('data-box','117.9998,10,100,44');expect(codes()).toContain('CONTROL_GAP');
    document.getElementById('b')!.setAttribute('data-box','117,10,100,44');expect(codes()).toContain('CONTROL_GAP');
  });
  it('does not mistake scrolling under an independent opaque sticky banner for a layout gap',()=>{
    layout('<header id="header" style="position:sticky;background-color:rgb(255,255,255)"><button id="a">A</button><button id="b">B</button></header><main><button id="flow">Flow</button></main>',{header:[0,0,800,50],a:[10,0,100,44],b:[114,0,100,44],flow:[10,49,100,44]});
    const report=scanAdminVisualDocument({touch:false});expect(report.violations.filter(issue=>issue.code==='CONTROL_GAP')).toHaveLength(1);expect(report.violations.find(issue=>issue.code==='CONTROL_GAP')?.relatedSelector).toBe('#b');
    document.getElementById('header')!.style.backgroundColor='rgba(255,255,255,.5)';expect(scanAdminVisualDocument({touch:false}).violations.filter(issue=>issue.code==='CONTROL_GAP').length).toBeGreaterThan(1);
  });
  it.each([['TH','sticky'],['TH','fixed'],['columnheader','sticky'],['columnheader','fixed']])('recognizes actual opaque pinned %s %s without exempting gaps between header controls', (kind,position)=>{
    const controls='<button id="a">A</button><button id="b">B</button>',style=`position:${position};background-color:rgb(255,255,255)`;
    layout(kind==='TH'?`<table><thead><tr><th id="header" style="${style}">${controls}</th></tr></thead><tbody><tr><td><button id="flow">Flow</button></td></tr></tbody></table>`:`<div id="header" role="columnheader" style="${style}">${controls}</div><main><button id="flow">Flow</button></main>`,{header:[0,0,800,50],a:[10,0,100,44],b:[114,0,100,44],flow:[10,44,100,44]});
    const gaps=scanAdminVisualDocument({touch:false}).violations.filter(issue=>issue.code==='CONTROL_GAP');
    expect(gaps.map(issue=>({selector:issue.selector,relatedSelector:issue.relatedSelector,actual:issue.actual,minimum:issue.minimum}))).toEqual([{selector:'#a',relatedSelector:'#b',actual:4,minimum:8}]);
    document.getElementById('header')!.style.filter='blur(0px) brightness(1)';expect(scanAdminVisualDocument({touch:false}).violations.filter(issue=>issue.code==='CONTROL_GAP')).toHaveLength(1);
  });
  it.each(['position:static;background-color:rgb(255,255,255)','position:sticky;background-color:rgba(255,255,255,.5)','position:sticky;background-color:rgb(255,255,255);filter:brightness(.99)','position:sticky;background-color:rgb(255,255,255);opacity:.99'])('retains the same8px gap for unpinned/translucent/effectful TH: %s',style=>{
    layout(`<table><thead><tr><th id="header" style="${style}"><button id="a">A</button></th></tr></thead><tbody><tr><td><button id="flow">Flow</button></td></tr></tbody></table>`,{header:[0,0,800,50],a:[10,0,100,44],flow:[10,44,100,44]});
    expect(scanAdminVisualDocument({touch:false}).violations.find(issue=>issue.code==='CONTROL_GAP')).toMatchObject({selector:'#a',relatedSelector:'#flow',actual:0,minimum:8});
  });
  it('retains gaps between controls in separate pinned TH cells and never classifies a pinned footer as a header',()=>{
    layout('<table><thead><tr><th id="first" style="position:sticky;background-color:rgb(255,255,255)"><button id="a">A</button></th><th id="second" style="position:sticky;background-color:rgb(255,255,255)"><button id="b">B</button></th></tr></thead></table>',{first:[0,0,112,50],second:[112,0,112,50],a:[10,0,100,44],b:[114,0,100,44]});
    expect(scanAdminVisualDocument({touch:false}).violations.find(issue=>issue.code==='CONTROL_GAP')).toMatchObject({selector:'#a',relatedSelector:'#b',actual:4,minimum:8});
    layout('<footer id="footer" style="position:sticky;background-color:rgb(255,255,255)"><button id="a">A</button></footer><main><button id="flow">Flow</button></main>',{footer:[0,0,800,50],a:[10,0,100,44],flow:[10,44,100,44]});
    expect(scanAdminVisualDocument({touch:false}).violations.find(issue=>issue.code==='CONTROL_GAP')).toMatchObject({selector:'#a',relatedSelector:'#flow',actual:0,minimum:8});
  });
  it.each(['HEADER','banner'])('separates an independent opaque app %s from pinned table headers without exempting their own control gaps',kind=>{
    vi.stubGlobal('innerWidth',911);Object.defineProperties(document.documentElement,{clientWidth:{configurable:true,value:911},scrollWidth:{configurable:true,value:911}});Object.defineProperty(document.body,'scrollWidth',{configurable:true,value:911});
    const appHeader=kind==='HEADER'?'<header':'<div role="banner"',appClose=kind==='HEADER'?'header':'div';
    layout(`${appHeader} id="app-header" style="position:sticky;background-color:rgb(255,255,255);z-index:20"><button id="language">EN</button><button id="app-neighbor">Next</button></${appClose}><main><table><thead><tr><th id="first" style="position:sticky;background-color:rgb(255,255,255);z-index:1"><button id="sort">Sort</button></th><th id="second" style="position:sticky;background-color:rgb(255,255,255);z-index:1"><button id="sort-neighbor">Other</button></th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table></main>`,{'app-header':[0,0,911,72],language:[793.333333,13.666667,49.333333,44],'app-neighbor':[846.666666,13.666667,49.333333,44],first:[700,29.948,100,91.333],second:[790,29.948,100,91.333],sort:[717.22,53.448,72.113295,44],'sort-neighbor':[793.333333,53.448,72,44]});
    const gaps=scanAdminVisualDocument({touch:false}).violations.filter(issue=>issue.code==='CONTROL_GAP');
    expect(gaps.map(issue=>[issue.selector,issue.relatedSelector])).toEqual([['#language','#app-neighbor'],['#sort','#sort-neighbor']]);
    expect(gaps.every(issue=>issue.actual!>=3.9999&&issue.actual!<4.0001&&issue.minimum===8)).toBe(true);
  });
  it('retains a real control gap when the pinned table is contained inside the app header region',()=>{
    layout('<header id="app-header" style="position:sticky;background-color:rgb(255,255,255)"><button id="language">EN</button><table><thead><tr><th id="table-header" style="position:sticky;background-color:rgb(255,255,255)"><button id="sort">Sort</button></th></tr></thead></table></header>',{'app-header':[0,0,800,100],language:[10,0,100,44],'table-header':[0,48,800,50],sort:[10,48,100,44]});
    expect(scanAdminVisualDocument({touch:false}).violations.find(issue=>issue.code==='CONTROL_GAP')).toMatchObject({selector:'#language',relatedSelector:'#sort',actual:4,minimum:8});
  });
  it('counts an associated label as a checkbox hit target', () => {
    layout('<label id="label"><input id="checkbox" type="checkbox"/><span id="label-text">Remember</span></label>', { label: [10, 10, 160, 44], checkbox: [15, 20, 16, 16], 'label-text': [40, 19, 100, 26] });
    const report = scanAdminVisualDocument({ touch: true });
    expect(report.violations.map(x => x.code)).not.toContain('CONTROL_HEIGHT');
    expect(report.violations.map(x => x.code)).not.toContain('CONTENT_OVERLAP');
  });
  it('measures the painted checked checkbox/radio glyph at 3:1 instead of treating a textless input color as text',()=>{
    layout('<label id="label"><input id="check" type="checkbox" checked style="color:rgb(0,0,0);background-color:rgb(0,0,0);border:2px solid rgb(0,0,0)"/><span id="label-text">Remember</span></label>',{label:[10,10,200,44],check:[10,10,44,44],'label-text':[66,19,140,26]});
    const original=getComputedStyle;
    let markColor='rgb(255,255,255)';
    vi.stubGlobal('getComputedStyle',(el:Element,pseudo?:string)=>pseudo==='::after'?{content:'""',display:'block',visibility:'visible',opacity:'1',filter:'none',backdropFilter:'none',mixBlendMode:'normal',width:'10px',height:'18px',backgroundColor:'transparent',getPropertyValue:(key:string)=>/border-(bottom|right)-width/.test(key)?'2px':/border-(bottom|right)-style/.test(key)?'solid':/border-(bottom|right)-color/.test(key)?markColor:''}:original(el));
    for(const type of ['checkbox','radio']){
      (document.getElementById('check') as HTMLInputElement).type=type;
      const report=scanAdminVisualDocument({touch:false});expect(report.violations.filter(issue=>issue.code==='TEXT_CONTRAST')).toEqual([]);expect(report.indeterminate).toEqual([]);expect(report.thresholds).toMatchObject({textContrast:4.5,uiContrast:3});
    }
    markColor='rgb(0,0,0)';expect(scanAdminVisualDocument({touch:false}).violations.find(issue=>issue.code==='UI_SELECTION_CONTRAST')).toMatchObject({selector:'#check',actual:1,minimum:3});
    document.getElementById('check')!.style.borderColor='rgb(255,255,255)';expect(codes()).toContain('UI_BORDER_CONTRAST');
  });
  it('fails closed when checked native state paint has no measurable explicit glyph',()=>{
    layout('<label id="label"><input id="check" type="checkbox" checked style="background-color:rgb(0,0,0);border:2px solid rgb(0,0,0)"/><span id="label-text">Remember</span></label>',{label:[10,10,200,44],check:[10,10,44,44],'label-text':[66,19,140,26]});
    const original=getComputedStyle;vi.stubGlobal('getComputedStyle',(el:Element,pseudo?:string)=>pseudo==='::after'?{content:'none',display:'none',visibility:'visible',opacity:'1',width:'auto',height:'auto',getPropertyValue:()=>''}:original(el));
    expect(scanAdminVisualDocument({touch:false}).indeterminate.find(issue=>issue.code==='UI_SELECTION_UNRESOLVED')).toMatchObject({selector:'#check',minimum:3});
  });
  it('continues to reject actual input text and associated checkbox-label text with contrast 1 at 4.5:1',()=>{
    layout('<input id="text" value="Actual text" style="color:rgb(255,255,255);background-color:rgb(255,255,255);border:2px solid rgb(0,0,0)"/><label id="label"><input id="check" type="checkbox" style="border:2px solid rgb(0,0,0)"/><span id="label-text" style="color:rgb(255,255,255);background-color:rgb(255,255,255)">Remember</span></label>',{text:[10,10,200,44],label:[10,70,200,44],check:[10,70,44,44],'label-text':[66,79,140,26]});
    const failures=scanAdminVisualDocument({touch:false}).violations.filter(issue=>issue.code==='TEXT_CONTRAST');expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({selector:'#text',actual:1,minimum:4.5}),expect.objectContaining({selector:'#label-text',actual:1,minimum:4.5})]));
  });
  it('reports unnamed and narrow icon controls separately', () => {
    layout('<button id="icon"><svg aria-hidden="true"></svg></button>', { icon: [10, 10, 32, 44] });
    expect(codes()).toEqual(expect.arrayContaining(['ICON_NAME', 'ICON_TARGET_SIZE']));
    document.getElementById('icon')!.setAttribute('aria-label', 'Open navigation');
    expect(codes()).not.toContain('ICON_NAME');
    expect(codes()).toContain('ICON_TOOLTIP');
    document.getElementById('icon')!.setAttribute('title', 'Open navigation');
    expect(codes()).not.toContain('ICON_TOOLTIP');
  });
  it('finds translucent text contrast and UI border contrast failures', () => {
    layout('<p id="alpha" style="color:rgba(0,0,0,0.5)">Low contrast</p><button id="border" style="border:1px solid rgb(220,220,220)">Save</button>', { alpha: [10, 10, 150, 30], border: [10, 60, 100, 44] });
    const report = scanAdminVisualDocument({ touch: false });
    expect(report.violations.find(x => x.code === 'TEXT_CONTRAST')?.actual).toBeCloseTo(3.97665, 3);
    expect(report.violations.some(x => x.code === 'UI_BORDER_CONTRAST')).toBe(true);
  });
  it('accepts a real contrasting outline as the UI boundary while keeping the same 3:1 threshold',()=>{
    layout('<button id="outlined" style="background-color:rgb(240,240,240);outline-width:1px;outline-style:solid;outline-color:rgb(0,0,0)">Selected nav</button>',{outlined:[10,10,180,44]});
    expect(codes()).not.toContain('UI_FILL_CONTRAST');expect(codes()).not.toContain('UI_OUTLINE_CONTRAST');
    document.getElementById('outlined')!.style.outlineColor='rgb(240,240,240)';expect(codes()).toContain('UI_OUTLINE_CONTRAST');
    document.getElementById('outlined')!.style.outlineColor='transparent';expect(codes()).toContain('UI_FILL_CONTRAST');
  });
  it('uses exact matched browser ink metrics rather than overlapping font-leading boxes',()=>{
    layout('<p id="first">First</p><p id="second">Second</p>',{first:[10,20,100,29],second:[10,45.5,100,29]});
    for(const id of ['first','second']){const el=document.getElementById(id)!;const r=el.getBoundingClientRect();el.setAttribute('data-text-box',[r.x,r.y,r.width,29].join(','));}
    let fontHeight=29;
    vi.stubGlobal('OffscreenCanvas',class{getContext(){return{font:'',direction:'ltr',measureText:()=>({fontBoundingBoxAscent:20,fontBoundingBoxDescent:fontHeight-20,actualBoundingBoxAscent:11,actualBoundingBoxDescent:0})};}});
    expect(codes()).not.toContain('CONTENT_OVERLAP');
    document.getElementById('second')!.setAttribute('data-text-box','10,25,100,29');expect(codes()).toContain('CONTENT_OVERLAP');
    document.getElementById('second')!.setAttribute('data-text-box','10,45.5,100,29');fontHeight=28;expect(codes()).toContain('CONTENT_OVERLAP');
  });
  it('measures bidi fragments on the same baseline without treating actual wrapped lines as a single line',()=>{
    layout('<p id="first">12 نص عربي</p><p id="second">Second</p>',{first:[10,20,150,29],second:[10,45.5,150,29]});
    document.getElementById('second')!.setAttribute('data-text-box','10,45.5,150,29');
    let secondFragmentY=20;
    vi.spyOn(document,'createRange').mockImplementation(()=>{let selected:Node|null=null;return {selectNodeContents:(node:Node)=>{selected=node;},getClientRects:()=>selected!.parentElement!.id==='first'?[box(10,20,60,29),box(70,secondFragmentY,60,29)]:[box(10,45.5,60,29),box(70,45.5,60,29)]} as unknown as Range;});
    vi.stubGlobal('OffscreenCanvas',class{getContext(){return{font:'',direction:'ltr',measureText:()=>({fontBoundingBoxAscent:20,fontBoundingBoxDescent:9,actualBoundingBoxAscent:11,actualBoundingBoxDescent:0})};}});
    expect(codes()).not.toContain('CONTENT_OVERLAP');
    secondFragmentY=45.5;expect(codes()).toContain('CONTENT_OVERLAP');
  });
  it('keeps explicit Arabic OpenType features and text transformations conservative',()=>{
    layout('<p id="first">First</p><p id="second">Second</p>',{first:[10,20,150,29],second:[10,45.5,150,29]});
    for(const id of ['first','second']){const el=document.getElementById(id)!;const r=el.getBoundingClientRect();el.setAttribute('data-text-box',[r.x,r.y,r.width,29].join(','));}
    vi.stubGlobal('OffscreenCanvas',class{getContext(){return{font:'',direction:'ltr',measureText:()=>({fontBoundingBoxAscent:20,fontBoundingBoxDescent:9,actualBoundingBoxAscent:11,actualBoundingBoxDescent:0})};}});
    expect(codes()).not.toContain('CONTENT_OVERLAP');
    for(const id of ['first','second'])document.getElementById(id)!.style.fontFeatureSettings='"calt", "rlig"';expect(codes()).toContain('CONTENT_OVERLAP');
    for(const id of ['first','second']){const el=document.getElementById(id)!;el.style.fontFeatureSettings='normal';el.style.textTransform='uppercase';}expect(codes()).toContain('CONTENT_OVERLAP');
  });
  it('measures resolved sRGB color-mix colors and leaves invisible borders unpainted', () => {
    layout('<p id="modern">Modern color</p><a id="transparent" href="#" style="border:1px solid transparent">Navigation</a><input id="input" style="border:1px solid transparent;background:transparent"/>', { modern:[10,10,180,30],transparent:[10,60,140,44],input:[10,120,140,44] });
    const previous=getComputedStyle;
    vi.stubGlobal('getComputedStyle',(el:Element)=>new Proxy(previous(el),{get(target,key){return el.id==='modern'&&key==='color'?'color(srgb 0.5 0.5 0.5)':Reflect.get(target,key);}}));
    const report=scanAdminVisualDocument({touch:false});
    expect(report.indeterminate).toEqual([]);
    expect(report.violations.find(x=>x.selector==='#modern'&&x.code==='TEXT_CONTRAST')?.actual).toBeCloseTo(3.97665,3);
    expect(report.violations.some(x=>x.selector==='#transparent'&&x.code==='UI_BORDER_CONTRAST')).toBe(false);
    expect(report.violations.some(x=>x.selector==='#input'&&x.code==='UI_BOUNDARY_MISSING')).toBe(true);
  });
  it('checks gradient stop extremes rather than treating the background as white', () => {
    layout('<p id="gradient" style="color:rgb(255,255,255)">Gradient text</p>', { gradient: [10, 10, 180, 30] });
    // jsdom20 discards gradient declarations, so expose the browser computed value.
    const previous = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (el: Element) => new Proxy(previous(el), { get(target, key) { return el.id === 'gradient' && key === 'backgroundImage' ? 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' : Reflect.get(target, key); } }));
    expect(scanAdminVisualDocument({ touch: false }).violations.find(x => x.code === 'TEXT_CONTRAST')?.actual).toBe(1);
  });
  it('makes photo contrast indeterminate and fails strict mode instead of inventing a pass', () => {
    layout('<p id="image" style="background-image:url(test.png)">Photo text</p>', { image: [10, 10, 180, 30] });
    const report = scanAdminVisualDocument({ touch: false });
    expect(report.indeterminate.some(x => x.code === 'CONTRAST_UNRESOLVED')).toBe(true); expect(report.shouldFail).toBe(true);
  });
  it('does not grant a gradient pass when grey text disappears between high-contrast endpoints', () => {
    layout('<p id="gradient" style="color:rgb(117,117,117)">Gradient text</p>', { gradient: [10, 10, 180, 30] });
    const previous = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (el: Element) => new Proxy(previous(el), { get(target, key) { return el.id === 'gradient' && key === 'backgroundImage' ? 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' : Reflect.get(target, key); } }));
    expect(scanAdminVisualDocument({ touch: false }).violations.find(x => x.code === 'TEXT_CONTRAST')?.actual).toBe(1);
  });
  it('detects clipping without a tooltip and horizontal viewport overflow', () => {
    layout('<div id="clip" style="overflow-x:hidden"><span id="text">Clipped text</span></div><button id="off">Outside</button>', { clip: [10, 10, 30, 30], text: [10, 10, 100, 30], off: [790, 70, 100, 44] });
    expect(codes()).toEqual(expect.arrayContaining(['CLIPPED_CONTENT', 'HORIZONTAL_OFFSCREEN']));
    document.getElementById('text')!.setAttribute('title', 'Clipped text');
    expect(codes()).not.toContain('CLIPPED_CONTENT');
  });
  it('permits intentional table scrolling but still rejects horizontal document scrolling', () => {
    layout('<div id="scroll" style="overflow-x:auto"><table id="table"><tbody><tr id="row"><td id="cell">Long table cell</td></tr></tbody></table></div>', { scroll: [10, 10, 780, 70], table: [10, 10, 1200, 60], row: [10, 10, 1200, 52], cell: [790, 10, 200, 52] });
    Object.defineProperties(document.getElementById('scroll'), { clientWidth: { configurable: true, value: 780 }, scrollWidth: { configurable: true, value: 1200 } });
    expect(codes()).not.toContain('HORIZONTAL_OFFSCREEN'); expect(codes()).not.toContain('CLIPPED_CONTENT');
    Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 1200 });
    expect(codes()).toContain('BODY_HORIZONTAL_OVERFLOW');
  });
  it('detects a text run clipped by its own element, including ellipsis geometry', () => {
    layout('<p id="text" style="overflow-x:hidden;text-overflow:ellipsis" data-text-box="10,10,150,25.5">A long meaningful name</p>', { text: [10, 10, 50, 30] });
    expect(codes()).toContain('CLIPPED_CONTENT');
    document.getElementById('text')!.setAttribute('title', 'A long meaningful name');
    expect(codes()).not.toContain('CLIPPED_CONTENT');
  });
  it('detects unrelated text overlap without reporting a button containing its label', () => {
    layout('<p id="first">First text</p><p id="second">Second text</p><button id="button"><span id="label">Action</span></button>', { first: [10, 10, 100, 30], second: [20, 10, 100, 30], button: [10, 80, 100, 44], label: [15, 85, 70, 25.5] });
    const overlap = scanAdminVisualDocument({ touch: false }).violations.filter(x => x.code === 'CONTENT_OVERLAP');
    expect(overlap).toHaveLength(1); expect(overlap[0]).toMatchObject({ selector: '#first', relatedSelector: '#second' });
  });
  it('requires an empty-state explanation and enforces chosen row density', () => {
    layout('<div id="wrapper"><table id="empty"><tbody></tbody></table></div><table id="data" data-density="compact"><tbody><tr id="row"><td id="cell">Entry</td></tr></tbody></table>', { wrapper: [10, 10, 200, 60], empty: [10, 10, 200, 60], data: [10, 100, 200, 60], row: [10, 100, 200, 43], cell: [10, 100, 100, 43] });
    expect(codes()).toEqual(expect.arrayContaining(['EMPTY_TABLE_NO_HELP', 'TABLE_ROW_HEIGHT']));
    document.getElementById('wrapper')!.insertAdjacentHTML('beforeend', '<p role="status" id="empty-message">No items. Add a reader to start.</p>');
    document.getElementById('empty-message')!.setAttribute('data-box', '10,70,250,25.5');
    document.getElementById('row')!.setAttribute('data-box', '10,100,200,44');
    expect(codes()).not.toContain('EMPTY_TABLE_NO_HELP'); expect(codes()).not.toContain('TABLE_ROW_HEIGHT');
  });
});

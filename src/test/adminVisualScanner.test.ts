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
      return el.style?.getPropertyValue(kebab) || defaults[name] || '';
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
  it('counts an associated label as a checkbox hit target', () => {
    layout('<label id="label"><input id="checkbox" type="checkbox"/> Remember</label>', { label: [10, 10, 160, 44], checkbox: [15, 20, 16, 16] });
    expect(scanAdminVisualDocument({ touch: true }).violations.map(x => x.code)).not.toContain('CONTROL_HEIGHT');
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

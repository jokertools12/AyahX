export interface AdminVisualScanOptions {
  mode?: 'baseline' | 'strict';
  touch?: boolean;
}
export interface AdminVisualIssue {
  code: string;
  selector: string;
  reason: string;
  rect: { x: number; y: number; width: number; height: number };
  actual?: number;
  minimum?: number;
  relatedSelector?: string;
  contrastKind?: 'text' | 'nontext';
}
export interface AdminVisualReport {
  version: 'admin-visual-1';
  mode: 'baseline' | 'strict';
  viewport: { width: number; height: number; devicePixelRatio: number; touch: boolean };
  thresholds: Record<string, number>;
  scanned: { textNodes: number; controls: number; tables: number };
  violations: AdminVisualIssue[];
  indeterminate: AdminVisualIssue[];
  compliant: boolean;
  shouldFail: boolean;
  limitations: string[];
}

/** Self-contained: pass directly to Playwright page.evaluate. No DOM writes or requests.
 * Range geometry: https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
 * Contrast math: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
 * The owner requires 4.5 for ALL text; the large-text exception is deliberately absent.
 */
export function scanAdminVisualDocument(options: AdminVisualScanOptions = {}): AdminVisualReport {
  const thresholds = { baseFont: 15, tableFont: 14.5, secondaryFont: 13, absoluteFont: 12,
    arabicLineHeight: 1.7, desktopControl: 40, touchControl: 44, iconSize: 40,
    gap: 8, textContrast: 4.5, uiContrast: 3, comfortableRow: 52, compactRow: 44 };
  const mode = options.mode ?? 'strict';
  const touch = options.touch ?? matchMedia('(pointer: coarse)').matches;
  const width = document.documentElement.clientWidth || innerWidth;
  const height = innerHeight;
  const violations: AdminVisualIssue[] = [];
  const indeterminate: AdminVisualIssue[] = [];
  const scanned = { textNodes: 0, controls: 0, tables: 0 };
  // Exact CSS identities only. Decimal strings are matched lexically: rounding
  // a near-one Number must never certify an effective filter as an identity.
  const identityFilter = (value: string | undefined): boolean => {
    if (!value || value.trim().toLowerCase() === 'none') return true;
    let rest = value.trim().toLowerCase();
    const zero = '[+-]?0+(?:\\.0*)?';
    const one = '\\+?0*1(?:\\.0*)?';
    const hundred = '\\+?0*100(?:\\.0*)?';
    const length = '(?:px|em|rem|ex|ch|cap|ic|lh|rlh|cm|mm|q|in|pt|pc|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh)?';
    while (rest) {
      const part = /^([a-z-]+)\(([^()]*)\)/.exec(rest);
      if (!part) return false;
      const [, name, raw] = part, amount = raw.trim();
      const pattern = name === 'blur' ? zero + length
        : name === 'hue-rotate' ? zero + '(?:deg|grad|rad|turn)?'
        : ['brightness', 'contrast', 'opacity', 'saturate'].includes(name) ? '(?:' + one + '|' + hundred + '%)'
        : ['grayscale', 'invert', 'sepia'].includes(name) ? zero + '%?'
        : null;
      if (!pattern || !new RegExp('^(?:' + pattern + ')$').test(amount)) return false;
      rest = rest.slice(part[0].length).trimStart();
    }
    return true;
  };
  const seen = new Set<string>();
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    if (!styleCache.has(el)) styleCache.set(el, getComputedStyle(el));
    return styleCache.get(el)!;
  };
  const selector = (el: Element): string => {
    const escape = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `);
    const parts: string[] = [];
    for (let current: Element | null = el; current; current = current.parentElement) {
      if (current.id) { parts.unshift(`#${escape(current.id)}`); break; }
      const siblings = current.parentElement ? [...current.parentElement.children].filter(x => x.tagName === current!.tagName) : [current];
      parts.unshift(current.tagName.toLowerCase() + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
    }
    return parts.join(' > ');
  };
  const record = (el: Element, code: string, reason: string, rect = el.getBoundingClientRect(), actual?: number, minimum?: number, related?: Element, unknown = false): void => {
    const key = `${code}:${selector(el)}:${related ? selector(related) : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    (unknown ? indeterminate : violations).push({ code, selector: selector(el), reason,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      ...(actual === undefined ? {} : { actual }), ...(minimum === undefined ? {} : { minimum }),
      ...(related ? { relatedSelector: selector(related) } : {}) });
  };
  const hidden = (el: Element): boolean => {
    for (let parent: Element | null = el; parent; parent = parent.parentElement) {
      const s = style(parent);
      if (parent.hasAttribute('hidden') || parent.hasAttribute('inert') || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return true;
      // Closed details contents can retain DOM/Range boxes in Chromium. Only
      // its first summary is painted and interactive until the owner opens it.
      if(parent.tagName==='DETAILS'&&!parent.hasAttribute('open')){const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');if(!summary?.contains(el))return true;}
      // Screen-reader-only labels are named content, not visible painted text.
      if (s.position === 'absolute' && (s.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(s.clipPath))) return true;
    }
    return false;
  };
  // Layout rectangles survive ancestor scrolling even where overflow has
  // removed every painted pixel. Pair geometry uses the actual clipped paint;
  // control sizes and truncation checks retain the original layout rectangle.
  const paintRect = (el: Element, rect: DOMRect, includeSelf = true): DOMRect | null => {
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
    for (let p: Element | null = includeSelf ? el : el.parentElement; p; p = p.parentElement) {
      const s = style(p), bounds = p.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(s.overflowX)) {
        left = Math.max(left, bounds.left + (parseFloat(s.borderLeftWidth) || 0));
        right = Math.min(right, bounds.right - (parseFloat(s.borderRightWidth) || 0));
      }
      if (/hidden|clip|auto|scroll/.test(s.overflowY)) {
        top = Math.max(top, bounds.top + (parseFloat(s.borderTopWidth) || 0));
        bottom = Math.min(bottom, bounds.bottom - (parseFloat(s.borderBottomWidth) || 0));
      }
    }
    return right > left && bottom > top ? { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect : null;
  };
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return !hidden(el) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height && !!paintRect(el, r, false);
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')].filter(visible);
  const scope = dialogs.at(-1) ?? document.body;
  const inScope = (el: Element): boolean => scope.contains(el);
  const hasTooltip = (el: Element): boolean => {
    for (let parent: Element | null = el; parent && inScope(parent); parent = parent.parentElement) {
      if (parent.getAttribute('title')?.trim()) return true;
      const ids = parent.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
      if (ids.some(id => document.getElementById(id)?.textContent?.trim())) return true;
    }
    return false;
  };
  const tableScroll = (el: Element): Element | null => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      if (/auto|scroll/.test(style(p).overflowX) && p.scrollWidth > p.clientWidth && p.querySelector('table,[role="table"],[role="grid"]')) return p;
    }
    return null;
  };
  const geometry = (el: Element, r: DOMRect): void => {
    if (!tableScroll(el) && (r.left < -0.01 || r.right > width + 0.01)) record(el, 'HORIZONTAL_OFFSCREEN', 'Visible content extends beyond the viewport.', r);
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = style(p), pr = p.getBoundingClientRect();
      const clipX = /hidden|clip|auto|scroll/.test(s.overflowX);
      const clipY = /hidden|clip/.test(s.overflowY);
      const clippedX = clipX && (r.left < pr.left - 0.01 || r.right > pr.right + 0.01);
      const clippedY = clipY && (r.top < pr.top - 0.01 || r.bottom > pr.bottom + 0.01);
      if ((clippedX && !tableScroll(el) || clippedY) && !hasTooltip(el)) record(el, 'CLIPPED_CONTENT', 'Content is clipped by an ancestor without explanatory tooltip.', r, undefined, undefined, p);
    }
  };
  type Color = [number, number, number, number];
  const color = (value: string): Color | null => {
    if (value === 'transparent') return [0, 0, 0, 0];
    const hex = /^#([\da-f]{3,8})$/i.exec(value);
    if (hex) {
      const h = hex[1].length <= 4 ? [...hex[1]].map(c => c + c).join('') : hex[1];
      if (h.length !== 6 && h.length !== 8) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    // Chromium resolves color-mix(in srgb,...) to color(srgb ...), not rgb().
    // Its channels are already gamma-encoded sRGB; do not apply an extra gamma.
    const srgb = /^color\(srgb\s+([+-]?[\d.e]+%?)\s+([+-]?[\d.e]+%?)\s+([+-]?[\d.e]+%?)(?:\s*\/\s*([\d.e]+%?))?\)$/i.exec(value);
    if(srgb){const channels=srgb.slice(1,4).map(c=>Math.max(0,Math.min(1,parseFloat(c)/(c.endsWith('%')?100:1)))*255),alpha=srgb[4]===undefined?1:parseFloat(srgb[4])/(srgb[4].endsWith('%')?100:1);return [...channels,alpha].every(Number.isFinite)?[channels[0],channels[1],channels[2],alpha]:null;}
    const rgb = /^rgba?\((.+)\)$/i.exec(value);
    if (!rgb) return null;
    const values = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (values.length < 3 || values.length > 4) return null;
    const channels = values.slice(0, 3).map(c => parseFloat(c) * (c.endsWith('%') ? 2.55 : 1));
    const alpha = values[3] === undefined ? 1 : parseFloat(values[3]) / (values[3].endsWith('%') ? 100 : 1);
    return [...channels, alpha].every(Number.isFinite) ? [channels[0], channels[1], channels[2], alpha] : null;
  };
  const over = (front: Color, back: Color): Color => {
    const alpha = front[3] + back[3] * (1 - front[3]);
    return [0, 1, 2].map(i => alpha ? (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0).concat(alpha) as Color;
  };
  const stackingChains=new Map<Element,Element[]>();
  const stackingChain=(el:Element):Element[]=>{
    if(stackingChains.has(el))return stackingChains.get(el)!;
    const chain:Element[]=[];
    for(let p:Element|null=el;p;p=p.parentElement){const s=style(p),parent=p.parentElement&&style(p.parentElement),positioned=s.position!=='static'&&!!s.position,flexItem=parent&&/flex|grid/.test(parent.display),z=s.zIndex&&s.zIndex!=='auto';
      const independent=['transform','scale','rotate','translate','perspective','filter','backdrop-filter','clip-path','mask-image','mask-border-source'].some(name=>{const value=s.getPropertyValue(name);return !!value&&value!=='none';});
      // Include modern containment/individual transforms: a high z-index
      // inside one such ancestor cannot escape that ancestor's own level.
      if(p===document.documentElement||['fixed','sticky'].includes(s.position)||z&&(positioned||flexItem)||Number(s.opacity)<1||independent||s.mixBlendMode&&s.mixBlendMode!=='normal'||s.isolation==='isolate'||['size','inline-size'].includes(s.getPropertyValue('container-type'))||/paint|layout|strict|content/.test(s.contain)||/transform|scale|rotate|translate|opacity|filter|perspective|clip-path|mask|isolation|contain/.test(s.willChange))chain.unshift(p);
    }
    stackingChains.set(el,chain);return chain;
  };
  const provenStackingAbove=(cover:Element,target:Element):boolean=>{
    const front=stackingChain(cover),back=stackingChain(target);let index=0;
    while(index<front.length&&index<back.length&&front[index]===back[index])index++;
    if(!front[index])return false;
    const level=(el:Element|undefined)=>el&&style(el).zIndex&&style(el).zIndex!=='auto'?Number(style(el).zIndex):0;
    const top=level(front[index]),bottom=level(back[index]);
    // Equal levels need paint-order details unavailable from hit testing when
    // pointer-events:none. Strictly ordered context levels prove this case.
    return Number.isFinite(top)&&Number.isFinite(bottom)&&top>bottom;
  };
  // A sticky header may cover a whole Range rectangle after scrolling. Only
  // discard it when hit testing proves a separate, fully opaque covering layer.
  // Partial coverage remains measurable; transparency must never hide failures.
  const fullyOccluded = (el: Element, rect: DOMRect): boolean => {
    if (typeof document.elementsFromPoint !== 'function') return false;
    // Pointer-events:none targets are absent from hit testing. For them require
    // additional proof from independently ordered CSS stacking contexts.
    let pointerUncertain=false;
    for (let p: Element | null = el; p; p = p.parentElement) if (style(p).pointerEvents === 'none') pointerUncertain=true;
    const left = Math.max(0, rect.left), right = Math.min(width, rect.right);
    const topEdge = Math.max(0, rect.top), bottom = Math.min(height, rect.bottom);
    if (right <= left || bottom <= topEdge) return false;
    const inset = Math.min(0.25, (right - left) / 4, (bottom - topEdge) / 4);
    const points = [[(left + right) / 2, (topEdge + bottom) / 2], [left + inset, topEdge + inset],
      [right - inset, topEdge + inset], [left + inset, bottom - inset], [right - inset, bottom - inset]];
    return points.every(([x, y]) => {
      for (const top of document.elementsFromPoint(x, y)) {
        if (top === el || el.contains(top) || top.contains(el)) return false;
        for (let cover: Element | null = top; cover; cover = cover.parentElement) {
          if (cover.contains(el) || el.contains(cover)) continue;
          const r = cover.getBoundingClientRect(), s = style(cover);
          if (r.left > left || r.right < right || r.top > topEdge || r.bottom < bottom) continue;
          if (color(s.backgroundColor)?.[3] !== 1 || !identityFilter(s.filter) || s.mixBlendMode && s.mixBlendMode !== 'normal') continue;
          let opaque = true, positionedLayer = false;
          for (let p: Element | null = cover; p; p = p.parentElement) {
            const ancestor = style(p);
            if (Number(ancestor.opacity) !== 1 || !identityFilter(ancestor.filter) || ancestor.mixBlendMode && ancestor.mixBlendMode !== 'normal') opaque = false;
            if (ancestor.position === 'fixed' || ancestor.position === 'sticky') positionedLayer = true;
          }
          // Ordinary overlapping controls remain a defect even when opaque.
          if (opaque && positionedLayer&&(!pointerUncertain||provenStackingAbove(cover,el))) return true;
        }
      }
      return false;
    });
  };
  const backgrounds = (el: Element | null): Color[] | null => {
    const layers: Element[] = [];
    for (let p = el; p; p = p.parentElement) layers.unshift(p);
    let colors: Color[] = [[255, 255, 255, 1]];
    for (const p of layers) {
      const s = style(p), solid = color(s.backgroundColor);
      if (!solid) return null;
      colors = colors.map(c => over(solid, c));
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        // All gradient stop colors are checked conservatively. Photos/patterns need pixels.
        if (!/^((repeating-)?(linear|radial|conic)-gradient\()/i.test(s.backgroundImage) || /url\(/i.test(s.backgroundImage)) return null;
        const stops = s.backgroundImage.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi)?.map(color);
        if (!stops?.length || stops.some(c => !c)) return null;
        colors = colors.flatMap(c => stops.map(stop => over(stop!, c)));
        if (colors.length > 256) return null;
      }
      if (s.mixBlendMode && s.mixBlendMode !== 'normal' || !identityFilter(s.filter) || !identityFilter(s.backdropFilter) || Number(s.opacity) < 1) return null;
    }
    return colors.filter((c, i, all) => all.findIndex(other => other.every((v, channel) => v === c[channel])) === i);
  };
  const luminance = (c: Color): number => c.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: Color, b: Color): number => {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  const measureContrast = (el: Element, foreground: string, minimum: number, code: string, backgroundEl: Element | null = el): void => {
    const fg = color(foreground), bgs = backgrounds(backgroundEl);
    const unresolved = (reason: string): void => {
      record(el, 'CONTRAST_UNRESOLVED', reason, undefined, undefined, minimum, undefined, true);
      const issue = indeterminate.find(item => item.code === 'CONTRAST_UNRESOLVED' && item.selector === selector(el));
      // One element can have unresolved text and border checks. Keep that
      // combination conservative: text pixels cannot certify its UI boundary.
      if (issue) issue.contrastKind = issue.contrastKind === 'nontext' || code !== 'TEXT_CONTRAST' ? 'nontext' : 'text';
    };
    if (!fg || !bgs) { unresolved('Contrast needs pixel/manual evidence for an unsupported color, image, opacity, filter or blend.'); return; }
    if (bgs.length > 1 && fg[3] < 1) { unresolved('Translucent foreground over a gradient needs pixel evidence.'); return; }
    let ratio = Math.min(...bgs.map(bg => contrast(over(fg, bg), bg)));
    if (bgs.length > 1) {
      // Endpoints alone can miss grey text disappearing in a black-to-white gradient.
      // Component bounds include interior colors, conservatively (even if a bound
      // is not physically under the glyph). Never grant a pass from stop colors alone.
      const lower: Color = [Math.min(...bgs.map(c => c[0])), Math.min(...bgs.map(c => c[1])), Math.min(...bgs.map(c => c[2])), 1];
      const upper: Color = [Math.max(...bgs.map(c => c[0])), Math.max(...bgs.map(c => c[1])), Math.max(...bgs.map(c => c[2])), 1];
      ratio = luminance(fg) >= luminance(lower) && luminance(fg) <= luminance(upper) ? 1 : Math.min(ratio, contrast(fg, lower), contrast(fg, upper));
    }
    if (ratio < minimum) record(el, code, 'Measured contrast is below the mandatory minimum.', undefined, ratio, minimum);
  };
  type Painted = { el: Element; rect: DOMRect; kind: 'text' | 'control'; hitTarget?: Element };
  const painted: Painted[] = [];
  const fontContext=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1).getContext('2d'):null;
  const inkRect=(el:Element,text:string,r:DOMRect,singleLine:boolean):DOMRect=>{
    const s=style(el);
    // Range boxes contain full font ascent/descent, not actual glyph ink. Only
    // use a browser-matched single line; wrapped/shaped runs stay conservative.
    if(!fontContext||!singleLine||s.textShadow&&s.textShadow!=='none'||s.textDecorationLine&&s.textDecorationLine!=='none'||s.textTransform&&s.textTransform!=='none'||s.fontVariantCaps&&s.fontVariantCaps!=='normal'||s.fontFeatureSettings&&s.fontFeatureSettings!=='normal'||s.fontVariationSettings&&s.fontVariationSettings!=='normal')return r;
    fontContext.font=`${s.fontStyle||'normal'} ${s.fontWeight||'400'} ${s.fontSize} ${s.fontFamily||'sans-serif'}`;
    fontContext.direction=s.direction==='rtl'?'rtl':'ltr';
    const metrics=fontContext.measureText(text),ascent=metrics.fontBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent,inkAscent=metrics.actualBoundingBoxAscent,inkDescent=metrics.actualBoundingBoxDescent;
    if(![ascent,descent,inkAscent,inkDescent].every(Number.isFinite)||Math.abs(ascent+descent-r.height)>.25||inkAscent+inkDescent<=0)return r;
    const top=r.top+ascent-inkAscent,bottom=r.top+ascent+inkDescent;
    return {x:r.x,y:top,left:r.left,right:r.right,top,bottom,width:r.width,height:bottom-top} as DOMRect;
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent?.trim() || !visible(el) || el.closest('script,style,noscript,template')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const ranges=[...range.getClientRects()];
    // Bidi text may have several fragments on a single baseline. Full-text ink
    // metrics overestimate each fragment safely; distinct wrapped lines retain
    // the original conservative Range boxes.
    const singleLine=!!ranges.length&&ranges.every(r=>Math.abs(r.top-ranges[0].top)<=.25&&Math.abs(r.bottom-ranges[0].bottom)<=.25);
    const rects = ranges.map(r=>inkRect(el,node.textContent!,r,singleLine)).filter(r => !!paintRect(el,r) && !fullyOccluded(el, paintRect(el,r)!));
    if (!rects.length) continue;
    scanned.textNodes++;
    const s = style(el), font = parseFloat(s.fontSize);
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth && !hasTooltip(el)) record(el, 'CLIPPED_CONTENT', 'Ellipsized text has no explanatory tooltip.');
    const table = el.closest('td,th,[role="cell"],[role="columnheader"],[role="rowheader"]');
    const secondary = el.closest('small,[data-visual-role="secondary"],.text-muted-foreground,.admin-muted');
    const heading = el.closest('h1,h2,h3');
    const min = Math.max(thresholds.absoluteFont, table ? thresholds.tableFont : heading ? { H1: 28, H2: 22, H3: 18 }[heading.tagName as 'H1' | 'H2' | 'H3'] : secondary ? thresholds.secondaryFont : thresholds.baseFont);
    if (!Number.isFinite(font)) record(el, 'FONT_UNRESOLVED', 'Computed font size is unavailable.', undefined, undefined, min, undefined, true);
    else if (font < min) record(el, 'FONT_TOO_SMALL', 'Visible text is smaller than its semantic minimum.', undefined, font, min);
    if (/[\u0600-\u06ff]/.test(node.textContent)) {
      const line = parseFloat(s.lineHeight);
      if (!Number.isFinite(line)) record(el, 'ARABIC_LINE_HEIGHT_UNRESOLVED', 'Arabic line-height must be explicitly measurable at 1.7 or greater.', undefined, undefined, thresholds.arabicLineHeight, undefined, true);
      else if (line / font < thresholds.arabicLineHeight) record(el, 'ARABIC_LINE_HEIGHT', 'Arabic line-height is below 1.7.', undefined, line / font, thresholds.arabicLineHeight);
    }
    measureContrast(el, s.color, thresholds.textContrast, 'TEXT_CONTRAST');
    for (const rect of rects) { geometry(el, rect); painted.push({ el, rect: paintRect(el,rect)!, kind: 'text' }); }
  }
  const controls = [...scope.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="combobox"]')].filter(el => visible(el) && !fullyOccluded(el, el.getBoundingClientRect()));
  const controlRects = new Map<Element, DOMRect>();
  const controlTargets = new Map<Element, Element>();
  const stickyHeader = (el:Element):Element|null=>{
    for(let p:Element|null=el;p;p=p.parentElement){const s=style(p);if((p.tagName==='HEADER'||p.getAttribute('role')==='banner')&&['fixed','sticky'].includes(s.position)&&color(s.backgroundColor)?.[3]===1){let opaque=true;for(let ancestor:Element|null=p;ancestor;ancestor=ancestor.parentElement){const a=style(ancestor);if(Number(a.opacity)!==1||!identityFilter(a.filter)||a.mixBlendMode&&a.mixBlendMode!=='normal')opaque=false;}if(opaque)return p;}}
    return null;
  };
  for (const el of controls) {
    scanned.controls++;
    let hit: Element = el;
    if (el instanceof HTMLInputElement && /checkbox|radio/.test(el.type)) {
      const labels = [...(el.labels ?? [])].filter(visible).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      if (labels[0]) hit = labels[0];
    }
    const r = hit.getBoundingClientRect(), clipped = paintRect(hit,r,false);
    if(!clipped)continue;
    controlRects.set(el, clipped); controlTargets.set(el, hit);
    const minimum = touch ? thresholds.touchControl : thresholds.desktopControl;
    if (r.height < minimum) record(el, 'CONTROL_HEIGHT', 'Interactive hit target is too short.', r, r.height, minimum);
    const hasVisibleLabel = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) || [...el.querySelectorAll('*')].some(c => !c.closest('[aria-hidden="true"]') && visible(c) && c.textContent?.trim());
    const iconOnly = !hasVisibleLabel && Boolean(el.querySelector('svg,img,[data-icon]'));
    const ids = el.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
    const name = el.getAttribute('aria-label')?.trim() || ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim() || el.getAttribute('title')?.trim() || el.textContent?.trim() || el.querySelector('img')?.getAttribute('alt')?.trim();
    if (iconOnly && (!name || !hasTooltip(el) && !el.getAttribute('aria-label')?.trim() && !ids.length)) record(el, 'ICON_NAME', 'Icon control has no accessible explanatory name.', r);
    if (iconOnly && !hasTooltip(el)) record(el, 'ICON_TOOLTIP', 'Icon control has no explanatory tooltip.', r);
    if (iconOnly && Math.min(r.width, r.height) < thresholds.iconSize) record(el, 'ICON_TARGET_SIZE', 'Icon hit target must be at least 40 by 40.', r, Math.min(r.width, r.height), thresholds.iconSize);
    geometry(el, r); painted.push({ el, rect: clipped, kind: 'control', hitTarget: hit });
    const s = style(el);
    const selectionInput = el instanceof HTMLInputElement && ['checkbox','radio'].includes(el.type);
    // Checkbox/radio color is not painted text. Their labels are independently
    // scanned at 4.5; keep target and boundary/state paint checks at 3 below.
    if (el.matches('input,select,textarea') && !selectionInput) {
      const font = parseFloat(s.fontSize);
      const minimumFont = el.closest('td,th,[role="cell"]') ? thresholds.tableFont : thresholds.baseFont;
      if (!Number.isFinite(font)) record(el, 'FONT_UNRESOLVED', 'Computed input font size is unavailable.', r, undefined, minimumFont, undefined, true);
      else if (font < minimumFont) record(el, 'FONT_TOO_SMALL', 'Input text is smaller than its semantic minimum.', r, font, minimumFont);
      measureContrast(el, s.color, thresholds.textContrast, 'TEXT_CONTRAST');
    }
    if(selectionInput && el.checked){
      const mark=getComputedStyle(el,'::after');
      const borders=['top','right','bottom','left'].filter(side=>parseFloat(mark.getPropertyValue(`border-${side}-width`))>0&&!['none','hidden'].includes(mark.getPropertyValue(`border-${side}-style`))&&color(mark.getPropertyValue(`border-${side}-color`))?.[3]!==0);
      const fill=color(mark.backgroundColor),painted=!!mark.content&&!['none','normal'].includes(mark.content)&&mark.display!=='none'&&mark.visibility==='visible'&&parseFloat(mark.width)>0&&parseFloat(mark.height)>0&&Number(mark.opacity)===1&&identityFilter(mark.filter)&&identityFilter(mark.backdropFilter)&&(!mark.mixBlendMode||mark.mixBlendMode==='normal');
      if(!painted||!borders.length&&!fill?.[3])record(el,'UI_SELECTION_UNRESOLVED','Checked native control state requires explicit measurable glyph paint or direct pixel evidence.',r,undefined,thresholds.uiContrast,undefined,true);
      else{
        for(const side of borders)measureContrast(el,mark.getPropertyValue(`border-${side}-color`),thresholds.uiContrast,'UI_SELECTION_CONTRAST');
        if(fill?.[3])measureContrast(el,mark.backgroundColor,thresholds.uiContrast,'UI_SELECTION_CONTRAST');
      }
    }
    if (iconOnly) measureContrast(el, s.color, thresholds.uiContrast, 'UI_ICON_CONTRAST');
    const border = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && !['none', 'hidden'].includes(s.getPropertyValue(`border-${side.toLowerCase()}-style`)) && color(s.getPropertyValue(`border-${side.toLowerCase()}-color`))?.[3]!==0);
    for (const side of border) measureContrast(el, s.getPropertyValue(`border-${side.toLowerCase()}-color`), thresholds.uiContrast, 'UI_BORDER_CONTRAST', el.parentElement);
    const outline=parseFloat(s.outlineWidth)>0&&!['none','hidden'].includes(s.outlineStyle)&&color(s.outlineColor)?.[3]!==0;
    if(outline)measureContrast(el,s.outlineColor,thresholds.uiContrast,'UI_OUTLINE_CONTRAST',el.parentElement);
    // A measured visible border/outline identifies the component. A decorative
    // low-contrast interior need not provide a second component boundary.
    if (!border.length&&!outline && s.backgroundColor !== 'transparent' && color(s.backgroundColor)?.[3]) measureContrast(el, s.backgroundColor, thresholds.uiContrast, 'UI_FILL_CONTRAST', el.parentElement);
    else if (!border.length&&!outline && el.matches('input,select,textarea,[role="checkbox"],[role="switch"],[role="combobox"]')) record(el, 'UI_BOUNDARY_MISSING', 'Form control has no measurable border, outline or contrasting fill.', r);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const firstTarget = controlTargets.get(controls[i])!, secondTarget = controlTargets.get(controls[j])!;
      if(!firstTarget||!secondTarget)continue;
      if (firstTarget.contains(secondTarget) || secondTarget.contains(firstTarget)) continue;
      // Scrolling can place any flow control 0-7px below an independent sticky
      // banner. These controls are not adjacent in layout. Gaps within a banner
      // or within normal flow are still measured at the original 8px threshold.
      const firstHeader=stickyHeader(controls[i]),secondHeader=stickyHeader(controls[j]);
      if(firstHeader!==secondHeader&&(firstHeader&&!secondHeader||secondHeader&&!firstHeader))continue;
      const a = controlRects.get(controls[i])!, b = controlRects.get(controls[j])!;
      const verticalIntersection = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const horizontalIntersection = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const gap = verticalIntersection > 0 ? Math.max(a.left, b.left) - Math.min(a.right, b.right) : horizontalIntersection > 0 ? Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) : Infinity;
      // Native zoom introduces at most sub-1e-4px representation noise in an
      // exact 8px CSS gap. The reported and required threshold stays 8px.
      if (gap >= 0 && gap < thresholds.gap - 0.0001) record(controls[i], 'CONTROL_GAP', 'Adjacent controls have less than 8px separation.', a, gap, thresholds.gap, controls[j]);
  }
  for (const table of [...scope.querySelectorAll('table,[role="table"],[role="grid"]')].filter(visible)) {
    scanned.tables++;
    // Emptiness describes the table's rendered data, not this scroll position.
    // Row geometry is still measured only when painted during the full scan.
    const rows = [...table.querySelectorAll('tbody tr,[role="row"]')].filter(row => !hidden(row) && row.getBoundingClientRect().height > 0);
    const dataRows = rows.filter(row => row.querySelector('td:not([colspan]),[role="cell"]'));
    const emptyRows = rows.filter(row => !dataRows.includes(row) && row.textContent?.trim());
    const help = table.parentElement?.querySelector('[role="status"],[data-empty-state]');
    if (!dataRows.length && !emptyRows.length && !(help && visible(help) && help.textContent?.trim())) record(table, 'EMPTY_TABLE_NO_HELP', 'Empty table has no visible explanation or next step.');
    const compact = Boolean(table.closest('[data-density="compact"]'));
    const minimum = compact ? thresholds.compactRow : thresholds.comfortableRow;
    for (const row of dataRows.filter(visible)) if (row.getBoundingClientRect().height < minimum) record(row, 'TABLE_ROW_HEIGHT', 'Data row is shorter than the selected density minimum.', undefined, row.getBoundingClientRect().height, minimum);
  }
  for (let i = 0; i < painted.length; i++) for (let j = i + 1; j < painted.length; j++) {
    const a = painted[i], b = painted[j];
    const aOwner = a.hitTarget ?? a.el, bOwner = b.hitTarget ?? b.el;
    if (aOwner === bOwner || aOwner.contains(bOwner) || bOwner.contains(aOwner)) continue;
    const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
    const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
    if (overlapWidth > 0.01 && overlapHeight > 0.01) {
      const left = Math.max(a.rect.left, b.rect.left), top = Math.max(a.rect.top, b.rect.top);
      const intersection = { x: left, y: top, left, top, right: left + overlapWidth, bottom: top + overlapHeight, width: overlapWidth, height: overlapHeight } as DOMRect;
      if (!fullyOccluded(a.el, intersection) && !fullyOccluded(b.el, intersection)) record(a.el, 'CONTENT_OVERLAP', 'Unrelated visible text or interactive targets overlap.', a.rect, undefined, undefined, b.el);
    }
  }
  const bodyWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
  if (bodyWidth > width + 0.01) record(document.body, 'BODY_HORIZONTAL_OVERFLOW', 'The document itself scrolls horizontally.', undefined, bodyWidth, width);
  const compliant = !violations.length && !indeterminate.length;
  return { version: 'admin-visual-1', mode, viewport: { width, height, devicePixelRatio, touch }, thresholds, scanned, violations, indeterminate,
    compliant, shouldFail: mode === 'strict' && !compliant,
    limitations: ['Viewport-only: scroll each document/container to inspect below-fold content.',
      'Single-line ink uses matching browser font metrics; other DOM rectangles cannot certify glyph pixels, pseudo-elements, canvas, closed shadow roots or cross-origin frames.',
      'Images, unsupported colors, opacity, filters and blends produce indeterminate contrast; strict mode fails until investigated.',
      'Gradient stop contrast is conservative; bounding-box overlap needs screenshot review for intentional overlays.',
      'Icon accessible-name checks are not a complete accessible-name algorithm; retain axe alongside this scanner.'] };
}

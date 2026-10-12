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
      // Screen-reader-only labels are named content, not visible painted text.
      if (s.position === 'absolute' && (s.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(s.clipPath))) return true;
    }
    return false;
  };
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return !hidden(el) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height;
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
  // A sticky header may cover a whole Range rectangle after scrolling. Only
  // discard it when hit testing proves a separate, fully opaque covering layer.
  // Partial coverage remains measurable; transparency must never hide failures.
  const fullyOccluded = (el: Element, rect: DOMRect): boolean => {
    if (typeof document.elementsFromPoint !== 'function') return false;
    // Pointer-events:none elements are absent from hit testing. Their paint
    // order cannot be proven by this API, so retain them conservatively.
    for (let p: Element | null = el; p; p = p.parentElement) if (style(p).pointerEvents === 'none') return false;
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
          if (color(s.backgroundColor)?.[3] !== 1 || s.filter && s.filter !== 'none' || s.mixBlendMode && s.mixBlendMode !== 'normal') continue;
          let opaque = true, positionedLayer = false;
          for (let p: Element | null = cover; p; p = p.parentElement) {
            const ancestor = style(p);
            if (Number(ancestor.opacity) !== 1 || ancestor.filter && ancestor.filter !== 'none' || ancestor.mixBlendMode && ancestor.mixBlendMode !== 'normal') opaque = false;
            if (ancestor.position === 'fixed' || ancestor.position === 'sticky') positionedLayer = true;
          }
          // Ordinary overlapping controls remain a defect even when opaque.
          if (opaque && positionedLayer) return true;
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
      if (s.mixBlendMode && s.mixBlendMode !== 'normal' || s.filter && s.filter !== 'none' || s.backdropFilter && s.backdropFilter !== 'none' || Number(s.opacity) < 1) return null;
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
    if (!fg || !bgs) { record(el, 'CONTRAST_UNRESOLVED', 'Contrast needs pixel/manual evidence for an unsupported color, image, opacity, filter or blend.', undefined, undefined, undefined, undefined, true); return; }
    if (bgs.length > 1 && fg[3] < 1) { record(el, 'CONTRAST_UNRESOLVED', 'Translucent foreground over a gradient needs pixel evidence.', undefined, undefined, undefined, undefined, true); return; }
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
  type Painted = { el: Element; rect: DOMRect; kind: 'text' | 'control' };
  const painted: Painted[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent?.trim() || !visible(el) || el.closest('script,style,noscript,template')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height && !fullyOccluded(el, r));
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
    for (const rect of rects) { geometry(el, rect); painted.push({ el, rect, kind: 'text' }); }
  }
  const controls = [...scope.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="combobox"]')].filter(el => visible(el) && !fullyOccluded(el, el.getBoundingClientRect()));
  const controlRects = new Map<Element, DOMRect>();
  for (const el of controls) {
    scanned.controls++;
    let hit: Element = el;
    if (el instanceof HTMLInputElement && /checkbox|radio/.test(el.type)) {
      const labels = [...(el.labels ?? [])].filter(visible).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      if (labels[0]) hit = labels[0];
    }
    const r = hit.getBoundingClientRect(); controlRects.set(el, r);
    const minimum = touch ? thresholds.touchControl : thresholds.desktopControl;
    if (r.height < minimum) record(el, 'CONTROL_HEIGHT', 'Interactive hit target is too short.', r, r.height, minimum);
    const hasVisibleLabel = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) || [...el.querySelectorAll('*')].some(c => !c.closest('[aria-hidden="true"]') && visible(c) && c.textContent?.trim());
    const iconOnly = !hasVisibleLabel && Boolean(el.querySelector('svg,img,[data-icon]'));
    const ids = el.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
    const name = el.getAttribute('aria-label')?.trim() || ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim() || el.getAttribute('title')?.trim() || el.textContent?.trim() || el.querySelector('img')?.getAttribute('alt')?.trim();
    if (iconOnly && (!name || !hasTooltip(el) && !el.getAttribute('aria-label')?.trim() && !ids.length)) record(el, 'ICON_NAME', 'Icon control has no accessible explanatory name.', r);
    if (iconOnly && !hasTooltip(el)) record(el, 'ICON_TOOLTIP', 'Icon control has no explanatory tooltip.', r);
    if (iconOnly && Math.min(r.width, r.height) < thresholds.iconSize) record(el, 'ICON_TARGET_SIZE', 'Icon hit target must be at least 40 by 40.', r, Math.min(r.width, r.height), thresholds.iconSize);
    geometry(el, r); painted.push({ el, rect: r, kind: 'control' });
    const s = style(el);
    if (el.matches('input,select,textarea')) {
      const font = parseFloat(s.fontSize);
      const minimumFont = el.closest('td,th,[role="cell"]') ? thresholds.tableFont : thresholds.baseFont;
      if (!Number.isFinite(font)) record(el, 'FONT_UNRESOLVED', 'Computed input font size is unavailable.', r, undefined, minimumFont, undefined, true);
      else if (font < minimumFont) record(el, 'FONT_TOO_SMALL', 'Input text is smaller than its semantic minimum.', r, font, minimumFont);
      measureContrast(el, s.color, thresholds.textContrast, 'TEXT_CONTRAST');
    }
    if (iconOnly) measureContrast(el, s.color, thresholds.uiContrast, 'UI_ICON_CONTRAST');
    const border = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && !['none', 'hidden'].includes(s.getPropertyValue(`border-${side.toLowerCase()}-style`)));
    for (const side of border) measureContrast(el, s.getPropertyValue(`border-${side.toLowerCase()}-color`), thresholds.uiContrast, 'UI_BORDER_CONTRAST', el.parentElement);
    if (!border.length && s.backgroundColor !== 'transparent' && color(s.backgroundColor)?.[3]) measureContrast(el, s.backgroundColor, thresholds.uiContrast, 'UI_FILL_CONTRAST', el.parentElement);
    else if (!border.length && el.matches('input,select,textarea,[role="checkbox"],[role="switch"],[role="combobox"]')) record(el, 'UI_BOUNDARY_MISSING', 'Form control has no measurable border or contrasting fill.', r);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const a = controlRects.get(controls[i])!, b = controlRects.get(controls[j])!;
      const verticalIntersection = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const horizontalIntersection = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const gap = verticalIntersection > 0 ? Math.max(a.left, b.left) - Math.min(a.right, b.right) : horizontalIntersection > 0 ? Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) : Infinity;
      if (gap >= 0 && gap < thresholds.gap) record(controls[i], 'CONTROL_GAP', 'Adjacent controls have less than 8px separation.', a, gap, thresholds.gap, controls[j]);
  }
  for (const table of [...scope.querySelectorAll('table,[role="table"],[role="grid"]')].filter(visible)) {
    scanned.tables++;
    const rows = [...table.querySelectorAll('tbody tr,[role="row"]')].filter(visible);
    const dataRows = rows.filter(row => row.querySelector('td:not([colspan]),[role="cell"]'));
    const emptyRows = rows.filter(row => !dataRows.includes(row) && row.textContent?.trim());
    const help = table.parentElement?.querySelector('[role="status"],[data-empty-state]');
    if (!dataRows.length && !emptyRows.length && !(help && visible(help) && help.textContent?.trim())) record(table, 'EMPTY_TABLE_NO_HELP', 'Empty table has no visible explanation or next step.');
    const compact = Boolean(table.closest('[data-density="compact"]'));
    const minimum = compact ? thresholds.compactRow : thresholds.comfortableRow;
    for (const row of dataRows) if (row.getBoundingClientRect().height < minimum) record(row, 'TABLE_ROW_HEIGHT', 'Data row is shorter than the selected density minimum.', undefined, row.getBoundingClientRect().height, minimum);
  }
  for (let i = 0; i < painted.length; i++) for (let j = i + 1; j < painted.length; j++) {
    const a = painted[i], b = painted[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
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
      'DOM rectangles cannot certify actual glyph pixels, pseudo-elements (including placeholders), canvas, closed shadow roots or cross-origin frames.',
      'Images, unsupported colors, opacity, filters and blends produce indeterminate contrast; strict mode fails until investigated.',
      'Gradient stop contrast is conservative; bounding-box overlap needs screenshot review for intentional overlays.',
      'Icon accessible-name checks are not a complete accessible-name algorithm; retain axe alongside this scanner.'] };
}

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Browser render harness', () => {
  it('keeps full-screen border drawing scoped to its scale factor', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'public/render-harness.html'), 'utf8');
    const start = source.indexOf('function drawFullScreenBorder');
    const end = source.indexOf('// Text wrapping for RTL Arabic', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const borderFunction = source.slice(start, end);
    expect(borderFunction).not.toMatch(/\bF\b/);
    expect(borderFunction).toContain('ctx.lineWidth = 1 * S;');
  });
});

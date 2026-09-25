import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('decorative layers do not intercept controls', () => {
  it.each([
    'src/pages/Index.tsx',
    'src/pages/CreatePage.tsx',
    'src/components/AchievementUnlockNotification.tsx',
    'src/components/BackgroundSelector.tsx',
    'src/components/CustomBackgroundUploader.tsx',
    'src/components/PexelsVideoSelector.tsx',
  ])('%s keeps empty absolute decorations outside hit testing', (file) => {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let checked = 0;
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node)) {
        const attr = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'className');
        const value = attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : '';
        if (value.includes('absolute') && /bg-gradient|islamic-pattern|blur-/.test(value)) {
          checked++;
          expect(value, `${file}: ${value}`).toContain('pointer-events-none');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(checked).toBeGreaterThan(0);
  });
});

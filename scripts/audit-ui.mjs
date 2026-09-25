import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Read-only source inventory. Generated reports preserve the pre-refactor
// bindings so relocated controls can be checked against their original behavior.
const root = process.cwd();
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx$/.test(file)) files.push(file);
  }
}
walk(path.join(root, 'src'));
const inventory = [];
for (const file of files.sort()) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = [];
  const states = [];
  const imports = [];
  function visit(node) {
    if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.text);
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && /^(useState|useReducer|useForm)$/.test(node.initializer.expression.getText(tree))) {
      states.push(node.getText(tree));
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      const props = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(tree), a.initializer?.getText(tree) ?? 'true']));
      if (/Button|Input|Select|Switch|Slider|Radio|Checkbox|Tabs|Dialog|Dropdown|Accordion|Sheet|Popover|Link|Textarea|Menu|Control|Panel|Selector|Uploader|Search|Card$/.test(tag) || /^(button|input|select|textarea|a|form|details|summary)$/.test(tag) || Object.keys(props).some(k => /^on[A-Z]/.test(k))) {
        const conditions = [];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isConditionalExpression(parent)) conditions.push(parent.condition.getText(tree));
          if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) conditions.push(parent.left.getText(tree));
        }
        const parent = ts.isJsxOpeningElement(node) ? node.parent : node;
        const texts = [];
        function collect(n) { if (ts.isJsxText(n) && n.text.trim()) texts.push(n.text.trim()); ts.forEachChild(n, collect); }
        collect(parent);
        controls.push({line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, tag, text: texts.join(' ').replace(/\s+/g, ' '), props, conditions});
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  inventory.push({file: path.relative(root, file).replaceAll('\\', '/'), imports, states, controls});
}
const report = { baseline: '66c73c004d09ad0f07215265c0b44c7956eaf2cd', files: inventory };
const output = process.argv[2];
if (!output) throw new Error('Pass a report path; baseline reports are never overwritten.');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({output, files: inventory.length, controls: inventory.reduce((sum, f) => sum + f.controls.length, 0), stateBindings: inventory.reduce((sum, f) => sum + f.states.length, 0)}));

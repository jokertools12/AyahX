import fs from 'node:fs';
import ts from 'typescript';

const baseline = JSON.parse(fs.readFileSync('docs/ui-refactor/baseline-inventory.json', 'utf8'));
const binding = /^(on[A-Z].*|value|defaultValue|checked|defaultChecked|disabled|required|min|max|step|accept|multiple|to|href|type|name)$/;
const normalize = text => text.replace(/\s+/g, ' ').trim();
const fingerprint = (tag, props, conditions = []) => {
  const entries = Object.entries(props).filter(([key]) => binding.test(key)).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? JSON.stringify([tag, entries.map(([key, value]) => [key, normalize(value)]), conditions.map(normalize)]) : null;
};
const failures = [];
let checked = 0;
let statesChecked = 0;
for (const file of baseline.files) {
  const tree = ts.createSourceFile(file.file, fs.readFileSync(file.file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const current = new Map();
  const states = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && /^(useState|useReducer|useForm)$/.test(node.initializer.expression.getText(tree))) states.push(normalize(node.getText(tree)));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const props = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(tree), a.initializer?.getText(tree) ?? 'true']));
      const conditions = [];
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isConditionalExpression(parent)) conditions.push(parent.condition.getText(tree));
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) conditions.push(parent.left.getText(tree));
      }
      const key = fingerprint(node.tagName.getText(tree), props, conditions);
      if (key) current.set(key, (current.get(key) || 0) + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const state of file.states) {
    statesChecked++;
    const index = states.indexOf(normalize(state));
    if (index < 0) failures.push({file:file.file,state});
    else states.splice(index,1);
  }
  for (const control of file.controls) {
    const key = fingerprint(control.tag, control.props, control.conditions);
    if (!key) continue;
    checked++;
    const remaining = current.get(key) || 0;
    if (remaining) current.set(key, remaining - 1);
    else failures.push({file: file.file, originalLine: control.line, tag: control.tag, binding: key});
  }
}
console.log(JSON.stringify({checked, statesChecked, failures}, null, 2));
if (failures.length) process.exitCode = 1;

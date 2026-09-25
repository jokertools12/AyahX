import fs from 'node:fs';
import ts from 'typescript';

// A source-linked relocation map, not a claim of end-to-end coverage.
const baseline = JSON.parse(fs.readFileSync('docs/ui-refactor/baseline-inventory.json', 'utf8'));
const normalize = s => s.replace(/\s+/g, ' ').trim();
const ignored = /^(className|style|dir|aria-.*|title|description)$/;
const signature = (tag, props) => JSON.stringify([tag, Object.entries(props).filter(([k]) => !ignored.test(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])]);
const rows = [];
const issues = [];
for (const file of baseline.files) {
  const tree = ts.createSourceFile(file.file, fs.readFileSync(file.file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates = new Map();
  function propsOf(node) { return Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.getText(tree),a.initializer?.getText(tree) ?? 'true'])); }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      const props = propsOf(node);
      const groups = [];
      for (let p=node.parent; p; p=p.parent) {
        if (!ts.isJsxElement(p) || p.openingElement === node) continue;
        const name = p.openingElement.tagName.getText(tree);
        const a = propsOf(p.openingElement);
        if (name === 'SettingsSection') groups.unshift(`الإعدادات: ${a.title?.replaceAll('"','')}`);
        if (name === 'TabsContent') groups.unshift(`تبويب ${a.value}`);
        if (name === 'DropdownMenuContent') groups.unshift('قائمة منسدلة');
        if (name === 'AccordionContent') groups.unshift('قسم قابل للطي');
        if (name === 'DialogContent') groups.unshift('نافذة حوار');
      }
      const key = signature(tag,props);
      const list = candidates.get(key) ?? [];
      list.push({line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,groups});
      candidates.set(key,list);
    }
    ts.forEachChild(node,visit);
  }
  visit(tree);
  for (const control of file.controls) {
    const matches = candidates.get(signature(control.tag,control.props));
    // Consume each occurrence once so duplicate controls cannot mask removals.
    const match = matches?.shift();
    if (!match) issues.push(`${file.file}:${control.line} ${control.tag}`);
    const groups = match?.groups ?? [];
    const bindings = Object.fromEntries(Object.entries(control.props).filter(([k])=>/^(on[A-Z]|value|checked|to$|href$)/.test(k)));
    const component = /src\/components\/ui\//.test(file.file);
    rows.push({
      element: control.text || control.props['aria-label'] || control.props.placeholder || control.props.id || control.tag,
      tag:control.tag,
      function:bindings,
      previousLocation:`${file.file}:${control.line}`,
      priority:component ? 'مكوّن مشترك: بحسب سياق الاستخدام' : groups.length ? 'ثانوي أو سياقي داخل المجموعة' : 'مباشر أو سياقي في الصفحة',
      category:groups.join(' ← ') || (component ? 'عنصر واجهة مشترك' : 'واجهة الصفحة الحالية'),
      newLocation:match ? `${file.file}:${match.line}` : null,
      originalConditions:control.conditions,
      verification:'مطابقة مصدرية؛ التغطية التفاعلية موثقة منفصلة في plan.md',
    });
  }
}
if (issues.length) { console.error(JSON.stringify({unmapped:issues},null,2)); process.exitCode=1; }
else {
  fs.writeFileSync('docs/ui-refactor/element-map.json',JSON.stringify({baseline:baseline.baseline, note:'Source positions include shared primitives and repeated templates, not unique features. Generated from the audited baseline; priority is contextual, not usage telemetry.',rows},null,2)+'\n');
  console.log(JSON.stringify({mapped:rows.length,unmapped:0}));
}

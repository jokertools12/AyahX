import ts from 'typescript';

// Required owner-facing pages, not dataset cardinalities. Every Route in the
// source is inspected too: adding an unseeded dynamic route must fail closed.
export const requiredAdminRoutePatterns = Object.freeze([
  '', 'roles', 'users', 'audit', 'settings', 'security', 'reciters', 'reciters/:id',
  'recitations', 'availability', 'providers', 'quran', 'timings', '_kit',
  'reviews', 'reviews/:id', 'listening', 'listening/:id', 'provider-licenses',
  'labels', 'storage', 'licensed-audio', 'licensed-audio/:id', 'reciter-wizard',
  'render-lab', 'launch', 'project', 'help',
]);

export function buildAdminVisualRoutes(source, fixture, options = {}) {
  const ast = ts.createSourceFile('AdminRoot.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const patterns = new Set();
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'Route') {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      if (attributes.some(attribute => attribute.name.getText(ast) === 'index')) patterns.add('');
      const path = attributes.find(attribute => attribute.name.getText(ast) === 'path');
      if (path) {
        const expression = path.initializer && ts.isJsxExpression(path.initializer) ? path.initializer.expression : path.initializer;
        if (!expression || !ts.isStringLiteral(expression)) throw new Error('NON_LITERAL_ADMIN_ROUTE_REQUIRES_INVENTORY');
        if (expression.text !== '*') patterns.add(expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const pattern of requiredAdminRoutePatterns) if (!patterns.has(pattern)) throw new Error('MISSING_REQUIRED_ADMIN_ROUTE:' + pattern);
  const identifiers = {
    'reciters/:id': fixture.reciterId,
    'reviews/:id': fixture.reviewId,
    'listening/:id': fixture.recitationId,
    'licensed-audio/:id': fixture.youtubeRecitationId,
  };
  const routes=[...patterns].map(pattern => {
    if(pattern==='timings'&&fixture.timingsRecitationId){
      if(!/^[a-zA-Z0-9_-]+$/u.test(fixture.timingsRecitationId)||!Number.isSafeInteger(fixture.timingsSurah)||!Number.isSafeInteger(fixture.timingsAyah)||fixture.timingsSurah<1||fixture.timingsAyah<1)throw new Error('REAL_TIMING_VISUAL_FIXTURE_REQUIRED');
      return{pattern,path:`/admin/timings?recitation_id=${fixture.timingsRecitationId}&surah=${fixture.timingsSurah}&ayah=${fixture.timingsAyah}&from=${fixture.timingsAyah}`};
    }
    if(pattern==='render-lab'&&fixture.renderJobId){
      if(!/^[a-zA-Z0-9_-]+$/u.test(fixture.renderJobId))throw new Error('OWNED_RENDER_VISUAL_FIXTURE_REQUIRED');
      return{pattern,path:'/admin/render-lab?job_id='+fixture.renderJobId};
    }
    if (pattern.includes(':')) {
      const id = identifiers[pattern];
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error('UNSEEDED_ADMIN_ROUTE_PARAMETER:' + pattern);
      return {pattern, path: '/admin/' + pattern.replace(':id', id)};
    }
    if (pattern && !/^[a-zA-Z0-9/_-]+$/u.test(pattern)) throw new Error('INVALID_ADMIN_ROUTE_PATH');
    return {pattern, path: '/admin' + (pattern ? '/' + pattern : '')};
  });
  // Full CI fixtures cover tabbed pages too, using the application's existing
  // query state. No DOM injection or mocked content replaces these subviews.
  return (options.includeAllViews??Boolean(fixture.timingsRecitationId&&fixture.renderJobId))?routes.flatMap(route=>route.pattern==='quran'?[route,...['integrity','riwayat'].map(tab=>({...route,path:route.path+'?tab='+tab,view:tab}))]:route.pattern==='reciters/:id'?[route,...['recitations','availability','sources','audit'].map(tab=>({...route,path:route.path+'?tab='+tab,view:tab}))]:[route]):routes;
}

/** All concrete modal declarations must have an explicit safe opener. */
export function buildAdminVisualDialogs(sources) {
  const declared=new Map(),openers=new Set();
  const contents=new Set(['DialogContent','DrawerContent','SheetContent','AlertDialogContent','dialog']);
  for(const {path,source} of sources){
    const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const slug=(node,name)=>{
      const attr=node.attributes.properties.filter(ts.isJsxAttribute).find(a=>a.name.getText(ast)===name);
      const expression=attr?.initializer&&ts.isJsxExpression(attr.initializer)?attr.initializer.expression:attr?.initializer;
      if(!expression||!ts.isStringLiteral(expression)||!/^[a-z0-9-]+$/u.test(expression.text))throw new Error('LITERAL_DIALOG_MARKER_REQUIRED:'+path+':'+name);
      return expression.text;
    };
    const visit=node=>{
      if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
        const tag=node.tagName.getText(ast),attributes=node.attributes.properties.filter(ts.isJsxAttribute);
        const normalized=path.replaceAll('\\','/');
        if(attributes.some(a=>a.name.getText(ast)==='visualDialogId'))openers.add(slug(node,'visualDialogId'));
        if(attributes.some(a=>a.name.getText(ast)==='data-admin-visual-open')){
          const attr=attributes.find(a=>a.name.getText(ast)==='data-admin-visual-open');
          const expression=attr.initializer&&ts.isJsxExpression(attr.initializer)?attr.initializer.expression:null;
          const forwarding=['/ui/DataTable.tsx','/ui/ChapterMatrix.tsx','/ui/AdminPrimitives.tsx'].some(file=>normalized.endsWith(file))&&expression&&ts.isIdentifier(expression)&&expression.text==='visualDialogId';
          if(!forwarding)openers.add(slug(node,'data-admin-visual-open'));
        }
        // ConfirmDialog forwards visualId; its single generic implementation is
        // checked separately. Every concrete usage still needs a literal ID.
        if((contents.has(tag)||tag==='ConfirmDialog')&&!normalized.endsWith('/ui/AdminPrimitives.tsx')){
          const id=slug(node,tag==='ConfirmDialog'?'visualId':'data-admin-visual-dialog');
          if(declared.has(id))throw new Error('DUPLICATE_DIALOG_DECLARATION:'+id);
          declared.set(id,{slug:id,file:path});
        }
      }
      ts.forEachChild(node,visit);
    };visit(ast);
  }
  for(const id of declared.keys())if(!openers.has(id))throw new Error('DIALOG_WITHOUT_SAFE_OPENER:'+id);
  for(const id of openers)if(!declared.has(id))throw new Error('OPENER_WITHOUT_DIALOG:'+id);
  if(!declared.size)throw new Error('EMPTY_ADMIN_DIALOG_INVENTORY');
  return [...declared.values()].sort((a,b)=>a.slug.localeCompare(b.slug));
}

export function assertAdminVisualDialogCoverage(inventory,observed){
  const passed=new Set(observed.filter(item=>item.passed).map(item=>item.slug));
  const missing=inventory.map(item=>item.slug).filter(id=>!passed.has(id));
  if(missing.length)throw new Error('UNTESTED_DECLARED_ADMIN_DIALOGS:'+missing.join(','));
}

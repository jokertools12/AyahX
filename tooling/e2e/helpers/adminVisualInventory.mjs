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

export function buildAdminVisualRoutes(source, fixture) {
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
  return [...patterns].map(pattern => {
    if (pattern.includes(':')) {
      const id = identifiers[pattern];
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error('UNSEEDED_ADMIN_ROUTE_PARAMETER:' + pattern);
      return {pattern, path: '/admin/' + pattern.replace(':id', id)};
    }
    if (pattern && !/^[a-zA-Z0-9/_-]+$/u.test(pattern)) throw new Error('INVALID_ADMIN_ROUTE_PATH');
    return {pattern, path: '/admin' + (pattern ? '/' + pattern : '')};
  });
}

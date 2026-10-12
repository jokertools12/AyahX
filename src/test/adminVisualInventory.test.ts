// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {buildAdminVisualRoutes, requiredAdminRoutePatterns,buildAdminVisualDialogs,assertAdminVisualDialogCoverage} from '../../tooling/e2e/helpers/adminVisualInventory.mjs';

const fixture = {reciterId: 'reader-1', reviewId: 'review-1', recitationId: 'recording-1', youtubeRecitationId: 'youtube-recording-1'};
const router = (extra = '') => '<Routes>' + requiredAdminRoutePatterns.map(pattern => pattern ? `<Route path="${pattern}" element={<Page/>}/>` : '<Route index element={<Page/>}/>').join('') + extra + '<Route path="*" element={<Error/>}/></Routes>';
describe('admin visual route coverage inventory', () => {
  it('uses recitation IDs for listening and licensed media, while preserving all pages', () => {
    const routes = buildAdminVisualRoutes(router(), fixture);
    expect(routes).toHaveLength(requiredAdminRoutePatterns.length);
    expect(routes.find(route => route.pattern === 'listening/:id')?.path).toBe('/admin/listening/recording-1');
    expect(routes.find(route => route.pattern === 'licensed-audio/:id')?.path).toBe('/admin/licensed-audio/youtube-recording-1');
  });
  it('fails on a missing owner page rather than passing a smaller matrix', () => {
    expect(() => buildAdminVisualRoutes(router().replace('<Route path="project" element={<Page/>}/>', ''), fixture)).toThrow('MISSING_REQUIRED_ADMIN_ROUTE:project');
  });
  it('fails on unknown dynamic additions and non-literal routing', () => {
    expect(() => buildAdminVisualRoutes(router('<Route path="unknown/:id" element={<Page/>}/>'), fixture)).toThrow('UNSEEDED_ADMIN_ROUTE_PARAMETER');
    expect(() => buildAdminVisualRoutes(router('<Route path={runtimePath} element={<Page/>}/>'), fixture)).toThrow('NON_LITERAL_ADMIN_ROUTE_REQUIRES_INVENTORY');
  });
  it('ignores examples in comments and preserves literal JSX expression paths', () => {
    const source = router().replace('path="project"', 'path={"project"}') + '/* <Route path="private/:id"/> */';
    expect(buildAdminVisualRoutes(source, fixture)).toHaveLength(requiredAdminRoutePatterns.length);
  });
});

describe('declared admin dialog coverage',()=>{
 const source='<Button data-admin-visual-open="search"/><DialogContent data-admin-visual-dialog="search"/><Button data-admin-visual-open="delete"/><ConfirmDialog visualId="delete"/>';
 const files=(text:string)=>[{path:'src/admin/Page.tsx',source:text}];
 it('requires literal concrete markers, including typed confirmation wrappers',()=>{
  expect(buildAdminVisualDialogs(files(source)).map(item=>item.slug)).toEqual(['delete','search']);
  expect(()=>buildAdminVisualDialogs(files(source.replace('visualId="delete"','visualId={runtimeId}')))).toThrow('LITERAL_DIALOG_MARKER_REQUIRED');
  expect(()=>buildAdminVisualDialogs(files(source+'<DrawerContent/>'))).toThrow('LITERAL_DIALOG_MARKER_REQUIRED');
 });
 it('rejects declarations with missing openers, orphaned openers and duplicate declarations',()=>{
  expect(()=>buildAdminVisualDialogs(files(source.replace('<Button data-admin-visual-open="search"/>','')))).toThrow('DIALOG_WITHOUT_SAFE_OPENER');
  expect(()=>buildAdminVisualDialogs(files(source+'<Button data-admin-visual-open="orphan"/>'))).toThrow('OPENER_WITHOUT_DIALOG');
  expect(()=>buildAdminVisualDialogs(files(source+'<DialogContent data-admin-visual-dialog="search"/>'))).toThrow('DUPLICATE_DIALOG_DECLARATION');
  expect(()=>buildAdminVisualDialogs(files('<main/>'))).toThrow('EMPTY_ADMIN_DIALOG_INVENTORY');
 });
 it('cannot pass by silently leaving a declared dialog unvisited or failing',()=>{
  const inventory=buildAdminVisualDialogs(files(source));
  expect(()=>assertAdminVisualDialogCoverage(inventory,[{slug:'search',passed:true}])).toThrow('UNTESTED_DECLARED_ADMIN_DIALOGS:delete');
  expect(()=>assertAdminVisualDialogCoverage(inventory,[{slug:'search',passed:true},{slug:'delete',passed:false}])).toThrow('UNTESTED_DECLARED_ADMIN_DIALOGS:delete');
  expect(()=>assertAdminVisualDialogCoverage(inventory,[{slug:'search',passed:true},{slug:'delete',passed:true}])).not.toThrow();
 });
});

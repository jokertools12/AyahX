// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {buildAdminLighthouseRoutes,summarizeAdminLighthouse,assertAdminLighthouseCoverage} from '../../tooling/e2e/helpers/adminLighthouse.mjs';
const source=readFileSync('src/admin/AdminRoot.tsx','utf8');
const fixture={reciterId:'actual-reader',reviewId:'actual-review',recitationId:'actual-recording',youtubeRecitationId:'actual-licensed',timingsRecitationId:'actual-recording',timingsSurah:103,timingsAyah:1};
const lhr=(accessibility=.95,bestPractices=.95,cls=.1)=>({categories:{accessibility:{score:accessibility},'best-practices':{score:bestPractices}},audits:{'cumulative-layout-shift':{numericValue:cls}},runWarnings:[]});
describe('ten-page authenticated Lighthouse proof',()=>{
 it('defaults to twelve actual main pages including GET-derived review/listening targets',()=>{
  const routes=buildAdminLighthouseRoutes(source,fixture);expect(routes).toHaveLength(12);
  expect(routes).toContain('/admin/reviews/actual-review');expect(routes).toContain('/admin/listening/actual-recording');
  expect(routes).toContain('/admin/render-lab');expect(routes).not.toContain('/admin/_kit');
  expect(buildAdminLighthouseRoutes(source,fixture,routes.slice(0,10))).toHaveLength(10);
 });
 it('rejects fewer than ten pages, repeated tabs of one page and invented/external IDs',()=>{
  const routes=buildAdminLighthouseRoutes(source,fixture);
  expect(()=>buildAdminLighthouseRoutes(source,fixture,routes.slice(0,9))).toThrow('LIGHTHOUSE_AT_LEAST_TEN_PAGES_REQUIRED');
  expect(()=>buildAdminLighthouseRoutes(source,fixture,[...routes.slice(0,9),'/admin/reviews/invented'])).toThrow('CAPTURE_DIAGNOSTIC_ROUTE_NOT_IN_INVENTORY');
  expect(()=>buildAdminLighthouseRoutes(source,fixture,[...routes.slice(0,9),'https://external.example/admin'])).toThrow('CAPTURE_DIAGNOSTIC_ROUTE_NOT_IN_INVENTORY');
  const tabs=['/admin/reciters/actual-reader','/admin/reciters/actual-reader?tab=recitations','/admin/reciters/actual-reader?tab=availability','/admin/reciters/actual-reader?tab=sources','/admin/reciters/actual-reader?tab=audit','/admin/quran','/admin/quran?tab=integrity','/admin/quran?tab=riwayat','/admin','/admin/project'];
  expect(()=>buildAdminLighthouseRoutes(source,fixture,tabs)).toThrow('LIGHTHOUSE_AT_LEAST_TEN_DISTINCT_PAGES_REQUIRED');
 });
 it('enforces the exact95/95/.1 boundaries including null scores and runtime failure',()=>{
  expect(summarizeAdminLighthouse(lhr(),'/admin').passed).toBe(true);
  for(const values of [[.949999,.95,.1],[.95,.949999,.1],[.95,.95,.100001]])expect(summarizeAdminLighthouse(lhr(...values as [number,number,number]),'/admin').passed).toBe(false);
  expect(summarizeAdminLighthouse({},'/admin').passed).toBe(false);
  expect(summarizeAdminLighthouse({...lhr(),runtimeError:{code:'NO_FCP'}},'/admin').passed).toBe(false);
 });
 it('does not serialize raw authenticated DOM, header, warning or token data',()=>{
  const secret='private-test-marker',input={...lhr(),runWarnings:[secret],finalDisplayedUrl:'http://localhost/admin?token='+secret,audits:{...lhr().audits,'color-contrast':{score:0,scoreDisplayMode:'binary',details:{nodes:[{html:secret}]}},[secret+'?token=secret']:{score:0}}};
  const summary=summarizeAdminLighthouse(input,'/admin');expect(JSON.stringify(summary)).not.toContain(secret);expect(summary.warningCount).toBe(1);expect(summary.failedAudits).toEqual([{id:'color-contrast',score:0,scoreDisplayMode:'binary'}]);
 });
 it('requires every requested route once and independently verifies score gates despite green flags',()=>{
  const routes=buildAdminLighthouseRoutes(source,fixture),pages=routes.map((path:string)=>summarizeAdminLighthouse(lhr(),path));
  expect(assertAdminLighthouseCoverage(routes,pages)).toBe(true);
  expect(()=>assertAdminLighthouseCoverage(routes,pages.slice(1))).toThrow('LIGHTHOUSE_ROUTE_COVERAGE_INCOMPLETE');
  expect(()=>assertAdminLighthouseCoverage(routes,[...pages.slice(0,-1),pages[0]])).toThrow('LIGHTHOUSE_ROUTE_COVERAGE_DUPLICATE');
  expect(assertAdminLighthouseCoverage(routes,[{...pages[0],accessibility:94.99,passed:true},...pages.slice(1)])).toBe(false);
 });
 it('loads --routes only from a private file and retains no raw Lighthouse result in reports',()=>{
  const script=readFileSync('scripts/measure-admin-lighthouse.mjs','utf8');
  expect(script).toContain("argument('--routes')");expect(script).toContain('await privateInput(routesPath)');expect(script).toContain('rawArtifactsPersisted:false');
  const progress=readFileSync('tooling/e2e/helpers/adminLighthouseProgress.mjs','utf8');
  expect(script).not.toContain('JSON.stringify(result.lhr');expect(script).toContain('progress.finish()');
  expect(progress).toContain('assertAdminLighthouseCoverage(report.expectedRoutes,report.pages)');
 });
});

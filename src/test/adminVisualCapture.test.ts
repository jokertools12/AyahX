// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {discoverAdminCaptureTargets,buildAdminCaptureInventory,filterAdminCaptureInventory,expectedAdminCaptureCases,assertAdminCaptureCoverage,assertAdminCaptureReadGates,assertAdminCaptureObservation} from '../../tooling/e2e/helpers/adminVisualCapture.mjs';
const source=readFileSync('src/admin/AdminRoot.tsx','utf8');
const fixture={reciterId:'reader',reviewId:'review',recitationId:'recording',youtubeRecitationId:'licensed',timingsRecitationId:'recording',timingsSurah:103,timingsAyah:1};
const matrix=(inventory:unknown[],phase:string)=>expectedAdminCaptureCases(inventory,phase).map((row:Record<string,unknown>)=>({...row,viewport:{dpr:row.zoom},screenshot:'/private/image.png',sha256:'1'.repeat(64),observationPath:'/private/observation.json'}));
function api(retained=false){
 const responses:Record<string,unknown>={
  '/api/admin/catalog/reciters?limit=1':{data:[{id:'reader'}]},
  '/api/admin/reviews?type=voice_confirmation&limit=1':{data:[{id:'review',recitation_id:'recording'}]},
  '/api/admin/licensed-audio':{data:{items:[{id:'licensed'}]}},
  '/api/admin/render-lab/choices':{data:{recitations:[{id:'recording'}]}},
  '/api/admin/catalog/recitations/recording/chapters':{data:{recitation:{id:'recording'},chapters:[{surah:103,ayah_count:3,ready_ayahs:3}]}},
  '/api/admin/catalog/timings?recitation_id=recording&surah=103&from=1&to=3&limit=1':{data:[{recitation_id:'recording',surah:103,ayah:1}]},
  '/api/admin/render-lab/jobs':{data:{items:retained?[{id:'actual-retained-job',status:'succeeded',artifact_available:true}]:[]}},
  '/api/admin/render-lab/jobs/actual-retained-job':{data:{id:'actual-retained-job',status:'succeeded',artifact:{requiresAdminAuthentication:true,playPath:'/api/admin/render-lab/jobs/actual-retained-job/media'},qa_report_json:{}}},
 };
 return{responses,read:vi.fn(async(path:string)=>{if(!(path in responses))throw new Error('UNEXPECTED_READ');return responses[path];})};
}
describe('production visual capture inventory and complete coverage',()=>{
 it('preserves before13×48 and expands after all36 AST views×48 including owner-feedback tools',()=>{
  const before=buildAdminCaptureInventory(source,{reciterId:'reader'},'before'),after=buildAdminCaptureInventory(source,fixture,'after');
  expect(before).toHaveLength(13);expect(expectedAdminCaptureCases(before,'before')).toHaveLength(624);
  expect(after).toHaveLength(36);expect(expectedAdminCaptureCases(after,'after')).toHaveLength(1728);
  expect(after.find(row=>row.pattern==='render-lab')?.path).toBe('/admin/render-lab');
  expect(after.filter(row=>row.pattern==='quran')).toHaveLength(3);expect(after.filter(row=>row.pattern==='reciters/:id')).toHaveLength(5);
 });
 it('derives real targets only from current GET DTOs and records missing retained media explicitly',async()=>{
  const reader=api(),targets=await discoverAdminCaptureTargets(reader.read);
  expect(targets.fixture).toEqual(fixture);expect(targets.fixture).not.toHaveProperty('renderJobId');
  expect(targets.targetEvidence).toMatchObject({source:'authenticated_get',retained_video:'unavailable',synthetic_targets:false});
  expect(targets.limitations.map(row=>row.code)).toContain('RETAINED_QA_VIDEO_UNAVAILABLE');
  expect(reader.read.mock.calls.map(([path])=>path)).toContain('/api/admin/catalog/timings?recitation_id=recording&surah=103&from=1&to=3&limit=1');
  const retained=await discoverAdminCaptureTargets(api(true).read);expect(retained.fixture.renderJobId).toBe('actual-retained-job');
 });
 it('GET-verifies the root-supplied actual video and refuses synthetic production media',async()=>{
  const reader=api(true);await expect(discoverAdminCaptureTargets(reader.read,{renderJobId:'actual-retained-job',production:true})).resolves.toMatchObject({targetEvidence:{render_selection:'root_supplied_get_verified',synthetic_targets:false}});
  reader.responses['/api/admin/render-lab/jobs/actual-retained-job']={data:{id:'actual-retained-job',status:'succeeded',artifact:{requiresAdminAuthentication:true,playPath:'/api/admin/render-lab/jobs/actual-retained-job/media'},qa_report_json:{fixture:'CI_VISUAL_ONLY_SYNTHETIC_BLACK',actual_quran_render:false}}};
  await expect(discoverAdminCaptureTargets(reader.read,{renderJobId:'actual-retained-job',production:true})).rejects.toThrow('PRODUCTION_SYNTHETIC_VIDEO_FORBIDDEN');
 });
 it('keeps the actual voice/listening subject while selecting a separate imported timing recording',async()=>{
  const reader=api();reader.responses['/api/admin/render-lab/choices']={data:{recitations:[{id:'recording'},{id:'imported'}]}};
  reader.responses['/api/admin/catalog/timings?recitation_id=recording&surah=103&from=1&to=3&limit=1']={data:[]};
  reader.responses['/api/admin/catalog/recitations/imported/chapters']={data:{recitation:{id:'imported'},chapters:[{surah:103,ayah_count:3,ready_ayahs:0}]}};
  reader.responses['/api/admin/catalog/timings?recitation_id=imported&surah=103&from=1&to=3&limit=1']={data:[{recitation_id:'imported',surah:103,ayah:2}]};
  const targets=await discoverAdminCaptureTargets(reader.read);
  expect(targets.fixture).toMatchObject({reviewId:'review',recitationId:'recording',timingsRecitationId:'imported',timingsSurah:103,timingsAyah:2});
  expect(targets.targetEvidence).toMatchObject({timing_selection:'render_choices_get_verified',timing_empty_chapters:[{recitation_id:'recording',surah:103}]});
 });
 it('GET-verifies an explicit timing target and never substitutes another one when it is empty or invalid',async()=>{
  const reader=api();await expect(discoverAdminCaptureTargets(reader.read,{timingsRecitationId:'recording'})).resolves.toMatchObject({targetEvidence:{timing_selection:'root_supplied_get_verified'}});
  expect(reader.read.mock.calls.map(([path])=>path)).not.toContain('/api/admin/render-lab/choices');
  await expect(discoverAdminCaptureTargets(reader.read,{timingsRecitationId:'../recording'})).rejects.toThrow('CAPTURE_TIMING_RECITATION_ID_INVALID');
  reader.responses['/api/admin/catalog/timings?recitation_id=recording&surah=103&from=1&to=3&limit=1']={data:[]};
  await expect(discoverAdminCaptureTargets(reader.read,{timingsRecitationId:'recording'})).rejects.toThrow('REAL_TIMING_ROW_REQUIRED');
 });
 it('uses actual paged catalog DTOs if render choices have no stored target; unknown metadata remains an error',async()=>{
  const reader=api();reader.responses['/api/admin/render-lab/choices']={data:{recitations:[]}};
  reader.responses['/api/admin/catalog/recitations?page=1&limit=100']={data:[{id:'recording'}],meta:{page:1,limit:100,total:1,totalPages:1}};
  await expect(discoverAdminCaptureTargets(reader.read)).resolves.toMatchObject({targetEvidence:{timing_selection:'catalog_recitations_get_verified'}});
  reader.responses['/api/admin/catalog/recitations?page=1&limit=100']={data:[{id:'recording'}],meta:{page:1,limit:100,total:101,totalPages:2}};
  await expect(discoverAdminCaptureTargets(reader.read)).rejects.toThrow('CAPTURE_RECITATIONS_PAGE_INCOMPLETE');
  reader.responses['/api/admin/catalog/recitations?page=1&limit=100']={data:[{id:'recording'}]};
  await expect(discoverAdminCaptureTargets(reader.read)).rejects.toThrow('CAPTURE_RECITATIONS_PAGE_INVALID');
 });
 it('stops on actual GET errors and identity drift instead of hiding them by switching timing subjects',async()=>{
  const reader=api();reader.responses['/api/admin/render-lab/choices']={data:{recitations:[{id:'recording'},{id:'unused'}]}};
  const failure=vi.fn(async(path:string)=>{if(path.includes('/catalog/timings?'))throw new Error('ACTUAL_GET_FAILED');return reader.read(path);});
  await expect(discoverAdminCaptureTargets(failure)).rejects.toThrow('ACTUAL_GET_FAILED');
  expect(failure.mock.calls.map(([path])=>path)).not.toContain('/api/admin/catalog/recitations/unused/chapters');
  reader.responses['/api/admin/catalog/recitations/recording/chapters']={data:{recitation:{id:'wrong'},chapters:[{surah:103,ayah_count:3,ready_ayahs:3}]}};
  await expect(discoverAdminCaptureTargets(reader.read)).rejects.toThrow('CAPTURE_CHAPTER_IDENTITY_INVALID');
 });
 it('continues to a real later catalog page and rejects duplicate or malformed subjects',async()=>{
  const reader=api();reader.responses['/api/admin/render-lab/choices']={data:{recitations:[]}};
  const empty=Array.from({length:100},(_,index)=>({id:'empty-'+index}));
  reader.responses['/api/admin/catalog/recitations?page=1&limit=100']={data:empty,meta:{page:1,limit:100,total:101,totalPages:2}};
  for(const row of empty)reader.responses['/api/admin/catalog/recitations/'+row.id+'/chapters']={data:{recitation:{id:row.id},chapters:[]}};
  reader.responses['/api/admin/catalog/recitations?page=2&limit=100']={data:[{id:'recording'}],meta:{page:2,limit:100,total:101,totalPages:2}};
  await expect(discoverAdminCaptureTargets(reader.read)).resolves.toMatchObject({fixture:{timingsRecitationId:'recording'}});
  reader.responses['/api/admin/catalog/recitations?page=2&limit=100']={data:[empty[0]],meta:{page:2,limit:100,total:101,totalPages:2}};
  await expect(discoverAdminCaptureTargets(reader.read)).rejects.toThrow('CAPTURE_TIMING_RECITATION_ID_INVALID');
  reader.responses['/api/admin/render-lab/choices']={data:{recitations:[{id:'../escape'}]}};
  await expect(discoverAdminCaptureTargets(reader.read)).rejects.toThrow('CAPTURE_TIMING_CHOICES_INVALID');
 });
 it('rejects unknown metadata, nonexistent real IDs and timing/chapter identity drift',async()=>{
  const unknown=api();unknown.responses['/api/admin/render-lab/jobs']={data:{}};await expect(discoverAdminCaptureTargets(unknown.read)).rejects.toThrow('CAPTURE_API_RESPONSE_SHAPE_INVALID');
  const missing=api();missing.responses['/api/admin/reviews?type=voice_confirmation&limit=1']={data:[]};await expect(discoverAdminCaptureTargets(missing.read)).rejects.toThrow('REAL_VOICE_REVIEW_REQUIRED');
  const drift=api();drift.responses['/api/admin/catalog/timings?recitation_id=recording&surah=103&from=1&to=3&limit=1']={data:[{recitation_id:'other',surah:103,ayah:1}]};await expect(discoverAdminCaptureTargets(drift.read)).rejects.toThrow('REAL_TIMING_ROW_REQUIRED');
 });
 it('requires the complete exact matrix, rejecting missing, duplicate and corrupt dimensions',()=>{
  const inventory=buildAdminCaptureInventory(source,fixture,'after'),rows=matrix(inventory,'after');
  expect(assertAdminCaptureCoverage(inventory,rows,'after').complete).toBe(true);
  expect(()=>assertAdminCaptureCoverage(inventory,rows.slice(1),'after')).toThrow('CAPTURE_MATRIX_INCOMPLETE');
  expect(()=>assertAdminCaptureCoverage(inventory,[...rows.slice(0,-1),rows[0]],'after')).toThrow('CAPTURE_DUPLICATE_CASE');
  expect(()=>assertAdminCaptureCoverage(inventory,[{...rows[0],size:{width:390,height:843}},...rows.slice(1)],'after')).toThrow('CAPTURE_UNEXPECTED_CASE_DIMENSION');
  expect(()=>assertAdminCaptureCoverage(inventory,[{...rows[0],viewport:{dpr:1.25}},...rows.slice(1)],'after')).toThrow('CAPTURE_NATIVE_ZOOM_PROOF_INVALID');
 });
 it('keeps a --routes diagnostic partial even if it names all pages, and rejects external or invented routes',()=>{
  const inventory=buildAdminCaptureInventory(source,fixture,'after'),selected=filterAdminCaptureInventory(inventory,inventory.map(row=>row.path));
  expect(assertAdminCaptureCoverage(selected,matrix(selected,'after'),'after',{partial:true})).toMatchObject({complete:false,scope:'diagnostic-partial'});
  expect(()=>filterAdminCaptureInventory(inventory,['https://external.example/admin'])).toThrow('CAPTURE_DIAGNOSTIC_ROUTE_NOT_IN_INVENTORY');
  expect(()=>filterAdminCaptureInventory(inventory,['/admin','/admin'])).toThrow('CAPTURE_DIAGNOSTIC_ROUTES_INVALID');
  expect(assertAdminCaptureCoverage([],[],'after',{partial:true}).complete).toBe(false);
 });
 it('fails closed on newly declared unseeded dynamic routes instead of using invented IDs',()=>{
  expect(()=>buildAdminCaptureInventory(source+'\nconst extra=<Route path="new/:id"/>;',fixture,'after')).toThrow('UNSEEDED_ADMIN_ROUTE_PARAMETER');
  const expanded=buildAdminCaptureInventory(source+'\nconst s5=<Route path="new-static"/>;',fixture,'after');expect(expanded).toHaveLength(37);expect(expanded.some(row=>row.path==='/admin/new-static')).toBe(true);
 });
 it('requires actual file identity and strict scanner contents, not a green resume summary',()=>{
  const row={route:'/admin',size:{width:1366,height:768},zoom:1,theme:'light',lang:'ar',viewport:{dpr:1},scanner_pass:true,scanner_violations:0,scanner_indeterminate:0};
  const evidence={...row,scans:[{report:{version:'admin-visual-1',mode:'strict',compliant:true,shouldFail:false,violations:[],indeterminate:[]}}]};
  expect(()=>assertAdminCaptureObservation(row,evidence,'after',{scanOnly:true})).not.toThrow();
  expect(()=>assertAdminCaptureObservation(row,{...evidence,route:'/admin/other'},'after',{scanOnly:true})).toThrow('CAPTURE_FILE_IDENTITY_INVALID');
  expect(()=>assertAdminCaptureObservation(row,{...evidence,scans:[]},'after',{scanOnly:true})).toThrow('CAPTURE_FILE_SCANS_REQUIRED');
  evidence.scans[0].report.compliant=false;expect(()=>assertAdminCaptureObservation(row,evidence,'after',{scanOnly:true})).toThrow('CAPTURE_FILE_STRICT_SCANNER_FAILED');
 });
 it('requires clean API/browser/write gates; no successful capture hides a failed read',()=>{
  const clean={network_errors:[],browser_errors:[],blocked_writes:[]};expect(()=>assertAdminCaptureReadGates(clean)).not.toThrow();
  for(const field of Object.keys(clean))expect(()=>assertAdminCaptureReadGates({...clean,[field]:[{code:'failure'}]})).toThrow();
 });
 it('uses a fresh private profile per invocation and requires an after revision while retaining the read-only write gate',()=>{
  const script=readFileSync('scripts/capture-admin-visual-truth.mjs','utf8');
  expect(script).toContain('AFTER_CAPTURE_REVISION_REQUIRED');expect(script).toContain('await mkdtemp(');expect(script).toContain("join(sessionDir,'chrome-profile')");
  expect(script).toContain("['/api/admin/auth/login','/api/admin/auth/logout']");expect(script).not.toContain('complete:true,cases:report.matrix.length');
 });
});

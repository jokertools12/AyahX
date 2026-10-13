import {buildAdminVisualRoutes} from './adminVisualInventory.mjs';
import {adminVisualSizes,adminVisualLanguages,adminVisualThemes} from './adminVisualSharding.mjs';

const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]+$/u.test(value);
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const rows=(value,shape)=>{const data=shape==='items'?value?.data?.items:value?.data;requireProof(Array.isArray(data),'CAPTURE_API_RESPONSE_SHAPE_INVALID');return data;};
// S4 retains the original screenshot matrix; tier2's200% is a separate gate.
export const captureZooms=()=>[1,1.25,1.5];
export const captureCaseKey=row=>JSON.stringify([row.route,row.size?.width,row.size?.height,row.zoom,row.theme,row.lang]);

/**
 * Only real GET DTOs. No fixture synthesis, mutation or provider fallback.
 * @param {(path: string) => Promise<unknown>} read
 * @param {{renderJobId?: string, timingsRecitationId?: string, production?: boolean}} [options]
 */
export async function discoverAdminCaptureTargets(read,{renderJobId,timingsRecitationId,production=false}={}){
 const readers=rows(await read('/api/admin/catalog/reciters?limit=1'));
 requireProof(id(readers[0]?.id),'REAL_RECITER_REQUIRED');
 const reviews=rows(await read('/api/admin/reviews?type=voice_confirmation&limit=1'));
 requireProof(id(reviews[0]?.id)&&id(reviews[0]?.recitation_id),'REAL_VOICE_REVIEW_REQUIRED');
 const recitationId=reviews[0].recitation_id;
 const licensed=rows(await read('/api/admin/licensed-audio'),'items');
 requireProof(id(licensed[0]?.id),'REAL_LICENSED_RECITATION_REQUIRED');
 // A review may concern an unimported draft or a local clone with cached
 // chapter counts. Listening keeps that review's exact subject; timing views
 // independently require a real stored row from a current read-only DTO.
 const timingTarget=await discoverStoredTimingTarget(read,timingsRecitationId);
 const timing=timingTarget.row;
 const jobs=rows(await read('/api/admin/render-lab/jobs'),'items');
 if(renderJobId!==undefined)requireProof(id(renderJobId),'CAPTURE_RENDER_JOB_ID_INVALID');
 const candidate=renderJobId??jobs.find(job=>id(job.id)&&job.status==='succeeded'&&job.artifact_available===true)?.id;
 let retained,synthetic=false;
 if(candidate){
  const response=await read('/api/admin/render-lab/jobs/'+candidate),job=response?.data;
  requireProof(job?.id===candidate&&job.status==='succeeded'&&job.artifact?.requiresAdminAuthentication===true&&job.artifact.playPath==='/api/admin/render-lab/jobs/'+candidate+'/media','CAPTURE_RETAINED_VIDEO_NOT_AVAILABLE');
  synthetic=job.qa_report_json?.actual_quran_render===false||/(?:CI_VISUAL_ONLY|SYNTHETIC)/u.test(String(job.qa_report_json?.fixture??''));
  requireProof(!production||!synthetic,'PRODUCTION_SYNTHETIC_VIDEO_FORBIDDEN');retained=job;
 }
 return{fixture:{reciterId:readers[0].id,reviewId:reviews[0].id,recitationId,youtubeRecitationId:licensed[0].id,timingsRecitationId:timing.recitation_id,timingsSurah:Number(timing.surah),timingsAyah:Number(timing.ayah),...(retained?{renderJobId:retained.id}:{})},limitations:[{code:'LOCAL_ONLY_UI_KIT',message:'مكتبة المكونات محلية للمدير الأعلى؛ يُلتقط الرفض الفعلي في جلسة التحقق دون توسيع صلاحياتها.'},...(!retained?[{code:'RETAINED_QA_VIDEO_UNAVAILABLE',message:'لا يوجد فيديو تجربة محفوظ ومتاح في الاستجابة الحية؛ تُلتقط صفحة التجربة الفعلية، ولا يُدّعى إثبات تشغيل فيديو أو قبول م8.'}]:[]),...(synthetic?[{code:'LOCAL_SYNTHETIC_VISUAL_MEDIA',message:'ملفCI بصري محلي فقط؛ لا يثبت قبول الفيديو الحقيقي أو م8.'}]:[])],targetEvidence:{source:'authenticated_get',timing_sample:'stored_row',timing_selection:timingTarget.selection,timing_empty_chapters:timingTarget.emptyChapters,retained_video:retained?'available':'unavailable',render_selection:renderJobId?'root_supplied_get_verified':'live_list',synthetic_targets:synthetic}};
}

async function discoverStoredTimingTarget(read,explicitId){
 const checked=new Set(),emptyChapters=[];
 const inspect=async(recitationId,selection)=>{
  requireProof(id(recitationId),'CAPTURE_TIMING_RECITATION_ID_INVALID');
  if(checked.has(recitationId))return null;checked.add(recitationId);
  const response=await read('/api/admin/catalog/recitations/'+recitationId+'/chapters');
  requireProof(response?.data?.recitation?.id===recitationId&&Array.isArray(response.data.chapters),'CAPTURE_CHAPTER_IDENTITY_INVALID');
  const chapters=response.data.chapters;
  requireProof(chapters.every(chapter=>positive(chapter?.surah)&&Number(chapter.surah)<=114&&positive(chapter.ayah_count))&&new Set(chapters.map(chapter=>Number(chapter.surah))).size===chapters.length,'CAPTURE_CHAPTER_RANGE_INVALID');
  // Cached ready counts only prioritize reads; they never prove timing exists.
  const ordered=[...chapters].sort((a,b)=>Number(Number(b.ready_ayahs)>0)-Number(Number(a.ready_ayahs)>0)||Number(a.surah)-Number(b.surah));
  for(const chapter of ordered){
   const path=`/api/admin/catalog/timings?recitation_id=${recitationId}&surah=${Number(chapter.surah)}&from=1&to=${Number(chapter.ayah_count)}&limit=1`;
   const result=rows(await read(path));requireProof(result.length<=1,'CAPTURE_TIMING_SAMPLE_LIMIT_INVALID');
   if(!result.length){emptyChapters.push({recitation_id:recitationId,surah:Number(chapter.surah)});continue;}
   const row=result[0];requireProof(row?.recitation_id===recitationId&&Number(row.surah)===Number(chapter.surah)&&positive(row.ayah)&&Number(row.ayah)<=Number(chapter.ayah_count),'REAL_TIMING_ROW_REQUIRED');
   return{row,selection,emptyChapters};
  }
  return null;
 };
 if(explicitId!==undefined){const selected=await inspect(explicitId,'root_supplied_get_verified');requireProof(selected,'REAL_TIMING_ROW_REQUIRED');return selected;}
 const response=await read('/api/admin/render-lab/choices'),choices=response?.data?.recitations;
 requireProof(Array.isArray(choices)&&choices.every(row=>id(row?.id))&&new Set(choices.map(row=>row.id)).size===choices.length,'CAPTURE_TIMING_CHOICES_INVALID');
 for(const row of choices){const selected=await inspect(row.id,'render_choices_get_verified');if(selected)return selected;}
 // Catalog pagination is target discovery, never a substitution of audio,
 // provider, rights or review status. Failed GETs are not swallowed.
 const catalogSeen=new Set();let totalPages=1,catalogTotal;
 for(let page=1;page<=totalPages;page++){
  const response=await read(`/api/admin/catalog/recitations?page=${page}&limit=100`),list=rows(response),meta=response?.meta;
  requireProof(Number(meta?.page)===page&&Number(meta?.limit)===100&&Number.isSafeInteger(Number(meta?.total))&&Number(meta.total)>=0&&Number(meta.totalPages)===Math.ceil(Number(meta.total)/100),'CAPTURE_RECITATIONS_PAGE_INVALID');
  requireProof(catalogTotal===undefined||Number(meta.total)===catalogTotal,'CAPTURE_RECITATIONS_TOTAL_CHANGED');catalogTotal=Number(meta.total);
  totalPages=Number(meta.totalPages);
  requireProof(list.length===Math.min(100,Math.max(0,catalogTotal-(page-1)*100)),'CAPTURE_RECITATIONS_PAGE_INCOMPLETE');
  requireProof(list.every(row=>id(row?.id)&&!catalogSeen.has(row.id))&&new Set(list.map(row=>row.id)).size===list.length,'CAPTURE_TIMING_RECITATION_ID_INVALID');
  for(const row of list){requireProof(id(row?.id)&&!catalogSeen.has(row.id),'CAPTURE_TIMING_RECITATION_ID_INVALID');catalogSeen.add(row.id);const selected=await inspect(row.id,'catalog_recitations_get_verified');if(selected)return selected;}
 }
 throw new Error('REAL_TIMING_ROW_REQUIRED');
}

export function buildAdminCaptureInventory(source,fixture,phase){
 requireProof(['before','after'].includes(phase),'CAPTURE_PHASE_INVALID');requireProof(id(fixture.reciterId),'REAL_RECITER_REQUIRED');
 if(phase==='after')return buildAdminVisualRoutes(source,fixture,{includeAllViews:true});
 // Preserve the original 13-page baseline, not the newer router's pages.
 return ['', 'roles','users','audit','settings','security','reciters','reciters/:id','recitations','availability','providers','quran','timings'].map(pattern=>({pattern,path:'/admin'+(pattern?'/'+pattern.replace(':id',fixture.reciterId):'')}));
}
export function filterAdminCaptureInventory(inventory,requested){
 requireProof(Array.isArray(requested)&&requested.length>0&&new Set(requested).size===requested.length,'CAPTURE_DIAGNOSTIC_ROUTES_INVALID');
 return requested.map(path=>{const route=inventory.find(row=>row.path===path);requireProof(route,'CAPTURE_DIAGNOSTIC_ROUTE_NOT_IN_INVENTORY');return route;});
}
export function expectedAdminCaptureCases(inventory,phase){
 return inventory.flatMap(({path})=>adminVisualLanguages.flatMap(lang=>adminVisualSizes.flatMap(size=>captureZooms(phase).flatMap(zoom=>adminVisualThemes.map(theme=>({route:path,size,zoom,theme,lang}))))));
}
/** Also used before resuming: duplicate or foreign evidence never skips work. */
export function assertAdminCaptureCoverage(inventory,matrix,phase,{partial=false,scanOnly=false,requireComplete=true}={}){
 const expected=expectedAdminCaptureCases(inventory,phase),keys=new Set(expected.map(captureCaseKey)),seen=new Set();
 requireProof(new Set(inventory.map(row=>row.path)).size===inventory.length,'CAPTURE_ROUTE_INVENTORY_DUPLICATE');
 requireProof(Array.isArray(matrix),'CAPTURE_MATRIX_REQUIRED');
 for(const row of matrix){
  const key=captureCaseKey(row);requireProof(keys.has(key),'CAPTURE_UNEXPECTED_CASE_DIMENSION');requireProof(!seen.has(key),'CAPTURE_DUPLICATE_CASE');seen.add(key);
  requireProof(Number.isFinite(row.viewport?.dpr)&&Math.abs(row.viewport.dpr-row.zoom)<=.02,'CAPTURE_NATIVE_ZOOM_PROOF_INVALID');
  if(scanOnly){requireProof(typeof row.scanner_pass==='boolean','CAPTURE_SCANNER_PROOF_REQUIRED');if(phase==='after')requireProof(row.scanner_pass===true&&row.scanner_violations===0&&row.scanner_indeterminate===0,'CAPTURE_STRICT_SCANNER_FAILED');}
  else requireProof(typeof row.screenshot==='string'&&/^[a-f0-9]{64}$/u.test(row.sha256??'')&&typeof row.observationPath==='string','CAPTURE_SCREENSHOT_PROOF_REQUIRED');
 }
 if(requireComplete)requireProof(seen.size===expected.length,'CAPTURE_MATRIX_INCOMPLETE');
 return{complete:!partial&&inventory.length>0&&seen.size===expected.length,expectedCases:expected.length,measuredCases:seen.size,scope:partial?'diagnostic-partial':'complete-visual-capture',strictScanner:phase==='after'&&scanOnly};
}
export function assertAdminCaptureReadGates(report){
 for(const key of ['network_errors','browser_errors','blocked_writes'])requireProof(Array.isArray(report[key])&&report[key].length===0,'CAPTURE_'+key.toUpperCase());
}
export function assertAdminCaptureObservation(row,evidence,phase,{scanOnly=false}={}){
 requireProof(captureCaseKey(row)===captureCaseKey(evidence)&&row.viewport?.dpr===evidence.viewport?.dpr,'CAPTURE_FILE_IDENTITY_INVALID');
 if(!scanOnly){requireProof(row.sha256===evidence.sha256&&row.screenshot===evidence.screenshot,'CAPTURE_FILE_SCREENSHOT_INVALID');return;}
 requireProof(Array.isArray(evidence.scans)&&evidence.scans.length>0,'CAPTURE_FILE_SCANS_REQUIRED');
 for(const scan of evidence.scans){
  const proof=scan.report;requireProof(proof?.version==='admin-visual-1'&&proof.mode===(phase==='before'?'baseline':'strict')&&Array.isArray(proof.violations)&&Array.isArray(proof.indeterminate)&&typeof proof.compliant==='boolean','CAPTURE_FILE_SCANNER_INVALID');
  if(phase==='after')requireProof(proof.compliant===true&&proof.shouldFail===false&&!proof.violations.length&&!proof.indeterminate.length,'CAPTURE_FILE_STRICT_SCANNER_FAILED');
 }
 requireProof(row.scanner_pass===evidence.scans.every(scan=>scan.report.compliant)&&row.scanner_violations===evidence.scans.reduce((n,scan)=>n+scan.report.violations.length,0)&&row.scanner_indeterminate===evidence.scans.reduce((n,scan)=>n+scan.report.indeterminate.length,0),'CAPTURE_FILE_SCANNER_SUMMARY_MISMATCH');
}

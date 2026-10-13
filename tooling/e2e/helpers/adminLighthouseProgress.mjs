import {assertAdminLighthouseCoverage} from './adminLighthouse.mjs';

const phases=new Set(['preflight','modules','chrome_launch','connect','authenticate','discover','navigate','settle','lighthouse','summarize','finalize','cleanup','rate_window_wait']);
const knownCodes=new Set(['ARGUMENT_VALUE_REQUIRED','LOCAL_ORIGIN_REQUIRED','PRIVATE_INPUT_OUTSIDE_GIT_REQUIRED','PRIVATE_FIXTURE_PATH_REQUIRED','SUPER_ADMIN_FIXTURE_COOKIE_REQUIRED','FIXTURE_COOKIE_FORMAT_INVALID','SCOPED_FIXTURE_COOKIE_REJECTED','LIGHTHOUSE_TARGET_GET_FAILED','LIGHTHOUSE_RESULT_MISSING','LIGHTHOUSE_RUNTIME_ERROR','LIGHTHOUSE_EXPECTED_ROUTES_INVALID','LIGHTHOUSE_ROUTE_COVERAGE_INCOMPLETE','LIGHTHOUSE_ROUTE_COVERAGE_DUPLICATE','LIGHTHOUSE_UNEXPECTED_ROUTE','LIGHTHOUSE_AT_LEAST_TEN_PAGES_REQUIRED','LIGHTHOUSE_AT_LEAST_TEN_DISTINCT_PAGES_REQUIRED','LIGHTHOUSE_MAIN_PAGE_MISSING','LIGHTHOUSE_AUTHORIZED_MAIN_PAGES_REQUIRED','REAL_TIMING_ROW_REQUIRED','REAL_RECITER_REQUIRED','REAL_VOICE_REVIEW_REQUIRED','REAL_LICENSED_RECITATION_REQUIRED','CAPTURE_CHAPTER_IDENTITY_INVALID','CAPTURE_TIMING_RECITATION_ID_INVALID','CAPTURE_TIMING_CHOICES_INVALID','CAPTURE_RECITATIONS_PAGE_INVALID','CAPTURE_RECITATIONS_PAGE_INCOMPLETE','CAPTURE_API_RESPONSE_SHAPE_INVALID','LIGHTHOUSE_PHASE_TIMEOUT','LIGHTHOUSE_PROGRESS_PHASE_INVALID','LIGHTHOUSE_PROGRESS_ROUTE_INVALID','LIGHTHOUSE_PROGRESS_LIMIT_REACHED','LIGHTHOUSE_API_RATE_LIMITED']);
const classes=new Set(['Error','TimeoutError','ProtocolError','TypeError','SyntaxError','RangeError']);

/**
 * No arbitrary error message, stack, URL, header, DOM or cookie is retained.
 * @param {unknown} error
 * @param {{phase?: string, path?: string|null, startedAt?: number, now?: number}} [context]
 */
export function classifyAdminLighthouseFailure(error,{phase,path=null,startedAt,now=Date.now()}={}){
 const name=typeof error?.name==='string'&&classes.has(error.name)?error.name:'UnknownError';
 const message=typeof error?.message==='string'?error.message:'';
 let code=knownCodes.has(message)?message:'LIGHTHOUSE_EXECUTION_FAILED',category='execution';
 if(name==='TimeoutError'||message==='LIGHTHOUSE_PHASE_TIMEOUT'||/\b(?:Navigation timeout|Waiting for selector|Timed out|timeout exceeded|Protocol timeout)\b/iu.test(message)){code='LIGHTHOUSE_PHASE_TIMEOUT';category='timeout';}
 else if(message==='ADMIN_VISUAL_BUDGET_EXHAUSTED'){code='LIGHTHOUSE_BUDGET_EXHAUSTED';category='budget';}
 else if(message==='LIGHTHOUSE_API_RATE_LIMITED'){category='rate_limit';}
 else if(name==='ProtocolError'){code='LIGHTHOUSE_PROTOCOL_ERROR';category=/Target closed|Session closed|Connection closed/iu.test(message)?'browser_closed':'protocol';}
 else if(name==='SyntaxError'){code='LIGHTHOUSE_INPUT_SCHEMA_ERROR';category='schema';}
 else if(message==='LIGHTHOUSE_RESULT_MISSING'){category='measurement_schema';}
 else if(name==='TypeError'){code='LIGHTHOUSE_TYPE_ERROR';category='type_error';}
 else if(error?.code==='ENOENT'){code='LIGHTHOUSE_FILE_UNAVAILABLE';category='filesystem';}
 else if(/net::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|NAME_NOT_RESOLVED|TIMED_OUT)/u.test(message)){code='LIGHTHOUSE_NETWORK_ERROR';category='network';}
 return{code,errorClass:name,category,phase:phases.has(phase)?phase:'preflight',path,elapsedMs:Number.isFinite(startedAt)?Math.max(0,now-startedAt):null};
}

/**
 * Durable progress snapshots never turn partial/failed measurements green.
 * @param {(report: Record<string, unknown>) => Promise<void>} persist
 * @param {{now?: () => number}} [options]
 */
export function createAdminLighthouseProgress(persist,{now=Date.now}={}){
 const observed=()=>new Date(now()).toISOString();
 const report={scope:'local-production-build',startedAt:observed(),observedAt:observed(),status:'running',complete:false,passed:false,expectedRoutes:[],pages:[],apiErrors:/** @type {Array<{path: string, status: number}>} */([]),blockedWrites:/** @type {Array<{path: string, method: string}>} */([]),phase:null,phases:[],failure:null};
 let phaseStarted=now();
 const save=async()=>{report.observedAt=observed();await persist(report);};
 /** @param {string} phase @param {string|null} [path] */
 const checkpoint=async(phase,path=null)=>{
  if(!phases.has(phase))throw new Error('LIGHTHOUSE_PROGRESS_PHASE_INVALID');
  if(path!==null&&(path!=='/admin'&&!report.expectedRoutes.includes(path)))throw new Error('LIGHTHOUSE_PROGRESS_ROUTE_INVALID');
  if(report.phases.length>=1024)throw new Error('LIGHTHOUSE_PROGRESS_LIMIT_REACHED');
  if(report.phases.length)report.phases.at(-1).elapsedMs=Math.max(0,now()-phaseStarted);
  phaseStarted=now();report.phase={name:phase,path,startedAt:observed()};report.phases.push({...report.phase,elapsedMs:null});
  await save();
 };
 const page=async summary=>{report.pages.push(summary);await save();};
 const fail=async error=>{
  const classified=classifyAdminLighthouseFailure(error,{phase:report.phase?.name,path:report.phase?.path??null,startedAt:phaseStarted,now:now()});
  if(!report.failure)report.failure=classified;
  else{report.secondaryFailures??=[];if(report.secondaryFailures.length<16)report.secondaryFailures.push(classified);}
  report.status='failed';report.complete=false;report.passed=false;report.finishedAt=observed();
  if(report.phases.length)report.phases.at(-1).elapsedMs=classified.elapsedMs;
  await save();return classified;
 };
 const finish=async()=>{
  await checkpoint('finalize');
  try{
   report.passed=assertAdminLighthouseCoverage(report.expectedRoutes,report.pages)&&!report.apiErrors.length&&!report.blockedWrites.length;
   report.complete=report.passed;report.status=report.passed?'complete':'failed';report.finishedAt=observed();
   report.measurementFailures=report.pages.filter(row=>!row.passed).map(row=>({path:row.path,category:row.runtimeError?'runtime':'measurement',runtimeCode:row.runtimeError?.code??null}));
   await save();return report.passed;
  }catch(error){await fail(error);throw error;}
 };
 return{report,checkpoint,page,fail,finish,save};
}

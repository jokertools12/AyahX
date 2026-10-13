import {buildAdminCaptureInventory,filterAdminCaptureInventory} from './adminVisualCapture.mjs';

const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export const adminLighthouseMainPatterns=Object.freeze(['','reviews/:id','listening/:id','reciters','recitations','availability','provider-licenses','storage','render-lab','launch','project','settings']);
export function buildAdminLighthouseRoutes(source,fixture,requested){
 const inventory=buildAdminCaptureInventory(source,fixture,'after');
 const selected=requested===undefined?adminLighthouseMainPatterns.map(pattern=>{const route=inventory.find(row=>row.pattern===pattern&&!row.view);requireProof(route,'LIGHTHOUSE_MAIN_PAGE_MISSING');return route;}):filterAdminCaptureInventory(inventory,requested);
 requireProof(selected.length>=10,'LIGHTHOUSE_AT_LEAST_TEN_PAGES_REQUIRED');
 requireProof(new Set(selected.map(row=>row.pattern)).size>=10,'LIGHTHOUSE_AT_LEAST_TEN_DISTINCT_PAGES_REQUIRED');
 requireProof(!selected.some(row=>row.pattern==='_kit'),'LIGHTHOUSE_AUTHORIZED_MAIN_PAGES_REQUIRED');
 return selected.map(row=>row.path);
}
export function summarizeAdminLighthouse(lhr,path){
 const accessibility=number(lhr?.categories?.accessibility?.score),bestPractices=number(lhr?.categories?.['best-practices']?.score),cls=number(lhr?.audits?.['cumulative-layout-shift']?.numericValue);
 const runtimeCode=lhr?.runtimeError?.code;
 const passed=accessibility!==null&&accessibility>=.95&&bestPractices!==null&&bestPractices>=.95&&cls!==null&&cls<=.1&&!lhr?.runtimeError;
 // Persist only fixed audit identifiers/numeric summaries, never raw LHR/DOM,
 // headers, cookie, screenshot, warning text or a capability URL.
 const failedAudits=Object.entries(lhr?.audits??{}).filter(([id,audit])=>/^[a-z0-9-]{1,100}$/u.test(id)&&typeof audit?.score==='number'&&audit.score<1).map(([id,audit])=>({id,score:audit.score,scoreDisplayMode:/^[a-zA-Z]+$/u.test(audit.scoreDisplayMode??'')?audit.scoreDisplayMode:null}));
 return{path,accessibility:accessibility===null?null:Math.round(accessibility*10000)/100,bestPractices:bestPractices===null?null:Math.round(bestPractices*10000)/100,cls,lcpMs:number(lhr?.audits?.['largest-contentful-paint']?.numericValue),totalBlockingTimeMs:number(lhr?.audits?.['total-blocking-time']?.numericValue),failedAudits,warningCount:Array.isArray(lhr?.runWarnings)?lhr.runWarnings.length:0,runtimeError:lhr?.runtimeError?{code:typeof runtimeCode==='string'&&/^[A-Z0-9_]{1,80}$/u.test(runtimeCode)?runtimeCode:'LIGHTHOUSE_RUNTIME_ERROR'}:null,passed};
}
export function assertAdminLighthouseCoverage(expected,pages){
 requireProof(Array.isArray(expected)&&expected.length>=10&&new Set(expected).size===expected.length,'LIGHTHOUSE_EXPECTED_ROUTES_INVALID');
 requireProof(Array.isArray(pages)&&pages.length===expected.length,'LIGHTHOUSE_ROUTE_COVERAGE_INCOMPLETE');
 requireProof(new Set(pages.map(page=>page.path)).size===pages.length,'LIGHTHOUSE_ROUTE_COVERAGE_DUPLICATE');
 requireProof(pages.every(page=>expected.includes(page.path)),'LIGHTHOUSE_UNEXPECTED_ROUTE');
 return pages.every(page=>page.passed===true&&typeof page.accessibility==='number'&&page.accessibility>=95&&typeof page.bestPractices==='number'&&page.bestPractices>=95&&typeof page.cls==='number'&&Number.isFinite(page.cls)&&page.cls<=.1&&!page.runtimeError);
}

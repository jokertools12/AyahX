// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {buildAdminVisualRoutes} from '../../tooling/e2e/helpers/adminVisualInventory.mjs';
import {selectAdminVisualShard,expectedAdminVisualCases,adminVisualCaseKey,adminVisualCaseName,aggregateAdminVisualShards,assertAdminVisualShard} from '../../tooling/e2e/helpers/adminVisualSharding.mjs';

// Synthetic proof documents exercise the aggregate validator only. They never
// represent an actual browser, database, render or acceptance result.
const inventories=[
 [{pattern:'',path:'/admin'},{pattern:'render-lab',path:'/admin/render-lab?job_id=owned-one'}],
 [{pattern:'',path:'/admin'},{pattern:'render-lab',path:'/admin/render-lab?job_id=owned-two'}],
];
const dialogInventory=[{slug:'first',file:'src/admin/First.tsx'},{slug:'second',file:'src/admin/Second.tsx'}];
const accessibility=()=>({violations:[],incomplete:[],originalIncomplete:[],remeasurements:[]});
const scans=()=>[{report:{version:'admin-visual-1',mode:'strict',shouldFail:false,compliant:true,violations:[],indeterminate:[]}}];
function child(index:number){
 const routeInventory=selectAdminVisualShard(inventories[index],index),cases=expectedAdminVisualCases(routeInventory),caseEvidence=new Map(),dialogs:Array<{caseId:string;slug:string;passed:boolean}>=[];
 const matrix=cases.map((item:Record<string,unknown>,position:number)=>{
  const caseId=adminVisualCaseName(item),applicableDialogs=position===0?[index?'second':'first']:[];
  const proof={...item,dpr:item.zoom,passed:true,scans:scans(),accessibility:accessibility(),applicableDialogs,dialogs:applicableDialogs.map(slug=>({slug,passed:true,scans:scans(),accessibility:accessibility()}))};
  caseEvidence.set(adminVisualCaseKey(item),proof);for(const slug of applicableDialogs)dialogs.push({caseId,slug,passed:true});
  return{...item,caseId,dpr:item.zoom,passed:true,violations:0,indeterminate:0,axeViolations:0,axeIncomplete:0};
 });
 return{exitCode:0,caseEvidence,report:{version:'admin-visual-ci-shard-2',mode:'strict',acceptanceScope:'partial-route-shard',passed:false,shardComplete:true,phase:'finished',shard:{index,count:2},fullRouteInventory:inventories[index],routeInventory,routes:routeInventory.map(route=>route.path),dialogInventory,expectedCases:matrix.length,matrix,dialogs,reviewsStayedPending:true,apiErrors:[],browserErrors:[],blockedRequests:[],redisErrors:[]}};
}
const complete=()=>[child(0),child(1)];
const aggregate=(children=complete())=>aggregateAdminVisualShards(children,inventories,dialogInventory);

describe('strict visual shard aggregation',()=>{
 it('partitions every current logical view into two disjoint native 64-case matrices with actor-owned video targets',()=>{
  const source=readFileSync('src/admin/AdminRoot.tsx','utf8');
  const fixture={reciterId:'reader',reviewId:'review',recitationId:'recording',youtubeRecitationId:'youtube',timingsRecitationId:'pinned',timingsSurah:103,timingsAyah:1,renderJobId:'first-owned-video'};
  const first=buildAdminVisualRoutes(source,fixture),second=buildAdminVisualRoutes(source,{...fixture,renderJobId:'second-owned-video'});
  const parts=[selectAdminVisualShard(first,0),selectAdminVisualShard(second,1)];
  expect(first).toHaveLength(34);expect(parts.map(part=>part.length)).toEqual([17,17]);
  expect(parts.flatMap(expectedAdminVisualCases)).toHaveLength(2176);
  expect(new Set(parts.flatMap(expectedAdminVisualCases).map(adminVisualCaseKey)).size).toBe(2176);
  expect(()=>selectAdminVisualShard(first,0,1)).toThrow('ADMIN_VISUAL_SHARD_CONFIG_INVALID');
 });
 it('publishes full acceptance only after both partial children and all file/dialog proofs pass',()=>{
  const children=complete();expect(children.every(item=>item.report.passed===false)).toBe(true);
  const result=aggregate(children);expect(result).toMatchObject({passed:true,expectedCases:128,acceptanceScope:'complete-route-matrix',reviewsStayedPending:true,dialogCoverage:{passed:true}});
  expect(result.routes).toEqual(['/admin','/admin/render-lab?job_id=owned-two']);
  expect(()=>assertAdminVisualShard(children[0],inventories[0],dialogInventory,0)).not.toThrow();
 });
 it('rejects a missing child, nonzero exit, incomplete/no-PASS child, and a child claiming full acceptance',()=>{
  expect(()=>aggregate([child(0)])).toThrow('ADMIN_VISUAL_ALL_SHARDS_REQUIRED');
  for(const mutate of [(item:ReturnType<typeof child>)=>{item.exitCode=1;},(item:ReturnType<typeof child>)=>{item.report.shardComplete=false;},(item:ReturnType<typeof child>)=>{item.report.passed=true;}]){
   const children=complete();mutate(children[1]);expect(()=>aggregate(children)).toThrow();
  }
  expect(()=>aggregateAdminVisualShards(complete(),inventories,[])).toThrow('ADMIN_VISUAL_SOURCE_DIALOG_INVENTORY_REQUIRED');
 });
 it('rejects missing, duplicate, corrupt and substituted matrix dimensions',()=>{
  const missing=complete();missing[0].report.matrix.pop();expect(()=>aggregate(missing)).toThrow('CASE_COUNT_MISMATCH');
  const duplicate=complete();duplicate[0].report.matrix[1]={...duplicate[0].report.matrix[0]};expect(()=>aggregate(duplicate)).toThrow('ADMIN_VISUAL_DUPLICATE_CASE');
  const corrupt=complete();corrupt[0].report.matrix[0].size={width:390,height:843};expect(()=>aggregate(corrupt)).toThrow('ADMIN_VISUAL_UNEXPECTED_CASE_DIMENSION');
  const substituted=complete();substituted[1].report.routeInventory=[inventories[0][1]];expect(()=>aggregate(substituted)).toThrow('ADMIN_VISUAL_CHILD_ROUTE_PARTITION_CHANGED');
 });
 it('requires actual matching case files, strict scanner evidence and native zoom proof',()=>{
  const missing=complete();missing[0].caseEvidence.clear();expect(()=>aggregate(missing)).toThrow('ADMIN_VISUAL_CASE_FILES_MISSING');
  const wrongFile=complete();wrongFile[0].caseEvidence.values().next().value.route='/admin/other';expect(()=>aggregate(wrongFile)).toThrow('ADMIN_VISUAL_CASE_FILE_IDENTITY_MISMATCH');
  const hiddenFailure=complete();hiddenFailure[0].caseEvidence.values().next().value.scans[0].report.compliant=false;expect(()=>aggregate(hiddenFailure)).toThrow('ADMIN_VISUAL_STRICT_SCAN_REQUIRED');
  const wrongZoom=complete();wrongZoom[0].caseEvidence.values().next().value.dpr=1.25;expect(()=>aggregate(wrongZoom)).toThrow('ADMIN_VISUAL_NATIVE_ZOOM_PROOF_INVALID');
 });
 it('requires exact visible target PASS instead of trusting cleared axe incomplete flags',()=>{
  const children=complete(),proof=children[0].caseEvidence.values().next().value,target=['#text'];
  proof.accessibility.originalIncomplete=[{id:'color-contrast',nodes:[{target}]}];
  proof.accessibility.remeasurements=[{target,resolved:true,reason:'EXACT_VISIBLE_CONTRAST_PASS',fullyVisibleBeforeRun:true,fullyVisibleAfterRun:true,violations:[],incomplete:[],passTargets:[]}];
  expect(()=>aggregate(children)).toThrow('ADMIN_VISUAL_AXE_TARGET_PASS_REQUIRED');
  proof.accessibility.remeasurements[0].passTargets=[target];expect(aggregate(children).passed).toBe(true);
 });
 it('rejects every error channel and any human review decision despite a green matrix',()=>{
  for(const field of ['apiErrors','browserErrors','blockedRequests','redisErrors']){
   const children=complete();children[0].report[field].push({code:'failure'});expect(()=>aggregate(children)).toThrow();
  }
  const children=complete();children[1].report.reviewsStayedPending=false;expect(()=>aggregate(children)).toThrow('ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
 });
 it('requires all applicable dialogs per case, matching dialog report rows, and union of all declared dialogs',()=>{
  const missing=complete();missing[0].caseEvidence.values().next().value.dialogs=[];expect(()=>aggregate(missing)).toThrow('ADMIN_VISUAL_APPLICABLE_DIALOG_UNTESTED');
  const mismatch=complete();mismatch[0].report.dialogs=[];expect(()=>aggregate(mismatch)).toThrow('ADMIN_VISUAL_DIALOG_REPORT_PROOF_MISMATCH');
  const unvisited=complete(),proof=unvisited[1].caseEvidence.values().next().value;proof.applicableDialogs=[];proof.dialogs=[];unvisited[1].report.dialogs=[];
  expect(()=>aggregate(unvisited)).toThrow('UNTESTED_DECLARED_ADMIN_DIALOGS:second');
 });
 it('keeps the workflow aggregate-only and uploads evidence without credentials, profiles or raw child logs',()=>{
  const workflow=readFileSync('.github/workflows/admin-visual.yml','utf8');
  expect(workflow).toContain('run: node scripts/admin-visual-ci-all.mjs');expect(workflow).toContain('shards/*/evidence');
  expect(workflow).not.toMatch(/runner\.temp[^\n]*(?:fixture\.json|chrome-profile|child\.log)/u);
 });
});

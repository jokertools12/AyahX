// @vitest-environment node
import {snapshotAdminVisualReviews,proveAdminVisualReviewInvariant} from '../../tooling/e2e/helpers/adminVisualReviewProof.mjs';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {buildAdminVisualRoutes,buildAdminVisualDialogs} from '../../tooling/e2e/helpers/adminVisualInventory.mjs';
import {expectedAdminVisualCases,selectAdminVisualShard,adminVisualCaseKey,adminVisualCaseName,aggregateAdminVisualShards} from '../../tooling/e2e/helpers/adminVisualSharding.mjs';
import {adminVisualLaunchCombinations,adminVisualLaunchCorePatterns,adminVisualLaunchDialogCombinations,adminVisualCombinationKey,shouldScanAdminVisualDialogs,adminVisualDialogReuseScope} from '../../tooling/e2e/helpers/adminVisualTiers.mjs';
const fixture={reciterId:'reader',reviewId:'review',recitationId:'recording',youtubeRecitationId:'youtube',timingsRecitationId:'pinned',timingsSurah:103,timingsAyah:1,renderJobId:'actor-one'};
const source=readFileSync('src/admin/AdminRoot.tsx','utf8');
type VisualRoute={pattern:string;path:string;view?:string};
type VisualCase={route:string;size:{width:number;height:number};zoom:number;theme:string;lang:string};
const inventories:VisualRoute[][]=[buildAdminVisualRoutes(source,fixture),buildAdminVisualRoutes(source,{...fixture,renderJobId:'actor-two'})];
function sources(path:string):Array<{path:string;source:string}>{return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(join(path,entry.name)):entry.name.endsWith('.tsx')&&!/\.(test|spec)\.tsx$/u.test(entry.name)?[{path:join(path,entry.name),source:readFileSync(join(path,entry.name),'utf8')}]:[]);}
const dialogInventory:Array<{slug:string;file:string}>=buildAdminVisualDialogs(sources('src/admin'));
// Synthetic validator documents never substitute for root's real browser run.
const scan=()=>[{report:{version:'admin-visual-1',mode:'strict',compliant:true,shouldFail:false,violations:[],indeterminate:[]}}];
const axe=()=>({violations:[],incomplete:[],originalIncomplete:[],remeasurements:[]});
function child(index:number){
 const routeInventory=selectAdminVisualShard(inventories[index],index),cases=expectedAdminVisualCases(routeInventory,'tier1') as VisualCase[];
 const caseEvidence=new Map(),dialogs:Array<{caseId:string;slug:string;passed:boolean;size:{width:number;height:number};zoom:number;theme:string;lang:string}>=[];
 const matrix=cases.map((row)=>{
  const caseId=adminVisualCaseName(row);
  // Distribute all declared dialog IDs over both actor-owned route partitions.
  const applicableDialogs=shouldScanAdminVisualDialogs(row,'tier1')&&row.route===routeInventory[0].path?dialogInventory.filter((_:unknown,i:number)=>i%2===index).map((item)=>item.slug):[];
  const proof={...row,dpr:row.zoom,scans:scan(),accessibility:axe(),applicableDialogs,dialogs:applicableDialogs.map((slug:string)=>({slug,passed:true,scans:scan(),accessibility:axe()})),passed:true};
  caseEvidence.set(adminVisualCaseKey(row),proof);
  for(const slug of applicableDialogs)dialogs.push({caseId,slug,passed:true,size:row.size,zoom:row.zoom,theme:row.theme,lang:row.lang});
  return{...row,caseId,dpr:row.zoom,passed:true,violations:0,indeterminate:0,axeViolations:0,axeIncomplete:0};
 });
 return{exitCode:0,caseEvidence,report:{version:'admin-visual-ci-shard-2',mode:'strict',tier:'tier1',acceptanceScope:'partial-route-shard',passed:false,shardComplete:true,phase:'finished',shard:{index,count:2},fullRouteInventory:inventories[index],routeInventory,routes:routeInventory.map((route)=>route.path),dialogInventory,matrix,dialogs,expectedCases:cases.length,reviewsStayedPending:true,reviewInvariant:proveAdminVisualReviewInvariant(snapshotAdminVisualReviews([]),snapshotAdminVisualReviews([])),apiErrors:[],browserErrors:[],blockedRequests:[],redisErrors:[]}};
}
describe('Batch 5b strict visual tiers',()=>{
 it('covers every one of the 34 source views at exactly the five requested launch combinations, plus five core views at 200%',()=>{
  const cases=expectedAdminVisualCases(inventories[0],'tier1') as VisualCase[];
  expect(inventories[0]).toHaveLength(34);expect(cases).toHaveLength(195);
  expect(adminVisualLaunchCombinations.map(adminVisualCombinationKey)).toEqual([
   '[1366,768,1,"light","ar"]','[1366,768,1.5,"dark","ar"]','[390,844,1,"light","ar"]','[390,844,1.5,"dark","ar"]','[1920,1080,1.25,"light","en"]',
  ]);
  for(const route of inventories[0])expect(cases.filter((row)=>row.route===route.path&&row.zoom!==2).map(adminVisualCombinationKey)).toEqual(adminVisualLaunchCombinations.map(adminVisualCombinationKey));
  for(const pattern of adminVisualLaunchCorePatterns){const route=inventories[0].find((item)=>item.pattern===pattern&&!item.view);expect(cases.filter((row)=>row.route===route.path&&row.zoom===2)).toHaveLength(5);}
  expect(new Set(cases.map(adminVisualCaseKey)).size).toBe(cases.length);
  expect(inventories.map((inventory,index:number)=>expectedAdminVisualCases(selectAdminVisualShard(inventory,index),'tier1')).flat()).toHaveLength(195);
  expect(expectedAdminVisualCases(inventories[0],'tier2')).toHaveLength(2176);
 });
 it('includes added static views rather than freezing the old source snapshot',()=>{
  const added=[...inventories[0],{pattern:'diagnostics',path:'/admin/diagnostics'}];
  expect(expectedAdminVisualCases(added,'tier1')).toHaveLength(200);
  expect(expectedAdminVisualCases(added,'tier2')).toHaveLength(2240);
 });
 it('requires every declared dialog ID in both desktop Arabic light 100% and mobile Arabic dark 150% aggregate proof',()=>{
  const children=[child(0),child(1)],aggregate=()=>aggregateAdminVisualShards(children,inventories,dialogInventory,'tier1');
  expect(aggregate()).toMatchObject({passed:true,tier:'tier1',acceptanceScope:'complete-launch-matrix',expectedCases:195});
  const first=children[0];const mobile=[...first.caseEvidence.values()].find(row=>row.applicableDialogs.length&&row.size.width===390),slug=mobile.applicableDialogs[0];
  mobile.applicableDialogs=mobile.applicableDialogs.filter((id:string)=>id!==slug);mobile.dialogs=mobile.dialogs.filter((item)=>item.slug!==slug);
  first.report.dialogs=first.report.dialogs.filter(row=>!(row.slug===slug&&row.size.width===390));
  expect(aggregate).toThrow('UNTESTED_DECLARED_ADMIN_DIALOGS:'+slug);
  expect(adminVisualLaunchDialogCombinations.map(adminVisualCombinationKey)).toEqual(['[1366,768,1,"light","ar"]','[390,844,1.5,"dark","ar"]']);
 });
 it('rejects missing core routes, launch combinations, a wrong tier and duplicate/substituted case dimensions',()=>{
  expect(()=>aggregateAdminVisualShards([],[[{pattern:'',path:'/admin'}]],dialogInventory,'tier1')).toThrow('ADMIN_VISUAL_LAUNCH_CORE_MISSING');
  const missing=[child(0),child(1)];missing[0].report.matrix.pop();expect(()=>aggregateAdminVisualShards(missing,inventories,dialogInventory,'tier1')).toThrow('CASE_COUNT_MISMATCH');
  const wrong=[child(0),child(1)];wrong[1].report.tier='tier2';expect(()=>aggregateAdminVisualShards(wrong,inventories,dialogInventory,'tier1')).toThrow('ADMIN_VISUAL_CHILD_TIER_MISMATCH');
  const substitute=[child(0),child(1)];substitute[0].report.matrix[0].size={width:1536,height:864};expect(()=>aggregateAdminVisualShards(substitute,inventories,dialogInventory,'tier1')).toThrow('ADMIN_VISUAL_UNEXPECTED_CASE_DIMENSION');
 });
 it('uses an earlier direct dialog measurement only as a scheduling reference at the identical combination',()=>{
  const children=[child(0),child(1)],first=children[0],proofs=[...first.caseEvidence.values()];
  const measured=proofs.find(row=>row.dialogs.some(dialog=>dialog.slug==='keyboard-help')),later=proofs.find(row=>row.route!==measured.route&&adminVisualCombinationKey(row)===adminVisualCombinationKey(measured));
  later.previouslyMeasuredDialogs=[{slug:'keyboard-help',reuseScope:'shared-admin-shell',caseId:adminVisualCaseName(measured)}];
  expect(aggregateAdminVisualShards(children,inventories,dialogInventory,'tier1').passed).toBe(true);
  later.previouslyMeasuredDialogs[0].caseId='invented-cached-proof';
  expect(()=>aggregateAdminVisualShards(children,inventories,dialogInventory,'tier1')).toThrow('ADMIN_VISUAL_DIALOG_REFERENCE_SCOPE_INVALID');
 });
 it('never reuses page-specific or future dialogs across route/tab scope',()=>{
  const row={route:'/admin/reciters/reader?tab=a'},other={route:'/admin/reciters/reader?tab=b'},declared={slug:'reciter-audit-detail',file:'src/admin/pages/catalog/ReciterAudit.tsx'};
  expect(adminVisualDialogReuseScope(declared,row)).not.toBe(adminVisualDialogReuseScope(declared,other));
  expect(adminVisualDialogReuseScope({slug:'new-shell-dialog',file:'src/admin/AdminShell.tsx'},row)).toBe('route:'+row.route);
  const children=[child(0),child(1)],proofs=[...children[0].caseEvidence.values()];
  const measured=proofs.find(proof=>proof.dialogs.some(dialog=>dialog.slug==='audit-detail')),later=proofs.find(proof=>proof.route!==measured.route&&adminVisualCombinationKey(proof)===adminVisualCombinationKey(measured));
  later.previouslyMeasuredDialogs=[{slug:'audit-detail',reuseScope:'route:'+later.route,caseId:adminVisualCaseName(measured)}];
  expect(()=>aggregateAdminVisualShards(children,inventories,dialogInventory,'tier1')).toThrow('ADMIN_VISUAL_DIALOG_REFERENCE_SCOPE_INVALID');
 });
 it('runs launch only on PR and full only on manual/weekly events, with verified billing guard and no job above sixty minutes',()=>{
  const workflow=readFileSync('.github/workflows/admin-visual.yml','utf8');
  expect(workflow).not.toMatch(/^ {2}push:/mu);expect(workflow).toContain('workflow_dispatch:');expect(workflow).toContain("cron: '17 2 * * 0'");
  expect(workflow).toContain("github.event_name == 'pull_request' && 'tier1' || 'tier2'");
  expect(workflow).toContain("github.event_name == 'pull_request' && 40 || 60");
  expect(workflow).toContain("vars.ADMIN_VISUAL_BILLING_APPROVED == 'true'");expect(workflow).not.toContain('github.event.repository.private == true');
  expect(workflow).not.toMatch(/timeout-minutes:\s*(?:[7-9]\d|\d{3,})/u);
 });
});

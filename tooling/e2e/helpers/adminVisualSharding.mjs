import {isDeepStrictEqual} from 'node:util';
import {assertAdminVisualDialogCoverage} from './adminVisualInventory.mjs';

// These are the original acceptance dimensions. Sharding changes scheduling,
// never the number of measurements, native zoom or scanner/axe thresholds.
export const adminVisualSizes=Object.freeze([{width:1366,height:768},{width:1536,height:864},{width:1920,height:1080},{width:390,height:844}]);
export const adminVisualZooms=Object.freeze([1,1.25,1.5,2]);
export const adminVisualLanguages=Object.freeze(['ar','en']);
export const adminVisualThemes=Object.freeze(['light','dark']);
export const ADMIN_VISUAL_SHARD_COUNT=2;
const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const exact=(actual,expected,code)=>requireProof(isDeepStrictEqual(actual,expected),code);
export const adminVisualRouteSlot=route=>JSON.stringify([route.pattern,route.view??null]);

export function selectAdminVisualShard(inventory,index,count=ADMIN_VISUAL_SHARD_COUNT){
 requireProof(count===ADMIN_VISUAL_SHARD_COUNT&&Number.isInteger(index)&&index>=0&&index<count,'ADMIN_VISUAL_SHARD_CONFIG_INVALID');
 requireProof(Array.isArray(inventory)&&inventory.length>=count,'ADMIN_VISUAL_ROUTE_INVENTORY_REQUIRED');
 const slots=inventory.map(adminVisualRouteSlot);
 requireProof(new Set(slots).size===slots.length&&new Set(inventory.map(route=>route.path)).size===inventory.length,'ADMIN_VISUAL_ROUTE_INVENTORY_DUPLICATE');
 return inventory.filter((_,position)=>position%count===index);
}

export function adminVisualCaseKey(row){
 return JSON.stringify([row.route,row.size?.width,row.size?.height,row.zoom,row.theme,row.lang]);
}
export function adminVisualCaseName(row){
 return row.route.replace(/[^a-zA-Z0-9_-]/gu,'_')+`-${row.size.width}-${row.zoom*100}-${row.theme}-${row.lang}`;
}
export function expectedAdminVisualCases(inventory){
 return inventory.flatMap(({path})=>adminVisualLanguages.flatMap(lang=>adminVisualSizes.flatMap(size=>adminVisualZooms.flatMap(zoom=>adminVisualThemes.map(theme=>({route:path,size,zoom,theme,lang}))))));
}

function assertEmpty(value,code){requireProof(Array.isArray(value)&&value.length===0,code);}
function assertScanEvidence(scans){
 requireProof(Array.isArray(scans)&&scans.length>0,'ADMIN_VISUAL_SCANS_REQUIRED');
 for(const scan of scans){
  requireProof(scan?.report?.version==='admin-visual-1'&&scan.report.mode==='strict'&&scan.report.shouldFail===false&&scan.report.compliant===true,'ADMIN_VISUAL_STRICT_SCAN_REQUIRED');
  assertEmpty(scan.report.violations,'ADMIN_VISUAL_SCAN_VIOLATIONS');assertEmpty(scan.report.indeterminate,'ADMIN_VISUAL_SCAN_INDETERMINATE');
 }
}
function assertAccessibilityEvidence(accessibility){
 requireProof(accessibility&&Array.isArray(accessibility.originalIncomplete)&&Array.isArray(accessibility.remeasurements),'ADMIN_VISUAL_AXE_EVIDENCE_REQUIRED');
 assertEmpty(accessibility.violations,'ADMIN_VISUAL_AXE_VIOLATIONS');assertEmpty(accessibility.incomplete,'ADMIN_VISUAL_AXE_INCOMPLETE');
 // Resolved contrast nodes need the actual visible exact-target PASS proof.
 for(const rule of accessibility.originalIncomplete){
  requireProof(rule.id==='color-contrast'&&Array.isArray(rule.nodes),'ADMIN_VISUAL_AXE_UNRESOLVED_RULE');
  for(const node of rule.nodes){
   const matches=accessibility.remeasurements.filter(proof=>isDeepStrictEqual(proof.target,node.target));
   requireProof(matches.length===1,'ADMIN_VISUAL_AXE_REMEASUREMENT_REQUIRED');
   const proof=matches[0];
   requireProof(proof.resolved===true&&proof.reason==='EXACT_VISIBLE_CONTRAST_PASS'&&proof.fullyVisibleBeforeRun===true&&proof.fullyVisibleAfterRun===true,'ADMIN_VISUAL_AXE_EXACT_PASS_REQUIRED');
   assertEmpty(proof.violations,'ADMIN_VISUAL_AXE_REMEASUREMENT_VIOLATIONS');assertEmpty(proof.incomplete,'ADMIN_VISUAL_AXE_REMEASUREMENT_INCOMPLETE');
   requireProof(Array.isArray(proof.passTargets)&&proof.passTargets.some(target=>isDeepStrictEqual(target,node.target)),'ADMIN_VISUAL_AXE_TARGET_PASS_REQUIRED');
  }
 }
}

/** A successful child is partial evidence, never full acceptance by itself. */
export function assertAdminVisualShard({report,exitCode,caseEvidence},fullInventory,dialogInventory,index){
 requireProof(exitCode===0,'ADMIN_VISUAL_CHILD_EXIT_FAILED');
 requireProof(report?.version==='admin-visual-ci-shard-2'&&report.mode==='strict'&&report.acceptanceScope==='partial-route-shard'&&report.passed===false&&report.shardComplete===true&&report.phase==='finished'&&!report.failure,'ADMIN_VISUAL_CHILD_INCOMPLETE');
 exact(report.shard,{index,count:ADMIN_VISUAL_SHARD_COUNT},'ADMIN_VISUAL_CHILD_SHARD_MISMATCH');
 exact(report.fullRouteInventory,fullInventory,'ADMIN_VISUAL_CHILD_SOURCE_INVENTORY_CHANGED');
 const assigned=selectAdminVisualShard(fullInventory,index),expected=expectedAdminVisualCases(assigned),keys=new Set(expected.map(adminVisualCaseKey));
 exact(report.routeInventory,assigned,'ADMIN_VISUAL_CHILD_ROUTE_PARTITION_CHANGED');exact(report.routes,assigned.map(route=>route.path),'ADMIN_VISUAL_CHILD_ROUTES_CHANGED');
 exact(report.dialogInventory,dialogInventory,'ADMIN_VISUAL_CHILD_DIALOG_INVENTORY_CHANGED');
 requireProof(report.expectedCases===expected.length&&Array.isArray(report.matrix)&&report.matrix.length===expected.length,'ADMIN_VISUAL_CHILD_CASE_COUNT_MISMATCH');
 for(const key of ['apiErrors','browserErrors','blockedRequests','redisErrors'])assertEmpty(report[key],'ADMIN_VISUAL_CHILD_'+key.toUpperCase());
 requireProof(report.reviewsStayedPending===true,'ADMIN_VISUAL_HUMAN_REVIEWS_CHANGED');
 requireProof(caseEvidence instanceof Map&&caseEvidence.size===expected.length,'ADMIN_VISUAL_CASE_FILES_MISSING');
 const seen=new Set(),observedDialogs=[];
 for(const row of report.matrix){
  const key=adminVisualCaseKey(row);
  requireProof(keys.has(key),'ADMIN_VISUAL_UNEXPECTED_CASE_DIMENSION');requireProof(!seen.has(key),'ADMIN_VISUAL_DUPLICATE_CASE');seen.add(key);
  requireProof(row.passed===true&&['violations','indeterminate','axeViolations','axeIncomplete'].every(field=>row[field]===0),'ADMIN_VISUAL_CASE_FAILED');
  const proof=caseEvidence.get(key);requireProof(proof,'ADMIN_VISUAL_CASE_FILE_MISSING');
  requireProof(adminVisualCaseKey(proof)===key&&row.caseId===adminVisualCaseName(proof),'ADMIN_VISUAL_CASE_FILE_IDENTITY_MISMATCH');
  requireProof(proof.passed===true&&Number.isFinite(proof.dpr)&&Math.abs(proof.dpr-row.zoom)<=.02&&proof.dpr===row.dpr,'ADMIN_VISUAL_NATIVE_ZOOM_PROOF_INVALID');
  assertScanEvidence(proof.scans);assertAccessibilityEvidence(proof.accessibility);
  requireProof(Array.isArray(proof.applicableDialogs)&&new Set(proof.applicableDialogs).size===proof.applicableDialogs.length&&Array.isArray(proof.dialogs),'ADMIN_VISUAL_DIALOG_APPLICABILITY_REQUIRED');
  const scanned=new Set();
  for(const dialog of proof.dialogs){
   requireProof(dialogInventory.some(declared=>declared.slug===dialog.slug)&&!scanned.has(dialog.slug),'ADMIN_VISUAL_DIALOG_UNKNOWN_OR_DUPLICATE');scanned.add(dialog.slug);
   requireProof(dialog.passed===true,'ADMIN_VISUAL_DIALOG_FAILED');assertScanEvidence(dialog.scans);assertAccessibilityEvidence(dialog.accessibility);
   observedDialogs.push({caseId:row.caseId,slug:dialog.slug,passed:true});
  }
  exact([...scanned].sort(),[...proof.applicableDialogs].sort(),'ADMIN_VISUAL_APPLICABLE_DIALOG_UNTESTED');
 }
 exact(report.dialogs,observedDialogs,'ADMIN_VISUAL_DIALOG_REPORT_PROOF_MISMATCH');
 return{routeInventory:assigned,matrix:report.matrix,dialogs:observedDialogs};
}

/** Only this all-shards verifier is allowed to publish passed=true. */
export function aggregateAdminVisualShards(children,inventories,dialogInventory){
 requireProof(Array.isArray(children)&&children.length===ADMIN_VISUAL_SHARD_COUNT&&Array.isArray(inventories)&&inventories.length===ADMIN_VISUAL_SHARD_COUNT,'ADMIN_VISUAL_ALL_SHARDS_REQUIRED');
 requireProof(Array.isArray(dialogInventory)&&dialogInventory.length>0&&new Set(dialogInventory.map(dialog=>dialog.slug)).size===dialogInventory.length,'ADMIN_VISUAL_SOURCE_DIALOG_INVENTORY_REQUIRED');
 const slots=inventories[0].map(adminVisualRouteSlot);
 for(const inventory of inventories)exact(inventory.map(adminVisualRouteSlot),slots,'ADMIN_VISUAL_SHARD_SOURCE_SLOTS_CHANGED');
 const accepted=children.map((child,index)=>assertAdminVisualShard(child,inventories[index],dialogInventory,index));
 const routeInventory=inventories[0].map((_,position)=>inventories[position%ADMIN_VISUAL_SHARD_COUNT][position]);
 const matrix=accepted.flatMap(child=>child.matrix),dialogs=accepted.flatMap(child=>child.dialogs);
 requireProof(matrix.length===expectedAdminVisualCases(routeInventory).length&&new Set(matrix.map(adminVisualCaseKey)).size===matrix.length,'ADMIN_VISUAL_AGGREGATE_CASE_COVERAGE_INVALID');
 assertAdminVisualDialogCoverage(dialogInventory,dialogs);
 return{version:'admin-visual-ci-all-2',acceptanceScope:'complete-route-matrix',mode:'strict',routeInventory,routes:routeInventory.map(route=>route.path),dialogInventory,matrix,dialogs,expectedCases:matrix.length,dialogCoverage:{passed:true},reviewsStayedPending:true,apiErrors:[],browserErrors:[],blockedRequests:[],redisErrors:[],passed:true,shards:children.map((child,index)=>({index,exitCode:child.exitCode,shardComplete:child.report.shardComplete,cases:child.report.matrix.length}))};
}

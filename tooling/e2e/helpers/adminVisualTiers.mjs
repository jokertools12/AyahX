// Scheduling changes coverage only; scanner/axe thresholds and native zoom stay.
export const adminVisualLaunchCombinations=Object.freeze([
 {size:{width:1366,height:768},zoom:1,theme:'light',lang:'ar'},
 {size:{width:1366,height:768},zoom:1.5,theme:'dark',lang:'ar'},
 {size:{width:390,height:844},zoom:1,theme:'light',lang:'ar'},
 {size:{width:390,height:844},zoom:1.5,theme:'dark',lang:'ar'},
 {size:{width:1920,height:1080},zoom:1.25,theme:'light',lang:'en'},
]);
export const adminVisualLaunchCorePatterns=Object.freeze(['','reviews/:id','listening','reciters','availability']);
export const adminVisualLaunchDialogCombinations=Object.freeze([adminVisualLaunchCombinations[0],adminVisualLaunchCombinations[3]]);
export function requireAdminVisualTier(tier){
 if(!['tier1','tier2'].includes(tier))throw new Error('ADMIN_VISUAL_TIER_INVALID');
 return tier;
}
export function adminVisualCombinationKey(row){return JSON.stringify([row.size?.width,row.size?.height,row.zoom,row.theme,row.lang]);}
/** Match the CSS visibility contracts of responsive shell controls. */
export function adminVisualDialogSupportedAtCase(slug,row){
 if(slug==='mobile-nav')return (row.size?.width??0)<=1099;
 if(slug==='keyboard-help')return (row.size?.width??0)>767;
 return true;
}
// Only these shared shell dialogs have route-independent content. Route-local
// dialogs can differ between tab/query contexts even with the same declaration.
export function adminVisualDialogReuseScope(dialog,row){
 const shell=dialog.file?.replaceAll('\\','/').endsWith('/admin/AdminShell.tsx');
 return shell&&['keyboard-help','quick-search','reading-preferences'].includes(dialog.slug)?'shared-admin-shell':'route:'+row.route;
}
export function launchAdminVisualCases(inventory){
 return inventory.flatMap(({path,pattern,view})=>[
  ...adminVisualLaunchCombinations.map(combo=>({route:path,...combo})),
  // The owner did not restrict the 200% core checks to one size/theme/language.
  // Cover all five launch combinations at 200%, including Arabic mobile dark.
  ...(!view&&adminVisualLaunchCorePatterns.includes(pattern)?adminVisualLaunchCombinations.map(combo=>({route:path,...combo,zoom:2})):[]),
 ]);
}
export function shouldScanAdminVisualDialogs(row,tier){
 requireAdminVisualTier(tier);
 return tier==='tier2'||adminVisualLaunchDialogCombinations.some(combo=>adminVisualCombinationKey(combo)===adminVisualCombinationKey(row));
}
export function assertAdminVisualLaunchCoreCoverage(inventory){
 for(const pattern of adminVisualLaunchCorePatterns)if(!inventory.some(route=>route.pattern===pattern&&!route.view))throw new Error('ADMIN_VISUAL_LAUNCH_CORE_MISSING:'+pattern);
}
export function assertAdminVisualTierDialogCoverage(inventory,observed,tier){
 requireAdminVisualTier(tier);
 const combinations=tier==='tier1'?adminVisualLaunchDialogCombinations:[null];
 for(const combo of combinations){
  const passed=new Set(observed.filter(row=>row.passed&&(!combo||adminVisualCombinationKey(row)===adminVisualCombinationKey(combo))).map(row=>row.slug));
  const missing=inventory.map(dialog=>dialog.slug).filter(slug=>adminVisualDialogSupportedAtCase(slug,combo??{})&&!passed.has(slug));
  if(missing.length)throw new Error('UNTESTED_DECLARED_ADMIN_DIALOGS:'+missing.join(',')+(combo?':'+adminVisualCombinationKey(combo):''));
 }
}

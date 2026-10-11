import {AdminHistoryGuard} from './adminHistoryGuard';
const dirtyForms=new Set<symbol>();
const currentIndex=()=>Number.isInteger(window.history.state?.idx)?Number(window.history.state.idx):null;
let guard:AdminHistoryGuard|null=null;
let installed=false;
const pop=(event:PopStateEvent)=>guard?.pop(Number.isInteger(event.state?.idx)?Number(event.state.idx):null,event);
export function installAdminNavigationGuard(){if(!installed){window.addEventListener('popstate',pop,true);installed=true;}}
export function markAdminForm(key:symbol,dirty:boolean){
 installAdminNavigationGuard();
 if(dirty)dirtyForms.add(key);else dirtyForms.delete(key);
 if(dirtyForms.size&&!guard)guard=new AdminHistoryGuard(currentIndex(),{confirm:allowAdminNavigation,go:delta=>window.history.go(delta)});
 if(!dirtyForms.size&&guard)guard=null;
}
export function rememberAdminLocation(){guard?.remember(currentIndex());}
export function allowAdminNavigation(){return !dirtyForms.size||window.confirm(document.documentElement.lang==='en'?'Discard unsaved changes?':'تجاهل التغييرات غير المحفوظة؟');}

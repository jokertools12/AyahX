interface PopEvent {stopImmediatePropagation:()=>void}
export interface HistoryGuardRuntime {confirm:()=>boolean;go:(delta:number)=>void}
/** BrowserRouter stores an integer idx on every managed history entry. */
export class AdminHistoryGuard {
 private restoring=false;
 constructor(private index:number|null,private readonly runtime:HistoryGuardRuntime){}
 remember(index:number|null){if(!this.restoring)this.index=index;}
 pop(next:number|null,event:PopEvent){
  if(this.restoring){event.stopImmediatePropagation();if(next===this.index)this.restoring=false;else if(next!==null&&this.index!==null)this.runtime.go(this.index-next);return;}
  if(this.runtime.confirm()){this.index=next;return;}
  // Capture runs before BrowserRouter's bubble listener, retaining the mounted form.
  event.stopImmediatePropagation();
  if(next!==null&&this.index!==null&&next!==this.index){this.restoring=true;this.runtime.go(this.index-next);}
 }
}

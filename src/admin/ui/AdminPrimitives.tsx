import { useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, CircleHelp, XCircle, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { copy } from '../adminClipboard';
export { Button, Input, Skeleton };
export { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
export { Switch } from '@/components/ui/switch';
export { Checkbox } from '@/components/ui/checkbox';
export { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
export { Textarea } from '@/components/ui/textarea';
export { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
export { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
export { Sheet as Drawer, SheetContent as DrawerContent, SheetHeader as DrawerHeader, SheetTitle as DrawerTitle, SheetDescription as DrawerDescription } from '@/components/ui/sheet';
export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
const statuses:Record<string,{ar:string;en:string;tone:string}>={
  complete:{ar:'مكتمل',en:'Complete',tone:'success'},near_complete:{ar:'شبه مكتمل',en:'Near complete',tone:'warning'},partial:{ar:'جزئي',en:'Partial',tone:'warning'},unavailable:{ar:'غير متاح',en:'Unavailable',tone:'muted'},
  unverified:{ar:'غير متحقق',en:'Unverified',tone:'warning'},auto_verified:{ar:'متحقق آليًا',en:'Auto verified',tone:'success'},confirmed:{ar:'مؤكد بشريًا',en:'Confirmed',tone:'success'},mismatch:{ar:'غير مطابق',en:'Mismatch',tone:'danger'},
  published:{ar:'مؤهل تقنيًا',en:'Technically eligible',tone:'success'},ready:{ar:'جاهز',en:'Ready',tone:'success'},needs_review:{ar:'يحتاج مراجعة',en:'Needs review',tone:'warning'},hidden:{ar:'مخفي',en:'Hidden',tone:'muted'},pending:{ar:'معلّق',en:'Pending',tone:'warning'},approved:{ar:'معتمد',en:'Approved',tone:'success'},rejected:{ar:'مرفوض',en:'Rejected',tone:'danger'}
};
export function StatusChip({status,lang='ar'}:{status:string;lang?:'ar'|'en'}){const s=statuses[status];const Icon=s?.tone==='success'?CheckCircle2:s?.tone==='danger'?XCircle:s?.tone==='warning'?AlertTriangle:CircleHelp;return <span className="admin-chip" data-tone={s?.tone??'muted'}><Icon size={14} aria-hidden="true"/>{s?.[lang]??status}</span>;}
export function PageHeader({title,description,action,children}:{title:string;description?:string;action?:ReactNode;children?:ReactNode}){return <header className="admin-stack"><div className="admin-row" style={{justifyContent:'space-between'}}><div><h1 className="admin-page-title">{title}</h1>{description&&<p className="admin-muted">{description}</p>}</div>{action}</div>{children}</header>;}
export function Field({label,id,children,hint}:{label:string;id:string;children:ReactNode;hint?:string}){return <div className="admin-field"><label htmlFor={id}>{label}</label>{children}{hint&&<small className="admin-muted">{hint}</small>}</div>;}
export function EmptyState({text='لا توجد نتائج مطابقة',children}:{text?:string;children?:ReactNode}){return <div className="admin-card" role="status"><p>{text}</p>{children}</div>;}
export function ErrorState({error,onRetry}:{error:{message:string;code?:string;requestId?:string};onRetry?:()=>void}){return <div role="alert" className="admin-card admin-error"><p>{error.message}</p><p className="admin-muted" dir="ltr">{error.code} {error.requestId}</p><div className="admin-row">{error.requestId&&<Button variant="outline" onClick={()=>copy(error.requestId!)}>نسخ معرّف الطلب <Copy size={16} aria-hidden="true"/></Button>}{onRetry&&<Button variant="outline" onClick={onRetry}>إعادة المحاولة <RefreshCw size={16} aria-hidden="true"/></Button>}</div></div>;}
export function LoadingState(){return <div role="status" aria-label="جار التحميل" className="admin-stack"><Skeleton className="h-10 w-full"/><Skeleton className="h-20 w-full"/><Skeleton className="h-20 w-full"/></div>;}
export function CodeBlock({value,label='JSON'}:{value:unknown;label?:string}){const text=typeof value==='string'?value:JSON.stringify(value,null,2);return <div><div className="admin-row"><strong>{label}</strong><Button variant="ghost" onClick={()=>copy(text)} aria-label={`نسخ ${label}`}><Copy size={16} aria-hidden="true"/></Button></div><pre dir="ltr" className="admin-json">{text}</pre></div>;}
export function DiffViewer({before,after}:{before:unknown;after:unknown}){return <div className="admin-diff"><CodeBlock value={before} label="قبل / Before"/><CodeBlock value={after} label="بعد / After"/></div>;}
export function StatCard({label,value,hint}:{label:string;value:ReactNode;hint?:string}){return <section className="admin-card"><p className="admin-muted">{label}</p><strong style={{fontSize:28,fontVariantNumeric:'tabular-nums'}}>{value}</strong>{hint&&<p className="admin-muted">{hint}</p>}</section>;}
export function ProgressBar({value,max,label}:{value:number;max:number;label:string}){return <label className="admin-field">{label}: {value}/{max}<progress max={max} value={value} style={{width:'100%',accentColor:'hsl(var(--primary))'}}/></label>;}
export function ConfirmDialog({open,onOpenChange,expected,title,impact,onConfirm,pending=false}:{open:boolean;onOpenChange:(v:boolean)=>void;expected:string;title:string;impact:string;onConfirm:()=>void;pending?:boolean}){const [typed,setTyped]=useState('');return <Dialog open={open} onOpenChange={v=>{setTyped('');onOpenChange(v);}}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{impact}</DialogDescription></DialogHeader><Field label={`اكتب ${expected} للتأكيد`} id="typed-confirm"><Input id="typed-confirm" dir="ltr" value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off"/></Field><DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>إلغاء</Button><Button variant="destructive" disabled={typed!==expected||pending} onClick={onConfirm}>{pending?'جار التنفيذ…':'تأكيد'}</Button></DialogFooter></DialogContent></Dialog>;}
export function AuditTimeline({items,onSelect}:{items:Array<{id:string;action:string;created_at:string}>;onSelect:(id:string)=>void}){return <ol className="admin-timeline">{items.map(item=><li key={item.id}><Button variant="link" onClick={()=>onSelect(item.id)}>{item.action}</Button><time className="admin-muted" dir="ltr">{item.created_at}</time></li>)}</ol>;}

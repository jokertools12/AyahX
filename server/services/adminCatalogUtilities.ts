import {CatalogError,type CatalogRow} from './catalogContracts';
import {reportableAudioUrl} from './catalogLinkChecker';
export function parsedJson<T>(value:unknown):T{return (typeof value==='string'?JSON.parse(value):value) as T;}
export const truth=(value:unknown):boolean=>value===true||value===1;
export const enabled=(value:unknown):boolean=>value===null||value===undefined||truth(value);
/** Literal search, including %, _, and the escape character itself. */
export const literalLike=(value:string):string=>'%'+value.replace(/[!%_]/gu,'!$&')+'%';
export function safeCatalogUrl(value:unknown):string|null{return typeof value==='string'?reportableAudioUrl(value):null;}
export function redactCatalogEvidence(value:unknown):unknown{
  if(typeof value==='string'){if(/^https?:\/\//iu.test(value))return safeCatalogUrl(value)??'[PRIVATE_URL]';if(/(?:mysql|redis|postgres):\/\//iu.test(value))return '[PRIVATE_VALUE]';return value;}
  if(Array.isArray(value))return value.map(redactCatalogEvidence);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/password|secret|token|credential|connection_string/iu.test(key)?'[PRIVATE_VALUE]':redactCatalogEvidence(item)]));
  return value;
}
export interface AdminPage {page:number;limit:number;sort?:string;direction?:'asc'|'desc';q?:string;[key:string]:unknown}
export function pageQuery(input:AdminPage,sorts:Record<string,string>,defaultSort:string):{order:string;limit:number;offset:number}{
  if(!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.direction&&!['asc','desc'].includes(input.direction)||input.sort&&!sorts[input.sort])throw new CatalogError('CATALOG_INPUT_INVALID',422);
  return {order:(sorts[input.sort??defaultSort])+' '+(input.direction==='desc'?'DESC':'ASC'),limit:input.limit,offset:(input.page-1)*input.limit};
}
export function pageResult(rows:CatalogRow[],total:number,input:AdminPage):{data:CatalogRow[];meta:CatalogRow}{return {data:rows,meta:{page:input.page,limit:input.limit,total,totalPages:Math.ceil(total/input.limit)}};}
/** A subset permutation replaces only its existing slots; omitted rows never jump. */
export function reorderSlots(rows:readonly CatalogRow[],ids:readonly string[],partition?:string):CatalogRow[]{
  if(ids.length<2||new Set(ids).size!==ids.length)throw new CatalogError('CATALOG_ORDER_INVALID',422);
  const selected=new Map(rows.filter(row=>ids.includes(String(row.id))).map(row=>[String(row.id),row]));
  if(selected.size!==ids.length)throw new CatalogError('CATALOG_ORDER_STALE',409);
  if(partition&&new Set([...selected.values()].map(row=>truth(row[partition]))).size>1)throw new CatalogError('CATALOG_ORDER_PARTITION_MISMATCH',422);
  let index=0;return rows.map(row=>selected.has(String(row.id))?selected.get(ids[index++])!:row);
}

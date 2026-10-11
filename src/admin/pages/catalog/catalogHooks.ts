import {useQuery} from '@tanstack/react-query';
import {adminApi} from '../../adminApi';
import {useAdmin} from '../../adminState';
import {useAdminMutation} from '../../useAdminResource';
export function useCatalogResource<T>(path:string,enabled=true){return useQuery({queryKey:['admin','catalog',path],queryFn:()=>adminApi<T>('/catalog'+path),enabled,retry:false});}
export function useCatalogWrite(){const mutation=useAdminMutation();return {...mutation,write:<T,>(path:string,method:string,body?:unknown)=>mutation.run<T>('/catalog'+path,method,body)};}
export function usePermission(permission:string){const {user}=useAdmin();return user?.permissions.includes(permission)??false;}
/** Reordering visible IDs changes their existing slots; omitted rows are untouched. */
export function reorderedIds(ids:string[],from:string,to:string){const result=[...ids],fromIndex=result.indexOf(from),toIndex=result.indexOf(to);if(fromIndex<0||toIndex<0||from===to)return result;result.splice(fromIndex,1);result.splice(toIndex,0,from);return result;}
export const catalogListKeys=['q','page','limit','sort','direction','riwayah','style','provider','source','availability','voice','license','visible','featured','reciter_id'] as const;
export function useCatalogFacets(){return useQuery({queryKey:['admin','catalog','facets'],queryFn:async()=>{const rows:Array<{riwayah_code:string;style:string;channel:string}>=[];let page=1,totalPages=1;do{const result=await adminApi<Array<{riwayah_code:string;style:string;channel:string}>>('/catalog/recitations?page='+page+'&limit=100');rows.push(...result.data);totalPages=result.meta.totalPages??1;page++;}while(page<=totalPages);return {riwayah:[...new Set(rows.map(r=>r.riwayah_code))].sort(),style:[...new Set(rows.map(r=>r.style))].sort(),source:[...new Set(rows.map(r=>r.channel))].filter(Boolean).sort()};},retry:false});}

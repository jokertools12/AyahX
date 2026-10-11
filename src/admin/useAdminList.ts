import {useSearchParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {adminApi} from './adminApi';
export function useAdminList<T>(path:string){const [params,setParams]=useSearchParams();const page=Math.max(1,Number(params.get('page')??1)),limit=Math.min(100,Math.max(1,Number(params.get('limit')??50)));const query=useQuery({queryKey:['admin',path,params.toString()],queryFn:()=>adminApi<T[]>(path+'?'+params.toString()),retry:false});const set=(key:string,value:string)=>setParams(old=>{const next=new URLSearchParams(old);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');return next;});return {query,params,set,page,limit,total:query.data?.meta.total??0,rows:query.data?.data??[]};}

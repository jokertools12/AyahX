import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {adminApi,adminWrite,AdminApiError} from './adminApi';
import {toast} from '@/components/ui/sonner';
import {useText} from './adminState';
export function useAdminResource<T>(path:string,options:{enabled?:boolean}={}){return useQuery({queryKey:['admin',path],queryFn:()=>adminApi<T>(path),retry:false,enabled:options.enabled??true});}
export function useAdminMutation(){const client=useQueryClient(),t=useText();const [pending,setPending]=useState(false),[error,setError]=useState<AdminApiError|null>(null);return {pending,error,clearError:()=>setError(null),run:async<T,>(path:string,method:string,body?:unknown):Promise<T|null>=>{setPending(true);setError(null);try{const result=await adminWrite<T>(path,method,body);await client.invalidateQueries({queryKey:['admin']});toast.success(t('تمت العملية بنجاح','Operation completed'));return result.data;}catch(err){const safe=err instanceof AdminApiError?err:new AdminApiError(t('تعذر الاتصال بالخادم','Cannot reach server'),'ADMIN_NETWORK_UNAVAILABLE');setError(safe);toast.error(safe.message);return null;}finally{setPending(false);}}};}

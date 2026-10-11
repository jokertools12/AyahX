import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {adminApi,adminWrite,AdminApiError} from './adminApi';
import {toast} from '@/components/ui/sonner';
export function useAdminResource<T>(path:string){return useQuery({queryKey:['admin',path],queryFn:()=>adminApi<T>(path),retry:false});}
export function useAdminMutation(){const client=useQueryClient();const [pending,setPending]=useState(false),[error,setError]=useState<AdminApiError|null>(null);return {pending,error,clearError:()=>setError(null),run:async<T,>(path:string,method:string,body?:unknown):Promise<T|null>=>{setPending(true);setError(null);try{const result=await adminWrite<T>(path,method,body);await client.invalidateQueries({queryKey:['admin']});toast.success('تم حفظ التغيير / Change saved');return result.data;}catch(err){const safe=err instanceof AdminApiError?err:new AdminApiError('تعذر الاتصال بالخادم / Cannot reach server','ADMIN_NETWORK_UNAVAILABLE');setError(safe);toast.error(safe.message);return null;}finally{setPending(false);}}};}

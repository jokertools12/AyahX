export interface AdminMeta {requestId:string;page?:number;limit?:number;total?:number;totalPages?:number}
export interface AdminResponse<T>{data:T;meta:AdminMeta}
export class AdminApiError extends Error{constructor(message:string,public code:string,public requestId?:string,public detail?:Record<string,unknown>){super(message);}}
export async function adminApi<T>(path:string,options:RequestInit={}):Promise<AdminResponse<T>>{
  const response=await fetch('/api/admin'+path,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
  const body=await response.json() as AdminResponse<T>&{code?:string;message?:string;detail?:Record<string,unknown>};
  if(!response.ok){const error=new AdminApiError(body.message??'تعذر إتمام الطلب',body.code??'ADMIN_REQUEST_FAILED',typeof body.detail?.requestId==='string'?body.detail.requestId:undefined,body.detail);if(response.status===401&&path!=='/auth/login')window.dispatchEvent(new CustomEvent('ayahx-admin-session-expired'));throw error;}
  return body;
}
export const adminWrite=<T>(path:string,method:string,body?:unknown)=>adminApi<T>(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
export interface AdminUser{id:string;email:string;displayName:string;roles:string[];permissions:string[];sessionId:string;environment:string;totp:{enabled:boolean;required:boolean;encryptionConfigured:boolean}}

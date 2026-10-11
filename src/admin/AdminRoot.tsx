import {lazy,Suspense,useEffect,useState} from 'react';
import {Route,Routes,useLocation} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {adminApi,AdminApiError,type AdminUser} from './adminApi';
import {AdminProvider} from './adminContext';
import {useAdmin,useText} from './adminState';
import AdminLogin from './AdminLogin';
import AdminShell from './AdminShell';
import {ErrorState,LoadingState} from './ui/AdminPrimitives';
import './admin.css';
const Dashboard=lazy(()=>import('./pages/AdminDashboard'));
const Roles=lazy(()=>import('./pages/AdminRoles'));
const Users=lazy(()=>import('./pages/AdminUsers'));
const Audit=lazy(()=>import('./pages/AdminAudit'));
const Settings=lazy(()=>import('./pages/AdminSettings'));
const Security=lazy(()=>import('./pages/AdminSecurity'));
const Kit=lazy(()=>import('./AdminKit'));
function Allowed({permission,children}:{permission:string;children:React.ReactNode}){const {user}=useAdmin(),t=useText();return user?.permissions.includes(permission)?children:<ErrorState error={{code:'ADMIN_FORBIDDEN',message:t('لا تملك صلاحية هذه الصفحة','You cannot access this page')}}/>;}
function AdminContent({expired,onLogin}:{expired:boolean;onLogin:()=>void}){const {user,lang}=useAdmin(),t=useText();return <div className="admin-app" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>{user?<><AdminShell><Suspense fallback={<LoadingState/>}><Routes><Route index element={<Allowed permission="dashboard.read"><Dashboard/></Allowed>}/><Route path="roles" element={<Allowed permission="roles.read"><Roles/></Allowed>}/><Route path="users" element={<Allowed permission="users.read"><Users/></Allowed>}/><Route path="audit" element={<Allowed permission="audit.read"><Audit/></Allowed>}/><Route path="settings" element={<Allowed permission="settings.read"><Settings/></Allowed>}/><Route path="security" element={<Allowed permission="security.self"><Security/></Allowed>}/><Route path="_kit" element={user.environment==='local'&&user.roles.includes('super_admin')?<Kit/>:<ErrorState error={{code:'ADMIN_FORBIDDEN',message:t('مكتبة المكونات محلية للمدير الأعلى فقط','UI kit is local and super administrator only')}}/>}/><Route path="*" element={<ErrorState error={{code:'ADMIN_PAGE_NOT_FOUND',message:t('صفحة غير موجودة','Page not found')}}/>}/></Routes></Suspense></AdminShell>{expired&&<div className="admin-reauth" role="dialog" aria-modal="true" aria-label={t('إعادة الدخول','Sign in again')}><AdminLogin reauth onSuccess={onLogin}/></div>}</>:<div className="admin-login-layout"><AdminLogin onSuccess={onLogin}/></div>}</div>;}
export default function AdminRoot(){const location=useLocation();const [expired,setExpired]=useState(false),[lastUser,setLastUser]=useState<AdminUser|null>(null);const query=useQuery({queryKey:['admin','identity'],queryFn:()=>adminApi<AdminUser>('/auth/me'),retry:false});const current=query.data?.data??lastUser;useEffect(()=>{if(query.data?.data)setLastUser(query.data.data);},[query.data]);useEffect(()=>{const listener=()=>{if(current)setExpired(true);};window.addEventListener('ayahx-admin-session-expired',listener);return()=>window.removeEventListener('ayahx-admin-session-expired',listener);},[current]);const refresh=()=>{setLastUser(null);setExpired(false);void query.refetch();};const login=()=>{setExpired(false);void query.refetch();};if(query.isPending)return <div className="admin-app"><main className="admin-main"><LoadingState/></main></div>;if(query.error&&!(query.error instanceof AdminApiError&&query.error.code.includes('SESSION'))&&!(query.error instanceof AdminApiError&&query.error.code==='ADMIN_UNAUTHENTICATED'))return <div className="admin-app"><main className="admin-main"><ErrorState error={query.error} onRetry={()=>void query.refetch()}/></main></div>;return <AdminProvider user={current} refreshUser={refresh}><Routes location={location}><Route path="/admin/*" element={<AdminContent expired={expired} onLogin={login}/>}/></Routes></AdminProvider>;}

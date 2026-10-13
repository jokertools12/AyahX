import {lazy,Suspense,useEffect,useState} from 'react';
import {Route,Routes} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {adminApi,AdminApiError,type AdminUser} from './adminApi';
import {AdminProvider} from './adminContext';
import {useAdmin,useText} from './adminState';
import AdminLogin from './AdminLogin';
import AdminShell from './AdminShell';
import {ErrorState,LoadingState} from './ui/AdminPrimitives';
import './admin.css';
const Dashboard=lazy(()=>import('./pages/workspace/StartPage'));
const Reviews=lazy(()=>import('./pages/workspace/ReviewsPage'));
const ReviewDetail=lazy(()=>import('./pages/workspace/ReviewDetailPage'));
const Listening=lazy(()=>import('./pages/workspace/ListeningPage'));
const ProviderLicenses=lazy(()=>import('./pages/workspace/ProviderLicensesPage'));
const Labels=lazy(()=>import('./pages/workspace/LabelsPage'));
const Launch=lazy(()=>import('./pages/workspace/LaunchPage'));
const Project=lazy(()=>import('./pages/workspace/ProjectPage'));
const Help=lazy(()=>import('./pages/workspace/HelpPage'));
const Feedback=lazy(()=>import('./pages/workspace/FeedbackPage'));
const Diagnostics=lazy(()=>import('./pages/workspace/DiagnosticsPage'));
const Storage=lazy(()=>import('./pages/workspace/StoragePage'));
const LicensedAudio=lazy(()=>import('./pages/workspace/LicensedAudioPage'));
const Wizard=lazy(()=>import('./pages/workspace/ReciterWizardPage'));
const RenderLab=lazy(()=>import('./pages/workspace/RenderLabPage'));
const Roles=lazy(()=>import('./pages/AdminRoles'));
const Users=lazy(()=>import('./pages/AdminUsers'));
const Audit=lazy(()=>import('./pages/AdminAudit'));
const Settings=lazy(()=>import('./pages/AdminSettings'));
const Security=lazy(()=>import('./pages/AdminSecurity'));
const Kit=lazy(()=>import('./AdminKit'));
const Reciters=lazy(()=>import('./pages/catalog/RecitersPage'));
const ReciterDetail=lazy(()=>import('./pages/catalog/ReciterDetailPage'));
const Recitations=lazy(()=>import('./pages/catalog/RecitationsPage'));
const Availability=lazy(()=>import('./pages/catalog/AvailabilityPage'));
const Providers=lazy(()=>import('./pages/catalog/ProvidersPage'));
const Quran=lazy(()=>import('./pages/catalog/QuranPage'));
const Timings=lazy(()=>import('./pages/catalog/TimingsPage'));
function Allowed({permission,children}:{permission:string;children:React.ReactNode}){const {user}=useAdmin(),t=useText();return user?.permissions.includes(permission)?children:<ErrorState error={{code:'ADMIN_FORBIDDEN',message:t('لا تملك صلاحية هذه الصفحة','You cannot access this page')}}/>;}
function AdminContent({expired,onLogin}:{expired:boolean;onLogin:()=>void}){const {user,lang}=useAdmin(),t=useText();
 // Body portals inherit document direction rather than their React parent's.
 // Restore the public document attributes when this admin subtree unmounts.
 useEffect(()=>{const documentRoot=document.documentElement,previousDir=documentRoot.dir,previousLang=documentRoot.lang,previousDirection=documentRoot.style.direction;documentRoot.style.direction=lang==='ar'?'rtl':'ltr';documentRoot.dir=lang==='ar'?'rtl':'ltr';documentRoot.lang=lang;return()=>{documentRoot.dir=previousDir;documentRoot.lang=previousLang;documentRoot.style.direction=previousDirection;};},[lang]);
 return <div className="admin-app" dir={lang==='ar'?'rtl':'ltr'} lang={lang}>{user?<><AdminShell><Suspense fallback={<LoadingState/>}><Routes><Route index element={<Allowed permission="dashboard.read"><Dashboard/></Allowed>}/><Route path="feedback" element={<Allowed permission="dashboard.read"><Feedback/></Allowed>}/><Route path="diagnostics" element={<Allowed permission="dashboard.read"><Diagnostics/></Allowed>}/><Route path="reviews" element={<Allowed permission="review.read"><Reviews/></Allowed>}/><Route path="reviews/:id" element={<Allowed permission="review.read"><ReviewDetail/></Allowed>}/><Route path="listening" element={<Allowed permission="review.read"><Listening/></Allowed>}/><Route path="listening/:id" element={<Allowed permission="review.read"><Listening/></Allowed>}/><Route path="provider-licenses" element={<Allowed permission="providers.read"><ProviderLicenses/></Allowed>}/><Route path="labels" element={<Allowed permission="recitations.read"><Labels/></Allowed>}/><Route path="launch" element={<Allowed permission="review.read"><Launch/></Allowed>}/><Route path="project" element={<Allowed permission="dashboard.read"><Project/></Allowed>}/><Route path="help" element={<Allowed permission="dashboard.read"><Help/></Allowed>}/><Route path="storage" element={<Allowed permission="storage.manage"><Storage/></Allowed>}/><Route path="licensed-audio" element={<Allowed permission="sources.read"><LicensedAudio/></Allowed>}/><Route path="licensed-audio/:id" element={<Allowed permission="sources.read"><LicensedAudio/></Allowed>}/><Route path="reciter-wizard" element={<Allowed permission="recitations.write"><Wizard/></Allowed>}/><Route path="render-lab" element={<Allowed permission="render.test"><RenderLab/></Allowed>}/><Route path="roles" element={<Allowed permission="roles.read"><Roles/></Allowed>}/><Route path="users" element={<Allowed permission="users.read"><Users/></Allowed>}/><Route path="audit" element={<Allowed permission="audit.read"><Audit/></Allowed>}/><Route path="settings" element={<Allowed permission="settings.read"><Settings/></Allowed>}/><Route path="security" element={<Allowed permission="security.self"><Security/></Allowed>}/><Route path="reciters" element={<Allowed permission="reciters.read"><Reciters/></Allowed>}/><Route path="reciters/:id" element={<Allowed permission="reciters.read"><ReciterDetail/></Allowed>}/><Route path="recitations" element={<Allowed permission="recitations.read"><Recitations/></Allowed>}/><Route path="availability" element={<Allowed permission="recitations.read"><Availability/></Allowed>}/><Route path="providers" element={<Allowed permission="providers.read"><Providers/></Allowed>}/><Route path="quran" element={<Allowed permission="quran.read"><Quran/></Allowed>}/><Route path="timings" element={<Allowed permission="timings.read"><Timings/></Allowed>}/><Route path="_kit" element={user.environment==='local'&&user.roles.includes('super_admin')?<Kit/>:<ErrorState error={{code:'ADMIN_FORBIDDEN',message:t('مكتبة المكونات محلية للمدير الأعلى فقط','UI kit is local and super administrator only')}}/>}/><Route path="*" element={<ErrorState error={{code:'ADMIN_PAGE_NOT_FOUND',message:t('صفحة غير موجودة','Page not found')}}/>}/></Routes></Suspense></AdminShell>{expired&&<div className="admin-reauth" role="dialog" aria-modal="true" aria-label={t('إعادة الدخول','Sign in again')}><AdminLogin reauth onSuccess={onLogin}/></div>}</>:<div className="admin-login-layout"><AdminLogin onSuccess={onLogin}/></div>}</div>;}
export default function AdminRoot(){const [signedOut,setSignedOut]=useState(false);const [expired,setExpired]=useState(false),[lastUser,setLastUser]=useState<AdminUser|null>(null);const query=useQuery({queryKey:['admin','identity'],queryFn:()=>adminApi<AdminUser>('/auth/me'),retry:false});const current=signedOut?null:query.data?.data??lastUser;useEffect(()=>{if(query.data?.data)setLastUser(query.data.data);},[query.data]);useEffect(()=>{const listener=()=>{if(current)setExpired(true);};window.addEventListener('ayahx-admin-session-expired',listener);return()=>window.removeEventListener('ayahx-admin-session-expired',listener);},[current]);const refresh=()=>{setSignedOut(true);setLastUser(null);setExpired(false);void query.refetch();};const login=()=>{setExpired(false);setSignedOut(false);void query.refetch();};if(query.isPending)return <div className="admin-app"><main className="admin-main"><LoadingState/></main></div>;if(query.error&&!(query.error instanceof AdminApiError&&query.error.code.includes('SESSION'))&&!(query.error instanceof AdminApiError&&query.error.code==='ADMIN_UNAUTHENTICATED'))return <div className="admin-app"><main className="admin-main"><ErrorState error={query.error} onRetry={()=>void query.refetch()}/></main></div>;return <AdminProvider user={current} refreshUser={refresh}><AdminContent expired={expired} onLogin={login}/></AdminProvider>;}

import {createContext,useContext} from 'react';
import {type AdminUser} from './adminApi';
export type AdminLanguage='ar'|'en';
export const AdminContext=createContext<{user:AdminUser|null;lang:AdminLanguage;setLang:(l:AdminLanguage)=>void;refreshUser:()=>void}>({user:null,lang:'ar',setLang:()=>{},refreshUser:()=>{}});
export function useAdmin(){return useContext(AdminContext);}
export function useText(){const {lang}=useAdmin();return (ar:string,en:string)=>lang==='ar'?ar:en;}

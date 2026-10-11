import {useState,type ReactNode} from 'react';
import {type AdminUser} from './adminApi';
import {AdminContext,type AdminLanguage} from './adminState';
export function AdminProvider({user,refreshUser,children}:{user:AdminUser|null;refreshUser:()=>void;children:ReactNode}){const [lang,setLanguage]=useState<AdminLanguage>(()=>localStorage.getItem('ayahx-admin-lang')==='en'?'en':'ar');return <AdminContext.Provider value={{user,refreshUser,lang,setLang:l=>{localStorage.setItem('ayahx-admin-lang',l);setLanguage(l);}}}>{children}</AdminContext.Provider>;}

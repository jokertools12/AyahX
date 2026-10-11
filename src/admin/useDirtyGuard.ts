import {useEffect,useRef} from 'react';
import {useLocation} from 'react-router-dom';
import {markAdminForm,rememberAdminLocation} from './adminDirtyState';
export function useDirtyGuard(dirty:boolean){const key=useRef(Symbol('admin-form')),location=useLocation();useEffect(()=>{rememberAdminLocation();},[location.key]);useEffect(()=>{const form=key.current;markAdminForm(form,dirty);if(!dirty)return()=>markAdminForm(form,false);const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>{markAdminForm(form,false);window.removeEventListener('beforeunload',handler);};},[dirty]);}

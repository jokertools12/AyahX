import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AdminContext} from '../adminState';
import {termLabel} from '../i18n/terms';
import AdminUsers from './AdminUsers';
vi.mock('../useAdminList',()=>({useAdminList:()=>({params:new URLSearchParams(),set:()=>{},page:1,total:1,limit:25,rows:[{id:'fixture-user',email:'fixture@example.test',displayName:'Fixture user',roles:['admin'],createdAt:'2026-10-13'}],query:{isPending:false,error:null,refetch:()=>{}}})}));
vi.mock('../useAdminResource',()=>({useAdminMutation:()=>({pending:false,error:null,run:vi.fn()})}));
vi.mock('../ui/DataTable',()=>({DataTable:({rows,onSelect}:{rows:Array<{id:string}>;onSelect:(row:{id:string})=>void})=><button onClick={()=>onSelect(rows[0])}>Open fixture user</button>,Pagination:()=>null}));
const owner={id:'unit-owner',email:'unit@example.test',displayName:'Unit owner',roles:['super_admin'],permissions:['roles.manage'],sessionId:'unit-session',environment:'test',totp:{enabled:false,required:false,encryptionConfigured:false}};
afterEach(cleanup);
describe('user role drawer checkbox names',()=>{
 it.each(['ar','en'] as const)('exposes each role name/title in %s and keeps grant toggles functional',lang=>{
  render(<MemoryRouter><AdminContext.Provider value={{user:owner,lang,setLang:()=>{},refreshUser:()=>{}}}><AdminUsers/></AdminContext.Provider></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Open fixture user'}));
  for(const role of ['super_admin','admin','content_manager','moderator','support','finance','analyst','user']){const name=termLabel(role,lang),checkbox=screen.getByRole('checkbox',{name});expect(checkbox).toHaveAttribute('aria-label',name);expect(checkbox).toHaveAttribute('title',name);}
  const admin=screen.getByRole('checkbox',{name:termLabel('admin',lang)});expect(admin).toHaveAttribute('aria-checked','true');fireEvent.click(admin);expect(admin).toHaveAttribute('aria-checked','false');expect(screen.getByRole('dialog')).toHaveClass('admin-drawer');
 });
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AdminContext} from '../adminState';
import {permissionLabel} from '../i18n/adminLabels';
import AdminRoles from './AdminRoles';
vi.mock('../useAdminResource',()=>({
 useAdminResource:(path:string)=>({isPending:false,error:null,refetch:()=>{},data:{data:path==='/roles'?[{slug:'super_admin',nameAr:'المدير الأعلى',nameEn:'Super administrator',permissions:['review.read']},{slug:'admin',nameAr:'أدمن',nameEn:'Administrator',permissions:['review.read']}]:[{key:'review.read',resource:'review',description:'قراءة المراجعات البشرية'},{key:'review.decide',resource:'review',description:'اتخاذ قرار المراجعة البشرية'}]}}),
 useAdminMutation:()=>({pending:false,error:null,run:vi.fn()})
}));
const user={id:'unit-owner',email:'unit@example.test',displayName:'Unit owner',roles:['super_admin'],permissions:['roles.manage'],sessionId:'unit-session',environment:'test',totp:{enabled:false,required:false,encryptionConfigured:false}};
const view=(lang:'ar'|'en')=>render(<MemoryRouter><AdminContext.Provider value={{user,lang,setLang:()=>{},refreshUser:()=>{}}}><AdminRoles/></AdminContext.Provider></MemoryRouter>);
afterEach(cleanup);
describe('permission controls expose the same localized name and tooltip',()=>{
 it.each(['ar','en'] as const)('names each checked/unchecked control in %s without relying on its check icon',lang=>{
  view(lang);for(const key of ['review.read','review.decide']){const label=permissionLabel(key,lang),checkbox=screen.getByRole('checkbox',{name:label});expect(checkbox).toHaveAttribute('aria-label',label);expect(checkbox).toHaveAttribute('title',label);expect(checkbox).toBeDisabled();}
  expect(screen.getByRole('checkbox',{name:permissionLabel('review.read',lang)})).toHaveAttribute('aria-checked','true');
 });
 it('keeps editable role selection and a checkbox toggle functional with the explicit name',()=>{
  view('en');fireEvent.change(screen.getByLabelText('Role'),{target:{value:'admin'}});const checkbox=screen.getByRole('checkbox',{name:permissionLabel('review.decide','en')});expect(checkbox).toBeEnabled();fireEvent.click(checkbox);expect(checkbox).toHaveAttribute('aria-checked','true');expect(screen.getByRole('button',{name:'Review and save'})).toBeEnabled();
 });
});

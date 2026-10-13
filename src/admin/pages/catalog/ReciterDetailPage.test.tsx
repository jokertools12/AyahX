import {afterEach,describe,it,expect,vi} from 'vitest';
import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {useDirtyGuard} from '../../useDirtyGuard';
import {AdminContext} from '../../adminState';
import ReciterDetailPage from './ReciterDetailPage';
const capabilities=vi.hoisted(()=>({enabled:false}));
vi.mock('./catalogHooks',()=>({usePermission:()=>capabilities.enabled,useCatalogResource:()=>({isPending:false,error:null,refetch:()=>{},data:{data:{reciter:{id:'local-reader',name_ar:'قارئ اختبار',name_en:'Local reader',slug:'local-reader',public_recitations:0},recitations:[],visibility_reasons:[]}}})}));
vi.mock('./ReciterProfile',()=>({default:function TestProfile(){const [dirty,setDirty]=useState(false);useDirtyGuard(dirty);return <input aria-label="Local draft" onChange={()=>setDirty(true)}/>;}}));
vi.mock('./ReciterMerge',()=>({default:()=>null}));
vi.mock('./RecitationTable',()=>({default:()=>null}));
vi.mock('./RecitationDrawer',()=>({default:()=>null}));
vi.mock('./AvailabilityPanel',()=>({default:()=>null}));
const context={user:null,lang:'en' as const,setLang:()=>{},refreshUser:()=>{}};
afterEach(()=>{cleanup();vi.restoreAllMocks();capabilities.enabled=false;});
describe('Reader tab navigation with dirty forms',()=>{
 it('asks once for an attempted tab change and preserves the draft when declined',()=>{const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><AdminContext.Provider value={context}><ReciterDetailPage/></AdminContext.Provider></MemoryRouter>);fireEvent.change(screen.getByLabelText('Local draft'),{target:{value:'Unsaved local draft'}});const tab=screen.getByRole('tab',{name:'Recitations'});fireEvent.mouseDown(tab,{button:0,ctrlKey:false});fireEvent.focus(tab);expect(confirm).toHaveBeenCalledOnce();expect(screen.getByRole('tab',{name:'Profile'})).toHaveAttribute('aria-selected','true');expect(screen.getByLabelText('Local draft')).toHaveValue('Unsaved local draft');});
 it('keeps exact ARIA panel references for all five inactive/active reader tabs without mounting inactive data',()=>{
  capabilities.enabled=true;render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><AdminContext.Provider value={context}><ReciterDetailPage/></AdminContext.Provider></MemoryRouter>);
  const tabs=screen.getAllByRole('tab');expect(tabs).toHaveLength(5);
  for(const tab of tabs){const id=tab.getAttribute('aria-controls')!,panel=document.getElementById(id);expect(panel).toHaveAttribute('role','tabpanel');expect(panel).toHaveAttribute('aria-labelledby',tab.id);expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);expect(panel!.hidden).toBe(tab.getAttribute('aria-selected')!=='true');}
 });
});

import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AdminContext} from '../../adminState';
import RenderLabPage from './RenderLabPage';
const {run,enabledCalls}=vi.hoisted(()=>({run:vi.fn(),enabledCalls:[] as string[]}));
vi.mock('../../useAdminResource',()=>({useAdminMutation:()=>({run,pending:false,error:null}),useAdminResource:(path:string,options?:{enabled?:boolean})=>{
 const enabled=options?.enabled!==false;if(enabled)enabledCalls.push(path);
 let data:unknown={items:[]};if(path==='/render-lab/choices')data={recitations:[{id:'recording-one',reciter_id:'reader-one',reciter_name_ar:'قارئ',display_label_ar:'تسجيل',provider:'actual',slug:'unit'}],max_duration_ms:90000,concurrency:1};
 else if(path==='/render-lab/choices/recording-one')data={chapters:Array.from({length:114},(_,i)=>({surah:i+1,name_ar:'سورة '+(i+1),ayah_count:10,available_runs:[[1,3]],availability_state:'complete'}))};
 else if(path.startsWith('/render-lab/choices/recording-one/'))data={surah:Number(path.split('/').at(-1)),available_runs:[[1,3]]};
 return {data:{data},isPending:false,isFetching:false,error:null,refetch:vi.fn()};
}}));
const context={user:null,lang:'en' as const,setLang:()=>{},refreshUser:()=>{}};
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();enabledCalls.length=0;});
describe('Render lab exact source admission',()=>{
 it('debounces ArrowDown-like rapid changes and rejects stale runs immediately',()=>{vi.useFakeTimers();render(<AdminContext.Provider value={context}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><RenderLabPage/></MemoryRouter></AdminContext.Provider>);fireEvent.change(screen.getByLabelText('Reader'),{target:{value:'reader-one'}});fireEvent.change(screen.getByLabelText('Recording and source'),{target:{value:'recording-one'}});act(()=>vi.advanceTimersByTime(250));fireEvent.change(screen.getByLabelText('Available chapter'),{target:{value:'1'}});act(()=>vi.advanceTimersByTime(250));expect(screen.getByRole('button',{name:'Create test video'})).toBeEnabled();enabledCalls.length=0;for(let surah=2;surah<=103;surah++)fireEvent.change(screen.getByLabelText('Available chapter'),{target:{value:String(surah)}});expect(screen.getByRole('button',{name:'Create test video'})).toBeDisabled();expect(enabledCalls.filter(path=>/\/choices\/recording-one\/\d+$/u.test(path))).toEqual([]);fireEvent.submit(screen.getByRole('button',{name:'Create test video'}).closest('form')!);expect(run).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(250));expect(new Set(enabledCalls.filter(path=>/\/choices\/recording-one\/\d+$/u.test(path)))).toEqual(new Set(['/render-lab/choices/recording-one/103']));expect(screen.getByRole('button',{name:'Create test video'})).toBeEnabled();});
});

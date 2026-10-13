import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {AdminContext} from '../../adminState';
import {AdminApiError} from '../../adminApi';
import RenderLabPage from './RenderLabPage';
const {run,enabledCalls,resourceStates,resourceRefetch}=vi.hoisted(()=>({run:vi.fn(),enabledCalls:[] as string[],resourceStates:new Map<string,{data?:unknown;isPending?:boolean;isFetching?:boolean;error?:Error}>(),resourceRefetch:new Map<string,ReturnType<typeof vi.fn>>()}));
vi.mock('../../useAdminResource',()=>({useAdminMutation:()=>({run,pending:false,error:null}),useAdminResource:(path:string,options?:{enabled?:boolean})=>{
 const enabled=options?.enabled!==false;if(enabled)enabledCalls.push(path);
 let data:unknown={items:[]};if(path==='/render-lab/choices')data={recitations:[{id:'recording-one',reciter_id:'reader-one',reciter_name_ar:'قارئ',display_label_ar:'تسجيل',provider:'actual',slug:'unit'}],max_duration_ms:90000,concurrency:1};
 else if(path==='/render-lab/choices/recording-one')data={chapters:Array.from({length:114},(_,i)=>({surah:i+1,name_ar:'سورة '+(i+1),ayah_count:10,available_runs:[[1,3]],availability_state:'complete'}))};
 else if(path.startsWith('/render-lab/choices/recording-one/'))data={surah:Number(path.split('/').at(-1)),available_runs:[[1,3]]};
 const state=resourceStates.get(path);if(!resourceRefetch.has(path))resourceRefetch.set(path,vi.fn());
 return {data:state?.isPending||state?.error?undefined:{data:state?.data??data},isPending:state?.isPending??false,isFetching:state?.isFetching??false,error:state?.error??null,refetch:resourceRefetch.get(path)};
}}));
const context={user:null,lang:'en' as const,setLang:()=>{},refreshUser:()=>{}};
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');enabledCalls.length=0;resourceStates.clear();resourceRefetch.clear();});
const selectedPath='/render-lab/jobs/actual-job',selectedJob={id:'actual-job',status:'succeeded',progress:100,artifact:{playPath:'/api/admin/render-lab/jobs/actual-job/media'}};
function Location(){return <output aria-label="Unit router location">{useLocation().search}</output>;}
const view=(job=true)=><AdminContext.Provider value={context}><MemoryRouter initialEntries={['/admin/render-lab'+(job?'?job_id=actual-job':'')]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><RenderLabPage/><Location/></MemoryRouter></AdminContext.Provider>;
describe('Render lab exact source admission',()=>{
 it('debounces ArrowDown-like rapid changes and rejects stale runs immediately',()=>{vi.useFakeTimers();render(<AdminContext.Provider value={context}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><RenderLabPage/></MemoryRouter></AdminContext.Provider>);fireEvent.change(screen.getByLabelText('Reader'),{target:{value:'reader-one'}});fireEvent.change(screen.getByLabelText('Recording and source'),{target:{value:'recording-one'}});act(()=>vi.advanceTimersByTime(250));fireEvent.change(screen.getByLabelText('Available chapter'),{target:{value:'1'}});act(()=>vi.advanceTimersByTime(250));expect(screen.getByRole('button',{name:'Create test video'})).toBeEnabled();enabledCalls.length=0;for(let surah=2;surah<=103;surah++)fireEvent.change(screen.getByLabelText('Available chapter'),{target:{value:String(surah)}});expect(screen.getByRole('button',{name:'Create test video'})).toBeDisabled();expect(enabledCalls.filter(path=>/\/choices\/recording-one\/\d+$/u.test(path))).toEqual([]);fireEvent.submit(screen.getByRole('button',{name:'Create test video'}).closest('form')!);expect(run).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(250));expect(new Set(enabledCalls.filter(path=>/\/choices\/recording-one\/\d+$/u.test(path)))).toEqual(new Set(['/render-lab/choices/recording-one/103']));expect(screen.getByRole('button',{name:'Create test video'})).toBeEnabled();});
 it('keeps the header and loading region stable until all three real query states resolve, then scrolls once',()=>{
  const frames:FrameRequestCallback[]=[],scroll=vi.fn();vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scroll});
  resourceStates.set('/render-lab/choices',{isPending:true});resourceStates.set('/render-lab/jobs',{isPending:true});resourceStates.set(selectedPath,{isPending:true});
  const rendered=render(view()),header=screen.getByRole('heading',{level:1,name:'Real video test'});
  expect(screen.getByRole('region',{name:'Loading render lab data'})).toHaveAttribute('aria-busy','true');expect(screen.queryByLabelText('Reader')).not.toBeInTheDocument();expect(scroll).not.toHaveBeenCalled();
  resourceStates.delete('/render-lab/choices');rendered.rerender(view());expect(screen.queryByRole('heading',{name:'Recent actual tests'})).not.toBeInTheDocument();
  const items=Array.from({length:20},(_,index)=>({id:'old-job-'+index,status:'succeeded',reciter_name_ar:'Unit reader '+index,display_label_ar:'Unit job',created_at:'2026-10-13',artifact_available:false}));
  resourceStates.set('/render-lab/jobs',{data:{items}});rendered.rerender(view());expect(screen.queryByLabelText('Generated test video')).not.toBeInTheDocument();expect(frames).toHaveLength(0);
  resourceStates.set(selectedPath,{data:selectedJob});rendered.rerender(view());expect(screen.getByRole('heading',{level:1,name:'Real video test'})).toBe(header);expect(screen.getAllByRole('button',{name:'Open test'})).toHaveLength(20);expect(screen.getByLabelText('Generated test video')).toHaveAttribute('src',selectedJob.artifact.playPath);expect(screen.getByLabelText('Unit router location')).toHaveTextContent('?job_id=actual-job');
  expect(frames).toHaveLength(1);act(()=>frames[0](0));expect(scroll).toHaveBeenCalledOnce();expect(scroll).toHaveBeenCalledWith({block:'start'});
  resourceStates.set('/render-lab/jobs',{data:{items},isFetching:true});rendered.rerender(view());expect(screen.getByLabelText('Generated test video')).toBeInTheDocument();expect(screen.queryByRole('region',{name:'Loading render lab data'})).not.toBeInTheDocument();
  resourceStates.set('/render-lab/jobs',{data:{items}});rendered.rerender(view());expect(frames).toHaveLength(1);expect(run).not.toHaveBeenCalled();
 });
 it('waits for an initial background refetch rather than scrolling to stale cached geometry',()=>{
  const frames:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  resourceStates.set(selectedPath,{data:selectedJob,isFetching:true});const rendered=render(view());expect(screen.getByRole('region',{name:'Loading render lab data'})).toBeInTheDocument();expect(frames).toHaveLength(0);
  resourceStates.set(selectedPath,{data:selectedJob});rendered.rerender(view());expect(screen.getByLabelText('Generated test video')).toBeInTheDocument();expect(frames).toHaveLength(1);
 });
 it('preserves polling while initial data is pending and stops it at a real terminal status',()=>{
  vi.useFakeTimers();resourceStates.set('/render-lab/jobs',{isPending:true});resourceStates.set(selectedPath,{isPending:true});const rendered=render(view());act(()=>vi.advanceTimersByTime(2500));expect(resourceRefetch.get(selectedPath)).toHaveBeenCalledOnce();
  resourceStates.set(selectedPath,{data:selectedJob});rendered.rerender(view());act(()=>vi.advanceTimersByTime(5000));expect(resourceRefetch.get(selectedPath)).toHaveBeenCalledOnce();expect(screen.getByRole('region',{name:'Loading render lab data'})).toBeInTheDocument();
 });
 it('keeps a failed selected GET explicit, retryable and attached to the same job ID',()=>{
  resourceStates.set(selectedPath,{error:new AdminApiError('Cannot read selected test job','ADMIN_JOB_READ_FAILED')});render(view());expect(screen.getByRole('alert')).toHaveTextContent('Cannot read selected test job');expect(screen.queryByLabelText('Generated test video')).not.toBeInTheDocument();expect(screen.getByLabelText('Unit router location')).toHaveTextContent('?job_id=actual-job');
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(resourceRefetch.get(selectedPath)).toHaveBeenCalledOnce();expect(run).not.toHaveBeenCalled();
 });
 it('does not request a missing job and still opens an actual listed job through the existing UI action',()=>{
  resourceStates.set('/render-lab/jobs',{data:{items:[{id:'actual-job',status:'succeeded',reciter_name_ar:'Unit reader',display_label_ar:'Unit job',created_at:'2026-10-13',artifact_available:true}]}});resourceStates.set(selectedPath,{data:selectedJob});render(view(false));expect(enabledCalls).not.toContain('/render-lab/jobs/');
  fireEvent.click(screen.getByRole('button',{name:'Open test'}));expect(screen.getByLabelText('Unit router location')).toHaveTextContent('?job_id=actual-job');expect(enabledCalls).toContain(selectedPath);expect(screen.getByLabelText('Generated test video')).toHaveAttribute('src',selectedJob.artifact.playPath);expect(run).not.toHaveBeenCalled();
 });
});

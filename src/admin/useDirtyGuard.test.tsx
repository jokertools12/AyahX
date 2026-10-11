import {afterEach,describe,it,expect,vi} from 'vitest';
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {BrowserRouter,useLocation} from 'react-router-dom';
import {useDirtyGuard} from './useDirtyGuard';
function Profile(){const [value,setValue]=useState('Original');useDirtyGuard(value!=='Original');return <input aria-label="Draft" value={value} onChange={event=>setValue(event.target.value)}/>;}
function Route(){const location=useLocation();return location.search==='?tab=profile'?<Profile/>:<p>Other tab</p>;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Dirty form with BrowserRouter popstate listeners',()=>{
 it('retains the same mounted input on denied back and restoration, and permits an approved back',()=>{
  window.history.replaceState({idx:1,key:'profile'},'', '/admin/reciters/local?tab=profile');
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),go=vi.spyOn(window.history,'go').mockImplementation(()=>{});
  render(<BrowserRouter><Route/></BrowserRouter>);
  const input=screen.getByLabelText('Draft');fireEvent.change(input,{target:{value:'Unsaved'}});
  act(()=>{window.history.replaceState({idx:0,key:'recitations'},'', '/admin/reciters/local?tab=recitations');window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));});
  expect(confirm).toHaveBeenCalledOnce();expect(go).toHaveBeenCalledWith(1);expect(screen.getByLabelText('Draft')).toBe(input);expect(input).toHaveValue('Unsaved');
  act(()=>{window.history.replaceState({idx:1,key:'profile'},'', '/admin/reciters/local?tab=profile');window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));});
  expect(confirm).toHaveBeenCalledOnce();expect(screen.getByLabelText('Draft')).toBe(input);expect(input).toHaveValue('Unsaved');
  confirm.mockReturnValue(true);
  act(()=>{window.history.replaceState({idx:0,key:'recitations'},'', '/admin/reciters/local?tab=recitations');window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));});
  expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument();expect(screen.getByText('Other tab')).toBeInTheDocument();
 });
});

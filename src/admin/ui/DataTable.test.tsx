import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {DataTable} from './DataTable';
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('DataTable loading layout',()=>{
 it('retains the named reorder actions and boundary disabling with decorative SVG arrows',()=>{
  const move=vi.fn();render(<DataTable rows={[{id:'reader-1',label:'First'},{id:'reader-2',label:'Second'}]} columns={[{key:'label',label:'Reader'}]} caption="Readers" lang="en" onReorder={move}/>);
  const firstUp=screen.getAllByRole('button',{name:'Move up reader-1'})[0],firstDown=screen.getAllByRole('button',{name:'Move down reader-1'})[0];
  expect(firstUp).toBeDisabled();expect(firstDown).toBeEnabled();expect(firstDown.querySelector('svg')).toHaveAttribute('aria-hidden','true');expect(firstDown.textContent).toBe('');
  fireEvent.click(firstDown);expect(move).toHaveBeenCalledWith('reader-1','reader-2');expect(screen.getAllByRole('button',{name:'Move down reader-2'})[0]).toBeDisabled();
 });
 it('keeps the same toolbar mounted while reserving the table viewport',()=>{const props={columns:[{key:'label',label:'Name'}],caption:'Readers',lang:'en' as const};const view=render(<DataTable rows={[]} {...props} loading/>);const viewName=screen.getByRole('textbox',{name:'Saved view name'});expect(view.container.querySelector('[aria-busy=true]')).toBeInTheDocument();expect(view.container.querySelector('.admin-table-placeholder')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Export results CSV'})).toBeDisabled();view.rerender(<DataTable rows={[{id:'reader-1',label:'Reader'}]} {...props}/>);expect(screen.getByRole('textbox',{name:'Saved view name'})).toBe(viewName);expect(view.container.querySelector('.admin-table-placeholder')).not.toBeInTheDocument();expect(screen.getByRole('table')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Export results CSV'})).toBeEnabled();});
});

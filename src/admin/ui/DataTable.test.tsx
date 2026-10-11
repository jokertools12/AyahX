import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {DataTable} from './DataTable';
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('DataTable loading layout',()=>{
 it('keeps the same toolbar mounted while reserving the table viewport',()=>{const props={columns:[{key:'label',label:'Name'}],caption:'Readers',lang:'en' as const};const view=render(<DataTable rows={[]} {...props} loading/>);const viewName=screen.getByRole('textbox',{name:'Saved view name'});expect(view.container.querySelector('[aria-busy=true]')).toBeInTheDocument();expect(view.container.querySelector('.admin-table-placeholder')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Export results CSV'})).toBeDisabled();view.rerender(<DataTable rows={[{id:'reader-1',label:'Reader'}]} {...props}/>);expect(screen.getByRole('textbox',{name:'Saved view name'})).toBe(viewName);expect(view.container.querySelector('.admin-table-placeholder')).not.toBeInTheDocument();expect(screen.getByRole('table')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Export results CSV'})).toBeEnabled();});
});

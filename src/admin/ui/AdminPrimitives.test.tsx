import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {AdminContext} from '../adminState';
import {EmptyState,ErrorState,LoadingState,CodeBlock,ConfirmDialog} from './AdminPrimitives';
const english={user:null,lang:'en' as const,setLang:()=>{},refreshUser:()=>{}};
afterEach(cleanup);
describe('Shared admin language and confirmations',()=>{
 it('renders shared empty, loading, error, and copy controls from the English context',()=>{render(<AdminContext.Provider value={english}><EmptyState/><LoadingState/><ErrorState error={{message:'Explicit failure',requestId:'unit-request'}} onRetry={()=>{}}/><CodeBlock value={{id:1}} label="Evidence"/></AdminContext.Provider>);expect(screen.getByText('No matching results')).toBeInTheDocument();expect(screen.getByRole('status',{name:'Loading'})).toBeInTheDocument();expect(screen.getByRole('button',{name:/Copy request ID/})).toBeInTheDocument();expect(screen.getByRole('button',{name:/Retry/})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Copy Evidence'})).toBeInTheDocument();});
 it('requires a new typed confirmation each time a dialog opens',()=>{const change=vi.fn(),confirm=vi.fn(),dialog=(open:boolean)=><AdminContext.Provider value={english}><ConfirmDialog open={open} onOpenChange={change} expected="reader_slug" title="Confirm change" impact="Saved configuration changes" onConfirm={confirm}/></AdminContext.Provider>;const view=render(dialog(true));fireEvent.change(screen.getByLabelText('Type reader_slug to confirm'),{target:{value:'reader_slug'}});expect(screen.getByRole('button',{name:'Confirm'})).toBeEnabled();view.rerender(dialog(false));view.rerender(dialog(true));expect(screen.getByLabelText('Type reader_slug to confirm')).toHaveValue('');expect(screen.getByRole('button',{name:'Confirm'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeInTheDocument();});
});

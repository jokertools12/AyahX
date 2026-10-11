import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {AdminContext} from '../../adminState';
import {type CatalogRecitation} from './catalogTypes';
import RecitationActions from './RecitationActions';
import ReciterAudit from './ReciterAudit';
const mocks=vi.hoisted(()=>({permissions:new Set<string>(),resource:vi.fn(),write:vi.fn()}));
vi.mock('./catalogHooks',()=>({usePermission:(key:string)=>mocks.permissions.has(key),useCatalogResource:()=>({refetch:()=>{},data:null}),useCatalogWrite:()=>({write:mocks.write,pending:false,error:null})}));
vi.mock('../../useAdminResource',()=>({useAdminResource:(path:string)=>{mocks.resource(path);return {isPending:false,error:null,data:{data:[]}};}}));
const context={user:null,lang:'en' as const,setLang:()=>{},refreshUser:()=>{}};
const row={id:'local-recitation',slug:'local-recitation',is_public:false,is_default_for_reciter:false,visibility_reasons:[]} as unknown as CatalogRecitation;
function actions(){return render(<BrowserRouter><AdminContext.Provider value={context}><RecitationActions row={row}/></AdminContext.Provider></BrowserRouter>);}
afterEach(()=>{cleanup();mocks.permissions.clear();vi.clearAllMocks();});
describe('Catalog controls match their API permissions',()=>{
 it('does not offer a link check to a presentation-only editor',()=>{mocks.permissions.add('recitations.write');actions();expect(screen.getByRole('button',{name:'Set reader default'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Recalculate availability'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Check links'})).not.toBeInTheDocument();});
 it('offers link checking to a source editor without presenting unrelated recitation writes',()=>{mocks.permissions.add('sources.write');actions();expect(screen.getByRole('button',{name:'Check links'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Recalculate availability'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Set reader default'})).not.toBeInTheDocument();});
 it('uses the accepted audit query keys to scope a reader history',()=>{render(<ReciterAudit id="reader-test-id"/>);expect(mocks.resource).toHaveBeenCalledWith('/audit?entityType=reciter&entityId=reader-test-id&limit=100');});
});

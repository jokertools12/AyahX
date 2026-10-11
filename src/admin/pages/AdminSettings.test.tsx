import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {AdminContext} from '../adminState';
import {type AdminUser} from '../adminApi';
import AdminSettings from './AdminSettings';
const mocks=vi.hoisted(()=>({resource:vi.fn(),run:vi.fn()}));
vi.mock('../useAdminResource',()=>({useAdminResource:(...args:unknown[])=>mocks.resource(...args),useAdminMutation:()=>({run:mocks.run,pending:false,error:null})}));
const setting={key:'OPENAI_API_KEY',type:'string',group:'ai',description:'Provider credential',default:null,value:null,validator:{maxLength:8192},isSecret:true,isSet:true,masked:'••••••••',readOnly:false,consumer:['server/services/aiService.ts:getAiConfig']};
function mount(permissions:string[]){const user:AdminUser={id:'test-admin',email:'test@example.invalid',displayName:null,roles:['super_admin'],permissions,sessionId:'test-session',environment:'local',totp:{enabled:false,required:false,encryptionConfigured:true}};mocks.resource.mockImplementation((path:string)=>({isPending:false,error:null,data:{data:path==='/settings'?[setting]:[],meta:{requestId:'test-request'}}}));return render(<BrowserRouter><AdminContext.Provider value={{user,lang:'en',setLang:()=>{},refreshUser:()=>{}}}><AdminSettings/></AdminContext.Provider></BrowserRouter>);}
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('Runtime settings secrets',()=>{
 it('keeps a stored secret masked and the editable replacement blank, then clears the replacement after a successful write',async()=>{mocks.run.mockResolvedValue({data:setting});mount(['settings.read','settings.write']);const input=screen.getByLabelText('New secret value');expect(input).toHaveAttribute('type','password');expect(input).toHaveValue('');expect(screen.getByText(/Stored value is secret/)).toHaveTextContent('••••••••');expect(screen.getByRole('button',{name:'Save'})).toBeDisabled();fireEvent.change(input,{target:{value:'test-only-replacement'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mocks.run).toHaveBeenCalledWith('/settings/OPENAI_API_KEY','PATCH',{value:'test-only-replacement'}));await waitFor(()=>expect(input).toHaveValue(''));expect(screen.getByRole('button',{name:'Save'})).toBeDisabled();});
 it('disables the flag query without flags.read and offers no secret editor without write permission',()=>{mount(['settings.read']);expect(mocks.resource).toHaveBeenCalledWith('/flags',{enabled:false});expect(screen.queryByLabelText('New secret value')).not.toBeInTheDocument();expect(screen.getByText('You do not have permission to change this setting.')).toBeInTheDocument();});
});

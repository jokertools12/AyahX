import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AdminContext} from '../../adminState';
import ChapterMissingWords from './ChapterMissingWords';
const {read}=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../../adminApi',()=>({adminApi:read}));
const show=(value:unknown)=>render(<AdminContext.Provider value={{user:null,lang:'en',setLang:()=>{},refreshUser:()=>{}}}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ChapterMissingWords value={value} recitationId="unit-recording" surah={4}/></QueryClientProvider></AdminContext.Provider>);
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('Actual canonical missing words',()=>{
 it('reads only the affected verse and renders its linked stored Quran word',async()=>{read.mockResolvedValue({data:[{ayah:3,legal_words:[{position:2,text_uthmani:'ٱللَّهِ'}]}]});show([{ayah:3,words:[[2,'NO_VALID_MAPPED_SOURCE_INTERVAL']]}]);await waitFor(()=>expect(screen.getByText('ٱللَّهِ')).toBeInTheDocument());expect(read).toHaveBeenCalledWith('/catalog/timings?recitation_id=unit-recording&surah=4&from=3&to=3&limit=1');expect(screen.getByText('No valid source interval maps to this word')).toBeInTheDocument();});
 it('announces unavailable canonical text without borrowing another source',async()=>{read.mockResolvedValue({data:[{ayah:3,legal_words:[]}]});show([{ayah:3,words:[[2,'NO_VALID_MAPPED_SOURCE_INTERVAL']]}]);await waitFor(()=>expect(screen.getByText(/Text from another riwayah is never borrowed/)).toBeInTheDocument());expect(read).toHaveBeenCalledTimes(1);});
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LibraryPage from '@/pages/LibraryPage';

const f=vi.hoisted(()=>({user:{id:'fixture-user'},getMy:vi.fn(),remove:vi.fn().mockResolvedValue({}),duplicate:vi.fn(),update:vi.fn(),download:vi.fn().mockResolvedValue(undefined),navigate:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.user,isAuthenticated:true,loading:false})}));
vi.mock('@/lib/api',()=>({api:{videos:{getMy:f.getMy,delete:f.remove,duplicate:f.duplicate,update:f.update}}}));
vi.mock('@/lib/download',()=>({downloadSavedVideo:f.download}));
vi.mock('@/components/Layout',()=>({Layout:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock('react-router-dom',async(importOriginal)=>({...await importOriginal<typeof import('react-router-dom')>(),useNavigate:()=>f.navigate}));
const video={id:'fixture-video',surah_name:'الفاتحة',surah_number:1,reciter_id:'mishary_alafasy',reciter_name:'مشاري العفاسي',start_ayah:1,end_ayah:3,aspect_ratio:'9:16',background_type:'image',created_at:'2026-01-01T00:00:00Z',video_url:'/fixture.mp4'};
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function mount(overrides={}) {f.getMy.mockResolvedValue([{...video,...overrides}]);render(<MemoryRouter><LibraryPage/></MemoryRouter>);await screen.findByRole('button',{name:'معاينة سورة الفاتحة'});}
function expand() {fireEvent.click(screen.getByText('إجراءات الفيديو',{selector:'summary span.block'}));}
describe('library relocated actions',()=>{
  it('keeps download and preview direct, with unchanged destinations',async()=>{
    await mount();
    fireEvent.click(screen.getByRole('button',{name:'تحميل الفيديو مباشرة (MP4)'}));
    await waitFor(()=>expect(f.download).toHaveBeenCalledWith('/fixture.mp4','quran_1.mp4'));
    fireEvent.click(screen.getByRole('button',{name:'معاينة سورة الفاتحة'}));
    expect(f.navigate).toHaveBeenCalledWith('/preview?surah=1&reciter=mishary_alafasy&start=1&end=3&backgroundType=image&ratio=9%3A16');
    expand();
    fireEvent.click(screen.getByRole('button',{name:'فتح'}));
    fireEvent.click(screen.getByRole('button',{name:'إعادة إنشاء'}));
    expect(f.navigate).toHaveBeenCalledTimes(3);
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('keeps duplicate and delete wired to the original video id',async()=>{
    await mount();
    f.duplicate.mockResolvedValue({...video,id:'duplicate',surah_name:'نسخة'});
    expand();
    fireEvent.click(screen.getByRole('button',{name:'تكرار مشروع الفاتحة'}));
    await screen.findByRole('button',{name:'معاينة سورة نسخة'});
    expect(f.duplicate).toHaveBeenCalledWith('fixture-video');
    fireEvent.click(screen.getByRole('button',{name:'حذف فيديو سورة الفاتحة'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'معاينة سورة الفاتحة'})).not.toBeInTheDocument());
    expect(f.remove).toHaveBeenCalledWith('fixture-video');
    expect(screen.getByRole('button',{name:'معاينة سورة نسخة'})).toBeInTheDocument();
  });
  it('preserves expired-download replacement without hiding recreation',async()=>{
    await mount({expires_at:'2020-01-01T00:00:00Z'});
    expect(screen.queryByRole('button',{name:'تحميل الفيديو مباشرة (MP4)'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'إعادة إنشاء وتحميل فوري'}));
    expect(f.navigate).toHaveBeenCalledTimes(1);
    expect(f.download).not.toHaveBeenCalled();
  });
});

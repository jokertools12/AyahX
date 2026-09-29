import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserSettingsPage from '@/pages/UserSettingsPage';

const fixtures = vi.hoisted(()=>({
  user:{email:'ui-test@example.invalid',display_name:'اسم تجريبي',bio:'نبذة تجريبية',avatar_url:null},
  premium:false,
  updateProfile:vi.fn().mockResolvedValue({}),
  changePassword:vi.fn().mockResolvedValue({}),
  deleteAccount:vi.fn().mockResolvedValue({}),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:fixtures.user,isAuthenticated:true,loading:false})}));
vi.mock('@/hooks/useSubscription',()=>({useSubscription:()=>({
  subscription:null,isPremium:fixtures.premium,
  dailyUsage:{browserRenderLimit:fixtures.premium?null:5,browserRenderCount:1,browserRenderRemaining:4},
  entitlements:{ffmpegAssDailyLimit:1,skiaCanvasDailyLimit:2,backgroundAsyncDailyLimit:0},
})}));
vi.mock('@/lib/api',()=>({api:{auth:fixtures}}));
vi.mock('@/components/Layout',()=>({Layout:({children}:{children:React.ReactNode})=><main>{children}</main>}));
afterEach(()=>{cleanup();fixtures.premium=false;vi.clearAllMocks();});
function toggle(text:string) {fireEvent.click(screen.getByText(text,{selector:'summary span.block'}));}

describe('account settings disclosure',()=>{
  it('provides working navigation to each settings section',()=>{
    render(<MemoryRouter><UserSettingsPage/></MemoryRouter>);
    const nav=screen.getByRole('navigation',{name:'أقسام الإعدادات'});
    const links=Array.from(nav.querySelectorAll('a[href^="#settings-"]'));
    expect(links).toHaveLength(6);
    for(const link of links){
      const target=link.getAttribute('href')?.slice(1);
      expect(target).toBeTruthy();
      expect(document.getElementById(target!)).toBeInTheDocument();
    }
  });

  it.each([false,true])('keeps profile, password, usage and deletion accessible, premium=%s',async(premium)=>{
    fixtures.premium=premium;
    render(<MemoryRouter><UserSettingsPage/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('الاسم'),{target:{value:'اسم معدل'}});
    toggle('تغيير كلمة المرور');
    fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'),{target:{value:'fixture-only-old'}});
    fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'),{target:{value:'fixture-only-new'}});
    toggle('تغيير كلمة المرور'); toggle('تغيير كلمة المرور');
    expect(screen.getByLabelText('كلمة المرور الحالية')).toHaveValue('fixture-only-old');
    expect(screen.getByLabelText('كلمة المرور الجديدة')).toHaveValue('fixture-only-new');
    expect(screen.getByLabelText('الاسم')).toHaveValue('اسم معدل');
    toggle('تفاصيل الاستخدام');
    for(const label of ['التسجيل على جهازك','الإنتاج السحابي — FFmpeg','الإنتاج السحابي — Skia','الإنتاج السحابي — المتصفح']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'سجل المدفوعات'})).toHaveAttribute('href','/payment-history');
    toggle('حذف الحساب');
    fireEvent.click(screen.getByRole('button',{name:'حذف الحساب وجميع البيانات نهائياً'}));
    expect(screen.getByRole('button',{name:'تأكيد الحذف النهائي'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'إلغاء'}));
    expect(fixtures.deleteAccount).not.toHaveBeenCalled();
    expect(fixtures.changePassword).not.toHaveBeenCalled();
    expect(fixtures.updateProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'حفظ'}));
    await waitFor(()=>expect(fixtures.updateProfile).toHaveBeenCalledWith({display_name:'اسم معدل',bio:'نبذة تجريبية'}));
  });
});

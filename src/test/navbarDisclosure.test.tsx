import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Navbar } from '@/components/Navbar';

const auth = vi.hoisted(() => ({ authenticated: false, admin: false, signOut: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: auth.authenticated, user: auth.authenticated ? { email: 'ui-test@example.invalid', role: auth.admin ? 'admin' : 'user' } : null, signOut: auth.signOut }) }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/UsageQuotaBar', () => ({ UsageQuotaBar: () => null }));
afterEach(() => { cleanup(); auth.authenticated = false; auth.admin = false; vi.clearAllMocks(); });
function openMobile() {
  fireEvent.click(screen.getByRole('button', { name: 'فتح قائمة التنقل' }));
  return within(document.getElementById('mobile-navigation')!);
}

describe('navigation disclosure retains route access', () => {
  it('keeps every public destination in the mobile menu and closes on navigation', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    const menu = openMobile();
    expect(menu.getAllByRole('link').map(a=>a.getAttribute('href'))).toEqual(['/create', '/surahs', '/ibtahalat', '/pricing', '/discover', '/leaderboard']);
    expect(menu.queryByRole('link', {name:'لوحة التحكم'})).not.toBeInTheDocument();
    fireEvent.click(menu.getByRole('link', {name:'اكتشف'}));
    expect(screen.getByRole('button', {name:'فتح قائمة التنقل'})).toHaveAttribute('aria-expanded','false');
  });

  it.each([false,true])('preserves account routes without the removed dashboard: admin=%s', (admin) => {
    auth.authenticated = true; auth.admin = admin;
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    const menu = openMobile();
    for (const name of ['مكتبتي','الإعدادات','إحصائياتي','المفضلة','نشاط المتابَعين','الإنجازات']) expect(menu.getByRole('link',{name})).toBeInTheDocument();
    expect(menu.queryByRole('link',{name:'لوحة التحكم'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'الحساب والإعدادات'})).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, PanelLeftClose, Search, Sun, Moon, Languages, LogOut, HelpCircle, SlidersHorizontal } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, ErrorState } from './ui/AdminPrimitives';
import { useAdmin, useText } from './adminState';
import { adminGroups, adminNavigation } from './adminNavigation';
import { adminWrite } from './adminApi';
import { allowAdminNavigation } from './adminDirtyState';
import { useAdminMutation, useAdminResource } from './useAdminResource';
import { termLabel } from './i18n/terms';
import type { AdminPreferences } from '../../shared/admin/batch5';

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, lang, setLang, refreshUser } = useAdmin(), t = useText(), location = useLocation(), navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false), [mobile, setMobile] = useState(false), [palette, setPalette] = useState(false), [help, setHelp] = useState(false), [display, setDisplay] = useState(false), [search, setSearch] = useState('');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const preferences = useAdminResource<AdminPreferences>('/preferences'), mutation = useAdminMutation();
  const density = preferences.data?.data.density ?? 'comfortable', scale = preferences.data?.data.font_scale ?? 1;
  const sequence = useRef(0), items = adminNavigation.filter(n => user?.permissions.includes(n.permission));
  const current = items.find(n => n.path === location.pathname) ?? items.find(n => n.path !== '/admin' && location.pathname.startsWith(n.path + '/'));
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--admin-font-scale', String(scale)); root.dataset.adminDensity = density;
    return () => { root.style.removeProperty('--admin-font-scale'); delete root.dataset.adminDensity; };
  }, [density, scale]);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (anchor instanceof HTMLAnchorElement && anchor.origin === window.location.origin && (anchor.pathname !== location.pathname || anchor.search !== location.search) && !allowAdminNavigation()) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', handler, true); return () => document.removeEventListener('click', handler, true);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (((e.ctrlKey || e.metaKey) && e.key === 'k') || e.key === '/') { e.preventDefault(); setPalette(true); }
      else if (e.key === '?') setHelp(true);
      else if (e.key === 'g') sequence.current = Date.now();
      else if (Date.now() - sequence.current < 1200) { const item = adminNavigation.find(n => n.key === e.key && user?.permissions.includes(n.permission)); if (item) { e.preventDefault(); if (allowAdminNavigation()) navigate(item.path); } sequence.current = 0; }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [navigate, user]);
  const navigation = (drawer = false) => <nav aria-label={t('أقسام الإدارة', 'Administration sections')} className="admin-nav">
    <Link to="/admin" className="admin-brand" aria-label={t('AyahX — ابدأ من هنا', 'AyahX — start here')} title={t('AyahX — ابدأ من هنا', 'AyahX — start here')}><BrandLogo variant={collapsed && !drawer ? 'symbol' : 'horizontal'} className={collapsed && !drawer ? 'w-10' : 'w-40'} decorative priority /></Link>
    {adminGroups.map(group => {
      const links = items.filter(item => item.group === group.id); if (!links.length) return null;
      return <section key={group.id} className="admin-nav-group" aria-label={t(group.ar, group.en)}>{(!collapsed || drawer) && <p className="admin-nav-label admin-secondary">{t(group.ar, group.en)}</p>}{links.map(item => <NavLink end={item.path === '/admin'} key={item.path} to={item.path} onClick={() => setMobile(false)} title={t(item.ar, item.en)} aria-label={t(item.ar, item.en)}><item.icon size={20} aria-hidden="true" />{(!collapsed || drawer) && <span>{t(item.ar, item.en)}</span>}</NavLink>)}</section>;
    })}
    {user?.environment === 'local' && user.roles.includes('super_admin') && <NavLink to="/admin/_kit" title={t('مكتبة المكونات', 'UI kit')}>{collapsed && !drawer ? 'UI' : t('مكتبة المكونات', 'UI kit')}</NavLink>}
  </nav>;
  const icon = (label: string, child: ReactNode, action: () => void, extra = '') => <Button variant="ghost" className={'admin-icon-control ' + extra} aria-label={label} title={label} onClick={action}>{child}</Button>;
  const saveDisplay = (next: AdminPreferences) => void mutation.run('/preferences', 'PATCH', next);
  return <div className={`admin-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <a href="#admin-main" className="admin-skip">{t('تجاوز إلى المحتوى', 'Skip to content')}</a>
    <aside className="admin-sidebar">{navigation()}<Button variant="outline" className="admin-sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={t('طي القائمة', 'Collapse sidebar')} title={t('طي القائمة', 'Collapse sidebar')} aria-expanded={!collapsed}><PanelLeftClose size={20} aria-hidden="true" />{!collapsed && t('طي القائمة', 'Collapse sidebar')}</Button></aside>
    <div className="admin-workspace"><header className="admin-topbar">
      <Button variant="ghost" className="admin-icon-control admin-mobile-menu" data-admin-visual-open="mobile-nav" aria-label={t('فتح القائمة','Open menu')} title={t('فتح القائمة','Open menu')} onClick={()=>setMobile(true)}><Menu size={20} aria-hidden="true"/></Button>
      <Button variant="outline" className="admin-search-trigger" data-admin-visual-open="quick-search" aria-label={t('البحث السريع', 'Quick search')} title={t('البحث السريع', 'Quick search')} onClick={() => setPalette(true)}><Search size={20} aria-hidden="true" /><span>{t('ابحث عن صفحة…', 'Find a page…')}</span><kbd className="admin-secondary">⌘ K</kbd></Button>
      <span className="admin-environment admin-chip" title={t('البيئة التي تعمل عليها الآن', 'Your current environment')}>{termLabel(user?.environment ?? 'unknown', lang)}</span><div className="admin-topbar-spacer" />
      <Button variant="ghost" className="admin-icon-control" data-admin-visual-open="reading-preferences" aria-label={t('تفضيلات القراءة','Reading preferences')} title={t('تفضيلات القراءة','Reading preferences')} onClick={()=>setDisplay(true)}><SlidersHorizontal size={20} aria-hidden="true"/></Button>
      {icon(t('تبديل المظهر', 'Toggle theme'), dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />, () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('theme', next ? 'dark' : 'light'); })}
      <Button variant="ghost" className="admin-icon-control" aria-label={t('تغيير اللغة', 'Change language') + ' ' + (lang === 'ar' ? 'EN' : 'ع')} title={t('تغيير اللغة', 'Change language')} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}><Languages size={20} aria-hidden="true" /><span>{lang === 'ar' ? 'EN' : 'ع'}</span></Button>
      <Button variant="ghost" className="admin-icon-control admin-desktop-label" data-admin-visual-open="keyboard-help" aria-label={t('المساعدة والاختصارات','Help and shortcuts')} title={t('المساعدة والاختصارات','Help and shortcuts')} onClick={()=>setHelp(true)}><HelpCircle size={20} aria-hidden="true"/></Button>
      {icon(t('تسجيل الخروج', 'Sign out'), <LogOut size={20} aria-hidden="true" />, () => { void adminWrite('/auth/logout', 'POST', {}).then(refreshUser).catch(error => setSignOutError(error instanceof Error ? error : new Error(t('تعذر تسجيل الخروج. أعد المحاولة.', 'Sign out failed. Please retry.')))); })}
    </header>
    <main id="admin-main" tabIndex={-1} className="admin-main admin-stack"><nav aria-label={t('مسار الصفحة', 'Breadcrumb')} className="admin-breadcrumb admin-muted"><Link to="/admin">{t('الإدارة', 'Administration')}</Link><span aria-hidden="true">/</span><span>{current ? t(current.ar, current.en) : t('تفاصيل', 'Details')}</span></nav>{signOutError && <ErrorState error={signOutError} />}{children}</main></div>
    <Drawer open={mobile} onOpenChange={setMobile}><DrawerContent data-admin-visual-dialog="mobile-nav" className="admin-navigation-drawer" side={lang === 'ar' ? 'right' : 'left'}><DrawerHeader><DrawerTitle>{t('لوحة AyahX', 'AyahX administration')}</DrawerTitle><DrawerDescription>{t('اختر مهمتك من الأقسام', 'Choose your task from the sections')}</DrawerDescription></DrawerHeader>{navigation(true)}</DrawerContent></Drawer>
    <Dialog open={palette} onOpenChange={setPalette}><DialogContent data-admin-visual-dialog="quick-search" className="admin-dialog"><DialogHeader><DialogTitle>{t('البحث السريع', 'Quick search')}</DialogTitle><DialogDescription>{t('ابحث عن الصفحة باسم المهمة التي تريدها', 'Find a page by the task you want to do')}</DialogDescription></DialogHeader><Input aria-label={t('ابحث عن صفحة', 'Search pages')} autoFocus value={search} onChange={e => setSearch(e.target.value)} /><div className="admin-command-results">{items.filter(n => (n.ar + ' ' + n.en).toLowerCase().includes(search.toLowerCase())).map(n => <Button variant="ghost" key={n.path} onClick={() => { if (allowAdminNavigation()) { navigate(n.path); setPalette(false); } }}><n.icon size={20} aria-hidden="true" />{t(n.ar, n.en)}</Button>)}</div></DialogContent></Dialog>
    <Dialog open={display} onOpenChange={setDisplay}><DialogContent data-admin-visual-dialog="reading-preferences" className="admin-dialog"><DialogHeader><DialogTitle>{t('تفضيلات القراءة', 'Reading preferences')}</DialogTitle><DialogDescription>{t('تُحفظ لحسابك وتُطبّق على كل صفحات الإدارة', 'Saved to your account and applied to every admin page')}</DialogDescription></DialogHeader>{preferences.error && <ErrorState error={preferences.error} onRetry={() => void preferences.refetch()} />}<fieldset className="admin-stack"><legend>{t('كثافة الجداول', 'Table density')}</legend><div className="admin-row">{(['comfortable', 'compact'] as const).map(value => <Button key={value} variant={density === value ? 'default' : 'outline'} aria-pressed={density === value} disabled={mutation.pending} onClick={() => saveDisplay({ density: value, font_scale: scale })}>{value === 'comfortable' ? t('مريح', 'Comfortable') : t('مضغوط', 'Compact')}</Button>)}</div></fieldset><fieldset className="admin-stack"><legend>{t('حجم الخط', 'Font size')}</legend><div className="admin-row">{([1, 1.1, 1.2] as const).map((value, i) => <Button key={value} variant={scale === value ? 'default' : 'outline'} aria-pressed={scale === value} disabled={mutation.pending} onClick={() => saveDisplay({ density, font_scale: value })}>{['أ− / A−', 'أ / A', 'أ+ / A+'][i]}</Button>)}</div></fieldset>{mutation.error && <ErrorState error={mutation.error} />}</DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent data-admin-visual-dialog="keyboard-help" className="admin-dialog"><DialogHeader><DialogTitle>{t('المساعدة والاختصارات', 'Help and shortcuts')}</DialogTitle><DialogDescription>{t('افتح الدليل أو انتقل سريعًا بين المهمات', 'Open the guide or navigate between tasks')}</DialogDescription></DialogHeader><Button asChild><Link to="/admin/help" onClick={() => setHelp(false)}>{t('فتح دليل الاستخدام', 'Open usage guide')}</Link></Button><p>/ · Ctrl+K: {t('البحث', 'Search')} · ?: {t('المساعدة', 'Help')}</p><div className="admin-command-results">{items.map(n => <p key={n.path}><kbd dir="ltr">g {n.key}</kbd> — {t(n.ar, n.en)}</p>)}</div></DialogContent></Dialog>
  </div>;
}

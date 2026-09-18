import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { BookOpen, Video, Library, LogIn, LogOut, User, Music, Menu, X, Crown, Settings, Shield, CreditCard, BarChart3, Trophy, Compass, Heart, Activity } from 'lucide-react';
import { useAdmin } from '@/hooks/useAdmin';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { UsageQuotaBar } from '@/components/UsageQuotaBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navLinks = [
  { to: '/create', label: 'إنشاء فيديو', icon: Video },
  { to: '/surahs', label: 'تصفح السور', icon: BookOpen },
  { to: '/ibtahalat', label: 'تصفح الابتهالات', icon: Music },
  { to: '/pricing', label: 'الأسعار', icon: Crown },
  { to: '/discover', label: 'اكتشف', icon: Compass },
  { to: '/leaderboard', label: 'المتصدرين', icon: Trophy },
];

export function Navbar() {
  const { user, signOut, isAuthenticated } = useAuth();
  const { isAdmin } = useAdmin();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="sticky top-0 z-50 glass border-b border-border/50"
    >
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <BookOpen className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold gradient-text">قرآن ريلز</span>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Button key={link.to} asChild variant="ghost" size="sm" className="gap-2">
                <Link to={link.to}>
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              </Button>
            ))}
            {isAuthenticated && (
              <Button asChild variant="ghost" size="sm" className="gap-2">
                <Link to="/library">
                  <Library className="h-4 w-4" />
                  مكتبتي
                </Link>
              </Button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <div className="hidden sm:block">
              <UsageQuotaBar />
            </div>
            <NotificationBell />
            <ThemeToggle />

            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem className="text-muted-foreground text-sm">
                    {user?.email}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/library" className="flex items-center gap-2">
                      <Library className="h-4 w-4" />
                      <span>مكتبتي</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      <span>الإعدادات</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/payment-history" className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      <span>سجل المدفوعات</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/my-stats" className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      <span>إحصائياتي</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/achievements" className="flex items-center gap-2">
                      <Trophy className="h-4 w-4" />
                      <span>الإنجازات</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/activity" className="flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      <span>نشاط المتابَعين</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/favorites" className="flex items-center gap-2">
                      <Heart className="h-4 w-4" />
                      <span>المفضلة</span>
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link to="/admin" className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        <span>لوحة التحكم</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="h-4 w-4 ml-2" />
                    <span>تسجيل الخروج</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild variant="default" size="sm">
                <Link to="/auth" className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  <span className="hidden sm:inline">تسجيل الدخول</span>
                </Link>
              </Button>
            )}

            {/* Mobile Menu Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden overflow-hidden border-t border-border/50"
            >
              <div className="py-3 space-y-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <link.icon className="h-5 w-5 text-primary" />
                    <span className="font-medium">{link.label}</span>
                  </Link>
                ))}
                {isAuthenticated && (
                  <>
                    <Link
                      to="/library"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Library className="h-5 w-5 text-primary" />
                      <span className="font-medium">مكتبتي</span>
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Settings className="h-5 w-5 text-primary" />
                      <span className="font-medium">الإعدادات</span>
                    </Link>
                    <Link
                      to="/my-stats"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <BarChart3 className="h-5 w-5 text-primary" />
                      <span className="font-medium">إحصائياتي</span>
                    </Link>
                    <Link
                      to="/favorites"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Heart className="h-5 w-5 text-primary" />
                      <span className="font-medium">المفضلة</span>
                    </Link>
                    <Link
                      to="/activity"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Activity className="h-5 w-5 text-primary" />
                      <span className="font-medium">نشاط المتابَعين</span>
                    </Link>
                    <Link
                      to="/achievements"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Trophy className="h-5 w-5 text-primary" />
                      <span className="font-medium">الإنجازات</span>
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Shield className="h-5 w-5 text-primary" />
                        <span className="font-medium">لوحة التحكم</span>
                      </Link>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  );
}

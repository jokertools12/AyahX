import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, Info, CheckCircle, Crown, Award, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { api, NotificationItem } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { startActivePolling } from '@/lib/activePolling';
import { notificationTimeAgo } from '@/lib/notificationTime';

type Notification = NotificationItem;

const typeIcons: Record<string, { icon: typeof Bell; color: string }> = {
  system: { icon: Info, color: 'text-blue-500' },
  subscription: { icon: Crown, color: 'text-yellow-500' },
  achievement: { icon: Award, color: 'text-purple-500' },
  video: { icon: CheckCircle, color: 'text-green-500' },
  social: { icon: Heart, color: 'text-rose-500' },
};

const typeIcon = (type: string) => {
  const config = typeIcons[type] || { icon: Info, color: 'text-primary' };
  const Icon = config.icon;
  return <Icon className={`h-4 w-4 ${config.color} shrink-0`} />;
};

export function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const fetching = useRef(false);
  const offset = useRef(0);
  const pageSize = 30;

  const fetchNotifications = async (append = false) => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    setError('');
    try {
      const data = await api.social.getNotifications(append ? offset.current : 0, pageSize);
      offset.current = (append ? offset.current : 0) + data.length;
      setHasMore(data.length === pageSize);
      setNotifications(prev => append ? [...prev, ...data.filter(n => !prev.some(p => p.id === n.id))] : data);
    } catch {
      setError('تعذر تحميل الإشعارات. حاول مرة أخرى.');
    } finally { fetching.current = false; setLoading(false); }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    if (!user) return;

    // Preserve loaded history while the list is open; opening explicitly refreshes it.
    if (open) return;
    return startActivePolling(() => { void fetchNotifications(); }, 120000, 60000);
  }, [user?.id, open]);

  const markAsRead = async (id: string) => {
    try {
      await api.social.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (e) {
      setError('تعذر تحديث الإشعار. حاول مرة أخرى.');
    }
  };

  const markAllRead = async () => {
    if (!user) return;
    try {
      await api.social.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (e) {
      setError('تعذر تحديث الإشعارات. حاول مرة أخرى.');
    }
  };

  const handleNotificationClick = (n: Notification) => {
    if (!n.is_read) {
      markAsRead(n.id);
    }
    setOpen(false);
    if (n.type === 'video') {
      navigate('/library');
    }
  };

  const timeAgo = (dateStr: string) => {
    return notificationTimeAgo(dateStr);
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) void fetchNotifications(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="الإشعارات" className="relative rounded-full">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[min(24rem,calc(100vw-2rem))] p-0 overflow-hidden rounded-2xl shadow-xl" dir="rtl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h4 className="font-semibold text-sm">الإشعارات</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
              <CheckCheck className="h-3 w-3" />
              قراءة الكل
            </Button>
          )}
        </div>
        <div className="h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain" role="region" aria-label="قائمة الإشعارات" tabIndex={0}>
          {error && <div role="alert" className="p-3 text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => void fetchNotifications()}>إعادة المحاولة</Button></div>}
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {loading ? 'جارٍ تحميل الإشعارات…' : 'لا توجد إشعارات'}
            </div>
          ) : (
            <AnimatePresence>
              {notifications.map((n) => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={`flex gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors ${!n.is_read ? 'bg-primary/5' : ''}`}
                >
                  <div className="mt-0.5">{typeIcon(n.type)}</div>
                  <div 
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleNotificationClick(n)}
                  >
                    <p className="text-sm font-medium leading-tight hover:text-primary transition-colors">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {!n.is_read && (
                      <Button variant="ghost" size="icon" aria-label="تحديد الإشعار كمقروء" className="h-6 w-6" onClick={() => markAsRead(n.id)}>
                        <Check className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          {hasMore && <div className="p-3"><Button variant="outline" className="w-full" disabled={loading} onClick={() => void fetchNotifications(true)}>{loading ? 'جارٍ التحميل…' : 'عرض إشعارات أقدم'}</Button></div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

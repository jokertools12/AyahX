import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, Video, Trophy, User, Loader2, Users, Clock,
  Heart, MessageCircle, BookOpen,
} from 'lucide-react';

import { ErrorState } from '@/components/ErrorState';

interface ActivityItem {
  id: string;
  type: 'video' | 'achievement' | 'follow';
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  data: any;
}

export default function ActivityFeedPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followingCount, setFollowingCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    loadActivities();
  }, [user]);

  const loadActivities = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const res: any = await api.social.getFeed();
      if (res && typeof res === 'object' && 'activities' in res) {
        setFollowingCount(res.followingCount || 0);
        setActivities(res.activities || []);
      } else if (Array.isArray(res)) {
        setActivities(res);
      }
    } catch (err: any) {
      console.error('Failed to load feed:', err);
      setError('تعذر تحميل نشاط المتابَعين. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `منذ ${mins} دقيقة`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `منذ ${days} يوم`;
    return `منذ ${Math.floor(days / 30)} شهر`;
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            نشاط المتابَعين
          </h1>
          <p className="text-muted-foreground mt-1">
            آخر نشاطات {followingCount} مستخدم تتابعهم
          </p>
        </motion.div>

        {error ? (
          <ErrorState message={error} onRetry={loadActivities} />
        ) : followingCount === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">لم تتابع أحداً بعد</p>
              <p className="text-sm text-muted-foreground mb-4">تابع مستخدمين آخرين لرؤية نشاطاتهم هنا</p>
              <Button asChild>
                <Link to="/discover">اكتشف المستخدمين</Link>
              </Button>
            </CardContent>
          </Card>
        ) : activities.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">لا توجد نشاطات حديثة</p>
              <p className="text-sm text-muted-foreground">سيظهر هنا نشاط المستخدمين الذين تتابعهم</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {activities.map((activity, i) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <Link to={`/profile?id=${activity.user_id}`} aria-label={`الملف الشخصي لـ ${activity.display_name || 'مستخدم'}`}>
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                          {activity.avatar_url ? (
                            <img src={activity.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </Link>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/profile?id=${activity.user_id}`} className="font-medium hover:text-primary transition-colors">
                            {activity.display_name || 'مستخدم'}
                          </Link>
                          {activity.type === 'video' && (
                            <Badge variant="secondary" className="gap-1 text-xs">
                              <Video className="h-3 w-3" />
                              فيديو جديد
                            </Badge>
                          )}
                          {activity.type === 'achievement' && (
                            <Badge className="gap-1 text-xs bg-primary hover:bg-primary/90">
                              <Trophy className="h-3 w-3" />
                              إنجاز
                            </Badge>
                          )}
                        </div>

                        {activity.type === 'video' && (
                          <p className="text-sm text-muted-foreground mt-1">
                            أنشأ فيديو لسورة <span className="text-foreground font-medium">{activity.data.surah_name}</span>
                            {' '}بصوت <span className="text-foreground">{activity.data.reciter_name}</span>
                            {' '}(آية {activity.data.start_ayah}-{activity.data.end_ayah})
                          </p>
                        )}

                        {activity.type === 'achievement' && (
                          <p className="text-sm text-muted-foreground mt-1">
                            حصل على إنجاز: <span className="text-foreground font-medium">{activity.data.title}</span>
                          </p>
                        )}

                        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {timeAgo(activity.created_at)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

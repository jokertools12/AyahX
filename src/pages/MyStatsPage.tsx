import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Link, Navigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  Video, Star, Calendar, Crown, TrendingUp, BookOpen,
  Loader2, BarChart3, Heart, Mic, Clock, Music, Zap, Sparkles, Clock3, HardDrive,
} from 'lucide-react';
import { ErrorState } from '@/components/ErrorState';

interface VideoRecord {
  reciter_name: string;
  surah_name: string;
  created_at: string;
}

export default function MyStatsPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { isPremium, dailyUsage, subscription, entitlements } = useSubscription();
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [totalCreated, setTotalCreated] = useState(0);
  const [favReciters, setFavReciters] = useState<string[]>([]);
  const [favPerformers, setFavPerformers] = useState<string[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [vids, favsData] = await Promise.all([
        api.videos.getMy(),
        api.users.getFavorites(),
      ]);
      setVideos((vids as VideoRecord[]) || []);
      setFavorites(favsData?.surahs || []);
      setFavReciters(favsData?.reciters || []);
      setFavPerformers(favsData?.performers || []);
      setTotalCreated(vids?.length || 0);
    } catch (err) {
      console.error('Failed to load stats:', err);
      setError('تعذر تحميل الإحصائيات. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

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

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <ErrorState message={error} onRetry={load} />
        </div>
      </Layout>
    );
  }

  // ── Stats calculations ──
  const totalVideos = totalCreated;

  // Top reciters
  const reciterCounts: Record<string, number> = {};
  videos.forEach(v => { reciterCounts[v.reciter_name] = (reciterCounts[v.reciter_name] || 0) + 1; });
  const topReciters = Object.entries(reciterCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Top surahs
  const surahCounts: Record<string, number> = {};
  videos.forEach(v => { surahCounts[v.surah_name] = (surahCounts[v.surah_name] || 0) + 1; });
  const topSurahs = Object.entries(surahCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Weekly activity (last 7 days)
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });
    const count = videos.filter(v => v.created_at.startsWith(dateStr)).length;
    weeklyData.push({ date: dayName, videos: count });
  }

  // Monthly trend (last 6 months)
  const monthlyData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const month = d.toLocaleDateString('ar-EG', { month: 'short' });
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const count = videos.filter(v => v.created_at.startsWith(yearMonth)).length;
    monthlyData.push({ month, videos: count });
  }

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--quran-emerald))', 'hsl(var(--quran-gold))', 'hsl(var(--muted-foreground))'];

  const memberSince = subscription?.created_at
    ? new Date(subscription.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' })
    : '';

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" />
            إحصائياتي
          </h1>
          <p className="text-muted-foreground mt-1">ملخص نشاطك واستخدامك للمنصة</p>
        </motion.div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: 'الفيديوهات المنشأة', value: totalVideos, icon: Video, color: 'text-primary' },
            { label: 'المحفوظة', value: videos.length, icon: Video, color: 'text-accent' },
            { label: 'القراء المفضلون', value: favReciters.length, icon: Mic, color: 'text-accent' },
            { label: 'السور المفضلة', value: favorites.length, icon: Heart, color: 'text-destructive' },
            { label: 'المبتهلين المفضلين', value: favPerformers.length, icon: Music, color: 'text-primary' },
            { label: 'إجمالي المفضلة', value: favorites.length + favReciters.length + favPerformers.length, icon: Star, color: 'text-quran-gold' },
          ].map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Membership info */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
          <Card className={isPremium ? 'border-primary/50 bg-primary/5' : ''}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <Crown className={`h-6 w-6 ${isPremium ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="font-bold text-base">{isPremium ? 'عضوية مميزة ✨' : 'خطة مجانية'}</p>
                    {memberSince && <p className="text-xs text-muted-foreground">عضو منذ {memberSince}</p>}
                  </div>
                </div>
                {!isPremium && (
                  <Button asChild size="sm" className="gradient-primary text-primary-foreground">
                    <Link to="/pricing"><Crown className="h-4 w-4 ml-1" />ترقية للباقة المميزة</Link>
                  </Button>
                )}
              </div>

              {/* Multi-Engine Quotas Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/40 text-xs">
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-muted-foreground flex items-center gap-1 mb-1">
                    <Zap className="h-3.5 w-3.5 text-emerald-500" />
                    المتصفح الفوري
                  </span>
                  <span className="font-bold text-sm">
                    {dailyUsage.browserRenderLimit === null ? 'غير محدود' : `${dailyUsage.browserRenderLimit}/يوم`}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-muted-foreground flex items-center gap-1 mb-1">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    الإنتاج السحابي — FFmpeg
                  </span>
                  <span className="font-bold text-sm">
                    {entitlements.ffmpegAssDailyLimit} فيديو/يوم
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-muted-foreground flex items-center gap-1 mb-1">
                    <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                    الإنتاج السحابي — Skia
                  </span>
                  <span className="font-bold text-sm">
                    {entitlements.skiaCanvasDailyLimit} فيديو/يوم
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-muted-foreground flex items-center gap-1 mb-1">
                    <Clock3 className="h-3.5 w-3.5 text-primary" />
                    حفظ المكتبة
                  </span>
                  <span className="font-bold text-sm">
                    صالح 48 ساعة
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Charts Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Weekly Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="h-5 w-5" /> النشاط الأسبوعي</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Bar dataKey="videos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="فيديوهات" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Calendar className="h-5 w-5" /> التطور الشهري</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Area type="monotone" dataKey="videos" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} name="فيديوهات" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Top Reciters */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Mic className="h-5 w-5" /> القراء الأكثر استخداماً</CardTitle>
            </CardHeader>
            <CardContent>
              {topReciters.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">لا توجد بيانات بعد</p>
              ) : (
                <div className="h-52" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={topReciters} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="count" label={({ name, count }) => `${name}: ${count}`}>
                        {topReciters.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Surahs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><BookOpen className="h-5 w-5" /> السور الأكثر استخداماً</CardTitle>
            </CardHeader>
            <CardContent>
              {topSurahs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">لا توجد بيانات بعد</p>
              ) : (
                <div className="space-y-3">
                  {topSurahs.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-sm font-bold w-5 text-center text-muted-foreground">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-medium">{s.name}</span>
                          <Badge variant="secondary" className="text-xs">{s.count} فيديو</Badge>
                        </div>
                        <Progress value={(s.count / topSurahs[0].count) * 100} className="h-1.5" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* CTA */}
        {totalVideos === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8">
            <p className="text-muted-foreground mb-4">لم تنشئ أي فيديوهات بعد. ابدأ الآن!</p>
            <Button asChild size="lg">
              <Link to="/create"><Video className="h-5 w-5 ml-2" />إنشاء فيديو</Link>
            </Button>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}

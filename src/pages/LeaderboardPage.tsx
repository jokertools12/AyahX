import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trophy, Medal, Star, Video, Crown, Loader2, User,
} from 'lucide-react';
import { ErrorState } from '@/components/ErrorState';

interface LeaderboardEntry {
  user_id: string;
  display_name: string | null;
  points: number;
  achievement_count: number;
  video_count: number;
  rank: number;
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'points' | 'videos'>('points');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await api.achievements.getLeaderboard();
      const list: LeaderboardEntry[] = (raw || []).map((item: any) => ({
        user_id: item.user_id,
        display_name: item.display_name || null,
        points: Number(item.total_points || 0),
        achievement_count: Number(item.total_points || 0) > 0 ? Math.round(Number(item.total_points) / 10) : 0,
        video_count: Number(item.videos_count || 0),
        rank: 0,
      }));

      if (tab === 'points') {
        list.sort((a, b) => b.points - a.points);
      } else {
        list.sort((a, b) => b.video_count - a.video_count);
      }

      list.forEach((e, i) => { e.rank = i + 1; });
      setEntries(list.slice(0, 50));
    } catch (err) {
      console.error('Leaderboard load error:', err);
      setError('تعذر تحميل لوحة المتصدرين. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="h-6 w-6 text-quran-gold" />;
    if (rank === 2) return <Medal className="h-6 w-6 text-muted-foreground" />;
    if (rank === 3) return <Medal className="h-6 w-6 text-accent" />;
    return <span className="text-sm font-bold text-muted-foreground w-6 text-center">{rank}</span>;
  };

  const myRank = entries.find(e => e.user_id === user?.id);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            لوحة المتصدرين
          </h1>
          <p className="text-muted-foreground mt-1">أكثر المستخدمين نشاطاً وإنجازات</p>
        </motion.div>

        {/* My Rank Card */}
        {myRank && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="mb-6 border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold">ترتيبك الحالي</p>
                    <p className="text-sm text-muted-foreground">
                      #{myRank.rank} • {myRank.points} نقطة • {myRank.achievement_count} إنجاز
                    </p>
                  </div>
                </div>
                {getRankIcon(myRank.rank)}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid grid-cols-2 mb-6">
            <TabsTrigger value="points" className="gap-1">
              <Star className="h-4 w-4" />
              بالنقاط
            </TabsTrigger>
            <TabsTrigger value="videos" className="gap-1">
              <Video className="h-4 w-4" />
              بالفيديوهات
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab}>
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : entries.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  لا توجد بيانات بعد. كن أول من يحصل على إنجاز!
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {entries.map((entry, i) => {
                  const isMe = entry.user_id === user?.id;
                  return (
                    <motion.div key={entry.user_id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                      <Card className={`${isMe ? 'border-primary/50 bg-primary/5' : ''} ${entry.rank <= 3 ? 'shadow-md' : ''}`}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <div className="w-8 flex justify-center shrink-0">
                            {getRankIcon(entry.rank)}
                          </div>
                          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              <Link to={`/profile?id=${entry.user_id}`} aria-label={`الملف الشخصي لـ ${entry.display_name || 'مستخدم'}`} className="hover:text-primary transition-colors">
                                {entry.display_name || 'مستخدم'}
                              </Link>
                              {isMe && <Badge variant="secondary" className="mr-2 text-xs">أنت</Badge>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {entry.achievement_count} إنجاز • {entry.video_count} فيديو عام
                            </p>
                          </div>
                          <div className="text-left shrink-0">
                            <p className="font-bold text-primary text-lg">{tab === 'points' ? entry.points : entry.video_count}</p>
                            <p className="text-xs text-muted-foreground">{tab === 'points' ? 'نقطة' : 'فيديو عام'}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

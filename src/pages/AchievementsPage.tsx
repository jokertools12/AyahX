import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { useAchievements } from '@/hooks/useAchievements';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Navigate } from 'react-router-dom';
import {
  Trophy, Video, Heart, Mic, BookOpen, Crown, Star, Lock, Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/ErrorState';

const iconMap: Record<string, any> = {
  video: Video, heart: Heart, mic: Mic, 'book-open': BookOpen,
  crown: Crown, trophy: Trophy, star: Star,
};

const categoryNames: Record<string, string> = {
  videos: 'إنشاء الفيديوهات',
  engagement: 'التفاعل',
  exploration: 'الاستكشاف',
  membership: 'العضوية',
};

export default function AchievementsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { achievements, unlocked, totalPoints, loading, error, checkAndUnlock, refetch } = useAchievements();

  useEffect(() => {
    if (achievements.length > 0) checkAndUnlock();
  }, [achievements.length]);

  if (authLoading || loading) {
    return <Layout><div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  }
  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <ErrorState message={error} onRetry={refetch} />
        </div>
      </Layout>
    );
  }

  const categories = [...new Set(achievements.map(a => a.category))];
  const unlockedIds = new Set(unlocked.map(u => u.achievement_id));
  const progressPercent = achievements.length > 0 ? (unlocked.length / achievements.length) * 100 : 0;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            الإنجازات والجوائز
          </h1>
          <p className="text-muted-foreground mt-1">اجمع النقاط واحصل على شارات مميزة</p>
        </motion.div>

        {/* Points Summary */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="mb-8 border-primary/30 bg-primary/5">
            <CardContent className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                    <Star className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary">{totalPoints}</p>
                    <p className="text-sm text-muted-foreground">نقطة مكتسبة</p>
                  </div>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="flex justify-between text-sm mb-1">
                    <span>{unlocked.length} / {achievements.length} إنجاز</span>
                    <span>{Math.round(progressPercent)}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-3" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Achievements by Category */}
        {categories.map((cat, ci) => (
          <motion.div key={cat} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + ci * 0.1 }} className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              {categoryNames[cat] || cat}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {achievements.filter(a => a.category === cat).map(ach => {
                const isUnlocked = unlockedIds.has(ach.id);
                const Icon = iconMap[ach.icon] || Trophy;
                const unlockedAt = unlocked.find(u => u.achievement_id === ach.id)?.unlocked_at;

                return (
                  <Card key={ach.id} className={`transition-all ${isUnlocked ? 'border-primary/50 bg-primary/5' : 'opacity-60 grayscale'}`}>
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${isUnlocked ? 'bg-primary/20' : 'bg-muted'}`}>
                        {isUnlocked ? <Icon className="h-6 w-6 text-primary" /> : <Lock className="h-6 w-6 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm">{ach.title}</h3>
                          <Badge variant={isUnlocked ? 'default' : 'secondary'} className="text-xs">
                            {ach.points} نقطة
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{ach.description}</p>
                        {isUnlocked && unlockedAt && (
                          <p className="text-xs text-primary mt-1">
                            ✓ تم الحصول عليه {new Date(unlockedAt).toLocaleDateString('ar-EG')}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>
    </Layout>
  );
}

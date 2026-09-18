import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  User, Trophy, Video, Star, BookOpen, Mic, Share2, Loader2, UserPlus, UserCheck, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, Profile, SavedVideo } from '@/lib/api';
import { ErrorState } from '@/components/ErrorState';

interface ProfileData {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  followers_count?: number;
  following_count?: number;
}

type PublicVideo = SavedVideo;

interface AchievementData {
  id: string;
  title: string;
  points: number;
}

export default function ProfilePage() {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('id');
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [videos, setVideos] = useState<PublicVideo[]>([]);
  const [achievements, setAchievements] = useState<AchievementData[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [profileRes, videosData] = await Promise.all([
        api.users.getProfile(userId),
        api.videos.getPublic({ userId }),
      ]);

      setProfile(profileRes.profile as any);
      setIsFollowing(profileRes.isFollowing);
      setFollowersCount(profileRes.profile.followers_count || 0);
      setFollowingCount(profileRes.profile.following_count || 0);
      setVideos(videosData as any);
    } catch (err) {
      console.error('Failed to load profile:', err);
      setError('تعذر تحميل بيانات الملف الشخصي. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load, currentUser]);

  const toggleFollow = async () => {
    if (!currentUser || !userId) { toast.error('سجل دخول أولاً'); return; }
    if (userId === currentUser.id) return;
    setFollowLoading(true);
    try {
      const res = await api.users.toggleFollow(userId);
      setIsFollowing(res.isFollowing);
      setFollowersCount(res.followersCount);
    } catch {
      toast.error('فشل تحديث المتابعة');
    } finally {
      setFollowLoading(false);
    }
  };

  const shareProfile = () => {
    const url = `${window.location.origin}/profile?id=${userId}`;
    if (navigator.share) {
      navigator.share({ title: profile?.display_name || 'ملف شخصي', url });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('تم نسخ رابط الملف الشخصي');
    }
  };

  if (loading) {
    return <Layout><div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
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

  if (!profile) {
    return <Layout><div className="flex justify-center items-center min-h-[60vh] text-muted-foreground">لم يتم العثور على الملف الشخصي</div></Layout>;
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Profile Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mb-8 overflow-hidden">
            <div className="bg-gradient-to-br from-primary/20 to-accent/10 p-8 text-center">
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 border-4 border-background shadow-lg overflow-hidden">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <h1 className="text-2xl font-bold">{profile.display_name || 'مستخدم'}</h1>
              {profile.bio && <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{profile.bio}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                انضم {new Date(profile.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' })}
              </p>

              <div className="flex items-center justify-center gap-6 mt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{followersCount}</p>
                  <p className="text-xs text-muted-foreground">متابِع</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{followingCount}</p>
                  <p className="text-xs text-muted-foreground">يتابع</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{totalPoints}</p>
                  <p className="text-xs text-muted-foreground">نقطة</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{achievements.length}</p>
                  <p className="text-xs text-muted-foreground">إنجاز</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{videos.length}</p>
                  <p className="text-xs text-muted-foreground">فيديو عام</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mt-4">
                {currentUser && userId !== currentUser?.id && (
                  <Button size="sm" variant={isFollowing ? 'secondary' : 'default'} onClick={toggleFollow} disabled={followLoading} className="gap-1">
                    {isFollowing ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    {isFollowing ? 'متابَع' : 'متابعة'}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={shareProfile} className="gap-1">
                  <Share2 className="h-4 w-4" />
                  مشاركة
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Achievements */}
        {achievements.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              الإنجازات ({achievements.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {achievements.map(ach => (
                <Badge key={ach.id} variant="secondary" className="gap-1 px-3 py-1.5">
                  <Star className="h-3 w-3 text-primary" />
                  {ach.title}
                </Badge>
              ))}
            </div>
          </motion.div>
        )}

        {/* Public Videos */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            الفيديوهات العامة ({videos.length})
          </h2>
          {videos.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                لا توجد فيديوهات عامة
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videos.map(v => (
                <Card key={v.id} className="overflow-hidden">
                  <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-4 text-center">
                    <BookOpen className="h-8 w-8 text-primary mx-auto mb-1" />
                    <h3 className="font-bold">{v.surah_name}</h3>
                    <p className="text-xs text-muted-foreground">آية {v.start_ayah} - {v.end_ayah}</p>
                  </div>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Mic className="h-3.5 w-3.5" />
                      <span>{v.reciter_name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(v.created_at).toLocaleDateString('ar-EG')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </Layout>
  );
}
